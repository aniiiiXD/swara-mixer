"""Local singing studio. Durable projects; heavy audio work runs off the API loop."""
from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import re
import sys
import subprocess
import threading
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'packages/core'), str(ROOT / 'apps/coach/backend')]
# Reuse the installed song library, without changing the coach's files.
DESKTOP = Path.home() / 'Library/Application Support/studio.tonic.desktop'
os.environ.setdefault('STORAGE_DIR', str(DESKTOP / 'storage'))
os.environ.setdefault('KARAOKE_CACHE', str(DESKTOP / 'cache/karaoke'))
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
import numpy as np
import soundfile as sf
from app.services import pitch, songs
from stemcore.ingest.audiofile import decode_audio_bytes
from stemcore.stems.demucs import separate

DATA = Path(os.environ.get('STUDIO_DATA', str(Path(__file__).resolve().parents[1] / '.data')))
DATA.mkdir(parents=True, exist_ok=True)
LOCK = threading.RLock()
TASKS: set[asyncio.Task] = set()
HEAVY = asyncio.Semaphore(1)
COLORS = {'vocals':'#91c6e8','drums':'#a6bca5','bass':'#b6acd3','other':'#c4b99d','take':'#efba91','original':'#91c6e8'}


def folder(pid):
    if not re.fullmatch(r'[a-f0-9]{12}', pid):
        raise HTTPException(404, 'Session not found')
    return DATA / pid


def read(pid):
    try:
        with LOCK:
            return json.loads((folder(pid) / 'project.json').read_text())
    except FileNotFoundError:
        raise HTTPException(404, 'Session not found')


def save(project):
    with LOCK:
        directory = folder(project['id']); directory.mkdir(exist_ok=True)
        temporary = directory / 'project.tmp'
        temporary.write_text(json.dumps(project))
        temporary.replace(directory / 'project.json')
    return project


def update(pid, change):
    with LOCK:
        p = read(pid); change(p); return save(p)


def public(p):
    # File access is only through validated project + track ids.
    return {**{k:v for k,v in p.items() if k not in ('source','legacy')}, 'tracks': [{k:v for k,v in t.items() if k != 'path'} for t in p['tracks']]}


def waveform(path):
    y, sr = sf.read(path, dtype='float32', always_2d=True)
    mono = np.max(np.abs(y), axis=1)
    peaks = [round(float(np.max(block)), 4) for block in np.array_split(mono, min(1400, len(mono))) if len(block)]
    return len(y) / sr, peaks


def track(path, name, kind, start=0):
    duration, peaks = waveform(path)
    return {'id':uuid.uuid4().hex[:12], 'name':name, 'kind':kind, 'path':str(path), 'start':start, 'duration':duration, 'peaks':peaks, 'volume':1., 'muted':False, 'solo':False, 'color':COLORS[kind], 'analysis':'pending' if kind in ('vocals','take') else 'none'}


def launch(coro):
    task = asyncio.create_task(coro); TASKS.add(task); task.add_done_callback(TASKS.discard)


def add_levels(result, audio_path):
    y,sr=sf.read(audio_path,dtype='float32',always_2d=True)
    y=y.mean(axis=1).astype(np.float64)
    sums=np.concatenate(([0.],np.cumsum(y*y)))
    half=int(sr*.025)
    for point in result['contour']:
        center=int(point['t']*sr);lo=max(0,center-half);hi=min(len(y),center+half)
        point['rms']=float(np.sqrt(max(0.,sums[hi]-sums[lo])/max(1,hi-lo))) if hi>lo else 0.
    return result


def write_pitch(pid, tid, result):
    path = folder(pid) / f'{tid}.pitch.json'
    temp = path.with_suffix('.tmp'); temp.write_text(json.dumps(result)); temp.replace(path)
    def done(p):
        for t in p['tracks']:
            if t['id'] == tid: t['analysis'] = 'ready'; t.pop('analysisError', None)
    update(pid, done)


async def analyze_track(pid, tid, legacy=None):
    try:
        t = next(t for t in read(pid)['tracks'] if t['id'] == tid)
        async with HEAVY:
            if legacy:
                result = await run_in_threadpool(songs.reference, legacy)
            else:
                result = await run_in_threadpool(lambda: pitch.analyze(Path(t['path']).read_bytes(), raw=True))
        result = await run_in_threadpool(add_levels, result, t['path'])
        await run_in_threadpool(write_pitch, pid, tid, result)
    except Exception as exc:
        def failed(p):
            for t in p['tracks']:
                if t['id'] == tid: t['analysis'] = 'error'; t['analysisError'] = str(exc)
        update(pid, failed)


