import { useState } from "react";
import { Portrait, type Expression } from "../art/Portrait";
import { bondAction, CLASSES } from "../game/content";
import {
  assessRisk, dragTargets, endTurn, jamTargets, mayRefuse, medkitTargets, moveOptions, orderDrag, orderEvac, orderGrenade, orderJam,
  orderMedkit, orderMove, orderOverwatch, orderReload, orderShoot, orderSpot, orderStabilize, pairOf, spotTargets, squadUnits,
  stabilizeTargets, targetsFor, visibleToSquad,
} from "../game/combat/engine";
import { alive, canAct, shotInfo, WEAPONS } from "../game/combat/rules";
import type { CombatState, Unit } from "../game/combat/types";
import type { CampaignState } from "../game/types";
import { Board } from "./Board";
import { useFxPlayer } from "./useFx";

type Mode = { kind: "move" } | { kind: "grenade" } | { kind: "spot"; partnerId: string };
interface Confirm { title: string; body: string; ok: string; run: () => void; who?: Unit; hit?: number }

const FEAR_LABEL = { steady: "Steady", shaken: "Shaken", terrified: "Terrified" } as const;

export function CombatView({ c, st, analyst, onChange, onDone }: { c: CombatState; st: CampaignState; analyst: boolean; onChange: () => void; onDone: () => void }) {
  const [, setTick] = useState(0);
  const [selId, setSelId] = useState<string | null>(() => squadUnits(c).find(canAct)?.id ?? null);
  const [mode, setMode] = useState<Mode>({ kind: "move" });
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [speed, setSpeed] = useState(1);
  const player = useFxPlayer(c, speed);
  const sel = c.units.find((u) => u.id === selId && u.side === "squad");
  const myTurn = c.side === "squad" && !c.outcome && !player.busy;

  const after = () => {
    onChange();
    setMode({ kind: "move" });
    if (sel && (!canAct(sel) || sel.ap <= 0)) {
      const next = squadUnits(c).find((u) => canAct(u) && u.ap > 0);
      if (next) setSelId(next.id);
    }
    setTick((t) => t + 1);
    void player.play().then(() => setTick((t) => t + 1));
  };

  const moves = sel && myTurn ? moveOptions(c, sel) : [];
  const moveMap = new Map(moves.map((m) => [`${m.x},${m.y}`, m]));
  const targets = sel && myTurn ? targetsFor(c, sel) : [];
  const targetIds = new Set(targets.map((t) => t.unit.id));
  const visible = (u: Unit) => u.side === "squad" || (!u.dead && visibleToSquad(c, u));

  const tryMove = (x: number, y: number) => {
    if (!sel) return;
    const risk = assessRisk(c, sel, { x, y });
    const go = () => { orderMove(c, sel, x, y); after(); };
    if (mayRefuse(sel, risk)) {
      setConfirm({ title: `${sel.name} is terrified`, body: `That position is in the open. ${sel.name} may refuse the order and hold where they are.`, ok: "Order it anyway", run: go, who: sel });
    } else if (sel.kind === "ai" && risk.suicide) {
      setConfirm({ title: "Into the open", body: `${risk.exposedTo} guns will have a clear line on ${sel.name}. It won't refuse. The people close to it will see Command send it.`, ok: "Send it", run: go, who: sel });
    } else go();
  };

  const tryShoot = (t: Unit) => {
    if (!sel) return;
    const info = shotInfo(c, sel, t);
    setConfirm({
      title: `${sel.name} → ${t.name}`,
      body: `${info.hit}% to hit · ${info.crit}% crit · ${WEAPONS[sel.weapon].name} ${sel.dmg[0]}–${sel.dmg[1]}\n${info.notes.join(" · ")}`,
      ok: "Fire",
      run: () => { orderShoot(c, sel, t); after(); },
      who: sel,
      hit: info.hit,
    });
  };

  const clickTile = (x: number, y: number) => {
    if (!myTurn) return;
    const u = c.units.find((v) => alive(v) && v.x === x && v.y === y && visible(v));
    if (mode.kind === "grenade" && sel) {
      orderGrenade(c, sel, x, y);
      after();
      return;
    }
    if (mode.kind === "spot" && sel && u && u.side === "accord") {
      const partner = c.units.find((v) => v.id === mode.partnerId)!;
      orderSpot(c, sel, partner, u);
      after();
      return;
    }
    if (u?.side === "squad") { setSelId(u.id); setMode({ kind: "move" }); return; }
    if (u?.side === "accord" && targetIds.has(u.id)) { tryShoot(u); return; }
    if (moveMap.has(`${x},${y}`)) tryMove(x, y);
  };

  const riskAt = (x: number, y: number) => !!sel && assessRisk(c, sel, { x, y }).highRisk;
  const showOutcome = c.outcome && !player.busy;

  return (
    <div className="combat">
      <div className="c-board">
        <div className="board-head">
          <div>
            <div className="stencil small-stencil">{c.missionName.replace(/^the /, "")}</div>
            <div className="label">Turn {c.turn} · {c.outcome ? c.outcome : c.side === "squad" ? "Command" : "Accord"}</div>
          </div>
          <div className="row">
            <span className="label">{mode.kind === "grenade" ? "Pick a tile to throw at" : mode.kind === "spot" ? "Pick a target to call" : "Blue: one action · Ochre: dash"}</span>
            <button className="btn small" onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)}>{speed}× speed</button>
          </div>
        </div>
        <div className="board-wrap">
          <Board
            c={c} disp={player.disp} effects={player.effects} revealed={player.revealed} selId={selId}
            moveMap={moveMap} targetIds={targetIds} hover={hover} riskAt={riskAt} grenade={mode.kind === "grenade"} busy={player.busy}
            onTile={clickTile} onHover={setHover}
          />
          {player.banner && <div className={`turn-banner ${player.banner.startsWith("Accord") ? "enemy" : ""}`}>{player.banner}</div>}
        </div>
      </div>
      <div className="c-log">
        <div className="panel">
          <h3>Comms</h3>
          <div className="log">
            {c.log.slice(-60).reverse().map((l, i) => (
              <div key={i} className={`l ${l.kind}`}>
                {l.kind === "bark" ? <><b>{l.speaker}</b>“{l.text}”</> : l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="c-side">
        {showOutcome ? (
          <div className="panel">
            <h3>Mission over</h3>
            <div className={`stamp big ${c.outcome === "victory" ? "ok" : ""}`}>{c.outcome === "victory" ? "Cleared" : c.outcome === "evacuated" ? "Withdrawn" : "Lost"}</div>
            <p className="report">{c.outcome === "victory" ? "Hostiles cleared." : c.outcome === "evacuated" ? "Squad evacuated. The Accord holds the field." : "No one is answering on the squad channel."}</p>
            <button className="btn primary" onClick={onDone}>Debrief</button>
          </div>
        ) : sel ? (
          <SelectedPanel c={c} u={sel} st={st} analyst={analyst} targets={myTurn ? targets.map((t) => t.unit) : []} onShoot={tryShoot} setMode={setMode} mode={mode} after={after} locked={!myTurn} />
        ) : null}
        <div className="panel">
          <div className="spread">
            <h3>Squad</h3>
            {myTurn && <button className="btn small primary" onClick={() => { endTurn(c); after(); }}>End turn</button>}
            {player.busy && <span className="label">…</span>}
          </div>
          {squadUnits(c).map((u) => (
            <div key={u.id} className={`soldier-row ${u.id === selId ? "sel" : ""}`} onClick={() => { setSelId(u.id); setMode({ kind: "move" }); }}>
              <Portrait seed={u.soldierId!} kind={u.kind!} cls={u.cls!} expression={unitExpression(u)} size={34} />
              <div style={{ flex: 1 }}>
                <div className="name">{u.name}</div>
                <div className="small muted">
                  {u.dead ? "KIA" : u.evacuated ? "Evacuated" : u.downed ? (u.stabilized ? "Down, stable" : `Bleeding out (${u.bleed})`) : `${u.hp}/${u.maxHp} HP · ${u.kind === "human" ? FEAR_LABEL[u.fearState] : "Commons"}`}
                </div>
              </div>
              {canAct(u) && <span className="pips">{[0, 1].map((i) => <i key={i} className={u.ap > i ? "on" : ""} />)}</span>}
              {u.overwatch && <span className="tag warn">OW</span>}
            </div>
          ))}
        </div>
      </div>
      {confirm && (
        <div className="modal-back" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              {confirm.who && <Portrait seed={confirm.who.soldierId!} kind={confirm.who.kind!} cls={confirm.who.cls!} expression={unitExpression(confirm.who)} size={70} />}
              <div style={{ flex: 1 }}>
                <h2>{confirm.title}</h2>
                {confirm.hit !== undefined && <div className="hit-big">{confirm.hit}<span>%</span></div>}
                <p style={{ whiteSpace: "pre-line" }} className="small">{confirm.body}</p>
              </div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => { const r = confirm.run; setConfirm(null); r(); }}>{confirm.ok}</button>
              <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function unitExpression(u: Unit): Expression {
  if (u.dead) return "dead";
  if (u.kind === "ai") return u.downed ? "grief" : "calm";
  if (u.downed || u.fearState === "terrified") return "afraid";
  if (u.fearState === "shaken") return "tense";
  return "calm";
}

function SelectedPanel({ c, u, st, analyst, targets, onShoot, setMode, mode, after, locked }: {
  c: CombatState; u: Unit; st: CampaignState; analyst: boolean; targets: Unit[]; onShoot: (t: Unit) => void; setMode: (m: Mode) => void; mode: Mode; after: () => void; locked: boolean;
}) {
  const myTurn = c.side === "squad" && !c.outcome && !locked;
  const act = myTurn && canAct(u) && u.ap > 0;
  const stab = act ? stabilizeTargets(c, u) : [];
  const meds = act ? medkitTargets(c, u) : [];
  const drags = act ? dragTargets(c, u) : [];
  const spots = act ? spotTargets(c, u) : [];
  const jams = act ? jamTargets(c, u) : [];
  const onEvac = c.evac.some((p) => p.x === u.x && p.y === u.y);
  const soldier = u.soldierId ? st.soldiers[u.soldierId] : undefined;
  const partners = squadUnits(c).filter((p) => p !== u).map((p) => ({ p, info: pairOf(c, u, p) })).filter((x) => x.info && x.info.actions.length);
  const spotPartners = [...new Map(spots.map((s) => [s.partner.id, s])).values()];

  return (
    <div className="panel">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Portrait seed={u.soldierId!} kind={u.kind!} cls={u.cls!} expression={unitExpression(u)} size={58} />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>{u.name}</h2>
          <div className="small muted">{CLASSES[u.cls!].name} · {u.loadout} · {WEAPONS[u.weapon].name} {u.ammo}/{u.clip}</div>
        </div>
        <span className={`tag ${u.kind}`}>{u.kind === "ai" ? "COMMONS" : FEAR_LABEL[u.fearState].toUpperCase()}</span>
      </div>
      {u.kind === "human" && u.fearState !== "steady" && (
        <p className="small" style={{ color: u.fearState === "terrified" ? "var(--danger)" : "var(--accent)", marginTop: 6 }}>
          {u.fearState === "terrified" ? "Breathing fast. Won't look up from cover." : "Hands not quite steady."}
        </p>
      )}
      {analyst && u.kind === "human" && <p className="small mono dim">fear {u.fear} · will {u.will} · trust {u.commandTrust}</p>}
      {soldier && soldier.traits.some((t) => t.combatEffect) && (
        <div className="small muted" style={{ marginTop: 6 }}>{soldier.traits.filter((t) => t.combatEffect).map((t) => <div key={t.id}>· {t.text}</div>)}</div>
      )}
      {act && (
        <>
          <h3 style={{ marginTop: 12 }}>Shots</h3>
          {targets.length === 0 && <p className="small muted">No line on anything.</p>}
          {targets.map((t) => {
            const info = shotInfo(c, u, t);
            return (
              <button key={t.id} className="btn small" style={{ marginRight: 6, marginBottom: 6 }} disabled={u.ammo <= 0} onClick={() => onShoot(t)}>
                {t.name} · {info.hit}%{info.flanked ? " ⚑" : ""}
              </button>
            );
          })}
          <h3 style={{ marginTop: 10 }}>Actions</h3>
          <div className="row">
            <button className="btn small" disabled={u.ammo <= 0} onClick={() => { orderOverwatch(c, u); after(); }}>Overwatch</button>
            <button className="btn small" disabled={u.ammo >= u.clip} onClick={() => { orderReload(c, u); after(); }}>Reload</button>
            {u.grenades > 0 && <button className={`btn small ${mode.kind === "grenade" ? "on" : ""}`} onClick={() => setMode(mode.kind === "grenade" ? { kind: "move" } : { kind: "grenade" })}>Grenade ({u.grenades})</button>}
            {onEvac && <button className="btn small" onClick={() => { orderEvac(c, u); after(); }}>Evac</button>}
          </div>
          {(meds.length > 0 || stab.length > 0) && (
            <div className="row" style={{ marginTop: 6 }}>
              {meds.map((t) => <button key={`m${t.id}`} className="btn small" onClick={() => { orderMedkit(c, u, t); after(); }}>Medkit → {t === u ? "self" : t.name} ({u.medkits})</button>)}
              {stab.filter((t) => !meds.includes(t)).map((t) => <button key={`s${t.id}`} className="btn small" onClick={() => { orderStabilize(c, u, t); after(); }}>Stabilize {t.name}</button>)}
            </div>
          )}
          {jams.length > 0 && (
            <div className="row" style={{ marginTop: 6 }}>
              {jams.map((t) => <button key={t.id} className="btn small" onClick={() => { orderJam(c, u, t); after(); }}>Jam {t.name} ({u.jams})</button>)}
            </div>
          )}
          {(drags.length > 0 || spotPartners.length > 0) && (
            <>
              <h3 style={{ marginTop: 10, color: "var(--ai)" }}>Bond actions</h3>
              <div className="row">
                {drags.map((t) => <button key={t.id} className="btn small" onClick={() => { orderDrag(c, u, t); after(); }}>Drag {t.name} to cover</button>)}
                {spotPartners.map((s) => (
                  <button key={s.partner.id} className={`btn small ${mode.kind === "spot" && mode.partnerId === s.partner.id ? "on" : ""}`} onClick={() => setMode({ kind: "spot", partnerId: s.partner.id })}>
                    Spotter call → {s.partner.name} (+{s.bonus})
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {partners.length > 0 && (
        <p className="small dim" style={{ marginTop: 10 }}>
          Works with {partners.map(({ p, info }) => `${p.name} (${info!.actions.map((a) => bondAction(a)?.name).join(", ")})`).join("; ")}.
        </p>
      )}
    </div>
  );
}
