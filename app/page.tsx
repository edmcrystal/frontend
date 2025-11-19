
"use client";
import { useRef, useState, useEffect } from "react";
import styles from "./page.module.css";

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
    fetch("http://localhost:8000/api/csrf-token")
      .then((res) => {
        const token = res.headers.get("X-CSRF-Token");
        if (token) setCsrfToken(token);
      })
      .catch((err) => console.error("Failed to fetch CSRF token", err));
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setError(null);
    setLoading(true);
    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const eventSource = EventSourcePolyfill("https://dev.jarvis.edmcrystal.com/test2/v1/chat/completions/sse?stream=true", {
        headers: {},
        payload: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [...messages, userMsg],
          stream: true,
        }),
        method: "POST",
        signal: controller.signal,
        csrfToken,
      });

      let assistantMsg = "";
      eventSource.onmessage = (event: MessageEvent) => {
        if (event.data === "[DONE]") {
          setLoading(false);
          eventSource.close();
          return;
        }
        try {
          const data = JSON.parse(event.data);
          console.log("Received data:", data);
          const token = data.choices?.[0]?.delta?.content || "";
          assistantMsg += token;
          console.log("Received token:", token);
          setMessages((prev) => {
            // Update last assistant message in streaming
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === "assistant") {
              return [...prev.slice(0, -1), { role: "assistant", content: assistantMsg }];
            } else {
              return [...prev, { role: "assistant", content: assistantMsg }];
            }
          });
        } catch (err) {
          // ignore parse errors
        }
      };
      eventSource.onerror = (err: any) => {
        setError("Streaming connection error");
        setLoading(false);
        eventSource.close();
      };
    } catch (err: any) {
      setError("Failed to connect to backend");
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

// Polyfill for EventSource with POST support (for demo, use fetch+SSE in production)
function EventSourcePolyfill(url: string, opts: any) {
  // Only for demo: use fetch and parse SSE manually
  const { payload, signal, csrfToken } = opts;
  const eventTarget = new EventTarget();

  // Create a proxy object to hold the onmessage/onerror properties
  const eventSourceProxy = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: any) => void) | null,
    close: () => { },
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  };

  // Add internal listeners to trigger the properties
  eventTarget.addEventListener("message", (e: any) => {
    if (eventSourceProxy.onmessage) {
      eventSourceProxy.onmessage(e);
    }
  });
  eventTarget.addEventListener("error", (e: any) => {
    if (eventSourceProxy.onerror) {
      eventSourceProxy.onerror(e);
    }
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (csrfToken) {
    headers["X-CSRF-TOKEN"] = csrfToken;
  }

  fetch(url.replace("/sse", ""), {
    method: "POST",
    headers: headers,
    body: payload,
    signal,
  })
    .then(async (res) => {
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (chunk.startsWith("data: ")) {
            const data = chunk.slice(6);
            eventTarget.dispatchEvent(new MessageEvent("message", { data }));
          }
        }
      }
    })
    .catch((err) => {
      eventTarget.dispatchEvent(new Event("error"));
    });

  return eventSourceProxy;
}
