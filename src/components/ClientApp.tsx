"use client";

import dynamic from "next/dynamic";

// The whole app is a browser tool (canvas + localStorage), so skip server rendering.
const AppShell = dynamic(() => import("@/components/AppShell"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center text-sm text-[var(--muted)]">Loading SketchMind…</div>
  ),
});

export default function ClientApp() {
  return <AppShell />;
}
