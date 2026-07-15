class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
  }

  // Simple linear resampler from input sampleRate to 16000
  _resample(input, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) return input;
    const ratio = inputSampleRate / outputSampleRate;
    const outLength = Math.round(input.length / ratio);
    const out = new Float32Array(outLength);
    let pos = 0;
    for (let i = 0; i < outLength; i++) {
      out[i] = input[Math.floor(pos)];
      pos += ratio;
    }
    return out;
  }

  _floatTo16BitPCM(float32Array) {
    const l = float32Array.length;
    const buf = new ArrayBuffer(l * 2);
    const view = new DataView(buf);
    let offset = 0;
    for (let i = 0; i < l; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const samples = input[0];
      const resampled = this._resample(samples, sampleRate, 16000);
      const pcm16 = this._floatTo16BitPCM(resampled);
      this.port.postMessage(pcm16, [pcm16]);
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
