// public/worklets/pcm-processor.js
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.started = false;
    this.port.onmessage = (evt) => {
      if (evt.data?.type === 'start') this.started = true;
    };
  }

  process(inputs) {
    if (!this.started) return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const f32 = input[0]; // mono
    // convert Float32 [-1,1] → Int16 LE
    const buf = new ArrayBuffer(f32.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < f32.length; i++) {
      let s = Math.max(-1, Math.min(1, f32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    this.port.postMessage({ type: 'chunk', payload: buf }, [buf]);
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
