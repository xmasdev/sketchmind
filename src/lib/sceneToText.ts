/**
 * Turns Excalidraw elements into a compact, LLM-friendly description.
 *
 * Small local models can't see the canvas, so we give them the structure:
 * labelled shapes, the arrows between them, and loose text — in reading order.
 */

// Minimal structural type so this module stays free of Excalidraw imports
// (it is also unit-testable in plain Node).
export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  name?: string | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
}

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const MAX_CHARS = 4000;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function sceneToText(all: readonly SceneElement[]): { text: string; count: number } {
  const els = all.filter((e) => !e.isDeleted);
  if (els.length === 0) return { text: "The board is empty.", count: 0 };

  const byId = new Map(els.map((e) => [e.id, e]));

  // text bound to a container (shape label or arrow label)
  const labelOf = new Map<string, string>();
  for (const e of els) {
    if (e.type === "text" && e.containerId) {
      labelOf.set(e.containerId, clean(e.originalText ?? e.text ?? ""));
    }
  }

  const readingOrder = (a: SceneElement, b: SceneElement) =>
    Math.round(a.y / 80) - Math.round(b.y / 80) || a.x - b.x;

  // Give unlabelled shapes a stable handle so arrows can still reference them.
  const unnamed = new Map<string, string>();
  const nameOf = (e: SceneElement | undefined): string => {
    if (!e) return "(nothing)";
    const label = labelOf.get(e.id);
    if (label) return `"${label}"`;
    if (e.type === "text") return `"${clean(e.text ?? "")}"`;
    if (e.type === "frame") return `frame "${e.name ?? "Frame"}"`;
    if (!unnamed.has(e.id)) unnamed.set(e.id, `${e.type} #${unnamed.size + 1}`);
    return `(unlabelled ${unnamed.get(e.id)})`;
  };

  const lines: string[] = [];
  const pos = (e: SceneElement) => `at (${Math.round(e.x)}, ${Math.round(e.y)})`;

  const frames = els.filter((e) => e.type === "frame" || e.type === "magicframe");
  if (frames.length) {
    lines.push("Frames:");
    frames.sort(readingOrder).forEach((f) => lines.push(`- ${nameOf(f)} ${pos(f)}`));
  }

  const shapes = els.filter((e) => SHAPES.has(e.type)).sort(readingOrder);
  if (shapes.length) {
    lines.push("Shapes:");
    shapes.forEach((s) => lines.push(`- ${s.type} ${nameOf(s)} ${pos(s)}`));
  }

  const arrows = els.filter((e) => e.type === "arrow").sort(readingOrder);
  if (arrows.length) {
    lines.push("Connections:");
    for (const a of arrows) {
      const from = a.startBinding ? nameOf(byId.get(a.startBinding.elementId)) : "(loose end)";
      const to = a.endBinding ? nameOf(byId.get(a.endBinding.elementId)) : "(loose end)";
      const label = labelOf.get(a.id);
      lines.push(`- ${from} -> ${to}${label ? ` [label: "${label}"]` : ""}`);
    }
  }

  const freeText = els
    .filter((e) => e.type === "text" && !e.containerId && clean(e.text ?? ""))
    .sort(readingOrder);
  if (freeText.length) {
    lines.push("Free text:");
    freeText.forEach((t) => lines.push(`- "${clean(t.originalText ?? t.text ?? "")}" ${pos(t)}`));
  }

  const counts: Record<string, number> = {};
  for (const e of els) {
    if (["freedraw", "line", "image"].includes(e.type)) counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  const other = Object.entries(counts).map(([t, n]) => {
    const noun = t === "freedraw" ? "freehand stroke" : t;
    return `${n} ${noun}${n > 1 ? "s" : ""}`;
  });
  if (other.length) lines.push(`Other: ${other.join(", ")}.`);

  let text = lines.join("\n");
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n…(truncated)";
  return { text: text || "The board has only decorative elements.", count: els.length };
}
