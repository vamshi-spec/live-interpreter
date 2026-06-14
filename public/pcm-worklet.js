// AudioWorklet that downsamples the mic to 16 kHz mono and emits 16-bit PCM frames.
// Runs on the audio render thread; posts ArrayBuffers back to the main thread.
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.inputRate = sampleRate; // the context's native rate (often 48000)
    this.ratio = this.inputRate / this.targetRate;
    this._frac = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0]; // mono (we request 1 channel)
    if (!ch || ch.length === 0) return true;

    // Linear-interpolation downsample to 16 kHz.
    const out = [];
    let idx = this._frac;
    while (idx < ch.length) {
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, ch.length - 1);
      const frac = idx - i0;
      const sample = ch[i0] * (1 - frac) + ch[i1] * frac;
      // float [-1,1] -> int16
      const s = Math.max(-1, Math.min(1, sample));
      out.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      idx += this.ratio;
    }
    this._frac = idx - ch.length;

    const pcm = new Int16Array(out);
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
