import { z } from "zod";

export const MAX_SETTING_BYTES = 65_536;

export const settingKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9.]{0,63}$/);

export const jsonValueSchema = z.json().refine((value) => {
  try {
    const serialized = JSON.stringify(value);
    return (
      typeof serialized === "string" &&
      new TextEncoder().encode(serialized).byteLength <= MAX_SETTING_BYTES
    );
  } catch {
    return false;
  }
}, "O valor JSON excede o limite de 64 KiB ou não pode ser serializado.");

const emptyParamsSchema = z.strictObject({});
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const controlCharacterPattern = /\p{Cc}/u;

export const agentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: z.string(),
    name: z.string(),
    kind: z.literal("known"),
    structured: z.boolean(),
    found: z.boolean(),
    path: z.string().optional(),
  }),
  z.strictObject({
    id: z.string(),
    name: z.string(),
    kind: z.literal("custom"),
    structured: z.literal(false),
    found: z.boolean(),
    path: z.string().optional(),
    command: z.string(),
  }),
]);

export type Agent = z.infer<typeof agentSchema>;

export const terminalInfoSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  cwd: z.string(),
  shell: z.string(),
  cols: z.number().int().min(2).max(1_000),
  rows: z.number().int().min(2).max(500),
  startedAt: isoDateTimeSchema,
  exited: z.boolean(),
  exitCode: z.number().int().nullable().optional(),
});

export type TerminalInfo = z.infer<typeof terminalInfoSchema>;

const terminalIdSchema = z.string().min(1).max(80);
const terminalSizeSchema = z.strictObject({
  cols: z.number().int().min(2).max(1_000),
  rows: z.number().int().min(2).max(500),
});
const terminalCwdSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((cwd) => cwd.startsWith("/"), "O caminho do terminal deve ser absoluto.");
const terminalWriteDataSchema = z.string().refine((data) => {
  const bytes = new TextEncoder().encode(data).byteLength;
  return bytes >= 1 && bytes <= 65_536;
}, "A entrada do terminal deve ter de 1 a 65.536 bytes UTF-8.");

const agentNameSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((name) => name.trim() === name && !controlCharacterPattern.test(name));

const agentCommandSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (command) =>
      !controlCharacterPattern.test(command) &&
      (command.startsWith("/") || /^[A-Za-z0-9._+-]+$/.test(command)),
  );

export const methods = {
  "system.ping": {
    params: emptyParamsSchema,
    result: z.strictObject({ pong: z.literal(true), at: isoDateTimeSchema }),
  },
  "system.info": {
    params: emptyParamsSchema,
    result: z.strictObject({
      serviceVersion: z.string(),
      contractVersion: z.number().int(),
      pid: z.number().int(),
      startedAt: isoDateTimeSchema,
      nodeVersion: z.string(),
      platform: z.string(),
    }),
  },
  "settings.get": {
    params: z.strictObject({ key: settingKeySchema }),
    result: z.strictObject({ key: settingKeySchema, value: jsonValueSchema.nullable() }),
  },
  "settings.set": {
    params: z.strictObject({ key: settingKeySchema, value: jsonValueSchema }),
    result: z.strictObject({ key: settingKeySchema, value: jsonValueSchema }),
  },
  "agents.list": {
    params: emptyParamsSchema,
    result: z.strictObject({ agents: z.array(agentSchema), detectedAt: isoDateTimeSchema }),
  },
  "agents.detect": {
    params: emptyParamsSchema,
    result: z.strictObject({ agents: z.array(agentSchema), detectedAt: isoDateTimeSchema }),
  },
  "agents.add": {
    params: z.strictObject({ name: agentNameSchema, command: agentCommandSchema }),
    result: z.strictObject({ agent: agentSchema }),
  },
  "agents.remove": {
    params: z.strictObject({ id: z.string().min(1).max(80) }),
    result: z.strictObject({ removed: z.literal(true) }),
  },
  "terminals.list": {
    params: emptyParamsSchema,
    result: z.strictObject({ terminals: z.array(terminalInfoSchema) }),
  },
  "terminals.open": {
    params: terminalSizeSchema.extend({ cwd: terminalCwdSchema.optional() }),
    result: z.strictObject({ terminal: terminalInfoSchema }),
  },
  "terminals.attach": {
    params: z.strictObject({ id: terminalIdSchema }),
    result: z.strictObject({
      terminal: terminalInfoSchema,
      replay: z.string(),
      seq: z.number().int().min(0),
    }),
  },
  "terminals.write": {
    params: z.strictObject({ id: terminalIdSchema, data: terminalWriteDataSchema }),
    result: z.strictObject({ ok: z.literal(true) }),
  },
  "terminals.resize": {
    params: terminalSizeSchema.extend({ id: terminalIdSchema }),
    result: z.strictObject({ ok: z.literal(true) }),
  },
  "terminals.close": {
    params: z.strictObject({ id: terminalIdSchema }),
    result: z.strictObject({ ok: z.literal(true) }),
  },
  "service.shutdown": {
    params: emptyParamsSchema,
    result: z.strictObject({ ok: z.literal(true) }),
  },
  // O serviço deve aceitar este método apenas em desenvolvimento; ele testa o streaming da ponte.
  "dev.streamTest": {
    params: z.strictObject({
      chunks: z.number().int().min(1).max(10_000),
      chunkSize: z.number().int().min(1).max(65_536),
    }),
    result: z.strictObject({ streamId: z.string() }),
  },
} as const satisfies Record<string, { params: z.ZodType; result: z.ZodType }>;

export type MethodName = keyof typeof methods;
export type ParamsOf<M extends MethodName> = z.infer<(typeof methods)[M]["params"]>;
export type ResultOf<M extends MethodName> = z.infer<(typeof methods)[M]["result"]>;
export type JsonValue = z.infer<typeof jsonValueSchema>;
export type SettingKey = z.infer<typeof settingKeySchema>;
