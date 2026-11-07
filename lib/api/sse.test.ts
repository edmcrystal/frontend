import { describe, expect, it } from "vitest";
import { parseSSE, type SSEEvent } from "./sse";

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
      c.close();
    },
  });
}

async function collect(chunks: (string | Uint8Array)[]): Promise<SSEEvent[]> {
  const out: SSEEvent[] = [];
  for await (const ev of parseSSE(streamOf(chunks))) out.push(ev);
  return out;
}

describe("parseSSE", () => {
  it("parses events split across chunks", async () => {
    const evs = await collect(["data: hel", "lo\n\ndata: [DO", "NE]\n\n"]);
    expect(evs.map((e) => e.data)).toEqual(["hello", "[DONE]"]);
  });

  it("handles CRLF and lone CR line endings, including CRLF split across chunks", async () => {
    const evs = await collect(["data: a\r", "\n\r\ndata: b\r\rdata: c\n\n"]);
    expect(evs.map((e) => e.data)).toEqual(["a", "b", "c"]);
  });

  it("joins multi-line data and reads event/id fields, skipping comments", async () => {
    const evs = await collect([": keep-alive\n", "event: progress\nid: 7\ndata: line1\ndata: line2\n\n"]);
    expect(evs).toEqual([{ event: "progress", id: "7", data: "line1\nline2" }]);
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode("data: café ✓\n\n");
    const split = bytes.indexOf(0xc3) + 1; // middle of "é"
    const evs = await collect([bytes.slice(0, split), bytes.slice(split)]);
    expect(evs[0].data).toBe("café ✓");
  });

  it("flushes a final event without a trailing blank line", async () => {
    const evs = await collect(["data: tail"]);
    expect(evs.map((e) => e.data)).toEqual(["tail"]);
  });
});
