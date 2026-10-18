"use client";

import { MessageSquare } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import ChatPanel from "@/components/ChatPanel";
import type { BoardApi } from "@/lib/types";

// Excalidraw touches `window` on import, so the board only ever renders in the browser.
const Whiteboard = dynamic(() => import("@/components/Whiteboard"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-[var(--muted)]">Loading board…</div>
  ),
});

const LAYOUT_KEY = "sketchmind:layout:v1";
const MIN_W = 320;
const MAX_W = 640;

export default function AppShell() {
  const [board, setBoard] = useState<BoardApi | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [saved] = useState<{ width?: number; open?: boolean }>(() => {
    try {
      return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const [open, setOpen] = useState<boolean>(saved.open ?? window.innerWidth >= 768);
  const [width, setWidth] = useState<number>(saved.width ?? 400);
  const dragging = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width, open }));
    } catch {}
  }, [width, open]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const onReady = useCallback((api: BoardApi) => setBoard(api), []);

  const startDrag = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setWidth(Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - e.clientX)));
  };
  const endDrag = () => {
    dragging.current = false;
  };

  return (
    <main className="flex h-dvh w-full overflow-hidden bg-[var(--panel)]">
      <section className="relative min-w-0 flex-1" aria-label="Whiteboard">
        <Whiteboard onReady={onReady} onThemeChange={setTheme} />
      </section>

      {open ? (
        <aside
          className="fixed inset-0 z-20 flex md:relative md:inset-auto md:z-auto md:shrink-0 md:border-l md:border-[var(--line)]"
          style={{ ["--w" as string]: `${width}px` }}
          aria-label="AI assistant"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize assistant"
            onPointerDown={startDrag}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-[var(--accent)]/30 md:block"
          />
          <div className="h-full w-full md:w-[var(--w)]">
            <ChatPanel board={board} onCollapse={() => setOpen(false)} />
          </div>
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          className="fixed bottom-20 right-4 z-20 flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--on-accent)] shadow-lg shadow-black/20 transition hover:brightness-110"
        >
          <MessageSquare className="size-4" /> Ask AI
        </button>
      )}
    </main>
  );
}
