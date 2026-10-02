/* global AudioWorkletProcessor, sampleRate, registerProcessor */
// 200ms mono PCM chunks at 16kHz. Audio never plays through the output.
class NahiMilaPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.buffer = new Int16Array(3200);
    this.used = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush" && this.used) {
        const tail = this.buffer.slice(0, this.used);
        this.port.postMessage(tail.buffer, [tail.buffer]);
        this.used = 0;
      }
      if (e.data === "flush") this.port.postMessage({ flushed: true });
    };
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const sample of samples) {
      this.sum += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.buffer[this.used++] = Math.round(
          value * (value < 0 ? 32768 : 32767),
        );
        if (this.used === 3200) {
          this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
          this.buffer = new Int16Array(3200);
          this.used = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("nahimila-pcm", NahiMilaPCM);
