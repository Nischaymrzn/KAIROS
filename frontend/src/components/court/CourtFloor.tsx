import { useMemo } from "react";
import { createHalfCourtTexture } from "@/lib/courtTexture";
import { COURT_WIDTH, HALF_LENGTH, FLOOR_THICKNESS } from "@/lib/courtDimensions";

const HALF_LEN = HALF_LENGTH; // 47 ft (baseline -> division line)
const CENTER_X = -HALF_LEN / 2; // -23.5 (midpoint of the half)

/** Half-court hardwood surface (baseline at -47 to the division line at 0). */
export function CourtFloor() {
  const texture = useMemo(() => createHalfCourtTexture(), []);

  return (
    <group>
      {/* playing surface with markings */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CENTER_X, 0.02, 0]} receiveShadow>
        <planeGeometry args={[HALF_LEN, COURT_WIDTH]} />
        <meshStandardMaterial map={texture} roughness={0.5} metalness={0.02} />
      </mesh>

      {/* floor slab (thickness / side edge) */}
      <mesh position={[CENTER_X, -FLOOR_THICKNESS / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[HALF_LEN, FLOOR_THICKNESS, COURT_WIDTH]} />
        <meshStandardMaterial color="#a9763a" roughness={0.7} />
      </mesh>
    </group>
  );
}
