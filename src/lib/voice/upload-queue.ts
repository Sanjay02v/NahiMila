/** Batch ordered PCM uploads so one slow HTTP round trip does not drop speech. */
export class VoiceUploadQueue {
  private chunks: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private sequence = 0;
  private bytes = 0;
  private closed = false;
  private failure: unknown = null;
  constructor(
    private send: (sequence: number, audio: string) => Promise<void>,
    private onError: (e: unknown) => void,
  ) {}
  enqueue(buffer: ArrayBuffer) {
    if (this.closed) return;
    const chunk = new Uint8Array(buffer);
    if (
      !chunk.length ||
      chunk.length % 2 ||
      this.bytes + chunk.length > 672000
    ) {
      this.onError(new Error("VOICE_FILE_TOO_LARGE"));
      this.cancel();
      return;
    }
    this.bytes += chunk.length;
    this.chunks.push(chunk);
    if (!this.timer && !this.running)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.drain().catch(this.onError);
      }, 500);
  }
  private drain(): Promise<void> {
    if (this.running) return this.running;
    const task = async () => {
      while (this.chunks.length && !this.closed) {
        const batch: Uint8Array[] = [];
        let size = 0;
        while (this.chunks.length && size + this.chunks[0].length <= 32000) {
          const chunk = this.chunks.shift()!;
          batch.push(chunk);
          size += chunk.length;
        }
        if (!size) throw new Error("VOICE_FILE_TOO_LARGE");
        const pcm = new Uint8Array(size);
        let offset = 0;
        for (const c of batch) {
          pcm.set(c, offset);
          offset += c.length;
        }
        let binary = "";
        for (const b of pcm) binary += String.fromCharCode(b);
        await this.send(this.sequence++, btoa(binary));
      }
    };
    this.running = task()
      .catch((e) => {
        this.failure = e;
        this.closed = true;
        this.chunks = [];
        throw e;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  async finish() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.failure) throw this.failure;
    await this.drain();
    if (this.failure) throw this.failure;
  }
  cancel() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.chunks = [];
  }
}
