type TimerHandle = ReturnType<typeof setTimeout>;
export type TimerFunctions = {
  setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout?: (timer: TimerHandle) => void;
};

export type DeltaCoalescerOptions = TimerFunctions & {
  intervalMs?: number;
  maxChunkBytes?: number;
};

export class DeltaCoalescer {
  readonly #flush: (text: string) => Promise<void>;
  readonly #intervalMs: number;
  readonly #maxChunkBytes: number;
  readonly #setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  readonly #clearTimeout: (timer: TimerHandle) => void;
  #pending = "";
  #pendingBytes = 0;
  #timer: TimerHandle | undefined;
  #flushChain: Promise<void> = Promise.resolve();
  #failure: unknown;
  #ended = false;
  #endPromise: Promise<void> | undefined;

  constructor(flush: (text: string) => Promise<void>, options: DeltaCoalescerOptions = {}) {
    this.#flush = flush;
    this.#intervalMs = options.intervalMs ?? 50;
    this.#maxChunkBytes = options.maxChunkBytes ?? 256 * 1024;
    if (!Number.isInteger(this.#maxChunkBytes) || this.#maxChunkBytes < 1) {
      throw new RangeError("maxChunkBytes deve ser um inteiro positivo.");
    }
    this.#setTimeout = options.setTimeout ?? setTimeout;
    this.#clearTimeout = options.clearTimeout ?? clearTimeout;
  }

  async add(text: string): Promise<void> {
    if (this.#ended) throw new Error("Não é possível adicionar texto após end().");
    this.#throwFailure();

    for (const character of text) {
      const characterBytes = Buffer.byteLength(character, "utf8");
      if (characterBytes > this.#maxChunkBytes) {
        throw new RangeError("Um caractere excede o limite de maxChunkBytes.");
      }
      if (this.#pendingBytes > 0 && this.#pendingBytes + characterBytes > this.#maxChunkBytes) {
        await this.#flushPending();
      }
      this.#pending += character;
      this.#pendingBytes += characterBytes;
      if (this.#pendingBytes >= this.#maxChunkBytes) await this.#flushPending();
      else this.#ensureTimer();
    }
  }

  end(): Promise<void> {
    if (this.#endPromise) return this.#endPromise;
    this.#ended = true;
    this.#clearTimer();
    const remaining = this.#takePending();
    if (remaining) this.#enqueueFlush(remaining);
    this.#endPromise = this.#flushChain.then(() => this.#throwFailure());
    return this.#endPromise;
  }

  #ensureTimer(): void {
    if (this.#timer !== undefined || this.#pendingBytes === 0) return;
    this.#timer = this.#setTimeout(() => {
      this.#timer = undefined;
      const text = this.#takePending();
      if (text) this.#enqueueFlush(text);
    }, this.#intervalMs);
  }

  #flushPending(): Promise<void> {
    this.#clearTimer();
    const text = this.#takePending();
    return text ? this.#enqueueFlush(text) : this.#flushChain;
  }

  #takePending(): string {
    const text = this.#pending;
    this.#pending = "";
    this.#pendingBytes = 0;
    return text;
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    this.#clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #enqueueFlush(text: string): Promise<void> {
    this.#flushChain = this.#flushChain
      .then(async () => {
        this.#throwFailure();
        await this.#flush(text);
      })
      .catch((error: unknown) => {
        this.#failure ??= error;
        throw error;
      });
    // Timer callbacks have no caller to observe a rejection; end() still reports it.
    void this.#flushChain.catch(() => undefined);
    return this.#flushChain;
  }

  #throwFailure(): void {
    if (this.#failure !== undefined) throw this.#failure;
  }
}
