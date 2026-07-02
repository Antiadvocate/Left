/** OpenRouter client (browser). Streaming + JSON, fallback chain, usage accounting.
 *  The key is read from localStorage and sent directly to OpenRouter from the browser. */
import { getApiKey } from "./config";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface Usage { prompt_tokens: number; completion_tokens: number; cached_tokens?: number; cost?: number }
export interface LLMResult { text: string; usage: Usage; model: string }

function key(): string {
  const k = getApiKey();
  if (!k) throw new Error("No OpenRouter key set — open Tuning (or the welcome screen) and paste your key.");
  return k;
}

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key()}`,
    "HTTP-Referer": location.origin,
    "X-Title": "Weft",
  };
}

export function buildMessages(system: string, stable: string, volatile: string, model: string): any[] {
  const anthropic = model.startsWith("anthropic/");
  if (anthropic) {
    return [
      { role: "system", content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] },
      { role: "user", content: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }, { type: "text", text: volatile }] },
    ];
  }
  return [
    { role: "system", content: system },
    { role: "user", content: stable + "\n\n" + volatile },
  ];
}

async function once(messages: any[], model: string, json: boolean, maxTokens: number): Promise<LLMResult> {
  const res = await fetch(OR_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model, messages, max_tokens: maxTokens,
      temperature: json ? 0.3 : 0.85,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      usage: { include: true },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("empty completion");
  return {
    text,
    usage: { prompt_tokens: data.usage?.prompt_tokens ?? 0, completion_tokens: data.usage?.completion_tokens ?? 0, cached_tokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0, cost: data.usage?.cost ?? undefined },
    model: data.model ?? model,
  };
}

export async function complete(messages: any[], model: string, fallback: string, json = false, maxTokens = 4000): Promise<LLMResult> {
  try { return await once(messages, model, json, maxTokens); }
  catch { return await once(messages, fallback, json, maxTokens); }
}

export async function* completeStream(messages: any[], model: string, fallback: string, maxTokens = 4000, online = false): AsyncGenerator<string, LLMResult, unknown> {
  const slug = (m: string) => (online && !m.endsWith(":online") ? `${m}:online` : m);
  const attempt = async function* (m: string): AsyncGenerator<string, LLMResult, unknown> {
    const res = await fetch(OR_URL, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ model: slug(m), messages, max_tokens: maxTokens, temperature: 0.85, stream: true, usage: { include: true } }),
    });
    if (!res.ok || !res.body) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "", usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) { full += delta; yield delta; }
          if (j.usage) usage = { prompt_tokens: j.usage.prompt_tokens ?? 0, completion_tokens: j.usage.completion_tokens ?? 0, cached_tokens: j.usage.prompt_tokens_details?.cached_tokens ?? 0, cost: j.usage.cost ?? undefined };
        } catch { /* keep-alive */ }
      }
    }
    if (!full.trim()) throw new Error("empty stream");
    return { text: full, usage, model: m };
  };
  try { return yield* attempt(model); }
  catch { return yield* attempt(fallback); }
}

export function extractJson(text: string): string {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start === -1) return t;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === "{") depth++;
    if (c === "}") { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return t.slice(start);
}

export function repairJson(t: string): string {
  let inStr = false, esc = false; const stack: string[] = [];
  for (const ch of t) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = t;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

export function safeJson<T>(text: string, fallback: T): T {
  const ex = extractJson(text);
  try { return JSON.parse(ex) as T; } catch { /* try repair */ }
  try { return JSON.parse(repairJson(ex)) as T; } catch { return fallback; }
}

export async function generateImage(prompt: string, model = "google/gemini-2.5-flash-image", refImages: string[] = [], aspect: "portrait" | "landscape" | "square" = "landscape"): Promise<string> {
  // reference images (e.g. character portraits) are passed as image_url content blocks;
  // models that support multimodal input use them for consistency, others ignore them.
  // Aspect: the image models default to landscape/square, so we both (a) state the orientation
  // forcefully in the text and (b) pass a generation hint where the routing supports it.
  const ratio = aspect === "portrait" ? "2:3" : aspect === "square" ? "1:1" : "16:9";
  const orient = aspect === "portrait"
    ? "IMPORTANT: vertical portrait orientation, tall 2:3 aspect ratio, taller than wide. "
    : aspect === "square" ? "Square 1:1 aspect ratio. " : "";
  const content: any[] = [{ type: "text", text: orient + prompt }];
  for (const url of refImages.slice(0, 4)) if (url?.startsWith("data:") || url?.startsWith("http")) content.push({ type: "image_url", image_url: { url } });
  const res = await fetch(OR_URL, {
    method: "POST", headers: headers(),
    body: JSON.stringify({
      model, messages: [{ role: "user", content }], modalities: ["image", "text"],
      // generation hints — honored by routings that support image config, ignored otherwise
      image_config: { aspect_ratio: ratio },
    }),
  });
  if (!res.ok) throw new Error(`image gen HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!img) throw new Error("model returned no image — try google/gemini-2.5-flash-image");
  return img as string;
}
