import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownToLine, Braces, Brush, DoorOpen, Eye, EyeOff, Pencil, RotateCcw, Sparkles, X } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import { nice, niceCap } from "../lib/format";
import { CuspGlyph } from "../lib/charts";

function opennessLabel(r: number): string {
  if (r <= -7) return "clenched shut";
  if (r <= -3) return "guarded";
  if (r < 3) return "steady";
  if (r < 7) return "open";
  return "wide open";
}

export default function Cast({ save, setSave, initialSel }: { save: ClientSave; setSave: (s: ClientSave) => void; initialSel?: string | null }) {
  const [sel, setSel] = useState<string | null>(initialSel ?? null);
  const [showElsewhere, setShowElsewhere] = useState(true);
  const [showGone, setShowGone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [painting, setPainting] = useState(false);
  const [embodyConfirm, setEmbodyConfirm] = useState(false);
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [rawErr, setRawErr] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [embodying, setEmbodying] = useState(false);

  const toggleFollow = async (cid: string, on: boolean) => {
    setSave(await api.setTracked(save.id, cid, on));
  };
  const changeStatus = async (cid: string, action: "background" | "away" | "restore" | "central") => {
    setSave(await api.setCharacterStatus(save.id, cid, action));
  };

  const embody = async () => {
    if (!sel || embodying) return;
    setEmbodying(true);
    try {
      const s = await api.embody(save.id, sel);
      setSave(s); setSel(null); setEmbodyConfirm(false);
    } catch (e: any) { setImgErr(e.message); }
    finally { setEmbodying(false); }
  };
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", age: "", background: "", life_history: "", appearance_facts: "", appearance_now: "", current_goal: "", core_traits: "" });
  const [newFact, setNewFact] = useState("");
  const [factsBusy, setFactsBusy] = useState(false);
  const [ivQ, setIvQ] = useState("");
  const [ivBusy, setIvBusy] = useState(false);
  const [ivLog, setIvLog] = useState<{ q: string; a: string }[]>([]);
  const [ivErr, setIvErr] = useState("");

  useEffect(() => { setIvLog([]); setIvErr(""); setIvQ(""); setNewFact(""); }, [sel]);

  const commitFacts = async (facts: { content: string; quote?: string }[]) => {
    if (!sel) return;
    setFactsBusy(true);
    try { setSave(await api.setFacts(save.id, sel, facts)); } finally { setFactsBusy(false); }
  };
  const ask = async () => {
    if (!sel || !ivQ.trim() || ivBusy) return;
    const q = ivQ.trim(); setIvQ(""); setIvBusy(true); setIvErr("");
    try {
      const { answer } = await api.interview(save.id, sel, q, ivLog);
      setIvLog((l) => [...l, { q, a: answer }]);
    } catch (e: any) { setIvErr(e.message ?? "the conversation slipped away"); }
    finally { setIvBusy(false); }
  };

  const startEdit = () => {
    if (!c) return;
    setDraft({
      name: c.name, age: String(c.age), background: c.background, life_history: c.life_history ?? "", appearance_facts: c.appearance_facts, appearance_now: c.appearance_now ?? "",
      current_goal: c.current_goal ?? "", core_traits: c.core_traits.join(", "),
    });
    setEditing(true);
  };
  const commitEdit = async () => {
    if (!sel) return;
    const s = await api.edit(save.id, {
      characters: { [sel]: {
        name: draft.name.trim() || c!.name,
        age: Number(draft.age) || c!.age,
        background: draft.background,
        life_history: draft.life_history,
        appearance_facts: draft.appearance_facts,
        appearance_now: draft.appearance_now,
        current_goal: draft.current_goal,
        core_traits: draft.core_traits.split(",").map((x) => x.trim()).filter(Boolean),
      } },
    });
    setSave(s); setEditing(false);
  };
  const paint = async () => {
    if (!sel || painting) return;
    setPainting(true); setImgErr(null);
    try { const { save: s } = await api.portrait(save.id, sel); setSave(s); }
    catch (e: any) { setImgErr(e.message); }
    finally { setPainting(false); }
  };
  const allIds = Object.keys(save.characters);
  const gone = (id: string) => { const st = save.characters[id]?.status; return st === "dead" || st === "departed"; };
  const present = new Set(save.world.present);
  const sceneIds = ["char_player", ...allIds.filter((id) => id !== "char_player" && present.has(id) && !gone(id))];
  const elsewhereIds = allIds.filter((id) => id !== "char_player" && !present.has(id) && !gone(id));
  const goneIds = allIds.filter((id) => id !== "char_player" && gone(id));

  const c = sel ? save.characters[sel] : null;
  const cond = sel ? save.condition[sel] : null;
  const mem = sel ? save.memory[sel] : null;
  const traits = sel ? save.traits[sel] ?? [] : [];
  const playerEdges = useMemo(
    () => (sel ? save.world.edges.filter((e) => e.from === sel) : []),
    [sel, save.world.edges]
  );

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3">
      <div className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--accent)" }}>
        In the scene
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {sceneIds.map((id, i) => {
          const ch = save.characters[id];
          const p = save.condition[id]?.psyche;
          const isPlayer = id === "char_player";
          return (
            <motion.button key={id} className="card card-press p-3.5 text-left"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.25 }}
              onClick={() => setSel(id)}
              style={isPlayer ? { borderColor: "var(--accent-glow)" } : undefined}>
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-2 min-w-0">
                  {ch.portrait_url && <img src={ch.portrait_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" style={{ border: "1px solid var(--line)" }} />}
                  <div className="font-display text-[14.5px] truncate">{ch.name}</div>
                </div>
                {!isPlayer && ch.tracked && <Eye size={11} style={{ color: "var(--accent)" }} className="shrink-0" />}
              </div>
              <div className="font-mono text-[10px] mt-1 truncate" style={{ color: "var(--text-lo)" }}>
                {isPlayer ? "you" : nice(ch.drive?.goal || ch.current_activity || ch.current_goal || "—")}
              </div>
              {p && (
                <div className="font-mono text-[10px] mt-1.5" style={{ color: "var(--text-mid)" }}>
                  {nice(p.mood)} · {isPlayer ? nice(p.state) : opennessLabel(p.relaxation)}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      {elsewhereIds.length > 0 && (
        <>
          <button className="font-mono text-[10px] uppercase tracking-widest mt-5 mb-2 flex items-center gap-1.5"
            style={{ color: "var(--text-lo)" }} onClick={() => setShowElsewhere((v) => !v)}>
            <span style={{ display: "inline-block", transition: "transform .2s", transform: showElsewhere ? "rotate(90deg)" : "none" }}>▸</span>
            Elsewhere ({elsewhereIds.length})
          </button>
          {showElsewhere && (
            <div className="grid grid-cols-2 gap-2.5">
              {elsewhereIds.map((id, i) => {
                const ch = save.characters[id];
                const p = save.condition[id]?.psyche;
                return (
                  <motion.button key={id} className="card card-press p-3.5 text-left" style={{ opacity: 0.82 }}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 0.82, y: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.25 }}
                    onClick={() => setSel(id)}>
                    <div className="flex items-center gap-2 min-w-0">
                      {ch.portrait_url && <img src={ch.portrait_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" style={{ border: "1px solid var(--line)" }} />}
                      <div className="font-display text-[14.5px] truncate">{ch.name}</div>
                    </div>
                    <div className="font-mono text-[10px] mt-1 truncate" style={{ color: "var(--text-lo)" }}>
                      {ch.tracked && "● "}{nice(ch.drive?.goal || ch.current_activity || ch.current_goal || "—")}
                    </div>
                    {p && (
                      <div className="font-mono text-[10px] mt-1.5" style={{ color: "var(--text-mid)" }}>
                        {nice(p.mood)} · {opennessLabel(p.relaxation)}
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}
        </>
      )}

      {goneIds.length > 0 && (
        <>
          <button className="font-mono text-[10px] uppercase tracking-widest mt-5 mb-2 flex items-center gap-1.5"
            style={{ color: "var(--text-lo)" }} onClick={() => setShowGone((v) => !v)}>
            <span style={{ display: "inline-block", transition: "transform .2s", transform: showGone ? "rotate(90deg)" : "none" }}>▸</span>
            Gone ({goneIds.length})
          </button>
          {showGone && (
            <div className="grid grid-cols-2 gap-2.5">
              {goneIds.map((id) => {
                const ch = save.characters[id];
                return (
                  <button key={id} className="card card-press p-3.5 text-left" style={{ opacity: 0.55 }} onClick={() => setSel(id)}>
                    <div className="flex items-center gap-2 min-w-0">
                      {ch.portrait_url && <img src={ch.portrait_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0 grayscale" style={{ border: "1px solid var(--line)" }} />}
                      <div className="font-display text-[14.5px] truncate">{ch.name}</div>
                    </div>
                    <div className="font-mono text-[10px] mt-1" style={{ color: "var(--text-lo)" }}>
                      {ch.status === "dead" ? "dead" : "gone"}{ch.exit_note ? ` · ${ch.exit_note}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {c && cond && (
          <>
            <motion.div className="drawer-veil fixed inset-0 z-40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSel(null)} />
            <motion.div className="drawer fixed bottom-0 left-0 right-0 z-50 max-h-[82dvh] flex flex-col"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}>
              <div className="grab" />
              <div className="flex items-center justify-between px-5 py-2">
                <div className="flex items-center gap-3">
                  {c.portrait_url && <img src={c.portrait_url} alt="" onClick={() => setLightbox(c.portrait_url!)} className="w-16 h-16 rounded-xl object-cover cursor-pointer" style={{ border: "1px solid var(--line-strong)" }} />}
                  <div>
                    <div className="font-display text-[18px]">{c.name}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-lo)" }}>
                      {c.age} · {c.intelligence}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {sel !== "char_player" && (
                    <button onClick={() => toggleFollow(sel!, !c.tracked)} title={c.tracked ? "following — tap to unfollow" : "follow in the long game"}>
                      {c.tracked ? <Eye size={16} style={{ color: "var(--accent)" }} /> : <EyeOff size={16} style={{ color: "var(--text-lo)" }} />}
                    </button>
                  )}
                  {sel !== "char_player" && c.status !== "departed" && c.status !== "dead" && c.central !== false && (
                    <button onClick={() => changeStatus(sel!, "background")} title="background — demote to a minor figure (frees a central slot, the engine stops giving them full focus)">
                      <ArrowDownToLine size={16} style={{ color: "var(--text-lo)" }} />
                    </button>
                  )}
                  {sel !== "char_player" && c.status !== "departed" && c.status !== "dead" && (
                    <button onClick={() => { if (confirm(`Send ${c.name} away for good? They leave the story and the current scene. You can bring them back later from the Gone list.`)) changeStatus(sel!, "away"); }} title="send away — they leave the story permanently (reversible)">
                      <DoorOpen size={16} style={{ color: "var(--text-lo)" }} />
                    </button>
                  )}
                  {sel !== "char_player" && c.status === "departed" && (
                    <button onClick={() => changeStatus(sel!, "restore")} title="bring back into the story">
                      <RotateCcw size={16} style={{ color: "var(--accent)" }} />
                    </button>
                  )}
                  {sel !== "char_player" && (
                    <button onClick={() => setEmbodyConfirm(true)} title="embody">
                      <Sparkles size={16} style={{ color: embodyConfirm ? "var(--accent)" : "var(--text-lo)" }} />
                    </button>
                  )}
                  <button onClick={async () => { setRawErr(""); const raw = await api.getCharacterRaw(save.id, sel!); setRawJson(JSON.stringify(raw, null, 2)); }} title="raw edit (full JSON)">
                    <Braces size={16} style={{ color: rawJson !== null ? "var(--accent)" : "var(--text-lo)" }} />
                  </button>
                  <button onClick={paint} title="conjure portrait"><Brush size={16} style={{ color: painting ? "var(--accent)" : "var(--text-lo)" }} /></button>
                  <button onClick={editing ? () => setEditing(false) : startEdit}><Pencil size={16} style={{ color: editing ? "var(--accent)" : "var(--text-lo)" }} /></button>
                  <button onClick={() => { setSel(null); setEditing(false); }}><X size={18} style={{ color: "var(--text-lo)" }} /></button>
                </div>
              </div>
              {painting && <div className="px-5 pb-1 font-mono text-[10px]"><span className="shimmer">painting from memory…</span></div>}
              {imgErr && <div className="px-5 pb-1 font-mono text-[10px]" style={{ color: "var(--danger)" }}>{imgErr}</div>}

              <div className="scroll-y px-5 pb-6 space-y-4">
                {embodyConfirm && (
                  <div className="card p-4" style={{ borderColor: "var(--accent-glow)" }}>
                    <div className="font-display text-[15px] mb-1">Become {c.name}?</div>
                    <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>
                      You will inherit their memories, bonds, wounds, traits, and wants — all of it, as it stands.
                      {" "}{save.characters["char_player"]?.name} remains in the world, a person the world remembers.
                      This can be unraveled like any turn.
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button className="btn btn-accent flex-1" onClick={embody} disabled={embodying}>
                        {embodying ? "crossing…" : "Cross over"}
                      </button>
                      <button className="btn btn-ghost flex-1" onClick={() => setEmbodyConfirm(false)}>Stay</button>
                    </div>
                  </div>
                )}
                {editing && (
                  <Section title="Edit (the loom obeys)">
                    <EditField label="Name" v={draft.name} set={(v) => setDraft((d) => ({ ...d, name: v }))} />
                    <EditField label="Age" v={draft.age} set={(v) => setDraft((d) => ({ ...d, age: v }))} />
                    <EditField label="Appearance — baseline (face, eyes, hair, build; the engine can only append here, never rewrite)" v={draft.appearance_facts} set={(v) => setDraft((d) => ({ ...d, appearance_facts: v }))} rows={3} />
                    <EditField label="Presenting now (clothes, grime, visible state — freely rewritten in play)" v={draft.appearance_now} set={(v) => setDraft((d) => ({ ...d, appearance_now: v }))} rows={2} />
                    <EditField label="Background — bedrock identity (never auto-trimmed)" v={draft.background} set={(v) => setDraft((d) => ({ ...d, background: v }))} rows={3} />
                    <EditField label="Story so far — what\u2019s happened in play (auto-grows & compresses)" v={draft.life_history} set={(v) => setDraft((d) => ({ ...d, life_history: v }))} rows={3} />
                    <EditField label="Current goal" v={draft.current_goal} set={(v) => setDraft((d) => ({ ...d, current_goal: v }))} />
                    <EditField label="Core traits (comma-sep)" v={draft.core_traits} set={(v) => setDraft((d) => ({ ...d, core_traits: v }))} />
                    <button className="btn btn-accent w-full mt-2" onClick={commitEdit}>Weave changes in</button>
                  </Section>
                )}
                <Section title="Now">
                  {(() => {
                    const cusp = ((save as any).undertow?.cusps ?? {})[sel!];
                    return cusp ? (
                      <div className="flex items-center gap-3 pb-2">
                        <CuspGlyph a={cusp.a} b={cusp.b} x={cusp.x} />
                        <div className="text-[11px] leading-relaxed flex-1" style={{ color: "var(--text-lo)" }}>
                          Composure homes to their natural set point. Only sustained battering opens the shaded wedge where snaps become possible — and calm closes it again.
                        </div>
                      </div>
                    ) : null;
                  })()}
                  <Row k="mood" v={`${nice(cond.psyche.mood)} (${opennessLabel(cond.psyche.relaxation)})`} />
                  {cond.psyche.active_states.length > 0 && <Row k="feeling" v={cond.psyche.active_states.map(nice).join(", ")} />}
                  <Row k="body" v={`${nice(cond.fatigue)} · ${nice(cond.hunger)}`} />
                  {cond.conditions.length > 0 && <Row k="afflicted" v={cond.conditions.map(nice).join(", ")} />}
                  {cond.injuries.length > 0 && <Row k="injuries" v={cond.injuries.map((x) => nice(x.type)).join("; ")} />}
                  {(c.texture ?? []).length > 0 && <Row k="texture" v={(c.texture ?? []).join(" · ")} />}
                  {c.drive && <Row k="wants" v={`${c.drive.goal} — ${c.drive.progress}%${c.drive.blocker ? ` (blocked: ${nice(c.drive.blocker)})` : ""}`} />}
                  {(c.drive_queue ?? []).length > 0 && <Row k="then" v={(c.drive_queue ?? []).map((d) => d.goal).join(" · ")} />}
                  {c.appearance_now?.trim() && <Row k="presenting" v={c.appearance_now} />}
                  <Row k="where" v={save.world.places[c.location ?? ""]?.name ?? (c.location ? c.location : "—")} />
                  {sel !== "char_player" && <Row k="status" v={c.tracked ? "followed — lives on in the world, always wanting something" : "not followed — fades into the background when offscreen"} />}
                </Section>

                {(c.background || c.life_history) && (
                  <Section title="Identity">
                    <div className="font-mono text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Background (who they fundamentally are)</div>
                    {c.background && <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>{c.background}</div>}
                    {c.life_history?.trim() && (
                      <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--ink-2)" }}>
                        <div className="font-mono text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--accent)" }}>Story so far (what's happened in play)</div>
                        <div className="text-[12.5px] leading-relaxed italic" style={{ color: "var(--text-mid)" }}>{c.life_history}</div>
                      </div>
                    )}
                  </Section>
                )}

                <Section title="Knows — verified facts (the Truth panel)">
                  <div className="text-[11px] italic mb-1.5" style={{ color: "var(--text-lo)" }}>
                    Durable facts this character holds — verbatim-checked at write time, never decayed, never paraphrased again. Corrections here are law: the engine treats this list as ground truth in every future turn.
                  </div>
                  {(mem?.facts ?? []).length === 0 && <div className="text-[12px]" style={{ color: "var(--text-lo)" }}>Nothing ledgered yet — facts land here as the story establishes them, or add one by hand.</div>}
                  {(mem?.facts ?? []).map((f, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 py-1" style={{ borderBottom: "1px solid var(--ink-2)" }}>
                      <div className="flex-1">
                        <div className="text-[12.5px] leading-snug">{f.content}</div>
                        {f.quote && <div className="text-[10.5px] italic mt-0.5" style={{ color: "var(--text-lo)" }}>“{f.quote}”</div>}
                      </div>
                      <button disabled={factsBusy} onClick={() => commitFacts((mem?.facts ?? []).filter((_, j) => j !== i).map((x) => ({ content: x.content, quote: x.quote })))}>
                        <X size={13} style={{ color: "var(--text-lo)" }} />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <input className="field flex-1" placeholder="e.g. Grew up in Seattle" value={newFact} onChange={(e) => setNewFact(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newFact.trim()) { commitFacts([...(mem?.facts ?? []).map((x) => ({ content: x.content, quote: x.quote })), { content: newFact.trim() }]); setNewFact(""); } }} />
                    <button className="btn" disabled={factsBusy || !newFact.trim()}
                      onClick={() => { commitFacts([...(mem?.facts ?? []).map((x) => ({ content: x.content, quote: x.quote })), { content: newFact.trim() }]); setNewFact(""); }}>
                      add
                    </button>
                  </div>
                </Section>

                {sel !== "char_player" && c.status !== "dead" && (
                  <Section title="Interview — a quiet aside (leaves no trace)">
                    <div className="text-[11px] italic mb-1.5" style={{ color: "var(--text-lo)" }}>
                      Talk to {c.name} out of scene. They answer only from what they actually know and feel; nothing here enters the story, their memory, or the world. One cheap call per question.
                    </div>
                    {ivLog.map((t, i) => (
                      <div key={i} className="py-1.5">
                        <div className="text-[12px]" style={{ color: "var(--text-lo)" }}>you: {t.q}</div>
                        <div className="text-[12.5px] leading-relaxed mt-0.5">{t.a}</div>
                      </div>
                    ))}
                    {ivErr && <div className="font-mono text-[10px]" style={{ color: "var(--danger)" }}>{ivErr}</div>}
                    <div className="flex gap-2 mt-1">
                      <input className="field flex-1" placeholder={`ask ${c.name.split(" ")[0]} something…`} value={ivQ} onChange={(e) => setIvQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") ask(); }} />
                      <button className="btn" disabled={ivBusy || !ivQ.trim()} onClick={ask}>{ivBusy ? "…" : "ask"}</button>
                    </div>
                  </Section>
                )}

                {(cond.inventory.length > 0 || cond.wearing.length > 0) && (
                  <Section title="Carrying & wearing">
                    {cond.wearing.length > 0 && <Row k="wearing" v={cond.wearing.map(nice).join(", ")} />}
                    {cond.inventory.length > 0 && <Row k="items" v={cond.inventory.map((i) => niceCap(i.name)).join(", ")} />}
                  </Section>
                )}

                {traits.length > 0 && (
                  <Section title="Acquired self">
                    {traits.map((t) => (
                      <div key={t.id} className="py-1.5">
                        <div className="flex justify-between items-baseline">
                          <span className="text-[13.5px]">{niceCap(t.label)}</span>
                          <span className="font-mono text-[10px]" style={{ color: "var(--text-lo)" }}>×{t.reinforcement_count}</span>
                        </div>
                        <div className="meter mt-1.5"><div style={{ width: `${t.intensity * 10}%` }} /></div>
                      </div>
                    ))}
                  </Section>
                )}

                {playerEdges.length > 0 && (
                  <Section title="Bonds">
                    {playerEdges.map((e) => {
                      const other = save.characters[e.to]?.name ?? e.to;
                      return (
                        <div key={e.to} className="py-1.5">
                          <div className="flex justify-between text-[13.5px]">
                            <span>→ {other}{e.roles?.length ? <span style={{ color: "var(--accent)" }}> · {e.roles.join(" & ")}</span> : null}</span>
                            <span className="font-mono text-[10px]" style={{ color: e.warmth >= 0 ? "var(--calm)" : "var(--danger)" }}>
                              {e.warmth >= 0 ? "warm" : "cold"} {Math.abs(e.warmth)} · trust {e.trust}
                            </span>
                          </div>
                          {e.notes && <div className="text-[11.5px] italic mt-0.5" style={{ color: "var(--text-lo)" }}>{e.notes}</div>}
                        </div>
                      );
                    })}
                  </Section>
                )}

                {mem && (
                  <Section title="Memory">
                    {(save.traits[sel!] ?? []).length > 0 && (
                      <div className="pb-1.5">
                        <div className="font-mono text-[9.5px] uppercase tracking-wider mb-1" style={{ color: "var(--text-lo)" }}>becoming</div>
                        {(save.traits[sel!] ?? []).map((t, i) => (
                          <div key={`at${i}`} className="text-[12.5px] py-0.5 leading-relaxed">
                            <span style={{ color: "var(--accent)" }}>{t.label}</span>
                            <span className="font-mono text-[9px] ml-1.5" style={{ color: "var(--text-lo)" }}>i{t.intensity.toFixed(0)} · w{t.self_weight.toFixed(0)}</span>
                            <span style={{ color: "var(--text-mid)" }}> — {t.behavioral_impact}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {mem.beliefs.map((b, i) => (
                      <div key={`b${i}`} className="text-[13px] py-1" style={{ color: "var(--accent)" }}>※ {b.content}{typeof b.confidence === "number" ? <span className="font-mono text-[9px] ml-1" style={{ color: "var(--text-lo)" }}>{Math.round(b.confidence * 100)}%</span> : null}</div>
                    ))}
                    {[...mem.episodic].sort((a, b) => b.turn - a.turn).slice(0, 7).map((m, i) => (
                      <div key={i} className="text-[12.5px] py-1 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                        <span className="font-mono text-[9.5px] mr-1.5" style={{ color: "var(--text-lo)" }}>
                          {m.when_label ? m.when_label.replace(/\s*\(.*\)$/, "") : `t${m.turn}`}{m.where ? ` · ${m.where}` : ""}
                        </span>
                        {m.content}
                      </div>
                    ))}
                  </Section>
                )}

                <Section title="Core">
                  <div className="text-[13px] leading-relaxed" style={{ color: "var(--text-mid)" }}>{c.background}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {c.core_traits.map((t) => <span key={t} className="chip">{nice(t)}</span>)}
                  </div>
                </Section>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {rawJson !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="font-display text-[16px]">Raw edit</div>
            <div className="text-[12px] mt-1" style={{ color: "var(--text-mid)" }}>
              Full character record — identity, condition, acquired traits, memory. Edit the JSON and save. Add traits to the "traits" array, beliefs under "memory".
            </div>
            {rawErr && <div className="text-[12px] mt-1.5 px-2 py-1 rounded" style={{ color: "var(--danger)", background: "var(--danger-soft, rgba(200,60,60,.12))" }}>{rawErr}</div>}
            <div className="flex gap-2 mt-2.5">
              <button className="btn btn-accent" style={{ flex: 1 }} onClick={async () => {
                try {
                  const parsed = JSON.parse(rawJson);
                  setSave(await api.rawEditCharacter(save.id, sel!, parsed));
                  setRawJson(null); setRawErr("");
                } catch (e: any) { setRawErr(e?.message?.includes("JSON") ? "Invalid JSON — check your brackets and commas." : (e?.message ?? "save failed")); }
              }}>Save changes</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setRawJson(null); setRawErr(""); }}>Cancel</button>
            </div>
          </div>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            spellCheck={false} autoCapitalize="off" autoCorrect="off"
            style={{ flex: 1, width: "100%", background: "var(--ink-1)", color: "var(--text-mid)", border: "none", padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5, WebkitUserSelect: "text", userSelect: "text" }}
          />
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }} />
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-lo)" }}>{title}</div>
      {children}
    </div>
  );
}
function EditField({ label, v, set, rows }: { label: string; v: string; set: (v: string) => void; rows?: number }) {
  return (
    <div className="py-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-lo)" }}>{label}</div>
      {rows ? (
        <textarea className="field" rows={rows} value={v} onChange={(e) => set(e.target.value)} />
      ) : (
        <input className="field" value={v} onChange={(e) => set(e.target.value)} />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 py-1 text-[13.5px]">
      <span className="font-mono text-[10.5px] uppercase pt-0.5 w-16 shrink-0" style={{ color: "var(--text-lo)" }}>{k}</span>
      <span style={{ color: "var(--text-hi)" }}>{v}</span>
    </div>
  );
}
