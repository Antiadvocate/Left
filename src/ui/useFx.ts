// Plays the engine's fx stream back as animation. The engine has already resolved everything;
// the board shows a lagging "display" copy of each unit that catches up step by step.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CombatState, Fx } from "../game/combat/types";

export interface Disp {
  x: number;
  y: number;
  hp: number;
  downed: boolean;
  dead: boolean;
  evac: boolean;
  moving: boolean;
  step: number;
  aimAt?: string;
  hitAt?: number;
}

export type Effect =
  | { id: number; kind: "tracer"; x1: number; y1: number; x2: number; y2: number; hit: boolean; enemy: boolean }
  | { id: number; kind: "float"; x: number; y: number; text: string; tone: string }
  | { id: number; kind: "blast"; x: number; y: number }
  | { id: number; kind: "bubble"; unitId: string; text: string };

/** Omit that distributes over a union, so each effect variant keeps its own fields. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function snapshot(c: CombatState): Record<string, Disp> {
  const out: Record<string, Disp> = {};
  for (const u of c.units) out[u.id] = { x: u.x, y: u.y, hp: u.hp, downed: u.downed, dead: u.dead, evac: u.evacuated, moving: false, step: 0 };
  return out;
}

let effectId = 0;

export function useFxPlayer(c: CombatState, speed: number) {
  const disp = useRef<Record<string, Disp>>(snapshot(c));
  const [, setFrame] = useState(0);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const revealed = useRef(new Map<string, number>());
  const running = useRef(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const redraw = () => setFrame((f) => f + 1);

  useEffect(() => {
    // resuming a saved mission: nothing to replay
    c.fx = [];
    disp.current = snapshot(c);
    redraw();
  }, [c]);

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / speedRef.current));
  const addEffect = (e: DistOmit<Effect, "id">, ms: number) => {
    const id = ++effectId;
    setEffects((xs) => [...xs, { ...e, id } as Effect]);
    setTimeout(() => setEffects((xs) => xs.filter((x) => x.id !== id)), ms / speedRef.current);
  };
  const reveal = (id: string) => revealed.current.set(id, performance.now() + 1600 / speedRef.current);

  const tween = (id: string, x: number, y: number, ms: number) =>
    new Promise<void>((resolve) => {
      const d = disp.current[id];
      if (!d) return resolve();
      const x0 = d.x, y0 = d.y, t0 = performance.now(), dur = ms / speedRef.current;
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        d.x = x0 + (x - x0) * t;
        d.y = y0 + (y - y0) * t;
        redraw();
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

  const playOne = async (f: Fx, next?: Fx) => {
    const D = disp.current;
    switch (f.k) {
      case "step": {
        const d = D[f.id];
        if (!d) return;
        d.moving = true;
        d.step++;
        await tween(f.id, f.x, f.y, 120);
        if (!(next && next.k === "step" && next.id === f.id)) { d.moving = false; redraw(); }
        return;
      }
      case "place":
        await tween(f.id, f.x, f.y, 200);
        return;
      case "shot": {
        const a = D[f.from], t = D[f.to];
        if (!a || !t) return;
        reveal(f.from); reveal(f.to);
        a.aimAt = f.to;
        redraw();
        await sleep(170);
        const enemy = c.units.find((u) => u.id === f.from)?.side === "accord";
        const off = f.hit ? 0 : (f.dmg + (f.from.length % 3) - 1) * 0.35 + 0.3;
        addEffect({ kind: "tracer", x1: a.x, y1: a.y, x2: t.x + off, y2: t.y - (f.hit ? 0 : 0.3), hit: f.hit, enemy }, 320);
        await sleep(160);
        if (f.hit) {
          t.hitAt = performance.now();
          addEffect({ kind: "float", x: t.x, y: t.y, text: f.crit ? `CRIT −${f.dmg}` : `−${f.dmg}`, tone: "dmg" }, 1300);
        } else addEffect({ kind: "float", x: t.x, y: t.y, text: "MISS", tone: "miss" }, 1100);
        redraw();
        await sleep(260);
        a.aimAt = undefined;
        redraw();
        return;
      }
      case "unit": {
        const d = D[f.id];
        if (!d) return;
        const wasDown = d.downed, wasDead = d.dead;
        Object.assign(d, { hp: f.hp, downed: f.downed, dead: f.dead, evac: f.evacuated });
        redraw();
        if (f.dead && !wasDead) {
          const enemy = c.units.find((u) => u.id === f.id)?.side === "accord";
          if (enemy) addEffect({ kind: "blast", x: d.x, y: d.y }, 700);
          addEffect({ kind: "float", x: d.x, y: d.y, text: enemy ? "DESTROYED" : "KIA", tone: enemy ? "info" : "warn" }, 1500);
          await sleep(380);
        } else if (f.downed && !wasDown) {
          addEffect({ kind: "float", x: d.x, y: d.y, text: "DOWN", tone: "warn" }, 1400);
          await sleep(300);
        }
        return;
      }
      case "bark":
        addEffect({ kind: "bubble", unitId: f.id, text: f.text }, 2300);
        await sleep(140);
        return;
      case "float": {
        const d = D[f.id];
        if (d) addEffect({ kind: "float", x: d.x, y: d.y - 0.25, text: f.text, tone: f.tone }, 1400);
        await sleep(260);
        return;
      }
      case "blast":
        addEffect({ kind: "blast", x: f.x, y: f.y }, 800);
        await sleep(420);
        return;
      case "turn":
        setBanner(f.side === "accord" ? "Accord movement" : "Command");
        await sleep(650);
        setBanner(null);
        return;
    }
  };

  const play = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    while (c.fx.length) {
      const f = c.fx.shift()!;
      await playOne(f, c.fx[0]);
    }
    // the engine is authoritative: settle any drift
    const snap = snapshot(c);
    for (const [id, s] of Object.entries(snap)) disp.current[id] = { ...s, step: disp.current[id]?.step ?? 0 };
    running.current = false;
    setBusy(false);
    redraw();
  }, [c]);

  return { disp: disp.current, effects, busy, banner, play, revealed: revealed.current };
}
