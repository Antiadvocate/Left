/**
 * RETIRED LAYER — formerly the "undertow": Kuramoto phase-synchronization, Lyapunov
 * exponents, and a cusp-catastrophe psyche manifold. That apparatus was the wrong model
 * for emotion. It severed the generative kernel by OVERWRITING the relaxation scalar with
 * a readout of a catastrophe manifold (p.relaxation = cusp.x * 8), turning the one driving
 * variable into a passenger. It is gone.
 *
 * Emotion is now driven, as originally designed, by the relaxation scalar itself:
 *   - the simulator emits a per-character relaxation_delta each turn (the charge),
 *   - tickPsyche (in social.ts) drifts relaxation toward capacity and derives state,
 *   - the narrator reads each character's relaxation/state and renders accordingly.
 *
 * This module remains only as a thin compatibility surface so the views and telemetry that
 * still reference these fields keep compiling while they are simplified. No synchronization,
 * no manifold, no chaos metrics.
 */
import type { SaveState } from "./types";

export type Regime = "damped" | "critical" | "cascading";

export interface UndertowReport {
  regime: Regime;
  lyapunov: number;
  coherence: number;
  early_warning: boolean;
  instability: number;
  stances: { name: string; stance: string; p: number; vs: string }[];
  snaps: string[];
  directive: string;
  epistemic_pulls?: { id: string; target: string }[];
  dispersion?: number;
  shared_target?: string | null;
}

/** Neutral, calm, empty. The kernel (tickPsyche) drives psyche now; this just keeps
 *  downstream readers from crashing on absent fields. */
export function neutralUndertow(): UndertowReport {
  return {
    regime: "damped", lyapunov: -0.2, coherence: 0.5, early_warning: false,
    instability: 0, stances: [], snaps: [], directive: "",
    epistemic_pulls: [], dispersion: 0, shared_target: null,
  };
}

/** Back-compat alias: anything still calling tickUndertow gets the neutral report. */
export function tickUndertow(_state: SaveState, _rng: () => number = Math.random): UndertowReport {
  return neutralUndertow();
}
