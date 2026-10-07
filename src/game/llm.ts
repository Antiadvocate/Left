// Provider-agnostic JSON client for any OpenAI-compatible chat endpoint (OpenRouter,
// DeepSeek, a local llama.cpp / Ollama server). Only ever called between days, never in combat.

import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "deepseek/deepseek-chat",
  useLLM: false,
  analyst: false,
};

export interface CallOpts { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch }

export function extractJson(text: string): string {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

export async function callJson(s: Settings, system: string, user: string, o: CallOpts = {}): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 60000);
  o.signal?.addEventListener("abort", () => ctrl.abort());
  const doFetch = o.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${s.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.apiKey}`,
        "X-Title": "Open Weights",
      },
      body: JSON.stringify({
        model: s.model,
        temperature: 0.8,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("empty completion");
    return JSON.parse(extractJson(text));
  } finally {
    clearTimeout(timer);
  }
}
