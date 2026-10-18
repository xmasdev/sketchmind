import { LLM_BASE_URL, LLM_DEFAULT_MODEL, LLM_MAX_TOKENS, SYSTEM_PROMPT, llmHeaders } from "@/lib/llm";


interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: IncomingMessage[];
  model?: string;
  board?: { text: string; image?: string | null } | null;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const MAX_HISTORY = 20;

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return Response.json({ error: "The last message must come from the user" }, { status: 400 });
  }

  // Attach the board to the latest user turn only, so context stays fresh and small.
  const last = history[history.length - 1];
  let lastContent: string | ContentPart[] = last.content;
  if (body.board?.text) {
    const text =
      `<board>\n${body.board.text}\n</board>\n\n` +
      (body.board.image ? "A snapshot image of the board is attached.\n\n" : "") +
      last.content;
    lastContent = body.board.image
      ? [
          { type: "text", text },
          { type: "image_url", image_url: { url: body.board.image } },
        ]
      : text;
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(0, -1),
    { role: "user", content: lastContent },
  ];

  let upstream: Response;
  try {
    upstream = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: llmHeaders(),
      body: JSON.stringify({
        model: body.model || LLM_DEFAULT_MODEL,
        messages,
        stream: true,
        temperature: 0.4,
        max_tokens: LLM_MAX_TOKENS,
        frequency_penalty: 0.3,
      }),
      signal: req.signal,
    });
  } catch {
    return Response.json(
      {
        error: `Couldn't reach the model server at ${LLM_BASE_URL}. Is Ollama running? Try \`ollama serve\`.`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let message = detail;
    try {
      message = JSON.parse(detail)?.error?.message ?? JSON.parse(detail)?.error ?? detail;
    } catch {}
    return Response.json(
      { error: `Model server returned ${upstream.status}: ${message || upstream.statusText}` },
      { status: 502 },
    );
  }

  // Convert the upstream SSE stream into a plain text stream of tokens.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              if (json.error) {
                controller.enqueue(encoder.encode(`\n\n⚠️ ${json.error.message ?? json.error}`));
                continue;
              }
              const token: string | undefined = json.choices?.[0]?.delta?.content;
              if (token) controller.enqueue(encoder.encode(token));
            } catch {
              // ignore keep-alives / partial frames
            }
          }
        }
      } catch (err) {
        if (!req.signal.aborted) controller.error(err);
        return;
      }
      controller.close();
    },
    cancel() {
      upstream.body?.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
