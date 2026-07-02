import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Feather, Users, Globe2, BarChart3, Moon, Sun, Settings2 } from "lucide-react";
import { api, type ClientSave } from "./lib/api";
import { hasApiKey, setApiKey } from "./config";
import Library from "./views/Library";
import Play from "./views/Play";
import Cast from "./views/Cast";
import World from "./views/World";
import Chronicle from "./views/Chronicle";
import Forge from "./views/Forge";
import Settings, { applyProseFont } from "./views/Settings";

export type Tab = "play" | "cast" | "world" | "chronicle" | "settings";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "play", label: "Play", icon: Feather },
  { id: "cast", label: "Cast", icon: Users },
  { id: "world", label: "World", icon: Globe2 },
  { id: "chronicle", label: "Chronicle", icon: BarChart3 },
  { id: "settings", label: "Tuning", icon: Settings2 },
];

export default function App() {
  const [save, setSave] = useState<ClientSave | null>(null);
  const [tab, setTab] = useState<Tab>("play");
  const [mode, setMode] = useState<"library" | "forge" | "game">("library");
  const [lightMode, setLightMode] = useState(() => localStorage.getItem("weft-mode") === "light");
  const [needKey, setNeedKey] = useState(!hasApiKey());
  const [keyInput, setKeyInput] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", lightMode ? "light" : "dark");
    localStorage.setItem("weft-mode", lightMode ? "light" : "dark");
  }, [lightMode]);

  const theme = save?.world_bible.era_theme && save.world_bible.era_theme !== "auto"
    ? save.world_bible.era_theme : "ember";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => { applyProseFont(localStorage.getItem("weft-prose-font") ?? "newsreader"); }, []);

  const openSave = useCallback(async (id: string) => {
    const s = await api.save(id);
    setSave(s); setTab("play"); setMode("game");
  }, []);

  const closeSave = useCallback(() => { setSave(null); setMode("library"); }, []);

  const title = mode === "game" && save ? save.world_bible.name : mode === "forge" ? "The Forge" : "Weft";
  const subtitle = mode === "game" && save ? `${save.world.current_time} · turn ${save.world.current_turn}` : "a world that reacts";

  if (needKey) {
    return (
      <div className="shell">
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="card p-6 max-w-sm w-full">
            <div className="font-display text-[22px] mb-1" style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}>Weft</div>
            <div className="text-[13.5px] mb-4" style={{ color: "var(--text-mid)" }}>
              A world that reacts. It runs entirely in your browser and talks to models through your own OpenRouter key — paste it once to begin.
            </div>
            <input className="field" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} type="password"
              placeholder="sk-or-..." value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
            <button className="btn btn-accent w-full mt-3" disabled={!keyInput.trim()}
              onClick={() => { setApiKey(keyInput.trim()); setNeedKey(false); }}>
              Begin
            </button>
            <div className="text-[11px] italic mt-3" style={{ color: "var(--text-lo)" }}>
              Stored only in this browser (localStorage), sent only to OpenRouter. Free & paid models at openrouter.ai/keys. You can change it later in Tuning.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar z-30">
        <div className="flex items-center justify-between px-4 py-2.5">
          <button className="text-left" onClick={mode === "game" ? closeSave : undefined}>
            <div className="font-display text-[17px] leading-tight" style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}>
              {title}
            </div>
            <div className="font-mono text-[10px] tracking-wider uppercase" style={{ color: "var(--text-lo)" }}>
              {subtitle}
            </div>
          </button>
          <div className="flex items-center gap-2">
            <button className="chip" onClick={() => setLightMode((v) => !v)} aria-label="theme">
              {lightMode ? <Moon size={11} /> : <Sun size={11} />}
            </button>
            {mode === "game" && (
              <button className="chip" onClick={closeSave}>
                <BookOpen size={11} /> library
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 relative">
        <AnimatePresence mode="wait">
          {mode === "library" && (
            <motion.div key="library" className="absolute inset-0"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
              <Library onOpen={openSave} onForge={() => setMode("forge")} onCreated={(s) => { setSave(s); setMode("game"); setTab("play"); }} />
            </motion.div>
          )}
          {mode === "forge" && (
            <motion.div key="forge" className="absolute inset-0"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
              <Forge onBack={() => setMode("library")} onCreated={(s) => { setSave(s); setMode("game"); setTab("play"); }} />
            </motion.div>
          )}
          {mode === "game" && save && (
            <motion.div key={`game-${tab}`} className="absolute inset-0"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
              {tab === "play" && <Play save={save} setSave={setSave} />}
              {tab === "cast" && <Cast save={save} setSave={setSave} />}
              {tab === "world" && <World save={save} />}
              {tab === "chronicle" && <Chronicle save={save} />}
              {tab === "settings" && <Settings save={save} setSave={setSave} />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {mode === "game" && save && (
        <nav className="tabbar z-30">
          <div className="flex items-stretch justify-around px-2 pt-1.5">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <button key={id} onClick={() => setTab(id)}
                  className="flex flex-col items-center gap-0.5 px-3 py-1 relative"
                  style={{ color: active ? "var(--accent)" : "var(--text-lo)" }}>
                  {active && (
                    <motion.div layoutId="tab-glow" className="absolute -top-1.5 w-7 h-[2.5px] rounded-full"
                      style={{ background: "var(--accent)" }}
                      transition={{ type: "spring", stiffness: 480, damping: 36 }} />
                  )}
                  <Icon size={19} />
                  <span className="font-mono text-[9px] uppercase tracking-wider">{label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
