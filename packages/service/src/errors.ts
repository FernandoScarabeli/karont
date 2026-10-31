import type { ErrorCode } from "@karont/contract";

export class ServiceError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}
