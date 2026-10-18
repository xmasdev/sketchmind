/**
 * LLM configuration.
 *
 * SketchMind talks to any OpenAI-compatible Chat Completions endpoint, so the
 * same code works with:
 *   - Ollama (default)        http://localhost:11434/v1
 *   - LM Studio               http://localhost:1234/v1
 *   - llama.cpp server        http://localhost:8080/v1
 *   - Mistral / Groq / OpenRouter / OpenAI (set LLM_API_KEY)
 */
export const LLM_BASE_URL = (
  process.env.LLM_BASE_URL ?? "http://localhost:11434/v1"
).replace(/\/+$/, "");

export const LLM_API_KEY = process.env.LLM_API_KEY ?? "";

export const LLM_DEFAULT_MODEL = process.env.LLM_MODEL ?? "llama3.2";

/** Hard cap on reply length — small local models occasionally loop forever. */
export const LLM_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS ?? 1500);

export function llmHeaders(): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (LLM_API_KEY) headers.Authorization = `Bearer ${LLM_API_KEY}`;
  return headers;
}

/** Ollama exposes a native API next to /v1 that tells us which models can see images. */
export function ollamaNativeBase(): string | null {
  return LLM_BASE_URL.endsWith("/v1") ? LLM_BASE_URL.slice(0, -3) : null;
}

export const SYSTEM_PROMPT = `You are SketchMind, an AI assistant that lives next to a collaborative whiteboard (Excalidraw).
The user sketches ideas on the board and talks to you about them.

How to help:
- Be concise and concrete. Prefer short paragraphs and bullet points.
- When board context is provided, ground your answer in it. Refer to shapes by their labels.
- If the board is empty or the context is irrelevant to the question, just answer normally.
- Never invent elements that are not on the board.

Drawing on the board:
Only draw when the user asks for a drawing or diagram; otherwise answer in text.
When the user asks you to draw, diagram, map, visualise or sketch something (or to turn the board into a cleaner diagram),
reply with ONE short sentence and then ONE fenced code block in Mermaid syntax, like:

\`\`\`mermaid
flowchart TD
  A[Start] --> B{Is it working?}
  B -->|Yes| C[Ship it]
  B -->|No| D[Debug]
  D --> B
\`\`\`

Mermaid rules (follow strictly, the board parser is picky):
- Use "flowchart TD" or "flowchart LR" (sequenceDiagram and classDiagram are also fine).
- Node ids are short letters/words without spaces: A, B, api, db.
- Use [square brackets] for normal steps. Use {braces} ONLY for yes/no decisions. (round) is for start/end.
- Labels are plain words: no quotes, no parentheses, no HTML, no emoji, no markdown.
- Keep it to at most 15 nodes. No styling, classDef or subgraph styling lines.
The app shows an "Add to board" button under the code block, so do not explain how to render it.`;
