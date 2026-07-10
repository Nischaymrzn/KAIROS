import * as D from "../../constants/dimensions";
import { COLORS, MATERIALS } from "../../constants/theme";

/**
 * STANCHION — the portable goal: padded base behind the baseline, the pole, the
 * extension arm out to the backboard, and the braces that carry the load.
 *
 * THE BUG THIS FIXES
 * The diagonal brace was placed at `backboardLX - end * 0.6`. For the left hoop
 * that is -1.25 + 0.6 = -0.65, which is BETWEEN the backboard and the rim, so a
 * black steel bar was drawn diagonally across the front of the glass in every
 * shot of the hoop. The sign was simply inverted: the brace belongs behind the
 * board, on the pole side, where it is out of the shooter's view.
 *
 * Everything behind the board is now built as a real goal is: two braces forming
 * a triangle back to the arm, a padded backboard edge, and a tapered pole rather
 * than a plain cylinder.
 */
export function Stanchion({ end }: { end: -1 | 1 }) {
  const backboardLX = end * (D.BASKET_FROM_BASELINE - D.BACKBOARD_FROM_BASELINE); // ±1.25
  const poleLX = end * (D.BASKET_FROM_BASELINE + 3.2);
  const armY = D.RIM_HEIGHT + 2.6;
  const baseTopY = 3.4;

  // BEHIND the board is further from the court, which is the same sign as the
  // pole. Getting this sign wrong is what put a brace across the glass.
  const behind = (ft: number) => backboardLX + end * ft;

  return (
    <group>
      {/* ---- base ---- */}
      <mesh position={[poleLX, 1.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 3.4, 4.6]} />
        <meshStandardMaterial color={COLORS.padNavy} roughness={MATERIALS.pad.roughness} metalness={0} />
      </mesh>
      {/* chamfered top so the base is not a plain crate */}
      <mesh position={[poleLX, baseTopY + 0.12, 0]} castShadow>
        <boxGeometry args={[2.7, 0.3, 4.0]} />
        <meshStandardMaterial color={COLORS.padNavy} roughness={0.72} metalness={0} />
      </mesh>
      {/* ground plate and wheels */}
      <mesh position={[poleLX, 0.24, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 0.48, 5.1]} />
        <meshStandardMaterial color={COLORS.metalDark} roughness={0.68} metalness={0.35} />
      </mesh>
      {[-1.9, 1.9].map((z) => (
        <mesh key={z} position={[poleLX, 0.3, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.34, 16]} />
          <meshStandardMaterial color="#15181f" roughness={0.85} metalness={0.1} />
        </mesh>
      ))}

      {/* ---- pole: tapered, with a collar where the arm leaves it ---- */}
      <mesh position={[poleLX, (baseTopY + armY) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.5, armY - baseTopY, 28]} />
        <meshStandardMaterial
          color={COLORS.metalDark}
          metalness={MATERIALS.metal.metalness}
          roughness={MATERIALS.metal.roughness}
        />
      </mesh>
      <mesh position={[poleLX, armY - 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.44, 0.44, 0.5, 24]} />
        <meshStandardMaterial color={COLORS.metalMid} metalness={0.6} roughness={0.4} />
      </mesh>

      {/* ---- extension arm, pole top to the back of the board ---- */}
      <mesh position={[(behind(0.35) + poleLX) / 2, armY, 0]} castShadow>
        <boxGeometry args={[Math.abs(poleLX - behind(0.35)), 0.42, 0.46]} />
        <meshStandardMaterial color={COLORS.metalDark} metalness={0.55} roughness={0.45} />
      </mesh>

      {/* ---- braces, BEHIND the glass ---- */}
      {/* upper: arm down to the back of the board */}
      <mesh
        position={[behind(1.1), armY - 1.5, 0]}
        rotation={[0, 0, -end * 0.62]}
        castShadow
      >
        <boxGeometry args={[0.24, 3.4, 0.24]} />
        <meshStandardMaterial color={COLORS.metalDark} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* lower: board back down toward the pole, the load path of a real goal */}
      <mesh
        position={[(behind(0.4) + poleLX) / 2, D.RIM_HEIGHT - 0.9, 0]}
        rotation={[0, 0, end * 0.34]}
        castShadow
      >
        <boxGeometry args={[Math.abs(poleLX - behind(0.4)) * 1.02, 0.24, 0.24]} />
        <meshStandardMaterial color={COLORS.metalDark} metalness={0.5} roughness={0.5} />
      </mesh>

      {/* ---- backboard mount plate ---- */}
      <mesh position={[behind(0.28), D.RIM_HEIGHT + 1.2, 0]} castShadow>
        <boxGeometry args={[0.4, 3.6, 1.5]} />
        <meshStandardMaterial color={COLORS.metalDark} metalness={0.55} roughness={0.45} />
      </mesh>
    </group>
  );
}
