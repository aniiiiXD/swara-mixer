/* Capture original mono PCM against the transport's AudioContext sample clock. */
class TonicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.start = Infinity;
    this.end = Infinity;
    this.record = [];
    this.monitor = [];
    this.port.onmessage = ({ data }) => {
      if (data.kind === "start") {
        this.start = Math.round(data.time * sampleRate);
        this.end = Infinity;
        this.record = [];
      }
      if (data.kind === "stop") {
        this.end = Math.round(data.time * sampleRate);
        if (currentFrame >= this.end) this.finish();
      }
    };
  }
  send(kind, values, time) {
    const samples = Float32Array.from(values);
    this.port.postMessage({ kind, samples, time }, [samples.buffer]);
  }
  finish() {
    if (this.record.length) this.send("audio", this.record);
    this.record = [];
    this.start = Infinity;
    this.end = Infinity;
    this.port.postMessage({ kind: "done" });
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) {
      if (currentFrame >= this.end) this.finish();
      return true;
    }
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      const frame = currentFrame + i;
      this.monitor.push(sample);
      if (this.monitor.length === 2048) {
        this.send("pitch", this.monitor, (frame + 1) / sampleRate);
        this.monitor = [];
      }
      if (frame >= this.start && frame < this.end) {
        this.record.push(sample);
        if (this.record.length === 8192) {
          this.send("audio", this.record);
          this.record = [];
        }
      }
      if (frame >= this.end) this.finish();
    }
    return true;
  }
}
registerProcessor("tonic-capture", TonicCapture);
