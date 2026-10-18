"use client";

import {
  ArrowUp,
  Check,
  ChevronsRight,
  Copy,
  Eraser,
  Image as ImageIcon,
  LayoutDashboard,
  Loader2,
  PenLine,
  RotateCw,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { extractMermaid, sanitizeMermaid, splitMermaid } from "@/lib/mermaid";
import type { BoardApi, ChatMessage, ModelInfo, ModelsResponse } from "@/lib/types";

const CHAT_KEY = "sketchmind:chat:v1";
const PREFS_KEY = "sketchmind:prefs:v1";

type DrawStatus = { state: "drawing" } | { state: "added" } | { state: "error"; message: string };

interface Props {
  board: BoardApi | null;
  onCollapse: () => void;
}

const QUICK_PROMPTS = [
  { icon: LayoutDashboard, label: "Explain my board", prompt: "Explain what is on my board and how the pieces relate." },
  { icon: Sparkles, label: "What am I missing?", prompt: "Look at my board. What important steps, edge cases or components am I missing?" },
  { icon: Wand2, label: "Clean it up as a diagram", prompt: "Redraw my board as a clean, well-organised flowchart." },
  { icon: PenLine, label: "Draw a login flow", prompt: "Draw a flowchart of a user login flow with password reset." },
];

/** Auto-draw only when the user actually asked for a picture; otherwise offer a button. */
const WANTS_DRAWING = /\b(draw|diagram|flow ?chart|sketch|visuali[sz]e|map out|mind ?map|chart|redraw|clean (it|this) up)\b/i;

const uid = () => Math.random().toString(36).slice(2, 10);

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export default function ChatPanel({ board, onCollapse }: Props) {
  const [initialPrefs] = useState(() =>
    readJSON(PREFS_KEY, { model: "", useBoard: true, useImage: false, autoDraw: true }),
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() => readJSON<ChatMessage[]>(CHAT_KEY, []));
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [model, setModel] = useState<string>(initialPrefs.model);
  const [useBoard, setUseBoard] = useState<boolean>(initialPrefs.useBoard);
  const [useImage, setUseImage] = useState<boolean>(initialPrefs.useImage);
  const [autoDraw, setAutoDraw] = useState<boolean>(initialPrefs.autoDraw);
  const [draws, setDraws] = useState<Record<string, DrawStatus>>({});

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  // ---- persistence ----------------------------------------------------------
  useEffect(() => {
    if (!streaming) writeJSON(CHAT_KEY, messages.slice(-60));
  }, [messages, streaming]);

  useEffect(() => {
    writeJSON(PREFS_KEY, { model, useBoard, useImage, autoDraw });
  }, [model, useBoard, useImage, autoDraw]);

  // ---- models ---------------------------------------------------------------
  const loadModels = useCallback(() => {
    return fetch("/api/models", { cache: "no-store" })
      .then((res) => res.json() as Promise<ModelsResponse>)
      .then((data) => {
        setModels(data);
        setModel((current) => {
          const ids = data.models.map((m) => m.id);
          if (current && ids.includes(current)) return current;
          const def = ids.find((id) => id === data.defaultModel || id === `${data.defaultModel}:latest`);
          return def ?? ids[0] ?? data.defaultModel;
        });
      })
      .catch(() =>
        setModels({ ok: false, baseUrl: "", defaultModel: "", models: [], error: "Couldn't load models." }),
      );
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const modelInfo: ModelInfo | undefined = models?.models.find((m) => m.id === model);
  const visionBlocked = modelInfo?.vision === false;

  // ---- scrolling ------------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ---- drawing --------------------------------------------------------------
  const draw = useCallback(async (key: string, code: string) => {
    const api = boardRef.current;
    if (!api) return;
    setDraws((d) => ({ ...d, [key]: { state: "drawing" } }));
    try {
      try {
        await api.addMermaid(code);
      } catch {
        await api.addMermaid(sanitizeMermaid(code)); // second chance with common fixes applied
      }
      setDraws((d) => ({ ...d, [key]: { state: "added" } }));
      // remember on the message itself so the status survives a reload
      const [messageId, index] = key.split(":");
      setMessages((m) =>
        m.map((x) =>
          x.id === messageId ? { ...x, drawn: [...new Set([...(x.drawn ?? []), Number(index)])] } : x,
        ),
      );
    } catch (err) {
      const message = (err as Error)?.message?.split("\n")[0] || "Unknown parse error";
      setDraws((d) => ({ ...d, [key]: { state: "error", message } }));
    }
  }, []);

  // ---- sending --------------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      const api = boardRef.current;
      let boardPayload: { text: string; image?: string | null } | null = null;
      if (useBoard && api) {
        const { text: boardText } = api.describe();
        const image = useImage && !visionBlocked ? await api.snapshot().catch(() => null) : null;
        boardPayload = { text: boardText, image };
      }

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content,
        withBoard: !!boardPayload,
        withImage: !!boardPayload?.image,
      };
      const assistantMsg: ChatMessage = { id: uid(), role: "assistant", content: "" };
      const history = [...messages.filter((m) => !m.error), userMsg];

      setMessages((m) => [...m, userMsg, assistantMsg]);
      setInput("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let full = "";

      const patch = (changes: Partial<ChatMessage>) =>
        setMessages((m) => m.map((x) => (x.id === assistantMsg.id ? { ...x, ...changes } : x)));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            board: boardPayload,
            messages: history.map(({ role, content }) => ({ role, content })),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          patch({ content: full });
        }
        if (!full.trim()) patch({ content: "_The model returned an empty reply._" });
      } catch (err) {
        if (controller.signal.aborted) {
          patch({ content: full || "_Stopped._" });
        } else {
          patch({ content: (err as Error).message, error: true });
          full = "";
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }

      if (autoDraw && full && WANTS_DRAWING.test(content)) {
        const [first] = extractMermaid(full);
        if (first) draw(`${assistantMsg.id}:0`, first);
      }
    },
    [messages, model, streaming, useBoard, useImage, visionBlocked, autoDraw, draw],
  );

  const stop = () => abortRef.current?.abort();

  const clearChat = () => {
    stop();
    setMessages([]);
    setDraws({});
  };

  const askToFix = (code: string, error: string) =>
    send(
      `That Mermaid diagram failed to render with this error:\n${error}\n\n` +
        "Reply with a corrected version: one ```mermaid block only, plain-word labels, no quotes or parentheses in labels.\n\n" +
        "```\n" + code + "\n```",
    );

  const status = useMemo(() => {
    if (!models) return { tone: "idle", label: "Connecting…" } as const;
    if (!models.ok) return { tone: "bad", label: "Offline" } as const;
    if (models.models.length === 0) return { tone: "warn", label: "No models" } as const;
    return { tone: "good", label: "Local" } as const;
  }, [models]);

  return (
    <div className="flex h-full flex-col bg-[var(--panel)] text-[var(--ink)]">
      {/* header */}
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <Logo />
        <div className="leading-tight">
          <div className="font-semibold tracking-tight">SketchMind</div>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <span
              className={
                "inline-block size-1.5 rounded-full " +
                (status.tone === "good"
                  ? "bg-emerald-500"
                  : status.tone === "warn"
                    ? "bg-amber-500"
                    : status.tone === "bad"
                      ? "bg-rose-500"
                      : "bg-zinc-400")
              }
            />
            {status.label}
            {models?.ok && models.models.length > 0 && <span className="truncate">· {models.models.length} models</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Clear chat" onClick={clearChat} disabled={messages.length === 0}>
            <Eraser className="size-4" />
          </IconButton>
          <IconButton label="Hide assistant" onClick={onCollapse}>
            <ChevronsRight className="size-4" />
          </IconButton>
        </div>
      </header>

      {/* model + context controls */}
      <div className="space-y-2 border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-2">
          <label htmlFor="model" className="text-xs font-medium text-[var(--muted)]">
            Model
          </label>
          <select
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!models?.ok || models.models.length === 0}
            className="min-w-0 flex-1 truncate rounded-md border border-[var(--line)] bg-[var(--field)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60"
          >
            {models?.models.length ? (
              models.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {m.vision ? "  · vision" : ""}
                </option>
              ))
            ) : (
              <option value={model}>{model || "—"}</option>
            )}
          </select>
          <IconButton label="Refresh models" onClick={loadModels}>
            <RotateCw className="size-3.5" />
          </IconButton>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Toggle on={useBoard} onClick={() => setUseBoard((v) => !v)} title="Send a text description of the board with each message">
            <LayoutDashboard className="size-3.5" /> Board context
          </Toggle>
          <Toggle
            on={useImage && useBoard && !visionBlocked}
            disabled={!useBoard || visionBlocked}
            onClick={() => setUseImage((v) => !v)}
            title={
              visionBlocked
                ? "This model can't see images. Try a vision model like qwen2.5vl, gemma3 or llava."
                : "Also attach a snapshot image of the board (needs a vision model)"
            }
          >
            <ImageIcon className="size-3.5" /> Snapshot
          </Toggle>
          <Toggle on={autoDraw} onClick={() => setAutoDraw((v) => !v)} title="Automatically place diagrams the AI draws onto the board">
            <PenLine className="size-3.5" /> Auto-draw
          </Toggle>
        </div>
      </div>

      {/* connection help */}
      {models && (!models.ok || models.models.length === 0) && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed">
          {!models.ok ? (
            <>
              <p className="font-medium">Can&apos;t reach a local model.</p>
              <p className="mt-1 text-[var(--muted)]">{models.error}</p>
              <p className="mt-2">
                Install <a className="underline" href="https://ollama.com/download" target="_blank" rel="noreferrer">Ollama</a>, then run:
              </p>
            </>
          ) : (
            <p className="font-medium">Ollama is running but has no models yet. Pull one:</p>
          )}
          <pre className="mt-2 overflow-x-auto rounded bg-black/80 px-2 py-1.5 font-mono text-[11px] text-white">
            ollama pull llama3.2{"\n"}ollama serve
          </pre>
        </div>
      )}

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState onPick={send} disabled={streaming} />
        ) : (
          <ul className="space-y-4">
            {messages.map((m, i) => (
              <li key={m.id}>
                {m.role === "user" ? (
                  <UserBubble message={m} />
                ) : (
                  <AssistantMessage
                    message={m}
                    pending={streaming && i === messages.length - 1}
                    draws={draws}
                    onDraw={draw}
                    onFix={askToFix}
                    canDraw={!!board && !streaming}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* composer */}
      <form
        className="border-t border-[var(--line)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-[var(--line)] bg-[var(--field)] p-2 focus-within:border-[var(--accent)]">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={useBoard ? "Ask about your board, or “draw…”" : "Ask anything…"}
            aria-label="Message"
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-[var(--muted)]"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop generating"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--ink)] text-[var(--panel)]"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)] transition disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10.5px] text-[var(--muted)]">
          Enter to send · Shift+Enter for a new line · runs on your machine
        </p>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------------- */

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--accent)" />
      <path
        d="M8 21c2.5-1 3.5-6 6-6s2 5 4.5 5S22 11 24 10"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="10" r="2.2" fill="#ffd166" />
    </svg>
  );
}

