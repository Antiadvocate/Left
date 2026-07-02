import React, { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Hammer } from "lucide-react";
import { api, type ClientSave } from "../lib/api";

const SPARKS = [
  "A lighthouse town where the keeper has been dead three weeks and no one will say it",
  "A caravan crossing salt flats, water for nine days, eleven people",
  "A monastery that takes in anyone — and a stranger arrives at lamplight",
  "A river port the week the fish stopped coming",
];

export default function Forge({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: (s: ClientSave) => void;
}) {
  const [seed, setSeed] = useState("");
  const [model, setModel] = useState("deepseek/deepseek-chat-v3-0324");
  const [grounded, setGrounded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!seed.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const m = model.trim();
      onCreated(await api.forge(seed.trim(), m ? (grounded && !m.endsWith(":online") ? m + ":online" : m) : undefined));
    } catch (e: any) {
      setError(e.message ?? "the forge went cold");
      setBusy(false);
    }
  };

  return (
    <div className="scroll-y h-full px-5 pb-10 pt-3">
      <button className="chip mb-5" onClick={onBack}><ArrowLeft size={11} /> library</button>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="font-display text-[22px] mb-1.5">Seed a world.</div>
        <div className="text-[13.5px] leading-relaxed mb-5" style={{ color: "var(--text-mid)" }}>
          One idea. The engine builds the place, the people, their grudges, their clocks. One LLM call, then the world runs itself.
        </div>

        <textarea className="field" rows={4} placeholder="A fishing village the winter the ice came early…"
          value={seed} onChange={(e) => setSeed(e.target.value)} />

        <div className="flex flex-wrap gap-1.5 mt-3">
          {SPARKS.map((s) => (
            <button key={s} className="chip text-left" style={{ textTransform: "none", letterSpacing: 0 }}
              onClick={() => setSeed(s)}>
              {s.length > 44 ? s.slice(0, 43) + "…" : s}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>Forge model (OpenRouter id — pick the smith)</div>
          <input className="field" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
            value={model} onChange={(e) => setModel(e.target.value)} />
          <button className="chip mt-2.5" onClick={() => setGrounded((v) => !v)}
            style={grounded ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
            {grounded ? "◉" : "○"} ground with web search
          </button>
          <div className="text-[11px] italic mt-1.5" style={{ color: "var(--text-lo)" }}>
            Grounding appends OpenRouter's ":online" — the forge searches the web while building, so worlds seeded from real media, places, or history come back canon-accurate. Costs a little more.
          </div>
        </div>

        {error && (
          <div className="card p-3 mt-4 font-mono text-[12px]" style={{ color: "var(--danger)", borderColor: "rgba(199,81,70,.4)" }}>
            {error}
          </div>
        )}

        <motion.button className="btn btn-accent w-full mt-5" style={{ height: 50 }}
          whileTap={{ scale: 0.97 }} onClick={go} disabled={busy || !seed.trim()}>
          <Hammer size={15} />
          {busy ? "forging — this takes a minute…" : "Forge the world"}
        </motion.button>
        {busy && (
          <div className="font-mono text-[11px] text-center mt-3">
            <span className="shimmer">casting people, sharpening grudges, winding clocks…</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}
