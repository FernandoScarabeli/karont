import type { PickFolderOptions, PickFolderResult } from "./bridge.ts";
import type { ErrorCode } from "./envelopes.ts";
import type { AnyEvent } from "./events.ts";
import type { MethodName, ParamsOf, ResultOf } from "./methods.ts";

export const CONTRACT_VERSION = 1;

export type { AgentErrorAgent, AgentErrorDescription } from "./agentErrors.ts";
export { describeAgentError } from "./agentErrors.ts";
export type {
  NativeBridge,
  NativeResult,
  PickFolderOptions,
  PickFolderResult,
} from "./bridge.ts";
export { pickFolderOptionsSchema } from "./bridge.ts";
export type {
  AgentCapabilities,
  ComposerSkill,
  ComposerSkillReference,
  Conversation,
  ConversationAttachment,
  ConversationAttachmentMetadata,
  ConversationContextUsage,
  ConversationMessage,
  MessagePart,
} from "./conversations.ts";
export {
  agentCapabilitiesSchema,
  agentIdSchema,
  agentModelsSchema,
  composerFileSchema,
  composerSkillReferenceSchema,
  composerSkillSchema,
  conversationAttachmentMetadataSchema,
  conversationAttachmentSchema,
  conversationContextUsageSchema,
  conversationOptionsSchema,
  conversationSchema,
  conversationSendParamsSchema,
  errorPartSchema,
  messagePartSchema,
  messageSchema,
  permissionPartSchema,
  planPartSchema,
  questionPartSchema,
  reasoningEffortSchema,
} from "./conversations.ts";
export type {
  AuthFrame,
  ClientFrame,
  ErrorCode,
  EventEnvelope,
  HelloFrame,
  ReadyFrame,
  RequestEnvelope,
  ResponseEnvelope,
  ServerFrame,
} from "./envelopes.ts";
export {
  authFrameSchema,
  clientFrameSchema,
  ERROR_CODES,
  errorCodeSchema,
  eventEnvelopeSchema,
  helloFrameSchema,
  MAX_FRAME_BYTES,
  readyFrameSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  serverFrameSchema,
} from "./envelopes.ts";
export type { AnyEvent, EventName, PayloadOf } from "./events.ts";
export { events } from "./events.ts";
export type { InboxItem, InboxItemKind, InboxList } from "./inbox.ts";
export {
  inboxItemSchema,
  inboxListSchema,
  MAX_INBOX_ITEMS,
} from "./inbox.ts";
export type {
  Agent,
  JsonValue,
  MethodName,
  OverviewProject,
  OverviewWorkspace,
  ParamsOf,
  Project,
  RecentFolder,
  ResultOf,
  SettingKey,
  TerminalInfo,
  Workspace,
} from "./methods.ts";
export {
  agentSchema,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  jsonValueSchema,
  MAX_CONCURRENT_AGENTS_LIMIT,
  MAX_CONCURRENT_AGENTS_SETTING,
  MAX_SETTING_BYTES,
  methods,
  ONBOARDING_COMPLETED_SETTING,
  overviewProjectSchema,
  overviewWorkspaceSchema,
  projectSchema,
  queueStatusSchema,
  recentFolderSchema,
  settingKeySchema,
  terminalInfoSchema,
  workspaceSchema,
} from "./methods.ts";
export type { RestoreFileChange, RestorePointSummary } from "./restore.ts";
export {
  MAX_RESTORE_CHANGED_FILES,
  MAX_RESTORE_PATCH_BYTES,
  restoreFileChangeSchema,
  restorePointSummarySchema,
  restoreStateSchema,
  restoreUnavailableReasonSchema,
} from "./restore.ts";
export type {
  SearchConversationResult,
  SearchMessageResult,
  SearchProjectResult,
  SearchResult,
  SearchSnippetSegment,
} from "./search.ts";
export {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX,
  searchConversationResultSchema,
  searchMessageResultSchema,
  searchProjectResultSchema,
  searchResultSchema,
  searchSnippetSegmentSchema,
} from "./search.ts";
export type { MessageSource } from "./sources.ts";
export {
  MAX_MESSAGE_SOURCES,
  messageSourceSchema,
  normalizeSourceUrl,
  safeSourceUrl,
} from "./sources.ts";
export type { AgentUsage, UsageWindow } from "./usage.ts";
export { agentUsageSchema, usageWindowSchema } from "./usage.ts";
export type {
  ParsedRequest,
  ParseEventResult,
  ParseRequestResult,
  ParseResult,
  ValidationError,
  ValidationFailure,
} from "./validate.ts";
export { isEventName, isMethodName, parseEvent, parseRequest, parseResult } from "./validate.ts";

export type {
  Worktree,
  WorktreeMergeBlocked,
  WorktreeMergePreview,
  WorktreeStatus,
} from "./worktrees.ts";
export {
  worktreeMergeBlockedSchema,
  worktreeMergePreviewSchema,
  worktreeSchema,
  worktreeStatusSchema,
} from "./worktrees.ts";

export interface KarontBridge {
  request<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
  onEvent(listener: (event: AnyEvent) => void): () => void;
  pickFolder?(options?: PickFolderOptions): Promise<PickFolderResult>;
}

export class BridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}
