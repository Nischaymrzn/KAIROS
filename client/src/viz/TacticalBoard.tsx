/**
 * TACTICAL BOARD — a half court in plain SVG, drawn the way a coach draws one.
 *
 * WHY 2D AND NOT THE 3D SCENE. The arena is the right place to feel a shot. It is
 * the wrong place to read a formation: a perspective camera makes the spacing
 * between two players depend on where they stand relative to the lens, which is
 * the one thing a coach is looking at. Top-down, every foot of spacing is the
 * same number of pixels everywhere on the floor.
 *
 * Court geometry is in FEET in the same frame the rest of the client uses (rim at
 * x = -41.75, sidelines z = ±25), so a position from the tracking corpus, from a
 * scenario, or from a click can all be drawn here without conversion.
 *
 * The board draws no data of its own. It renders court markings and whatever
 * children are passed, positioned with the `ft` helpers, so the same board serves
 * the play study, the shot chart and the heat map without any of them agreeing on
 * anything except the floor.
 */
import type { ReactNode } from "react";
import { INK } from "./palette";

/** Court frame, in feet. */
export const BASELINE_X = -47;
export const HALF_X = 0;
export const SIDE_Z = 25;
export const RIM_X = -41.75;
export const RIM_R = 0.75;

const W_FT = HALF_X - BASELINE_X;      // 47
const H_FT = SIDE_Z * 2;               // 50
const S = 10;                          // px per foot at the drawn scale

/** Court feet to SVG units. */
export const fx = (x: number) => (x - BASELINE_X) * S;
export const fz = (z: number) => (z + SIDE_Z) * S;
export const flen = (ft: number) => ft * S;

export const VIEW_W = W_FT * S;
export const VIEW_H = H_FT * S;

/**
 * The three-point line: a 23.75 ft arc from the rim, cut off by the corner
 * straights at |z| = 22. Drawn as a path so the join is exact rather than an arc
 * that visibly overshoots into the corner.
 */
function threePointPath(): string {
  const R = 23.75;
  const cornerZ = 22;
  // where the arc meets the corner straight
  const dx = Math.sqrt(Math.max(R * R - cornerZ * cornerZ, 0));
  const arcEndX = RIM_X + dx;
  return [
    `M ${fx(BASELINE_X)} ${fz(-cornerZ)}`,
    `L ${fx(arcEndX)} ${fz(-cornerZ)}`,
    `A ${flen(R)} ${flen(R)} 0 0 0 ${fx(arcEndX)} ${fz(cornerZ)}`,
    `L ${fx(BASELINE_X)} ${fz(cornerZ)}`,
  ].join(" ");
}

export function TacticalBoard({
  children,
  under,
  className = "",
  label,
}: {
  children?: ReactNode;
  /**
   * Drawn BENEATH the court markings. A shot-quality surface covers the whole
   * floor, and painted over the lines it hides the only things that give a cell
   * its meaning — the arc a cell is inside or outside of, the edge of the key.
   * Data that fills the floor goes here; data that sits ON it (players, the
   * ball, markers) goes in `children`.
   */
  under?: ReactNode;
  className?: string;
  /** what the picture claims, for readers who cannot see it */
  label: string;
}) {
  const line = { stroke: INK.axis, fill: "none", strokeWidth: 1.5 };
  return (
    <svg
      className={`tb-board ${className}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* floor */}
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} rx={6} fill="rgba(255,255,255,0.022)" />

      {under}

      {/* the painted key: 16 ft wide, 19 ft from the baseline */}
      <rect
        x={fx(BASELINE_X)} y={fz(-8)}
        width={flen(19)} height={flen(16)}
        {...line} fill="rgba(76,110,245,0.10)"
      />
      {/* free-throw circle, dashed on the far side because it is not a boundary */}
      <path
        d={`M ${fx(BASELINE_X + 19)} ${fz(-6)} A ${flen(6)} ${flen(6)} 0 0 1 ${fx(BASELINE_X + 19)} ${fz(6)}`}
        {...line}
      />
      <path
        d={`M ${fx(BASELINE_X + 19)} ${fz(-6)} A ${flen(6)} ${flen(6)} 0 0 0 ${fx(BASELINE_X + 19)} ${fz(6)}`}
        {...line} strokeDasharray="5 5"
      />

      {/* restricted area, 4 ft from the rim */}
      <path
        d={`M ${fx(RIM_X)} ${fz(-4)} A ${flen(4)} ${flen(4)} 0 0 0 ${fx(RIM_X)} ${fz(4)}`}
        {...line} strokeWidth={1.2}
      />

      <path d={threePointPath()} {...line} />

      {/* backboard and rim */}
      <line
        x1={fx(RIM_X - 1.25)} y1={fz(-3)} x2={fx(RIM_X - 1.25)} y2={fz(3)}
        stroke={INK.secondary} strokeWidth={2.5} strokeLinecap="round"
      />
      <circle cx={fx(RIM_X)} cy={fz(0)} r={flen(RIM_R)} fill="none"
        stroke="#dc7436" strokeWidth={2} />

      {/* boundary */}
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} rx={6} {...line} strokeWidth={2} />

      {children}
    </svg>
  );
}
