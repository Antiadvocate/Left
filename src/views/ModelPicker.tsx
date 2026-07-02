import React, { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";

interface ORModel { id: string; name: string; created?: number; image?: boolean }

let CACHE: ORModel[] | null = null;
let CACHE_AT = 0;

// curated fallback if the live fetch is blocked/offline — kept reasonably current
const FALLBACK: ORModel[] = [
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-opus-4.1", name: "Claude Opus 4.1" },
  { id: "openai/gpt-5", name: "GPT-5" },
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
  { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3 0324" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
  { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick" },
  { id: "x-ai/grok-4", name: "Grok 4" },
  { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B" },
  { id: "mistralai/mistral-large-2411", name: "Mistral Large" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
];
const FALLBACK_IMAGE: ORModel[] = [
  { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", image: true },
  { id: "black-forest-labs/flux-1.1-pro", name: "FLUX 1.1 Pro", image: true },
  { id: "black-forest-labs/flux-1-schnell", name: "FLUX.1 Schnell", image: true },
  { id: "openai/gpt-image-1", name: "GPT Image 1", image: true },
];

async function loadModels(): Promise<ORModel[]> {
  if (CACHE && Date.now() - CACHE_AT < 1000 * 60 * 30) return CACHE;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(String(res.status));
    const j: any = await res.json();
    const list: ORModel[] = (j.data ?? []).map((m: any) => {
      const out: string[] = m.architecture?.output_modalities ?? [];
      return { id: m.id, name: m.name ?? m.id, created: m.created, image: out.includes("image") };
    });
    if (!list.length) throw new Error("empty");
    CACHE = list; CACHE_AT = Date.now();
    return list;
  } catch {
    return [...FALLBACK, ...FALLBACK_IMAGE];
  }
}

export function ModelPicker({
  label, value, onChange, kind = "text",
}: { label: string; value: string; onChange: (v: string) => void; kind?: "text" | "image" }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ORModel[] | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || models) return;
    setLoading(true);
    loadModels().then((m) => { setModels(m); setLoading(false); });
  }, [open, models]);

  const filtered = useMemo(() => {
    let list = (models ?? []).filter((m) => (kind === "image" ? m.image : !m.image));
    // newest first when we have timestamps
    list = [...list].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((m) => m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term));
    return list.slice(0, 60);
  }, [models, q, kind]);

  return (
    <div className="py-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-lo)" }}>{label}</div>
      <button className="field w-full text-left flex items-center justify-between" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
        onClick={() => { setOpen(true); setQ(""); }}>
        <span className="truncate">{value || "tap to choose a model"}</span>
        <span className="text-[10px] ml-2 shrink-0" style={{ color: "var(--text-lo)" }}>change</span>
      </button>

      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 95, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-display text-[16px]">{label}</div>
              <button onClick={() => setOpen(false)}><X size={18} style={{ color: "var(--text-lo)" }} /></button>
            </div>
            <div className="field flex items-center gap-2" style={{ padding: "0 10px" }}>
              <Search size={14} style={{ color: "var(--text-lo)" }} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "image" ? "search image models…" : "search models…"}
                className="flex-1 bg-transparent outline-none py-2" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-hi)" }} />
            </div>
            <div className="text-[10.5px] mt-1.5" style={{ color: "var(--text-lo)" }}>
              {loading ? "loading live model list…" : `${filtered.length} ${kind === "image" ? "image " : ""}models · newest first`}
            </div>
          </div>

          <div className="scroll-y flex-1 px-2 py-1">
            {q.trim() && !filtered.some((m) => m.id === q.trim()) && (
              <button className="w-full text-left px-3 py-2.5 rounded-lg" style={{ color: "var(--accent)" }}
                onClick={() => { onChange(q.trim()); setOpen(false); }}>
                Use custom: <span style={{ fontFamily: "var(--font-mono)" }}>{q.trim()}</span>
              </button>
            )}
            {filtered.map((m) => (
              <button key={m.id} className="w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between"
                style={{ background: m.id === value ? "var(--ink-2)" : "transparent" }}
                onClick={() => { onChange(m.id); setOpen(false); }}>
                <span className="min-w-0">
                  <span className="block text-[13.5px] truncate">{m.name}</span>
                  <span className="block font-mono text-[10px] truncate" style={{ color: "var(--text-lo)" }}>{m.id}</span>
                </span>
                {m.id === value && <Check size={15} style={{ color: "var(--accent)" }} className="shrink-0 ml-2" />}
              </button>
            ))}
            {!loading && !filtered.length && <div className="px-3 py-6 text-center text-[12.5px]" style={{ color: "var(--text-lo)" }}>No match. Type a full model id to use it anyway.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
