import { deployable, missionToday, squadMood } from "../game/campaign";
import { living } from "../game/relations";
import type { CampaignState, MissionSpec, Settings } from "../game/types";
import { RefusalReviews } from "./Debrief";
import { Figure } from "../art/Figure";
import { EventCard } from "./Night";

/** The roster standing in the hangar: the wounded sit, the AIs stand perfectly still. */
function Lineup({ st }: { st: CampaignState }) {
  const people = living(st);
  const gap = 46, w = Math.max(people.length * gap + 30, 320);
  return (
    <svg viewBox={`0 0 ${w} 96`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="The roster">
      <rect x={0} y={78} width={w} height={18} fill="#23201a14" />
      <line x1={0} y1={78} x2={w} y2={78} stroke="#23201a55" strokeWidth={1} />
      {people.map((s, i) => (
        <g key={s.id} transform={`translate(${30 + i * gap} 82)`}>
          <ellipse rx={14} ry={3} fill="#000" opacity={0.18} />
          <Figure seed={s.id} kind={s.kind} cls={s.class} loadout={s.loadout} pose={s.status === "injured" || s.status === "repair" ? "sit" : s.braced ? "cower" : "stand"} facing={i % 2 ? -1 : 1} armed={s.status === "active"} />
          <text y={12} textAnchor="middle" style={{ fontFamily: "var(--label)", fontWeight: 700, fontSize: 9, letterSpacing: "0.06em", fill: "#4d463a" }}>{s.callsign.toUpperCase()}</text>
        </g>
      ))}
    </svg>
  );
}

function moodLabel(m: number): { text: string; cls: string } {
  if (m >= 25) return { text: "The squad follows orders without looking back.", cls: "good" };
  if (m >= 5) return { text: "The squad follows orders.", cls: "" };
  if (m >= -15) return { text: "Orders get repeated back slower than they used to.", cls: "warn" };
  return { text: "People stop talking when the duty officer walks in.", cls: "bad" };
}

export function CommandView({ st, settings, onDeploy, onEndDay, onChange, onGo }: {
  st: CampaignState; settings: Settings; onDeploy: (m: MissionSpec) => void; onEndDay: () => void; onChange: () => void;
  onGo: (v: "barracks" | "memorial" | "settings") => void;
}) {
  const today = missionToday(st);
  const next = st.missions.filter((m) => m.day > st.day).sort((a, b) => a.day - b.day)[0];
  const alive = living(st);
  const ready = deployable(st);
  const mood = moodLabel(squadMood(st));
  const last = st.nightLog[st.nightLog.length - 1];
  const reviews = st.refusalReviews.length > 0;
  const llmOn = settings.useLLM && !!settings.apiKey;

  return (
    <div className="grid2">
      <div>
        <div className="panel clipped">
          <h3>Situation · Day {st.day}</h3>
          {today && <span className="stamp abs">Threat {today.difficulty}</span>}
          {today ? (
            <>
              <h1 style={{ textTransform: "capitalize" }}>{today.name.replace(/^the /, "")}</h1>
              <p className="muted">Accord activity confirmed. Threat level {today.difficulty}. Squad of up to six.</p>
              <div className="row">
                <button className="btn primary" disabled={reviews || ready.length === 0} onClick={() => onDeploy(today)}>Plan deployment</button>
                <button className="btn" disabled={reviews} onClick={onEndDay}>Let it go and end the day</button>
              </div>
              {ready.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>Nobody is fit to deploy.</p>}
            </>
          ) : (
            <>
              <h1>No deployment today</h1>
              <p className="muted">
                {next ? <>Next: <span style={{ textTransform: "capitalize" }}>{next.name.replace(/^the /, "")}</span>, in {next.day - st.day} day{next.day - st.day > 1 ? "s" : ""}.</> : "Quiet on the wire."}
                {" "}The barracks keeps moving between deployments.
              </p>
              <div className="row">
                <button className="btn primary" disabled={reviews} onClick={onEndDay}>End the day</button>
                <button className="btn" onClick={() => onGo("barracks")}>Bunk assignments</button>
              </div>
            </>
          )}
          {reviews && <p className="small" style={{ color: "var(--accent)", marginTop: 10 }}>A refusal is waiting on Command's decision.</p>}
        </div>
        <div className="panel">
          <h3>Hangar line</h3>
          <Lineup st={st} />
        </div>
        {reviews && (
          <div className="panel">
            <RefusalReviews st={st} onChange={onChange} />
          </div>
        )}
        {last && last.events.length > 0 && (
          <div className="panel">
            <h3>Last night</h3>
            {last.events.slice(0, 3).map((e) => <EventCard key={e.id} st={st} e={e} />)}
            {last.events.length > 3 && <p className="small muted">…and {last.events.length - 3} more in the barracks log.</p>}
          </div>
        )}
      </div>
      <div>
        <div className="panel">
          <h3>Watch Command</h3>
          <div className="stack small">
            <div className="spread"><span className="muted">Roster</span><span>{alive.length} ({ready.length} fit to deploy)</span></div>
            <div className="spread"><span className="muted">Commons AI soldiers</span><span>{alive.filter((s) => s.kind === "ai").length}</span></div>
            <div className="spread"><span className="muted">In medbay / repair</span><span>{alive.filter((s) => s.status === "injured" || s.status === "repair").length}</span></div>
            <div className="spread"><span className="muted">On the memorial wall</span><span>{st.memorial.length}</span></div>
            <div className="spread"><span className="muted">Funds (Halden contract)</span><span className="mono">{st.funds}</span></div>
          </div>
          <p className={`small`} style={{ marginTop: 12, color: mood.cls === "bad" ? "var(--danger)" : mood.cls === "warn" ? "var(--accent)" : undefined }}>{mood.text}</p>
        </div>
        <div className="panel">
          <h3>Night pass</h3>
          <p className="small muted">
            {llmOn ? <>Writing with <span className="mono">{settings.model}</span>. Falls back to templates if the call fails.</> : <>Template events. Add a model in Settings to have the night written by an LLM.</>}
          </p>
          <p className="small dim">Command sees what soldiers do and say, not how they feel.</p>
        </div>
      </div>
    </div>
  );
}
