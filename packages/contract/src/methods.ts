import { z } from "zod";
import {
  agentModelsSchema,
  conversationOptionsSchema,
  conversationSchema,
  conversationSendParamsSchema,
  messageSchema,
} from "./conversations.ts";

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

export const recentFolderSchema = z.strictObject({
  path: z.string().min(1).max(4_096),
  name: z.string().min(1).max(4_096),
  usedAt: z.iso.datetime({ offset: true }),
});

export type RecentFolder = z.infer<typeof recentFolderSchema>;

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
const terminalCommandSchema = z.string().refine((command) => {
  const bytes = new TextEncoder().encode(command).byteLength;
  return bytes >= 1 && bytes <= 4_096 && !command.includes("\u0000");
}, "O comando inicial deve ter de 1 a 4.096 bytes UTF-8 e não pode conter NUL.");
const folderPathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((folderPath) => !folderPath.includes("\u0000"));
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
      homeDir: z.string(),
    }),
  },
  "system.userName": {
    params: emptyParamsSchema,
    result: z.strictObject({ name: z.string().nullable() }),
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
  "conversation.create": {
    params: z.strictObject({
      agent: z.enum(["claude", "codex"]),
      cwd: z.string().min(1).max(4_096),
      mode: z.enum(["read-only", "edit", "full"]).default("edit"),
      title: z.string().min(1).max(240).optional(),
      model: z.string().min(1).max(80).optional(),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
      plan: z.boolean().optional(),
    }),
    result: z.strictObject({ conversation: conversationSchema }),
  },
  "conversation.list": {
    params: z.strictObject({
      agent: z.enum(["claude", "codex"]).optional(),
      cwd: z.string().optional(),
      archived: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    result: z.strictObject({ conversations: z.array(conversationSchema) }),
  },
  "conversation.count": {
    params: emptyParamsSchema,
    result: z.strictObject({ count: z.number().int().nonnegative() }),
  },
  "conversation.get": {
    params: z.strictObject({ id: z.string().min(1) }),
    result: z.strictObject({ conversation: conversationSchema, messages: z.array(messageSchema) }),
  },
  "conversation.markSeen": {
    params: z.strictObject({ id: z.string().min(1) }),
    result: z.strictObject({ conversation: conversationSchema }),
  },
  "conversation.send": {
    params: conversationSendParamsSchema,
    result: z.strictObject({ userMessage: messageSchema, agentMessage: messageSchema }),
  },
  "conversation.stop": {
    params: z.strictObject({ id: z.string().min(1) }),
    result: z.strictObject({ stopped: z.boolean() }),
  },
  "conversation.respond": {
    params: z.discriminatedUnion("responseType", [
      z.strictObject({
        id: z.string().min(1),
        partId: z.string().min(1),
        responseType: z.literal("permission"),
        decision: z.enum(["allow", "always", "deny"]),
      }),
      z.strictObject({
        id: z.string().min(1),
        partId: z.string().min(1),
        responseType: z.literal("question"),
        answers: z.record(z.string(), z.array(z.string())),
      }),
      z.strictObject({
        id: z.string().min(1),
        partId: z.string().min(1),
        responseType: z.literal("plan"),
        decision: z.enum(["approve", "reject"]),
        comment: z.string().max(8_192).optional(),
      }),
    ]),
    result: z.strictObject({ ok: z.literal(true) }),
  },
  "conversation.retry": {
    params: z.strictObject({ id: z.string().min(1), messageId: z.string().min(1).optional() }),
    result: z.strictObject({ agentMessage: messageSchema }),
  },
  "conversation.delete": {
    params: z.strictObject({ id: z.string().min(1) }),
    result: z.strictObject({ deleted: z.boolean() }),
  },
  "conversation.deleteAll": {
    params: emptyParamsSchema,
    result: z.strictObject({ deleted: z.number().int().nonnegative() }),
  },
  "conversation.rename": {
    params: z.strictObject({
      id: z.string().min(1),
      title: z.string().trim().min(1).max(240),
    }),
    result: z.strictObject({ conversation: conversationSchema }),
  },
  "conversation.setPinned": {
    params: z.strictObject({ id: z.string().min(1), pinned: z.boolean() }),
    result: z.strictObject({ conversation: conversationSchema }),
  },
  "conversation.setArchived": {
    params: z.strictObject({ id: z.string().min(1), archived: z.boolean() }),
    result: z.strictObject({ conversation: conversationSchema }),
  },
  "conversation.setOptions": {
    params: z.strictObject({ id: z.string().min(1), options: conversationOptionsSchema }),
    result: z.strictObject({ conversation: conversationSchema }),
  },
  "agent.models": {
    params: z.strictObject({ agent: z.enum(["claude", "codex"]) }),
    result: agentModelsSchema,
  },
  "folders.recent": {
    params: emptyParamsSchema,
    result: z.strictObject({ folders: z.array(recentFolderSchema).max(8) }),
  },
  "folders.validate": {
    params: z.strictObject({ path: folderPathSchema }),
    result: z.strictObject({
      path: z.string().min(1).max(4_096),
      exists: z.boolean(),
      isDirectory: z.boolean(),
    }),
  },
  "folders.gitInfo": {
    params: z.strictObject({ path: folderPathSchema }),
    result: z.strictObject({ branch: z.string().nullable(), detached: z.boolean() }),
  },
  "terminals.list": {
    params: emptyParamsSchema,
    result: z.strictObject({ terminals: z.array(terminalInfoSchema) }),
  },
  "terminals.open": {
    params: terminalSizeSchema.extend({
      cwd: terminalCwdSchema.optional(),
      command: terminalCommandSchema.optional(),
    }),
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
