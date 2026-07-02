/**
 * Full-body poses per shot type. Rotations are Euler [x,y,z] radians on the
 * rigged player's joints; `lift` raises the whole body off the floor (jump);
 * `ball` is the ball anchor relative to the torso pivot (ref feet:
 * x=right, y=up, z=forward). Keyed per ShotTypeId so each shot has distinct
 * mechanics. Default arm hangs down; negative shoulder/elbow X raises/bends.
 */
import type { ShotTypeId } from "./types";

type V3 = [number, number, number];
export type PoseKey = ShotTypeId | "idle" | "defend";

export interface PoseDef {
  lift: number;
  spine: V3;
  lHip: V3; lKnee: number;
  rHip: V3; rKnee: number;
  rShoulder: V3; rElbow: V3;
  lShoulder: V3; lElbow: V3;
  ball: V3;
}

const STAND_L: V3 = [0.06, 0, 0.03];
const STAND_R: V3 = [0.06, 0, -0.03];

// two-hand release: both arms up, hands angled inward toward the ball
const SH_R: V3 = [-2.1, 0.18, -0.55];
const EL_R: V3 = [-1.2, 0, 0.25];
const SH_L: V3 = [-2.1, -0.18, 0.55];
const EL_L: V3 = [-1.2, 0, -0.25];
const BALL_SHOOT: V3 = [0, 2.92, 0.52];

export const POSES: Record<PoseKey, PoseDef> = {
  idle: {
    lift: 0, spine: [0, 0, 0],
    lHip: STAND_L, lKnee: 0.12, rHip: STAND_R, rKnee: 0.12,
    rShoulder: [0.1, 0, -0.12], rElbow: [-0.25, 0, 0],
    lShoulder: [0.1, 0, 0.12], lElbow: [-0.25, 0, 0],
    ball: [0.5, 0.55, 0.3],
  },
  defend: {
    lift: 0, spine: [0.18, 0, 0],
    lHip: [0.1, 0, 0.16], lKnee: 0.5, rHip: [0.1, 0, -0.16], rKnee: 0.5,
    rShoulder: [-0.2, 0, -1.25], rElbow: [-0.15, 0, 0],
    lShoulder: [-0.2, 0, 1.25], lElbow: [-0.15, 0, 0],
    ball: [0, 0, 0],
  },

  catch_shoot: {
    lift: 0.12, spine: [-0.03, 0, 0],
    lHip: STAND_L, lKnee: 0.2, rHip: STAND_R, rKnee: 0.2,
    rShoulder: SH_R, rElbow: EL_R, lShoulder: SH_L, lElbow: EL_L,
    ball: BALL_SHOOT,
  },
  pullup: {
    lift: 0.5, spine: [-0.05, 0, 0],
    lHip: [0.1, 0, 0.05], lKnee: 0.3, rHip: [0.1, 0, -0.05], rKnee: 0.3,
    rShoulder: SH_R, rElbow: EL_R, lShoulder: SH_L, lElbow: EL_L,
    ball: BALL_SHOOT,
  },
  stepback: {
    lift: 0.4, spine: [-0.2, 0, 0.05],
    lHip: [-0.35, 0, 0.12], lKnee: 0.45, rHip: [0.4, 0, -0.1], rKnee: 0.35,
    rShoulder: SH_R, rElbow: EL_R, lShoulder: SH_L, lElbow: EL_L,
    ball: [0, 2.9, 0.5],
  },
  fadeaway: {
    lift: 0.5, spine: [-0.32, 0, 0],
    lHip: [0.35, 0, 0.05], lKnee: 0.3, rHip: [-0.5, 0, -0.05], rKnee: 0.7,
    rShoulder: [-2.0, 0.18, -0.55], rElbow: [-1.15, 0, 0.25],
    lShoulder: [-2.0, -0.18, 0.55], lElbow: [-1.15, 0, -0.25],
    ball: [0, 2.86, 0.5],
  },

  driving_layup: {
    lift: 0.95, spine: [0.14, 0, 0.05],
    lHip: [0.28, 0, 0.05], lKnee: 0.2, rHip: [-1.45, 0, -0.05], rKnee: 1.55,
    rShoulder: [-2.6, 0, -0.05], rElbow: [-0.28, 0, 0],
    lShoulder: [-0.55, 0, 0.3], lElbow: [-0.85, 0, 0],
    ball: [0.34, 3.25, 0.5],
  },
  dunk: {
    lift: 1.35, spine: [0.05, 0, 0],
    lHip: [-0.55, 0, 0.12], lKnee: 0.95, rHip: [-0.45, 0, -0.12], rKnee: 0.95,
    rShoulder: [-2.82, 0, -0.12], rElbow: [-0.22, 0, 0],
    lShoulder: [-2.7, 0, 0.16], lElbow: [-0.26, 0, 0],
    ball: [0.1, 3.5, 0.34],
  },
  floater: {
    lift: 0.7, spine: [0.05, 0, 0],
    lHip: [0.25, 0, 0.05], lKnee: 0.2, rHip: [-1.1, 0, -0.05], rKnee: 1.3,
    rShoulder: [-2.4, 0, -0.05], rElbow: [-0.6, 0, 0],
    lShoulder: [-0.6, 0, 0.24], lElbow: [-0.7, 0, 0],
    ball: [0.22, 3.02, 0.52],
  },
  hook: {
    lift: 0.12, spine: [0, -0.4, 0.1],
    lHip: [0.06, 0, 0.06], lKnee: 0.25, rHip: [0.1, 0, -0.04], rKnee: 0.2,
    rShoulder: [-1.5, 0, -1.05], rElbow: [-0.4, 0, 0],
    lShoulder: [-0.45, 0, 0.32], lElbow: [-0.6, 0, 0],
    ball: [0.85, 2.74, 0.12],
  },
};
