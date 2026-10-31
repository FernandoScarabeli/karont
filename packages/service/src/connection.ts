import type { Writable } from "node:stream";
import { encodeFrame, FrameTooLargeError } from "./wire.ts";

export { FrameTooLargeError };

export class ConnectionClosedError extends Error {
  constructor() {
    super("A conexão foi fechada antes do envio da mensagem.");
    this.name = "ConnectionClosedError";
  }
}

type PendingWrite = {
  frame: Buffer;
  resolve: () => void;
  reject: (error: Error) => void;
  counted: boolean;
};

export const MAX_PENDING_FRAME_BYTES = 8 * 1024 * 1024;

export class FrameWriter {
  readonly #writable: Writable;
  readonly #queue: PendingWrite[] = [];
  readonly #pendingWrites = new Set<PendingWrite>();
  readonly #idleListeners = new Set<() => void>();
  #current: PendingWrite | undefined;
  #closedError: ConnectionClosedError | undefined;
  #pendingBytes = 0;
  #waitingForDrain = false;
  #writing = false;
  #drainObservedDuringWrite = false;

  constructor(writable: Writable) {
    this.#writable = writable;
    writable.on("drain", this.#onDrain);
    writable.on("close", this.#onClose);
    writable.on("error", this.#onError);
    if (writable.destroyed || writable.writableEnded) this.#markClosed();
  }

  get pendingBytes(): number {
    return this.#pendingBytes;
  }

  canSendWithinBudget(value: unknown, maxBytes = MAX_PENDING_FRAME_BYTES): boolean {
    try {
      return this.#pendingBytes + encodeFrame(value).byteLength <= maxBytes;
    } catch {
      return false;
    }
  }

  onIdle(listener: () => void): () => void {
    this.#idleListeners.add(listener);
    if (this.#pendingBytes === 0) queueMicrotask(listener);
    return () => this.#idleListeners.delete(listener);
  }

  send(value: unknown): Promise<void> {
    if (this.#closedError) return Promise.reject(this.#closedError);
    let frame: Buffer;
    try {
      frame = encodeFrame(value);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<void>((resolve, reject) => {
      const pending: PendingWrite = { frame, resolve, reject, counted: true };
      this.#pendingWrites.add(pending);
      this.#pendingBytes += frame.byteLength;
      this.#queue.push(pending);
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#closedError || this.#waitingForDrain || this.#current) return;
    while (this.#queue.length > 0) {
      const pending = this.#queue.shift();
      if (!pending) return;
      this.#current = pending;
      this.#writing = true;
      let canContinue: boolean;
      try {
        canContinue = this.#writable.write(pending.frame, (error?: Error | null) => {
          if (error) {
            this.#release(pending);
            pending.reject(error);
            this.#markClosed(error);
            return;
          }
          this.#release(pending);
        });
      } catch (error) {
        this.#writing = false;
        this.#drainObservedDuringWrite = false;
        this.#current = undefined;
        this.#release(pending);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      this.#writing = false;
      if (this.#closedError) return;
      if (!canContinue && !this.#drainObservedDuringWrite) {
        this.#waitingForDrain = true;
        return;
      }
      this.#drainObservedDuringWrite = false;
      this.#current = undefined;
      pending.resolve();
    }
  }

  #onDrain = (): void => {
    if (this.#closedError) return;
    if (this.#writing) {
      this.#drainObservedDuringWrite = true;
      return;
    }
    if (!this.#waitingForDrain) return;
    this.#waitingForDrain = false;
    const completed = this.#current;
    this.#current = undefined;
    completed?.resolve();
    this.#pump();
  };

  #onClose = (): void => this.#markClosed();

  #onError = (error: Error): void => {
    this.#markClosed(error);
  };

  #release(pending: PendingWrite): void {
    if (!pending.counted) return;
    pending.counted = false;
    this.#pendingWrites.delete(pending);
    this.#pendingBytes = Math.max(0, this.#pendingBytes - pending.frame.byteLength);
    if (this.#pendingBytes !== 0 || this.#closedError) return;
    for (const listener of this.#idleListeners) listener();
  }

  #markClosed(_cause?: Error): void {
    if (this.#closedError) return;
    this.#closedError = new ConnectionClosedError();
    this.#current?.reject(this.#closedError);
    this.#current = undefined;
    this.#waitingForDrain = false;
    for (const pending of this.#queue.splice(0)) pending.reject(this.#closedError);
    for (const pending of this.#pendingWrites) pending.counted = false;
    this.#pendingWrites.clear();
    this.#pendingBytes = 0;
  }
}
