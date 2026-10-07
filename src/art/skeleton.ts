// A generic 2D skeleton: any joint set J, forward kinematics, and pose interpolation.
// Humans and Commons bodies share one rig; poses are just angle tables over it.

export interface Pt { x: number; y: number }

export interface BoneDef<J extends string> {
  parent: J | null; // null: attached to the root (pelvis)
  len: number;
}
export type Rig<J extends string> = { readonly [K in J]: BoneDef<J> };

/** Local angles in degrees, relative to the parent bone (root bones: absolute; 0 = +x, 90 = down). */
export interface Pose<J extends string> {
  joints: Record<J, number>;
  rootY: number; // pelvis height above the feet line
  tilt: number;  // whole-body rotation, for lying down
}

export type Solved<J extends string> = Record<J, { a: Pt; b: Pt; angle: number }>;

export function solve<J extends string>(rig: Rig<J>, order: readonly J[], pose: Pose<J>, scale = 1): Solved<J> {
  const out = {} as Solved<J>;
  const root: Pt = { x: 0, y: -pose.rootY * scale };
  for (const j of order) {
    const def = rig[j];
    const parent = def.parent ? out[def.parent] : null;
    const start = parent ? parent.b : root;
    const angle = (parent ? parent.angle : 0) + pose.joints[j];
    const rad = (angle * Math.PI) / 180;
    out[j] = { a: start, b: { x: start.x + Math.cos(rad) * def.len * scale, y: start.y + Math.sin(rad) * def.len * scale }, angle };
  }
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Shortest-way angle interpolation so limbs never spin the long way round. */
const lerpAngle = (a: number, b: number, t: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

export function lerpPose<J extends string>(a: Pose<J>, b: Pose<J>, t: number): Pose<J> {
  const joints = {} as Record<J, number>;
  for (const k of Object.keys(b.joints) as J[]) joints[k] = lerpAngle(a.joints[k], b.joints[k], t);
  return { joints, rootY: lerp(a.rootY, b.rootY, t), tilt: lerpAngle(a.tilt, b.tilt, t) };
}

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------- the body rig ----------

export type BodyJoint = "spine" | "neck" | "head" | "armB" | "foreB" | "armF" | "foreF" | "thighB" | "shinB" | "thighF" | "shinF";

export const BODY: Rig<BodyJoint> = {
  spine: { parent: null, len: 22 },
  neck: { parent: "spine", len: 4 },
  head: { parent: "neck", len: 9 },
  armB: { parent: "spine", len: 12 },
  foreB: { parent: "armB", len: 11 },
  armF: { parent: "spine", len: 12 },
  foreF: { parent: "armF", len: 11 },
  thighB: { parent: null, len: 14 },
  shinB: { parent: "thighB", len: 14 },
  thighF: { parent: null, len: 14 },
  shinF: { parent: "thighF", len: 14 },
};
export const BODY_ORDER: readonly BodyJoint[] = ["spine", "neck", "head", "armB", "foreB", "armF", "foreF", "thighB", "shinB", "thighF", "shinF"];

const P = (rootY: number, tilt: number, j: Record<BodyJoint, number>): Pose<BodyJoint> => ({ rootY, tilt, joints: j });

// Facing +x. Angles: spine -90 is upright; arms hanging from the shoulder are +180 relative to the spine.
export const POSES = {
  stand: P(28, 0, { spine: -92, neck: 0, head: 0, armB: 172, foreB: -8, armF: 188, foreF: -14, thighB: 94, shinB: 0, thighF: 86, shinF: 2 }),
  ready: P(28, 0, { spine: -88, neck: 2, head: 0, armB: 150, foreB: -70, armF: 120, foreF: -40, thighB: 98, shinB: 0, thighF: 80, shinF: 4 }),
  aim: P(27, 0, { spine: -84, neck: 4, head: 2, armB: 110, foreB: -24, armF: 96, foreF: -10, thighB: 104, shinB: -4, thighF: 74, shinF: 8 }),
  crouch: P(17, 0, { spine: -70, neck: -10, head: -4, armB: 130, foreB: -60, armF: 110, foreF: -40, thighB: 150, shinB: -112, thighF: 30, shinF: 100 }),
  cower: P(13, 0, { spine: -60, neck: 20, head: 20, armB: 300, foreB: 140, armF: 290, foreF: 150, thighB: 140, shinB: -120, thighF: 60, shinF: 100 }),
  run1: P(27, 0, { spine: -78, neck: -6, head: 0, armB: 110, foreB: -40, armF: 100, foreF: -30, thighB: 125, shinB: 40, thighF: 50, shinF: 50 }),
  run2: P(27, 0, { spine: -78, neck: -6, head: 0, armB: 116, foreB: -46, armF: 104, foreF: -36, thighB: 70, shinB: 60, thighF: 115, shinF: 10 }),
  sit: P(14, 0, { spine: -95, neck: 5, head: 0, armB: 160, foreB: -70, armF: 165, foreF: -75, thighB: 4, shinB: 86, thighF: -2, shinF: 92 }),
  down: P(5, -90, { spine: -95, neck: 10, head: 5, armB: 150, foreB: 20, armF: 200, foreF: 15, thighB: 95, shinB: 10, thighF: 80, shinF: -5 }),
  dead: P(4, -90, { spine: -92, neck: 25, head: 10, armB: 120, foreB: 30, armF: 230, foreF: -10, thighB: 100, shinB: 20, thighF: 75, shinF: -15 }),
  refuse: P(26, 0, { spine: -98, neck: -6, head: -4, armB: 76, foreB: -60, armF: 66, foreF: -50, thighB: 92, shinB: 0, thighF: 86, shinF: 2 }),
} satisfies Record<string, Pose<BodyJoint>>;
export type PoseName = keyof typeof POSES;
