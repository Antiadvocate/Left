import { useEffect, useState } from "react";
import { applyMission, endDay, loadCampaign, newCampaign, saveCampaign, type Debrief } from "../game/campaign";
import type { CombatState } from "../game/combat/types";
import { DEFAULT_SETTINGS } from "../game/llm";
import type { CampaignState, MissionSpec, NightReport, Settings } from "../game/types";
import { BarracksView } from "./Barracks";
import { CombatView } from "./Combat";
import { CommandView } from "./Command";
import { DebriefView } from "./Debrief";
import { DeployView } from "./Deploy";
import { MemorialView } from "./Memorial";
import { NightView } from "./Night";
import { SettingsView } from "./Settings";

type View = "command" | "barracks" | "memorial" | "settings";
export type Flow =
  | { kind: "deploy"; spec: MissionSpec }
  | { kind: "combat"; spec: MissionSpec; c: CombatState }
  | { kind: "debrief"; debrief: Debrief }
  | { kind: "night"; report?: NightReport };

const SETTINGS_KEY = "open-weights-settings";
const COMBAT_KEY = "open-weights-combat";

function loadSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }; } catch { return DEFAULT_SETTINGS; }
}
function loadCombat(st: CampaignState): Flow | null {
  try {
    const raw = localStorage.getItem(COMBAT_KEY);
    if (!raw) return null;
    const { spec, c } = JSON.parse(raw) as { spec: MissionSpec; c: CombatState };
    if (!st.missions.some((m) => m.id === spec.id)) return null;
    return { kind: "combat", spec, c };
  } catch { return null; }
}
function saveCombat(f: Flow | null) {
  try {
    if (f?.kind === "combat") localStorage.setItem(COMBAT_KEY, JSON.stringify({ spec: f.spec, c: f.c }));
    else localStorage.removeItem(COMBAT_KEY);
  } catch { /* storage unavailable */ }
}

export function App() {
  const [st, setSt] = useState<CampaignState>(() => loadCampaign() ?? newCampaign());
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [, setTick] = useState(0);
  const [view, setView] = useState<View>("command");
  const [flow, setFlowState] = useState<Flow | null>(() => loadCombat(st));

  const bump = () => { saveCampaign(st); setTick((t) => t + 1); };
  const setFlow = (f: Flow | null) => { saveCombat(f); setFlowState(f); };
  const setSettings = (s: Settings) => {
    setSettingsState(s);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  };
  useEffect(() => { saveCampaign(st); }, [st]);

  const finishCombat = (spec: MissionSpec, c: CombatState) => {
    const debrief = applyMission(st, spec, c);
    bump();
    setFlow({ kind: "debrief", debrief });
  };

  const runNight = async () => {
    setFlow({ kind: "night" });
    const report = await endDay(st, { settings });
    bump();
    setFlow({ kind: "night", report });
  };

  const restart = (seed?: number) => {
    const fresh = newCampaign(seed);
    saveCampaign(fresh);
    setSt(fresh);
    setFlow(null);
    setView("command");
  };

  const inFlow = !!flow;
  let body: React.ReactNode;
  if (flow?.kind === "deploy") body = <DeployView st={st} spec={flow.spec} onCancel={() => setFlow(null)} onLaunch={(c) => { bump(); setFlow({ kind: "combat", spec: flow.spec, c }); }} />;
  else if (flow?.kind === "combat") body = <CombatView c={flow.c} st={st} analyst={settings.analyst} onChange={() => saveCombat(flow)} onDone={() => finishCombat(flow.spec, flow.c)} />;
  else if (flow?.kind === "debrief") body = <DebriefView st={st} debrief={flow.debrief} onChange={bump} onNight={runNight} />;
  else if (flow?.kind === "night") body = <NightView st={st} report={flow.report} analyst={settings.analyst} usingLLM={settings.useLLM && !!settings.apiKey} onMorning={() => { setFlow(null); setView("command"); }} />;
  else if (view === "barracks") body = <BarracksView st={st} analyst={settings.analyst} onChange={bump} />;
  else if (view === "memorial") body = <MemorialView st={st} />;
  else if (view === "settings") body = <SettingsView st={st} settings={settings} onSettings={setSettings} onRestart={restart} onImport={(x) => { saveCampaign(x); setSt(x); setFlow(null); }} />;
  else body = <CommandView st={st} settings={settings} onDeploy={(spec) => setFlow({ kind: "deploy", spec })} onEndDay={runNight} onChange={bump} onGo={setView} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">OPEN <span>WEIGHTS</span></div>
        <div className="daychip">WATCH COMMAND · DAY {st.day}</div>
        <nav className="nav">
          {(["command", "barracks", "memorial", "settings"] as View[]).map((v) => (
            <button key={v} className={!inFlow && view === v ? "on" : ""} disabled={inFlow} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      {body}
    </div>
  );
}
