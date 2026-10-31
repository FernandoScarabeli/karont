export { computeMac, createNonce, createSecret, readSecret, verifyMac } from "./auth.ts";
export { connectService, type ServiceClient } from "./client.ts";
export { DeltaCoalescer, type DeltaCoalescerOptions, type TimerFunctions } from "./coalescer.ts";
export { ConnectionClosedError, FrameTooLargeError, FrameWriter } from "./connection.ts";
export { getSetting, migrations, openDatabase, setSetting } from "./db.ts";
export { createHandlers, SERVICE_VERSION, ServiceError } from "./handlers.ts";
export { ensurePrivateDir, resolvePaths, type ServicePaths } from "./paths.ts";
export { ServiceAlreadyRunningError, type StartServiceOptions, startService } from "./server.ts";
export { type DecodedItem, encodeFrame, FrameDecoder } from "./wire.ts";
