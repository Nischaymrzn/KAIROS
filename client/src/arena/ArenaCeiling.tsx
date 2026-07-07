/**
 * ARENA CEILING — the dark roof plane, a ring truss, and the light banks that
 * sell "game night": glowing housings above the court (the actual illumination
 * comes from <Lighting/>'s spots — these are their visible fixtures).
 */
import * as D from "../constants/dimensions";

const BANKS: [number, number][] = [
  [-40, 18], [-40, -18], [-6, 18], [-6, -18], [22, 18], [22, -18],
];

export function ArenaCeiling() {
  const cx = D.FLOOR_CENTER_X;
  return (
    <group>
      {/* roof */}
      <mesh position={[cx, 92, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[240, 40]} />
        <meshStandardMaterial color="#07090e" roughness={1} metalness={0} />
      </mesh>

      {/* ring truss */}
      <mesh position={[cx, 78, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[110, 1.4, 8, 48]} />
        <meshStandardMaterial color="#1a1e28" roughness={0.7} metalness={0.4} />
      </mesh>

      {/* light banks over the floor — emissive housings */}
      {BANKS.map(([x, z], i) => (
        <group key={i} position={[x, 74, z]}>
          <mesh>
            <boxGeometry args={[10, 1.4, 5]} />
            <meshStandardMaterial color="#171b24" roughness={0.6} metalness={0.4} />
          </mesh>
          <mesh position={[0, -0.75, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[9.2, 4.2]} />
            <meshBasicMaterial color="#fff4dd" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
