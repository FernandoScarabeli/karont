export const agentCatalog = [
  { id: "claude", name: "Claude Code", binaries: ["claude"], structured: true },
  { id: "codex", name: "Codex", binaries: ["codex"], structured: true },
  { id: "gemini", name: "Gemini CLI", binaries: ["gemini"], structured: true },
  { id: "opencode", name: "OpenCode", binaries: ["opencode"], structured: true },
  { id: "aider", name: "Aider", binaries: ["aider"], structured: false },
  { id: "cursor-agent", name: "Cursor Agent", binaries: ["cursor-agent"], structured: false },
  { id: "qwen", name: "Qwen Code", binaries: ["qwen"], structured: false },
  { id: "goose", name: "Goose", binaries: ["goose"], structured: false },
  { id: "amp", name: "Amp", binaries: ["amp"], structured: false },
  { id: "crush", name: "Crush", binaries: ["crush"], structured: false },
] as const;

export type KnownAgentId = (typeof agentCatalog)[number]["id"];
