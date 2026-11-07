
"use client";
import { useRef, useState, useEffect } from "react";
import styles from "./page.module.css";
import { fetchCsrfToken } from "@/lib/api/client";
import { CHAT_COMPLETIONS_URL } from "@/lib/api/config";
import { streamSSE } from "@/lib/api/sse";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCsrfToken(controller.signal)
      .then((token) => {
        if (token) setCsrfToken(token);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") console.error("Failed to fetch CSRF token", err);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setError(null);
    setLoading(true);
    const userMsg: Message = { role: "user", content: input };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let assistantMsg = "";
    try {
      await streamSSE(CHAT_COMPLETIONS_URL, {
        body: { model: "gpt-3.5-turbo", messages: history, stream: true },
        csrfToken,
        signal: controller.signal,
        onEvent: ({ data }) => {
          if (data === "[DONE]") {
            controller.abort();
            return;
          }
          let token = "";
          try {
            token = JSON.parse(data).choices?.[0]?.delta?.content ?? "";
          } catch {
            return; // ignore malformed chunks
          }
          if (!token) return;
          assistantMsg += token;
          const content = assistantMsg;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return last?.role === "assistant"
              ? [...prev.slice(0, -1), { role: "assistant", content }]
              : [...prev, { role: "assistant", content }];
          });
        },
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") setError("Streaming connection error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Chatbot Demo</h1>
        <div style={{ flex: 1, width: "100%", overflowY: "auto", marginBottom: 16 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ margin: "8px 0", textAlign: msg.role === "user" ? "right" : "left" }}>
              <b>{msg.role === "user" ? "You" : "Assistant"}:</b> {msg.content}
            </div>
          ))}
          {loading && (
            <div style={{ color: "#888" }}>Assistant is typing...</div>
          )}
        </div>
        <form onSubmit={handleSend} style={{ display: "flex", width: "100%", gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            disabled={loading}
            aria-label="Type your message"
          />
          <button type="submit" disabled={loading || !input.trim()} style={{ padding: "8px 16px" }}>
            Send
          </button>
        </form>
        {error && <div style={{ color: "red", marginTop: 8 }}>{error}</div>}
      </main>
    </div>
  );
}
