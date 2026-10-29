import io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import httpx,numpy as np,soundfile as sf
import studio_api as studio

class StudioTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.data=patch.object(studio,'DATA',Path(self.tmp.name));self.data.start()
  self.jobs=[]
  def launch(coro):self.jobs.append(coro.cr_code.co_name);coro.close()
  self.launch=patch.object(studio,'launch',side_effect=launch);self.launch.start()
  self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=studio.app),base_url='http://test')
  self.pid='abcdef012345';studio.save({'id':self.pid,'title':'Test','duration':10,'tracks':[],'status':'ready','settings':{}})
 async def asyncTearDown(self):
  await self.client.aclose();self.launch.stop();self.data.stop();self.tmp.cleanup()
 def wav(self):
  data=io.BytesIO();sf.write(data,.1*np.sin(np.arange(4800)*2*np.pi*220/48000),48000,format='WAV',subtype='PCM_16');return data.getvalue()
 async def test_take_audio_offset_raw_pitch_and_mix_survive_reopening(self):
  data=self.wav();points=[{'t':0,'midi':57,'conf':.9}]
  r=await self.client.post(f'/projects/{self.pid}/takes',files={'file':('voice.wav',data)},data={'start':'2.5','name':'My take','raw':json.dumps(points)})
  self.assertEqual(r.status_code,200);t=r.json()['tracks'][0];self.assertEqual(t['start'],2.5);self.assertAlmostEqual(t['duration'],.1);self.assertNotIn('path',t)
  audio=await self.client.get(f'/projects/{self.pid}/tracks/{t["id"]}/audio');self.assertEqual(audio.content,data)
  part=await self.client.get(f'/projects/{self.pid}/tracks/{t["id"]}/audio',headers={'Range':'bytes=0-31'});self.assertEqual(part.status_code,206);self.assertEqual(part.content,data[:32])
  await self.client.patch(f'/projects/{self.pid}/tracks/{t["id"]}',json={'muted':True,'solo':True,'volume':.4})
  await self.client.patch(f'/projects/{self.pid}/settings',json={'referenceSmooth':80,'showRaw':True})
  reopened=(await self.client.get(f'/projects/{self.pid}')).json();self.assertTrue(reopened['tracks'][0]['muted']);self.assertEqual(reopened['settings']['referenceSmooth'],80)
  raw=(await self.client.get(f'/projects/{self.pid}/tracks/{t["id"]}/pitch')).json();self.assertEqual(raw['contour'],points)
  self.assertEqual(self.jobs,['analyze_track'])
 async def test_upload_decodes_real_audio_and_queues_separation(self):
  r=await self.client.post('/projects/upload',files={'file':('song.wav',self.wav())});self.assertEqual(r.status_code,200);p=r.json();self.assertEqual(p['status'],'uploaded');self.assertEqual(p['tracks'][0]['kind'],'original');self.assertAlmostEqual(p['duration'],.1);self.assertEqual(self.jobs,['process_upload'])
 async def test_bad_upload_and_unknown_track_are_explicit_errors(self):
  r=await self.client.post('/projects/upload',files={'file':('bad.wav',b'not audio')});self.assertEqual(r.status_code,422)
  r=await self.client.get(f'/projects/{self.pid}/tracks/missing/audio');self.assertEqual(r.status_code,404)
  r=await self.client.patch(f'/projects/{self.pid}/tracks/missing',json={'volume':.5});self.assertEqual(r.status_code,404)
 async def test_retry_runs_on_event_loop(self):
  studio.update(self.pid,lambda p:p.update(status='error',source='/tmp/audio.wav'))
  r=await self.client.post(f'/projects/{self.pid}/retry');self.assertEqual(r.status_code,200);self.assertEqual(self.jobs,['process_upload'])

if __name__=='__main__':unittest.main()
