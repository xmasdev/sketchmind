/**
 * Helpers for pulling Mermaid diagrams out of model replies.
 * Small local models are inconsistent about fences, so we are forgiving.
 */

export type Segment =
  | { kind: "markdown"; text: string }
  | { kind: "mermaid"; code: string; complete: boolean; index: number };

const MERMAID_START = /^(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram)/;
const FENCE = /```([\w-]*)[^\n]*\n([\s\S]*?)(```|$)/g;

export function splitMermaid(content: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  let index = 0;
  for (const match of content.matchAll(FENCE)) {
    const [whole, lang, body, close] = match;
    const isMermaid = lang.toLowerCase() === "mermaid" || MERMAID_START.test(body.trim());
    if (!isMermaid) continue;
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "markdown", text: content.slice(last, start) });
    segments.push({ kind: "mermaid", code: body.trim(), complete: close === "```", index: index++ });
    last = start + whole.length;
  }
  if (last < content.length) segments.push({ kind: "markdown", text: content.slice(last) });
  return segments;
}

export function extractMermaid(content: string): string[] {
  return splitMermaid(content)
    .filter((s): s is Extract<Segment, { kind: "mermaid" }> => s.kind === "mermaid" && s.complete)
    .map((s) => s.code);
}

/**
 * Best-effort repair of common small-model mistakes:
 * quotes/parentheses inside [labels], trailing semicolons, styling lines.
 */
export function sanitizeMermaid(code: string): string {
  return code
    .split("\n")
    .filter((l) => !/^\s*(style|classDef|class|linkStyle|click)\s/.test(l))
    .map((l) =>
      l
        .replace(/;\s*$/, "")
        .replace(/\[([^\[\]]*)\]/g, (_m, label: string) =>
          `[${label.replace(/["'`()]/g, "").replace(/\s+/g, " ").trim() || " "}]`,
        ),
    )
    .join("\n")
    .trim();
}