async def process_upload(pid):
    try:
        p = read(pid)
        update(pid, lambda p:p.update(status='separating', progress=0, error=None))
        async def progress(value):
            update(pid, lambda p:p.update(progress=round(value)))
        async with HEAVY:
            stems = await separate(p['source'], folder(pid) / 'stems', on_progress=progress)
        new_tracks = await run_in_threadpool(lambda:[track(stems[k], {'vocals':'Singer','drums':'Drums','bass':'Bass','other':'Instruments'}[k], k) for k in ('vocals','drums','bass','other') if k in stems])
        if not any(t['kind'] == 'vocals' for t in new_tracks):
            raise RuntimeError('Separation did not produce a vocal track')
        def done(p):
            # Keep the upload as a muted source and any takes already recorded.
            for t in p['tracks']:
                if t['kind'] == 'original': t['muted'] = True; t['solo'] = False
            p['tracks'] = new_tracks + p['tracks']; p.update(status='ready', progress=100)
        update(pid, done)
        vocal = next(t for t in new_tracks if t['kind'] == 'vocals')
        await analyze_track(pid, vocal['id'])
    except Exception as exc:
        update(pid, lambda p:p.update(status='error', error=str(exc)))


@asynccontextmanager
async def lifespan(app):
    for path in DATA.glob('*/project.json'):
        p = json.loads(path.read_text())
        if p['status'] in ('uploaded','separating'):
            launch(process_upload(p['id']))
        else:
            for t in p['tracks']:
                if t.get('analysis') == 'pending': launch(analyze_track(p['id'], t['id'], p.get('legacy') if t['kind']=='vocals' else None))
    yield
    for task in list(TASKS): task.cancel()
    await asyncio.gather(*TASKS, return_exceptions=True)

app = FastAPI(title='Tonic Studio', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origin_regex=r'http://(localhost|127\.0\.0\.1):\d+', allow_methods=['*'], allow_headers=['*'], expose_headers=['Content-Length','Accept-Ranges','Content-Range'])

@app.get('/health')
def health(): return {'status':'ok'}

@app.get('/library')
def library(): return songs.list_songs()

@app.get('/projects')
def projects():
    with LOCK:
        return [public(json.loads(p.read_text())) for p in sorted(DATA.glob('*/project.json'), key=lambda p:p.stat().st_mtime, reverse=True)]

@app.get('/projects/{pid}')
def project(pid:str): return public(read(pid))

class LibraryImport(BaseModel):
    jobId: str = Field(pattern=r'^[a-f0-9]+$')

@app.post('/projects/library')
async def from_library(body:LibraryImport):
    if not any(s['jobId'] == body.jobId for s in songs.list_songs()): raise HTTPException(404, 'Song not found')
    pid = uuid.uuid4().hex[:12]
    meta = songs._song_entry(body.jobId)
    tracks = await run_in_threadpool(lambda:[track(songs._stem_path(body.jobId,k), name, k) for k,name in [('vocals','Singer'),('drums','Drums'),('bass','Bass'),('other','Instruments')] if songs._stem_path(body.jobId,k)])
    p = save({'id':pid,'title':meta['title'],'duration':max(t['duration'] for t in tracks), 'tracks':tracks,'status':'ready','progress':100,'settings':{},'legacy':body.jobId})
    for t in tracks:
        if t['kind']=='vocals': launch(analyze_track(pid,t['id'],body.jobId))
    return public(p)

async def receive(file, path, limit=1024*1024*1024):
    size=0
    with path.open('wb') as out:
        while chunk := await file.read(1024*1024):
            size += len(chunk)
            if size > limit:
                out.close(); path.unlink(missing_ok=True); raise HTTPException(413,'Audio file is too large (1 GB maximum)')
            out.write(chunk)
    if not size: path.unlink(missing_ok=True); raise HTTPException(400,'Choose a non-empty audio file')


def normalize(source, target):
    # Container decoding only; no denoising, tuning or compression.
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-vn','-c:a','pcm_s24le',str(target)],check=True,capture_output=True)
    return track(target, 'Original song', 'original')

