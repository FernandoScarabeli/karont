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
};

export class FrameWriter {
  readonly #writable: Writable;
  readonly #queue: PendingWrite[] = [];
  #current: PendingWrite | undefined;
  #closedError: ConnectionClosedError | undefined;
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

  send(value: unknown): Promise<void> {
    if (this.#closedError) return Promise.reject(this.#closedError);
    let frame: Buffer;
    try {
      frame = encodeFrame(value);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<void>((resolve, reject) => {
      this.#queue.push({ frame, resolve, reject });
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
        canContinue = this.#writable.write(pending.frame);
      } catch (error) {
        this.#writing = false;
        this.#drainObservedDuringWrite = false;
        this.#current = undefined;
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

  #markClosed(_cause?: Error): void {
    if (this.#closedError) return;
    this.#closedError = new ConnectionClosedError();
    this.#current?.reject(this.#closedError);
    this.#current = undefined;
    this.#waitingForDrain = false;
    for (const pending of this.#queue.splice(0)) pending.reject(this.#closedError);
  }
}
