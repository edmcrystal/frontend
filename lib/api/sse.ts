import { apiUrl, buildHeaders } from "./client";

export type SSEEvent = { event: string; data: string; id?: string };

export type StreamSSEOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: HeadersInit;
  csrfToken?: string | null;
  signal?: AbortSignal;
  onEvent: (event: SSEEvent) => void;
};

/**
 * Parses a Server-Sent Events byte stream into events.
 * Handles \n, \r\n and \r line endings, multi-line `data:` fields, comments,
 * and multi-byte characters split across chunks.
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let id: string | undefined;

  const flush = (): SSEEvent | null => {
    if (data.length === 0) {
      event = "message";
      return null;
    }
    const out: SSEEvent = { event, data: data.join("\n"), id };
    event = "message";
    data = [];
    return out;
  };

  const processLine = (line: string): SSEEvent | null => {
    if (line === "") return flush();
    if (line.startsWith(":")) return null; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value || "message";
    else if (field === "id") id = value;
    return null;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let match: RegExpExecArray | null;
      const lineBreak = /\r\n|\r|\n/g;
      let start = 0;
      while ((match = lineBreak.exec(buffer)) !== null) {
        // A trailing lone \r might be the first half of \r\n: wait for more data.
        if (!done && match[0] === "\r" && match.index === buffer.length - 1) break;
        const ev = processLine(buffer.slice(start, match.index));
        start = match.index + match[0].length;
        if (ev) yield ev;
      }
      buffer = buffer.slice(start);

      if (done) {
        if (buffer) {
          const ev = processLine(buffer);
          if (ev) yield ev;
        }
        const last = flush();
        if (last) yield last;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Opens an SSE stream over fetch (so POST bodies and custom headers work,
 * unlike the native EventSource). Resolves when the stream ends; rejects on
 * network/HTTP errors. Abort via `signal`.
 */
export async function streamSSE(
  url: string,
  { method = "POST", body, headers, csrfToken, signal, onEvent }: StreamSSEOptions,
): Promise<void> {
  const reqHeaders = buildHeaders(csrfToken, headers);
  reqHeaders.set("Accept", "text/event-stream");
  const res = await fetch(apiUrl(url), {
    method,
    headers: reqHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Stream request failed: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("Stream response has no body");
  for await (const ev of parseSSE(res.body)) onEvent(ev);
}