@app.post('/projects/upload')
async def upload(file:UploadFile=File(...)):
    pid=uuid.uuid4().hex[:12]; directory=folder(pid); directory.mkdir()
    source=directory/'upload.audio'
    await receive(file, source)
    try:
        t=await run_in_threadpool(normalize,source,directory/'original.wav')
    except Exception as exc:
        source.unlink(missing_ok=True); raise HTTPException(422,f'Cannot decode this audio file: {exc}')
    p=save({'id':pid,'title':Path(file.filename or 'Untitled song').stem,'duration':t['duration'],'tracks':[t],'source':str(directory/'original.wav'),'status':'uploaded','progress':0,'settings':{}})
    launch(process_upload(pid))
    return public(p)

class TrackChange(BaseModel):
    name:str|None=Field(default=None,min_length=1,max_length=120)
    volume:float|None=Field(default=None,ge=0,le=2)
    muted:bool|None=None
    solo:bool|None=None
    start:float|None=Field(default=None,ge=0,le=86400)

@app.patch('/projects/{pid}/tracks/{tid}')
def change_track(pid:str,tid:str,body:TrackChange):
    if not any(t['id']==tid for t in read(pid)['tracks']): raise HTTPException(404,'Track not found')
    def change(p):
        for t in p['tracks']:
            if t['id']==tid: t.update(body.model_dump(exclude_none=True))
    return public(update(pid,change))

@app.patch('/projects/{pid}/settings')
def settings(pid:str,body:dict):
    return public(update(pid,lambda p:p['settings'].update(body)))

@app.post('/projects/{pid}/retry')
async def retry(pid:str):
    p=read(pid)
    if p['status']=='error' and p.get('source'):
        update(pid,lambda p:p.update(status='uploaded',error=None)); launch(process_upload(pid))
    else:
        for t in p['tracks']:
            if t['analysis']=='error':
                update(pid,lambda p:[t.update(analysis='pending') for t in p['tracks'] if t['analysis']=='error'])
                launch(analyze_track(pid,t['id'],p.get('legacy') if t['kind']=='vocals' else None))
    return public(read(pid))

@app.post('/projects/{pid}/takes')
async def take(pid:str,file:UploadFile=File(...),start:float=Form(...),name:str=Form('My vocals'),raw:str=Form('[]')):
    p=read(pid)
    if not np.isfinite(start) or start < 0 or start > 86400: raise HTTPException(422,'Invalid recording position')
    path=folder(pid)/f'{uuid.uuid4().hex}.wav'
    await receive(file,path)
    try: t=await run_in_threadpool(track,path,name[:120],'take',start)
    except Exception: path.unlink(missing_ok=True); raise HTTPException(422,'Recording must be a valid WAV file')
    def append(p):
        p['tracks'].append(t); p['duration']=max(p['duration'],start+t['duration'])
    update(pid,append)
    try:
        points=json.loads(raw)
        if isinstance(points,list) and len(points)<=200000 and all(isinstance(p,dict) and isinstance(p.get('t'),(float,int)) and isinstance(p.get('conf'),(float,int)) and (p.get('midi') is None or isinstance(p.get('midi'),(float,int))) for p in points):
            (folder(pid)/f"{t['id']}.pitch.json").write_text(json.dumps({'engine':'live-mpm','contour':points,'duration':t['duration']}))
    except (ValueError,TypeError):
        pass
    launch(analyze_track(pid,t['id']))
    return public(read(pid))

@app.get('/projects/{pid}/tracks/{tid}/audio')
def audio(pid:str,tid:str):
    t=next((t for t in read(pid)['tracks'] if t['id']==tid),None)
    if not t: raise HTTPException(404,'Track not found')
    return FileResponse(t['path'],media_type='audio/wav',filename=f"{t['name']}.wav")

@app.get('/projects/{pid}/tracks/{tid}/pitch')
def contour(pid:str,tid:str):
    t=next((t for t in read(pid)['tracks'] if t['id']==tid),None)
    if not t: raise HTTPException(404,'Track not found')
    path=folder(pid)/f'{tid}.pitch.json'
    if not path.exists(): raise HTTPException(409,'Pitch analysis is still running')
    return json.loads(path.read_text())
