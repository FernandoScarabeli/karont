import type { Conversation, ConversationAttachment, MessagePart } from "@karont/contract";

export type AdapterEvent =
  | { kind: "part"; part: MessagePart }
  | { kind: "turn-id"; turnId: string }
  | { kind: "text-delta"; partType: "text" | "thinking"; partId: string; delta: string }
  | { kind: "state"; state: "working" | "waiting" }
  | {
      kind: "turn-end";
      status: "done" | "interrupted" | "error";
      error?: { type: "cli-not-found" | "not-logged-in" | "failed" | "interrupted"; text: string };
    }
  | { kind: "session"; sessionId: string };

export type AdapterResponse =
  | { responseType: "permission"; decision: "allow" | "always" | "deny" }
  | { responseType: "question"; answers: Record<string, string[]> }
  | { responseType: "plan"; decision: "approve" | "reject"; comment?: string };

export type AdapterModelList = {
  models: {
    id: string;
    name: string;
    efforts: NonNullable<Conversation["effort"]>[];
    defaultEffort: NonNullable<Conversation["effort"]>;
  }[];
  efforts: NonNullable<Conversation["effort"]>[];
};

export type AdapterStartOptions = {
  forkSession?: boolean;
};

export type CodexBranchPoint =
  | { lastTurnId: string }
  | { turnIndex: number; expectedTurnCount: number };

export interface AgentAdapter {
  start(
    conversation: Conversation,
    sessionId: string,
    resume: boolean,
    plan?: boolean,
    options?: AdapterStartOptions,
  ): Promise<void>;
  forkThread?(
    conversation: Conversation,
    sourceSessionId: string,
    branchPoint: CodexBranchPoint,
  ): Promise<string>;
  send(text: string, plan?: boolean, attachments?: ConversationAttachment[]): Promise<void>;
  respond(partId: string, response: AdapterResponse): Promise<void>;
  interrupt(): Promise<void>;
  dispose(): Promise<void>;
  getModels?(): Promise<AdapterModelList>;
}

export type AdapterFactory = (
  conversation: Conversation,
  emit: (event: AdapterEvent) => void,
) => AgentAdapter;
