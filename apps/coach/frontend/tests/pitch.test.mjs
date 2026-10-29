import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';

// Exercise the real detector with generated waveforms; only browser I/O is fake.
const source = new URL('../src/lib/pitch.ts', import.meta.url);
const module = new Module(source.pathname);
module.paths = Module._nodeModulePaths(new URL('..', import.meta.url).pathname);
module._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, source.pathname);
const {LiveDetector} = module.exports;

test('quiet voice, live tuning, silence and mic cleanup', async () => {
  let callback, context, stopped = false, opens = 0;
  globalThis.requestAnimationFrame = fn => { callback=fn; return 1; };
  globalThis.cancelAnimationFrame = () => { callback=null; };
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{mediaDevices:{getUserMedia:async()=>{opens++;return {getTracks:()=>[{stop:()=>{stopped=true;}}]};}}}});
  globalThis.AudioContext = class {
    currentTime=0; sampleRate=48000; amplitude=.0045; hz=220; inputGain={value:1,setTargetAtTime(value){this.value=value;}};
    constructor(){context=this;}
    async resume(){} async close(){}
    createMediaStreamSource(){return {connect(){}};}
    createBiquadFilter(){return {frequency:{value:0},connect(){}};}
    createGain(){return {gain:this.inputGain,connect(){}};}
    createAnalyser(){const c=this;return {fftSize:4096,smoothingTimeConstant:0,getFloatTimeDomainData(buffer){for(let i=0;i<buffer.length;i++)buffer[i]=c.amplitude*c.inputGain.value*Math.sin(2*Math.PI*c.hz*i/c.sampleRate);}};}
  };
  globalThis.MediaRecorder = class {
    state='inactive'; mimeType='audio/webm';
    start(){this.state='recording';} pause(){this.state='paused';} resume(){this.state='recording';}
    stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.());}
  };
  const samples=[];
  const detector=new LiveDetector({minRms:10**(-54/20),minClarity:.78,smoothingFrames:3,onSample:s=>samples.push(s)});
  await detector.start();
  const frames=n=>{for(let i=0;i<n;i++){context.currentTime+=.04;callback?.();}};
  frames(12);
  assert(samples.at(-1).rms<.006,'Fixture must be quieter than the old gate');
  assert(Math.abs(samples.at(-1).midi-57)<.1,'Quiet A3 should register');
  detector.configure({minRms:.01});frames(6);
  assert.equal(samples.at(-1).midi,null,'A raised gate should reject this input');
  detector.configure({gain:4});frames(8);
  assert(Math.abs(samples.at(-1).midi-57)<.1,'Live gain should recover the same pitch');
  assert.equal(opens,1,'Tuning must not reopen the microphone');
  context.amplitude=0;frames(8);assert.equal(samples.at(-1).midi,null,'Silence must not paint a stale note');
  context.amplitude=.03;context.hz=65.406;frames(12);assert(Math.abs(samples.at(-1).midi-36)<.1,'Low C2 remains detectable');
  await detector.stop();assert(stopped);assert.equal(callback,null);
});
