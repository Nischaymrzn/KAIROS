import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { createWoodTexture } from "./textures/woodTexture";
import { COLORS, MATERIALS } from "../constants/theme";
import * as D from "../constants/dimensions";

/**
 * HARDWOOD — the continuous gym floor the court is painted on. One big plane with
 * a single procedural wood texture (so there are no tiling seams), plus a thin
 * slab underneath for edge thickness. The court markings are a separate overlay
 * (see <CourtMarkings/>) so the wood reads as one uninterrupted surface.
 *
 * The plane extends an apron past the half-court on every side so the floor never
 * looks like it is floating; the surrounding arena will later sit around this.
 */

// Floor footprint now lives in constants/dimensions.ts (shared with the arena bowl
// so the seating lines up exactly with the floor edge).
const WIDTH = D.FLOOR_LEN_X; // 100, along X (length)
const DEPTH = D.FLOOR_LEN_Z; // 76,  along Z (width)
const CENTER_X = D.FLOOR_CENTER_X; // -16

export function Hardwood() {
  const texture = useMemo(
    () => createWoodTexture({ widthFt: WIDTH, heightFt: DEPTH, ppf: 18, plankFt: 0.55 }),
    []
  );
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group>
      {/* playing surface (wood) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CENTER_X, 0, 0]} receiveShadow>
        <planeGeometry args={[WIDTH, DEPTH]} />
        <meshPhysicalMaterial
          map={texture}
          roughness={MATERIALS.hardwood.roughness}
          metalness={MATERIALS.hardwood.metalness}
          clearcoat={MATERIALS.hardwood.clearcoat}
          clearcoatRoughness={MATERIALS.hardwood.clearcoatRoughness}
        />
      </mesh>

      {/* thickness slab / dark edge so the floor has depth from a low angle.
          Sits a touch BELOW the wood plane (not coincident) and does NOT cast
          shadows — otherwise its top self-occludes the plane and paints a hard
          diagonal seam wherever the shadow-camera frustum edge crosses the floor. */}
      <mesh position={[CENTER_X, -D.FLOOR_THICKNESS / 2 - 0.06, 0]}>
        <boxGeometry args={[WIDTH, D.FLOOR_THICKNESS, DEPTH]} />
        <meshStandardMaterial color={COLORS.floorEdge} roughness={0.8} metalness={0.05} side={THREE.FrontSide} />
      </mesh>
    </group>
  );
}
