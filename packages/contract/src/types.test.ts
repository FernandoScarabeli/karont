import type {
  AnyEvent,
  ClientFrame,
  ErrorCode,
  EventEnvelope,
  HelloFrame,
  JsonValue,
  KarontBridge,
  MethodName,
  ParamsOf,
  RequestEnvelope,
  ResultOf,
  ServerFrame,
} from "./index.ts";

function assertContractTypes(bridge: KarontBridge): void {
  const methodName: MethodName = "settings.set";
  const params: ParamsOf<"settings.set"> = { key: "theme", value: "dark" };
  const result: ResultOf<"settings.get"> = { key: "theme", value: null };
  const jsonValue: JsonValue = { enabled: true, items: [1, "two", null] };
  const errorCode: ErrorCode = "unavailable";
  const request: RequestEnvelope = { type: "request", id: "1", method: "system.ping", params: {} };
  const event: EventEnvelope = { type: "event", event: "bridge.status", payload: {} };
  const hello: HelloFrame = { type: "hello", contractVersion: 1, nonce: "0".repeat(64) };
  const serverFrame: ServerFrame = hello;
  const clientFrame: ClientFrame = { type: "auth", mac: "0".repeat(64) };
  const anyEvent: AnyEvent = { event: "bridge.status", payload: { state: "connected" } };
  const bridgeResult: Promise<ResultOf<"settings.get">> = bridge.request("settings.get", {
    key: "theme",
  });

  // @ts-expect-error Método inexistente não faz parte do contrato.
  const invalidMethod: MethodName = "unknown.method";
  // @ts-expect-error O valor retornado por settings.get deve incluir a chave.
  const invalidResult: ResultOf<"settings.get"> = { value: null };
  // @ts-expect-error O envelope exige a propriedade params.
  const missingParams: RequestEnvelope = { type: "request", id: "1", method: "system.ping" };

  void [
    methodName,
    params,
    result,
    jsonValue,
    errorCode,
    request,
    event,
    serverFrame,
    clientFrame,
    anyEvent,
    bridgeResult,
    invalidMethod,
    invalidResult,
    missingParams,
  ];
}

void assertContractTypes;
