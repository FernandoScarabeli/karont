import type { AnyEvent } from "@karont/contract";
import { ConnectionClosedError, type FrameWriter, MAX_PENDING_FRAME_BYTES } from "./connection.ts";

type TerminalOutputEvent = Extract<AnyEvent, { event: "terminals.output" }>;

type OutOfSyncStatus = {
  generation: number;
  notified: boolean;
};

export class TerminalOutputFlow {
  readonly #writer: FrameWriter;
  readonly #isOpen: () => boolean;
  readonly #onError: (error: unknown, message: string) => void;
  readonly #maxPendingBytes: number;
  readonly #outOfSyncTerminals = new Map<string, OutOfSyncStatus>();
  #removeIdleListener: (() => void) | undefined;

  constructor(
    writer: FrameWriter,
    options: {
      isOpen: () => boolean;
      onError: (error: unknown, message: string) => void;
      maxPendingBytes?: number;
    },
  ) {
    this.#writer = writer;
    this.#isOpen = options.isOpen;
    this.#onError = options.onError;
    this.#maxPendingBytes = options.maxPendingBytes ?? MAX_PENDING_FRAME_BYTES;
  }

  send(event: TerminalOutputEvent): void {
    const frame = { type: "event", event: event.event, payload: event.payload };
    const id = event.payload.id;
    const outOfSync = this.#outOfSyncTerminals.get(id);
    if (outOfSync) {
      outOfSync.generation += 1;
      return;
    }
    if (!this.#writer.canSendWithinBudget(frame, this.#maxPendingBytes)) {
      this.#outOfSyncTerminals.set(id, { generation: 1, notified: false });
      this.#watchForDrain();
      return;
    }
    void this.#writer.send(frame).catch((error: unknown) => {
      this.#onError(error, "Falha ao enviar saída do terminal; a conexão será encerrada.");
    });
  }

  captureAttachGeneration(id: string): number | undefined {
    return this.#outOfSyncTerminals.get(id)?.generation;
  }

  completeAttach(id: string, generationAtAttach: number | undefined): void {
    const current = this.#outOfSyncTerminals.get(id);
    if (!current) return;
    if (generationAtAttach !== undefined && current.generation === generationAtAttach) {
      this.#outOfSyncTerminals.delete(id);
    } else {
      current.notified = false;
      this.#watchForDrain();
    }
    if (this.#outOfSyncTerminals.size === 0) {
      this.#removeIdleListener?.();
      this.#removeIdleListener = undefined;
    }
  }

  close(): void {
    this.#removeIdleListener?.();
    this.#removeIdleListener = undefined;
    this.#outOfSyncTerminals.clear();
  }

  #watchForDrain(): void {
    if (this.#removeIdleListener) return;
    this.#removeIdleListener = this.#writer.onIdle(() => {
      if (!this.#isOpen()) return;
      for (const [id, status] of this.#outOfSyncTerminals) {
        if (status.notified) continue;
        status.notified = true;
        void this.#writer
          .send({ type: "event", event: "terminals.resync", payload: { id } })
          .catch((error: unknown) => {
            if (error instanceof ConnectionClosedError) return;
            this.#onError(error, "Falha ao enviar aviso de ressincronização.");
          });
      }
    });
  }
}
