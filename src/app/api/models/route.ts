import { connection } from "next/server";
import { LLM_BASE_URL, LLM_DEFAULT_MODEL, llmHeaders, ollamaNativeBase } from "@/lib/llm";
import type { ModelInfo, ModelsResponse } from "@/lib/types";

async function visionCapability(native: string, model: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${native}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const info = await res.json();
    return Array.isArray(info.capabilities) ? info.capabilities.includes("vision") : null;
  } catch {
    return null;
  }
}

export async function GET() {
  await connection(); // always run at request time

  const base: Omit<ModelsResponse, "ok" | "models"> = {
    baseUrl: LLM_BASE_URL,
    defaultModel: LLM_DEFAULT_MODEL,
  };

  try {
    const res = await fetch(`${LLM_BASE_URL}/models`, {
      headers: llmHeaders(),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const ids: string[] = (json.data ?? []).map((m: { id: string }) => m.id).sort();

    const native = ollamaNativeBase();
    const models: ModelInfo[] = await Promise.all(
      ids.map(async (id) => ({ id, vision: native ? await visionCapability(native, id) : null })),
    );

    return Response.json({ ...base, ok: true, models } satisfies ModelsResponse);
  } catch (err) {
    return Response.json({
      ...base,
      ok: false,
      models: [],
      error: `Can't reach ${LLM_BASE_URL} (${(err as Error).message}).`,
    } satisfies ModelsResponse);
  }
}
