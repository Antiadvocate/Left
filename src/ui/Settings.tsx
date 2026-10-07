import { useState } from "react";
import { DEFAULT_SETTINGS } from "../game/llm";
import type { CampaignState, Settings } from "../game/types";

export function SettingsView({ st, settings, onSettings, onRestart, onImport }: {
  st: CampaignState; settings: Settings; onSettings: (s: Settings) => void; onRestart: (seed?: number) => void; onImport: (st: CampaignState) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [seed, setSeed] = useState("");
  const [msg, setMsg] = useState("");
  const set = (k: keyof Settings, v: string | boolean) => setDraft({ ...draft, [k]: v });

  const exportSave = () => {
    const blob = new Blob([JSON.stringify(st)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `open-weights-day${st.day}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importSave = async (f: File) => {
    try {
      const x = JSON.parse(await f.text());
      if (x?.version !== 1 || !x.soldiers) throw new Error("not an Open Weights save");
      onImport(x);
      setMsg("Save loaded.");
    } catch (e: any) { setMsg(`Import failed: ${e?.message ?? e}`); }
  };

  return (
    <div className="grid2">
      <div className="panel">
        <h3>Night pass model</h3>
        <p className="small muted">
          Any OpenAI-compatible chat endpoint: OpenRouter, DeepSeek, or a local server. The model only writes between days: barracks events, memories and bark banks.
          It never touches combat, and every number it proposes is clamped by the rules engine. The key stays in this browser.
        </p>
        <label className="field"><span>Endpoint base URL</span><input type="text" value={draft.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} /></label>
        <label className="field"><span>API key</span><input type="password" value={draft.apiKey} onChange={(e) => set("apiKey", e.target.value)} /></label>
        <label className="field"><span>Model</span><input type="text" value={draft.model} onChange={(e) => set("model", e.target.value)} /></label>
        <label className="row small" style={{ marginBottom: 10 }}><input type="checkbox" checked={draft.useLLM} onChange={(e) => set("useLLM", e.target.checked)} /> Use the model for the night pass</label>
        <label className="row small" style={{ marginBottom: 14 }}><input type="checkbox" checked={draft.analyst} onChange={(e) => set("analyst", e.target.checked)} /> Analyst overlay (debug: show relationship numbers, fear, memories)</label>
        <div className="row">
          <button className="btn primary" onClick={() => { onSettings(draft); setMsg("Saved."); }}>Save</button>
          <button className="btn" onClick={() => setDraft({ ...DEFAULT_SETTINGS, apiKey: draft.apiKey })}>Defaults</button>
          <span className="small muted">{msg}</span>
        </div>
      </div>
      <div>
        <div className="panel">
          <h3>Campaign</h3>
          <p className="small muted">Seed <span className="mono">{st.seed}</span> · day {st.day}</p>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn" onClick={exportSave}>Export save</button>
            <label className="btn">Import save<input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importSave(e.target.files[0])} /></label>
          </div>
          <label className="field"><span>New campaign seed (optional)</span><input type="text" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} /></label>
          <button className="btn danger" onClick={() => { if (confirm("Start a new campaign? The current one is overwritten.")) onRestart(seed ? Number(seed) : undefined); }}>New campaign</button>
        </div>
      </div>
    </div>
  );
}
