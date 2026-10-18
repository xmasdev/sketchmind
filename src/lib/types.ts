export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** Whether board context was attached when this user message was sent. */
  withBoard?: boolean;
  /** Whether a board snapshot image was attached. */
  withImage?: boolean;
  error?: boolean;
  /** Indexes of the Mermaid blocks in this reply that were placed on the board. */
  drawn?: number[];
}

export interface ModelInfo {
  id: string;
  /** true / false when the backend reports it (Ollama), null when unknown. */
  vision: boolean | null;
}

export interface ModelsResponse {
  ok: boolean;
  baseUrl: string;
  defaultModel: string;
  models: ModelInfo[];
  error?: string;
}

/** Imperative handle the whiteboard exposes to the rest of the app. */
export interface BoardApi {
  /** Compact text description of what is on the board. */
  describe: () => { text: string; count: number };
  /** JPEG data URL of the board, or null when the board is empty. */
  snapshot: () => Promise<string | null>;
  /** Parse Mermaid and place the resulting diagram on the board. */
  addMermaid: (definition: string) => Promise<void>;
  clear: () => void;
}
