import assert from "node:assert/strict";
import { test } from "node:test";

import { extractMermaid, sanitizeMermaid, splitMermaid } from "../src/lib/mermaid.ts";
import { sceneToText, type SceneElement } from "../src/lib/sceneToText.ts";

const el = (o: Partial<SceneElement> & { id: string; type: string }): SceneElement => ({
  x: 0, y: 0, width: 100, height: 50, ...o,
});

test("sceneToText: empty board", () => {
  assert.deepEqual(sceneToText([]), { text: "The board is empty.", count: 0 });
});

test("sceneToText: labelled shapes, arrows and free text", () => {
  const { text, count } = sceneToText([
    el({ id: "a", type: "rectangle", x: 0, y: 0 }),
    el({ id: "a-label", type: "text", text: "User", containerId: "a" }),
    el({ id: "b", type: "ellipse", x: 300, y: 0 }),
    el({ id: "b-label", type: "text", text: "API", containerId: "b" }),
    el({ id: "arr", type: "arrow", x: 110, y: 20, startBinding: { elementId: "a" }, endBinding: { elementId: "b" } }),
    el({ id: "arr-label", type: "text", text: "login", containerId: "arr" }),
    el({ id: "note", type: "text", text: "remember   rate limits", x: 0, y: 300 }),
    el({ id: "scribble", type: "freedraw" }),
    el({ id: "gone", type: "rectangle", isDeleted: true }),
  ]);
  assert.equal(count, 8);
  assert.match(text, /rectangle "User" at \(0, 0\)/);
  assert.match(text, /ellipse "API"/);
  assert.match(text, /"User" -> "API" \[label: "login"\]/);
  assert.match(text, /Free text:\n- "remember rate limits"/);
  assert.match(text, /1 freehand stroke\./);
  assert.doesNotMatch(text, /gone/);
});

test("sceneToText: unlabelled shapes and loose arrows", () => {
  const { text } = sceneToText([
    el({ id: "a", type: "diamond" }),
    el({ id: "arr", type: "arrow", startBinding: { elementId: "a" }, endBinding: null }),
  ]);
  assert.match(text, /\(unlabelled diamond #1\) -> \(loose end\)/);
});

test("splitMermaid: finds fenced and unlabelled mermaid blocks", () => {
  const reply = "Here you go:\n```mermaid\nflowchart TD\n A-->B\n```\nand code:\n```js\nconsole.log(1)\n```\n```\ngraph LR\n X-->Y\n```";
  const segs = splitMermaid(reply);
  const diagrams = segs.filter((s) => s.kind === "mermaid");
  assert.equal(diagrams.length, 2);
  assert.ok(segs.some((s) => s.kind === "markdown" && s.text.includes("console.log")));
  assert.deepEqual(extractMermaid(reply), ["flowchart TD\n A-->B", "graph LR\n X-->Y"]);
});

test("splitMermaid: marks a block that is still streaming", () => {
  const segs = splitMermaid("Drawing:\n```mermaid\nflowchart TD\n A-->");
  const last = segs.at(-1)!;
  assert.equal(last.kind, "mermaid");
  assert.equal(last.kind === "mermaid" && last.complete, false);
  assert.deepEqual(extractMermaid("```mermaid\nflowchart TD\n A-->"), []);
});

test("sanitizeMermaid: strips quotes, parens, styling and semicolons", () => {
  const out = sanitizeMermaid('flowchart TD\n A["Login (OAuth)"] --> B[Done];\n style A fill:#f00\n classDef x fill:#000');
  assert.equal(out, "flowchart TD\n A[Login OAuth] --> B[Done]");
});
