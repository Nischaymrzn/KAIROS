import { useEffect, useMemo } from "react";
import { createHalfCourtMarkings } from "./textures/markingsTexture";
import { MATERIALS } from "../constants/theme";
import * as D from "../constants/dimensions";

/**
 * COURT MARKINGS — the painted lane + all the lines, as a transparent overlay that
 * sits just above the hardwood. Kept separate from <Hardwood/> so the wood is one
 * continuous surface and the markings can be re-tuned (or swapped for a full-court
 * version) without touching the floor.
 *
 * The texture maps exactly to the 47 (X) × 50 (Z) ft half-court, centred at the
 * midpoint of the half (x = -23.5). A hair of Y lift + depthWrite:false keeps it
 * from z-fighting the wood.
 */
const HALF_LEN = D.HALF_LENGTH; // 47 (baseline → division line)
const CENTER_X = -HALF_LEN / 2; // -23.5
const LIFT = 0.02; // above the wood, clear of z-fighting

export function CourtMarkings() {
  const texture = useMemo(() => createHalfCourtMarkings(), []);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CENTER_X, LIFT, 0]}>
      <planeGeometry args={[HALF_LEN, D.COURT_WIDTH]} />
      <meshStandardMaterial
        map={texture}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        roughness={MATERIALS.markings.roughness}
        metalness={MATERIALS.markings.metalness}
      />
    </mesh>
  );
}
