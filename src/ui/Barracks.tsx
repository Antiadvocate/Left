import { useState } from "react";
import { assignBunk, POD_NAMES } from "../game/campaign";
import { bondAction, CLASSES, VOICES } from "../game/content";
import { recall } from "../game/memory";
import { edge, living, mutualTier, pairActions } from "../game/relations";
import { RANKS } from "../game/roster";
import type { CampaignState, Soldier } from "../game/types";
import { HabitLine, KindTag, StatusTag, Token } from "./common";
import { EventCard } from "./Night";

export function BarracksView({ st, analyst, onChange }: { st: CampaignState; analyst: boolean; onChange: () => void }) {
  const alive = living(st);
  const [sel, setSel] = useState<string | null>(alive[0]?.id ?? null);
  const [moving, setMoving] = useState(false);
  const selected = sel ? st.soldiers[sel] : undefined;
  const byBunk = new Map(alive.filter((s) => s.bunkId).map((s) => [s.bunkId!, s]));

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <div className="spread">
            <h3>Barracks · bunk assignments</h3>
            {selected && (
              <button className={`btn small ${moving ? "on" : ""}`} onClick={() => setMoving(!moving)}>
                {moving ? `Pick a bunk for ${selected.callsign}` : `Move ${selected.callsign}`}
              </button>
            )}
          </div>
          <p className="small muted">Bunkmates share a room every night. Who sleeps next to whom decides who runs into whom.</p>
          <div className="pods">
            {st.bunks.map((pod, i) => (
              <div key={i} className="pod">
                <h3>Bay {POD_NAMES[i]}</h3>
                <div className="bunks">
                  {pod.map((b) => {
                    const s = byBunk.get(b);
                    return (
                      <div
                        key={b}
                        className={`bunk ${s ? "filled" : ""} ${moving ? "target" : ""}`}
                        onClick={() => {
                          if (moving && selected) { assignBunk(st, selected.id, b); setMoving(false); onChange(); }
                          else if (s) setSel(s.id);
                        }}
                      >
                        {s ? <><Token s={s} /><span style={{ flex: 1 }}>{s.callsign}</span><StatusTag s={s} /></> : <span className="dim">empty</span>}
                        <span className="bid">{b}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        {analyst && <div className="panel"><RelationshipMatrix st={st} /></div>}
      </div>
      <div>{selected ? <Dossier st={st} s={selected} analyst={analyst} /> : <div className="panel muted">Select a soldier.</div>}</div>
    </div>
  );
}

function Dossier({ st, s, analyst }: { st: CampaignState; s: Soldier; analyst: boolean }) {
  const alive = living(st).filter((o) => o.id !== s.id);
  const partners = alive.map((o) => ({ o, actions: pairActions(st, s.id, o.id) })).filter((p) => p.actions.length);
  const seen = st.nightLog.slice(-10).flatMap((r) => r.events.filter((e) => e.participants.includes(s.id))).slice(-5).reverse();
  return (
    <>
      <div className="panel">
        <div className="row">
          <Token s={s} />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{s.name}</h2>
            <div className="small muted">{RANKS[s.rank]} · {CLASSES[s.class].name} · {s.missions} missions · {s.kills} kills</div>
          </div>
          <KindTag s={s} />
          <StatusTag s={s} />
        </div>
        <div className="row small mono" style={{ marginTop: 10, gap: 14 }}>
          <span>AIM {s.stats.aim}</span><span>HP {s.stats.hp}</span><span>MOB {s.stats.mobility}</span><span>DEF {s.stats.defense}</span><span>TECH {s.stats.tech}</span>
          {s.kind === "human" && <span>WILL {s.stats.will}</span>}
        </div>
        {s.talents.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Talents: {s.talents.join(", ")}{s.kind === "ai" ? " (fixed)" : ""}</div>}
      </div>
      <div className="panel">
        <h3>Habits</h3>
        {s.traits.map((h) => <HabitLine key={h.id} h={h} />)}
        <p className="small dim" style={{ marginTop: 8 }}>Voice: {VOICES[s.voice]}</p>
      </div>
      <div className="panel">
        <h3>In the field</h3>
        {partners.length === 0 && <p className="small muted">Works alone, so far.</p>}
        {partners.map(({ o, actions }) => (
          <div key={o.id} className="row small" style={{ marginBottom: 4 }}>
            <Token s={o} />
            <span>{o.callsign}</span>
            <span className="muted">— {actions.map((a) => bondAction(a)?.name).join(", ")}</span>
          </div>
        ))}
      </div>
      <div className="panel">
        <h3>Seen lately</h3>
        {seen.length === 0 && <p className="small muted">Nothing anyone wrote down.</p>}
        {seen.map((e) => <EventCard key={e.id} st={st} e={e} />)}
      </div>
      {analyst && (
        <div className="panel">
          <h3>Analyst · hidden state</h3>
          <div className="small mono stack">
            <div>attachment {s.attachment} · relaxation {s.relaxation.toFixed(1)} ({s.braced ? "braced" : "settled"}) · set point {s.capacity}</div>
            <div>command trust {s.commandTrust.toFixed(0)} · once terrified: {s.wasTerrified ? "yes" : "no"}</div>
          </div>
          <h3 style={{ marginTop: 12 }}>Memories (as recalled now)</h3>
          {recall(s, 6).map((m) => (
            <div key={m.id} className="small" style={{ marginBottom: 6 }}>
              <span className="mono dim">[{m.significance}] </span>{m.core} <span className="muted">— {m.anchor}</span>
              {m.peripheral.length > 0 && <span className="dim"> ({m.peripheral.join("; ")})</span>}
            </div>
          ))}
          <h3 style={{ marginTop: 12 }}>Toward others</h3>
          <table className="matrix">
            <thead><tr><th></th><th>tier</th><th>warm →</th><th>trust →</th><th>← warm</th><th>← trust</th><th>attr</th></tr></thead>
            <tbody>
              {alive.map((o) => {
                const ab = edge(st, s.id, o.id), ba = edge(st, o.id, s.id);
                return (
                  <tr key={o.id}>
                    <td style={{ textAlign: "left" }}>{o.callsign}</td>
                    <td>{mutualTier(st, s.id, o.id)}{ab.tier !== ba.tier ? "*" : ""}</td>
                    <td>{ab.warmth.toFixed(0)}</td><td>{ab.trust.toFixed(0)}</td>
                    <td>{ba.warmth.toFixed(0)}</td><td>{ba.trust.toFixed(0)}</td>
                    <td>{ab.attraction.toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RelationshipMatrix({ st }: { st: CampaignState }) {
  const alive = living(st);
  const color = (w: number) => (w > 0 ? `rgba(124,196,127,${Math.min(0.85, w / 60)})` : `rgba(224,100,90,${Math.min(0.85, -w / 60)})`);
  return (
    <>
      <h3>Analyst · warmth matrix (row → column)</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="matrix">
          <thead><tr><th></th>{alive.map((o) => <th key={o.id}>{o.callsign.slice(0, 3)}</th>)}</tr></thead>
          <tbody>
            {alive.map((a) => (
              <tr key={a.id}>
                <th style={{ textAlign: "left" }}>{a.callsign}</th>
                {alive.map((b) => {
                  if (a === b) return <td key={b.id}>·</td>;
                  const e = edge(st, a.id, b.id);
                  return <td key={b.id} style={{ background: color(e.warmth) }} title={`${a.callsign}→${b.callsign}: warmth ${e.warmth.toFixed(0)}, trust ${e.trust.toFixed(0)}, ${e.tier}`}>{e.warmth.toFixed(0)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