function IconButton({
  label,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:pointer-events-none disabled:opacity-40"
      {...rest}
    >
      {children}
    </button>
  );
}

function Toggle({
  on,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 " +
        (on
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
          : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--hover)]")
      }
      {...rest}
    >
      {children}
    </button>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (p: string) => void; disabled: boolean }) {
  return (
    <div className="flex h-full flex-col justify-center gap-5 py-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Think out loud, visually.</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          Sketch on the board and ask about it. The assistant reads your shapes, labels and arrows —
          and can draw diagrams back onto the canvas.
        </p>
      </div>
      <div className="grid gap-2">
        {QUICK_PROMPTS.map(({ icon: Icon, label, prompt }) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className="group flex items-center gap-3 rounded-lg border border-[var(--line)] px-3 py-2.5 text-left text-sm transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <Icon className="size-4 text-[var(--accent)]" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--bubble)] px-3.5 py-2 text-sm leading-relaxed">
        {message.content}
      </div>
      {(message.withBoard || message.withImage) && (
        <div className="flex items-center gap-1 text-[10.5px] text-[var(--muted)]">
          <LayoutDashboard className="size-3" />
          {message.withImage ? "board + snapshot attached" : "board attached"}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  pending,
  draws,
  onDraw,
  onFix,
  canDraw,
}: {
  message: ChatMessage;
  pending: boolean;
  draws: Record<string, DrawStatus>;
  onDraw: (key: string, code: string) => void;
  onFix: (code: string, error: string) => void;
  canDraw: boolean;
}) {
  if (message.error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
        {message.content}
      </div>
    );
  }
  if (!message.content && pending) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <Loader2 className="size-4 animate-spin" /> Thinking…
      </div>
    );
  }

  return (
    <div className="prose-chat text-sm leading-relaxed">
      {splitMermaid(message.content).map((seg, i) =>
        seg.kind === "markdown" ? (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
            {seg.text}
          </ReactMarkdown>
        ) : (
          <MermaidCard
            key={i}
            code={seg.code}
            complete={seg.complete}
            status={
              draws[`${message.id}:${seg.index}`] ??
              (message.drawn?.includes(seg.index) ? { state: "added" } : undefined)
            }
            canDraw={canDraw}
            onDraw={() => onDraw(`${message.id}:${seg.index}`, seg.code)}
            onFix={(err) => onFix(seg.code, err)}
          />
        ),
      )}
      {pending && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-[var(--accent)] align-text-bottom" />}
    </div>
  );
}

function MermaidCard({
  code,
  complete,
  status,
  canDraw,
  onDraw,
  onFix,
}: {
  code: string;
  complete: boolean;
  status?: DrawStatus;
  canDraw: boolean;
  onDraw: () => void;
  onFix: (error: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[var(--line)]">
      <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--hover)] px-3 py-1.5 text-xs">
        <PenLine className="size-3.5 text-[var(--accent)]" />
        <span className="font-medium">Diagram</span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--ink)]"
          onClick={() => {
            navigator.clipboard?.writeText(code).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-48 overflow-auto bg-[var(--field)] px-3 py-2 font-mono text-[11.5px] leading-snug">{code}</pre>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-3 py-2 text-xs">
        {!complete ? (
          <span className="flex items-center gap-1.5 text-[var(--muted)]">
            <Loader2 className="size-3.5 animate-spin" /> Writing diagram…
          </span>
        ) : status?.state === "drawing" ? (
          <span className="flex items-center gap-1.5 text-[var(--muted)]">
            <Loader2 className="size-3.5 animate-spin" /> Drawing on the board…
          </span>
        ) : (
          <>
            <button
              type="button"
              disabled={!canDraw}
              onClick={onDraw}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1 font-medium text-[var(--on-accent)] disabled:opacity-50"
            >
              <PenLine className="size-3.5" />
              {status?.state === "added" ? "Add again" : "Add to board"}
            </button>
            {status?.state === "added" && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="size-3.5" /> On the board
              </span>
            )}
            {status?.state === "error" && (
              <>
                <span className="basis-full text-rose-600 dark:text-rose-400">Couldn&apos;t parse: {status.message}</span>
                <button
                  type="button"
                  disabled={!canDraw}
                  onClick={() => onFix(status.message)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 hover:bg-[var(--hover)] disabled:opacity-50"
                >
                  <Wand2 className="size-3.5" /> Ask AI to fix
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
