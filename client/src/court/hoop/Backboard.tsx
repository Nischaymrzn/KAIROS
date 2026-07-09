import * as D from "../../constants/dimensions";
import { COLORS } from "../../constants/theme";

/**
 * A rectangle drawn as four thin boxes in the Y–Z plane at a given X — used for
 * the backboard frame and the orange shooter's square (more solid than lines).
 */
function RectOutline({
  x, y, width, height, bar, depth, color, emissive,
}: {
  x: number; y: number; width: number; height: number;
  bar: number; depth: number; color: string; emissive?: string;
}) {
  const mat = (
    <meshStandardMaterial color={color} emissive={emissive ?? "#000000"} emissiveIntensity={emissive ? 0.35 : 0} metalness={0.3} roughness={0.5} />
  );
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[depth, bar, width + bar]} />
        {mat}
      </mesh>
      <mesh position={[0, -height / 2, 0]} castShadow>
        <boxGeometry args={[depth, bar, width + bar]} />
        {mat}
      </mesh>
      <mesh position={[0, 0, -width / 2]} castShadow>
        <boxGeometry args={[depth, height, bar]} />
        {mat}
      </mesh>
      <mesh position={[0, 0, width / 2]} castShadow>
        <boxGeometry args={[depth, height, bar]} />
        {mat}
      </mesh>
    </group>
  );
}

/**
 * BACKBOARD — tempered-glass pane, a light frame around it, and the orange
 * shooter's square. Built in the hoop-local frame (rim centre at origin); `end`
 * only sets which side faces the court.
 */
export function Backboard({ end }: { end: -1 | 1 }) {
  const backboardLX = end * (D.BASKET_FROM_BASELINE - D.BACKBOARD_FROM_BASELINE); // ±1.25
  const bbY = D.BACKBOARD_BOTTOM + D.BACKBOARD_HEIGHT / 2;
  const frontSign = -end; // court-facing side
  const frontX = backboardLX + frontSign * 0.06;

  return (
    <group>
      {/* Glass pane.
          The old pane was heavily transmissive and nearly black against a dark
          bowl, so the board read as a hole rather than as glass. Real arena glass
          is lit from the front and picks up the court, so this keeps transmission
          but adds a light tint and a clearcoat, which is what makes it read as a
          pane rather than an absence. */}
      <mesh position={[backboardLX, bbY, 0]} castShadow>
        <boxGeometry args={[0.12, D.BACKBOARD_HEIGHT, D.BACKBOARD_WIDTH]} />
        <meshPhysicalMaterial
          color={COLORS.glass}
          transparent
          opacity={0.5}
          roughness={0.05}
          metalness={0}
          transmission={0.55}
          thickness={0.3}
          clearcoat={0.9}
          clearcoatRoughness={0.06}
          ior={1.5}
        />
      </mesh>

      {/* white backing panel behind the lower half, the way a real board carries
          its sponsor band and stops the bowl showing straight through */}
      <mesh position={[backboardLX - frontSign * 0.05, D.RIM_HEIGHT + 0.75, 0]}>
        <boxGeometry args={[0.03, 2.4, D.BACKBOARD_WIDTH * 0.98]} />
        <meshStandardMaterial color="#f2f5fa" roughness={0.5} metalness={0} />
      </mesh>

      {/* light frame around the glass */}
      <RectOutline
        x={backboardLX}
        y={bbY}
        width={D.BACKBOARD_WIDTH}
        height={D.BACKBOARD_HEIGHT}
        bar={0.16}
        depth={0.2}
        color="#eef2f7"
      />

      {/* Padding along the bottom edge. Every NBA board has it, it is the part a
          player actually contacts, and it visually seats the rim on the board. */}
      <mesh position={[backboardLX, D.BACKBOARD_BOTTOM + 0.18, 0]} castShadow>
        <boxGeometry args={[0.34, 0.36, D.BACKBOARD_WIDTH + 0.1]} />
        <meshStandardMaterial color={COLORS.padNavy} roughness={0.8} metalness={0} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[backboardLX, D.BACKBOARD_BOTTOM + 1.0, s * (D.BACKBOARD_WIDTH / 2 + 0.02)]}
          castShadow
        >
          <boxGeometry args={[0.3, 1.7, 0.3]} />
          <meshStandardMaterial color={COLORS.padNavy} roughness={0.8} metalness={0} />
        </mesh>
      ))}

      {/* orange shooter square, bottom edge on the rim line */}
      <RectOutline
        x={frontX}
        y={D.RIM_HEIGHT + D.BACKBOARD_INNER_SQ_H / 2}
        width={D.BACKBOARD_INNER_SQ_W}
        height={D.BACKBOARD_INNER_SQ_H}
        bar={0.1}
        depth={0.07}
        color={COLORS.square}
        emissive={COLORS.rimEmissive}
      />

    </group>
  );
}
