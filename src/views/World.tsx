import React from "react";
import { motion } from "motion/react";
import type { ClientSave } from "../lib/api";
import { RelationshipWeb } from "./RelationshipWeb";
import { nice } from "../lib/format";

export default function World({ save }: { save: ClientSave }) {
  const w = save.world;
  const liveRumors = w.rumors.filter((r) => !r.dead);
  const activeThreads = w.threads.filter((t) => t.status === "active");
  const name = (id: string) => save.characters[id]?.name ?? id;

  // Emotional weather: the REAL signal now — each present/tracked character's openness
  // (relaxation) and state, the thing that actually drives the engine. No Kuramoto, no λ̂.
  const cond = (save as any).condition as Record<string, { psyche?: { relaxation: number; state: string; mood?: string; active_states?: string[] } }> | undefined;
  const weather = Object.entries(cond ?? {})
    .filter(([id]) => id !== "char_player" && save.characters[id] && (save.characters[id] as any).status !== "dead")
    .map(([id, c]) => ({ id, name: name(id), r: c.psyche?.relaxation ?? 0, state: c.psyche?.state ?? "intact", mood: c.psyche?.mood ?? "", states: c.psyche?.active_states ?? [] }))
    .filter((c) => save.world.present.includes(c.id) || (save.characters[c.id] as any).tracked)
    .sort((a, b) => a.r - b.r);
  const openColor = (r: number) => r <= -7 ? "var(--danger)" : r <= -3 ? "var(--accent)" : r >= 4 ? "var(--calm)" : "var(--text-mid)";
  const openWord = (r: number, st: string) => st === "broken" || st === "shattered" ? "broken" : st === "fracturing" ? "fracturing" : r <= -7 ? "clenched tight" : r <= -3 ? "guarded" : r >= 4 ? "open" : "level";

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3 space-y-3">
      {weather.length > 0 && (
        <Block title="Emotional weather" delay={0}>
          <div className="space-y-2 py-1">
            {weather.map((c) => (
              <div key={c.id}>
                <div className="flex justify-between items-baseline">
                  <span className="text-[13px]">{c.name}</span>
                  <span className="font-mono text-[10px]" style={{ color: openColor(c.r) }}>
                    {openWord(c.r, c.state)}{c.mood ? ` · ${c.mood}` : ""}
                  </span>
                </div>
                {/* openness meter: -10 clenched (left) to +10 open (right), midpoint marked */}
                <div className="relative meter mt-1.5" style={{ overflow: "visible" }}>
                  <div style={{ position: "absolute", left: "50%", top: -1, bottom: -1, width: 1, background: "var(--ink-3)" }} />
                  <div style={{
                    position: "absolute", height: "100%", borderRadius: 3,
                    background: openColor(c.r),
                    left: c.r >= 0 ? "50%" : `${50 + c.r * 5}%`,
                    width: `${Math.abs(c.r) * 5}%`,
                  }} />
                </div>
                {c.states.length > 0 && (
                  <div className="text-[10.5px] mt-1" style={{ color: "var(--text-lo)" }}>{c.states.join(" · ")}</div>
                )}
              </div>
            ))}
          </div>
          <div className="text-[10.5px] italic pt-2" style={{ color: "var(--text-lo)" }}>
            Openness bends perception: the clenched misread warmth as threat; the open see clearly. Each line is filtered through this.
          </div>
        </Block>
      )}
      <Block title="The web" delay={0.03}>
        <RelationshipWeb save={save} />
      </Block>

      <Block title="Threads" delay={0.04}>
        {activeThreads.length === 0 && <Empty>Nothing pulling at the weave yet.</Empty>}
        {activeThreads.map((t) => (
          <div key={t.id} className="py-2">
            <div className="flex justify-between items-baseline gap-2">
              <div className="font-display text-[14px]">{t.title}</div>
              <span className="font-mono text-[9.5px] shrink-0" style={{ color: t.tension >= 7 ? "var(--danger)" : "var(--text-lo)" }}>
                tension {t.tension}/10
              </span>
            </div>
            <div className="text-[12.5px] mt-0.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>{t.description}</div>
            <div className="meter mt-2"><div style={{ width: `${t.tension * 10}%`, background: t.tension >= 7 ? "var(--danger)" : "var(--accent)" }} /></div>
          </div>
        ))}
      </Block>

      <Block title="Clocks" delay={0.05}>
        {w.clocks.length === 0 && <Empty>No factions on the move.</Empty>}
        {w.clocks.map((c) => (
          <div key={c.id} className="py-2">
            <div className="flex justify-between items-baseline gap-2">
              <div className="font-display text-[14px]">{c.faction}</div>
              <span className="chip" style={c.status === "fired" ? { color: "var(--danger)", borderColor: "rgba(199,81,70,.4)" } : undefined}>
                {c.status === "fired" ? "fired" : `${c.filled}/${c.segments}`}
              </span>
            </div>
            <div className="text-[12.5px] mt-0.5" style={{ color: "var(--text-mid)" }}>{c.objective}</div>
            <div className="flex gap-1 mt-2">
              {Array.from({ length: c.segments }).map((_, i) => (
                <div key={i} className="h-2 flex-1 rounded-sm"
                  style={{ background: i < c.filled ? "var(--accent)" : "var(--ink-3)" }} />
              ))}
            </div>
          </div>
        ))}
      </Block>

      <Block title="What people are saying" delay={0.1}>
        {liveRumors.length === 0 && <Empty>The air is quiet. For now.</Empty>}
        {liveRumors.map((r) => (
          <div key={r.id} className="py-2">
            <div className="text-[13px] leading-relaxed italic">"{r.content}"</div>
            <div className="font-mono text-[9.5px] mt-1 flex gap-2" style={{ color: "var(--text-lo)" }}>
              <span style={r.truth !== "true" ? { color: "var(--danger)" } : undefined}>{r.truth}</span>
              <span>· {r.knowers.length} know · from {name(r.origin_char)}</span>
            </div>
          </div>
        ))}
      </Block>

      <Block title="Norms" delay={0.15}>
        {w.norms.map((n) => (
          <div key={n.id} className="py-1.5 text-[13px]">
            <span style={{ color: "var(--text-hi)" }}>{n.rule}</span>
            <span className="font-mono text-[9.5px] ml-2" style={{ color: "var(--text-lo)" }}>({n.enforcement} — {n.holders})</span>
          </div>
        ))}
      </Block>

      <Block title="Places" delay={0.2}>
        {Object.values(w.places).map((p) => (
          <div key={p.id} className="py-1.5">
            <span className="font-display text-[13.5px]">
              {p.name}{w.player_location === p.id && <span style={{ color: "var(--accent)" }}> ◂ you</span>}
            </span>
            <div className="text-[12px]" style={{ color: "var(--text-lo)" }}>{p.description_facts}</div>
          </div>
        ))}
      </Block>
    </div>
  );
}

function Block({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.div className="card p-4"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
      <div className="font-mono text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-lo)" }}>{title}</div>
      {children}
    </motion.div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] italic py-1" style={{ color: "var(--text-lo)" }}>{children}</div>;
}
