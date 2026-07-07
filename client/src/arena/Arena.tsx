import * as THREE from "three";
import * as D from "../constants/dimensions";
import { COLORS } from "../constants/theme";
import { SeatingStand } from "./SeatingStand";
import { Jumbotron } from "./Jumbotron";
import { ArenaCeiling } from "./ArenaCeiling";

/**
 * ARENA — the surrounding lower bowl. A tiered <SeatingStand/> on each of the four
 * sides of the floor footprint (from constants/dimensions.ts, so it lines up with
 * the hardwood edge exactly), plus a light concourse ground so nothing floats.
 *
 * Deliberately simple and light-toned: it gives the court a believable home
 * without competing with it. Corner gaps (SEAT_GAP) read as vomitory aisles.
 *
 * Modular by design — future arena layers mount as siblings here:
 *   <Arena/>
 *   <Scoreboard/> <Benches/> <LedRibbon/> <ArenaLights/> <Props/>
 * Each new feature is a new component, positioned in the same feet-from-centre
 * frame; never edit a stand to add a feature.
 */
export function Arena() {
  const sideLen = D.FLOOR_LEN_X - 2 * D.SEAT_GAP; // sideline banks run along X
  const baseLen = D.FLOOR_LEN_Z - 2 * D.SEAT_GAP; // baseline banks run along Z

  return (
    <group name="arena">
      {/* concourse ground under & around the bowl (light, matte) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[D.FLOOR_CENTER_X, -0.03, 0]} receiveShadow>
        <planeGeometry args={[420, 420]} />
        <meshStandardMaterial color={COLORS.arena.concourse} roughness={0.96} metalness={0} side={THREE.FrontSide} />
      </mesh>

      {/* sideline stands (+Z / -Z) */}
      <group position={[D.FLOOR_CENTER_X, 0, D.FLOOR_Z_MAX]}>
        <SeatingStand length={sideLen} />
      </group>
      <group position={[D.FLOOR_CENTER_X, 0, D.FLOOR_Z_MIN]} rotation={[0, Math.PI, 0]}>
        <SeatingStand length={sideLen} />
      </group>

      {/* baseline stands (+X / -X) */}
      <group position={[D.FLOOR_X_MAX, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <SeatingStand length={baseLen} />
      </group>
      <group position={[D.FLOOR_X_MIN, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <SeatingStand length={baseLen} />
      </group>

      {/* game-night dressing */}
      <Jumbotron />
      <ArenaCeiling />
    </group>
  );
}
