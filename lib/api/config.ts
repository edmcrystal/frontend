// Backend endpoints, configurable per environment via .env.local:
//   NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
//   NEXT_PUBLIC_CHAT_COMPLETIONS_URL=https://dev.jarvis.edmcrystal.com/test2/v1/chat/completions?stream=true

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

export const CHAT_COMPLETIONS_URL =
  process.env.NEXT_PUBLIC_CHAT_COMPLETIONS_URL ??
  "https://dev.jarvis.edmcrystal.com/test2/v1/chat/completions?stream=true";

export const CSRF_HEADER = "X-CSRF-Token";
