import { useState } from "react";
import { combatPairs, deployable, splitBonds, squadMood } from "../game/campaign";
import { startCombat } from "../game/combat/engine";
import type { CombatState } from "../game/combat/types";
import type { CampaignState, MissionSpec } from "../game/types";
import { CLASSES } from "../game/content";
import { RANKS } from "../game/roster";
import { KindTag, Standee } from "./common";

export function DeployView({ st, spec, onCancel, onLaunch }: { st: CampaignState; spec: MissionSpec; onCancel: () => void; onLaunch: (c: CombatState) => void }) {
  const ready = deployable(st);
  const [picked, setPicked] = useState<string[]>(() => ready.slice(0, 4).map((s) => s.id));
  const [, setTick] = useState(0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 6 ? p : [...p, id]));
  const splits = splitBonds(st, picked);
  const heavy = picked.filter((id) => st.soldiers[id].loadout === "heavy").length;

  const launch = () => {
    const squad = picked.map((id) => st.soldiers[id]);
    const c = startCombat({ mission: spec, squad, pairs: combatPairs(st, squad), squadMood: squadMood(st) });
    onLaunch(c);
  };

  return (
    <div className="grid2">
      <div className="panel">
        <div className="spread">
          <h3>Deployment · {spec.name}</h3>
          <span className="small mono muted">{picked.length}/6 · {heavy} heavy / {picked.length - heavy} light</span>
        </div>
        <p className="small muted">Going all heavy or all light beats an enemy that adapts to the middle, but it can mean benching half of a pair.</p>
        <div className="grid3">
          {ready.map((s) => {
            const on = picked.includes(s.id);
            return (
              <div key={s.id} className={`deploy-card ${on ? "on" : ""}`} onClick={() => toggle(s.id)}>
                {on && <span className="stamp tick" style={{ fontSize: 12, padding: "0 5px" }}>Go</span>}
                <Standee s={s} height={118} pose={on ? "ready" : "stand"} />
                <div className="name">{s.callsign}</div>
                <div className="small muted">{RANKS[s.rank]} · {CLASSES[s.class].name}</div>
                <div className="row" style={{ marginTop: 6, justifyContent: "space-between" }}>
                  <KindTag s={s} />
                  <button
                    className={`btn small ${s.loadout === "heavy" ? "on" : ""}`}
                    onClick={(e) => { e.stopPropagation(); s.loadout = s.loadout === "heavy" ? "light" : "heavy"; setTick((t) => t + 1); }}
                    title="Toggle loadout line"
                  >
                    {s.loadout}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="panel">
          <h3>Bonds this squad splits</h3>
          {splits.length === 0 ? (
            <p className="small muted">None that anyone has noticed.</p>
          ) : (
            splits.map((x) => {
              const goes = picked.includes(x.a) ? x.a : x.b;
              const stays = goes === x.a ? x.b : x.a;
              return (
                <p key={`${x.a}${x.b}`} className="small">
                  <b>{st.soldiers[goes].callsign}</b> deploys; <b>{st.soldiers[stays].callsign}</b> stays behind.
                </p>
              );
            })
          )}
          <p className="small dim">Partners apart for several missions start to drift.</p>
        </div>
        <div className="panel">
          <div className="row">
            <button className="btn primary" disabled={picked.length === 0} onClick={launch}>Launch</button>
            <button className="btn" onClick={onCancel}>Back</button>
          </div>
        </div>
      </div>
    </div>
  );
}
