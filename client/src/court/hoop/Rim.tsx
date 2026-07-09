import { useMemo } from "react";
import * as D from "../../constants/dimensions";
import { COLORS } from "../../constants/theme";

/**
 * RIM — an NBA breakaway goal, built to the published dimensions.
 *
 * WHAT WAS WRONG BEFORE
 * The ring was emissive. Powder-coated steel does not emit light, so the rim
 * glowed faintly from its own surface and sat oddly in the scene no matter how
 * the arena was lit — it read as a plastic toy rather than as painted metal. It
 * was also drawn from 5/8 inch stock scaled to roughly 1.2 inches, which is
 * nearly double the real ring and made the hoop look cartoonish next to a
 * correctly sized backboard.
 *
 * WHAT IT IS NOW
 * Ring stock is 5/8 inch (0.052 ft diameter, so a 0.026 ft tube radius), which is
 * the actual specification. The finish is a two-layer read: a dielectric base
 * with a clearcoat over it, which is how powder coat behaves — the colour comes
 * from a rough painted layer and the highlight rides on a thin gloss above it.
 * Metalness stays low because the steel is under the paint, not on top of it.
 *
 * Geometry: ring at the hoop-local origin (0, RIM_HEIGHT, 0), twelve net loops on
 * the underside, a breakaway hinge behind the ring, the spring housing, and the
 * mounting plate bolted through to the glass.
 */
export function Rim({ end }: { end: -1 | 1 }) {
  const backboardLX = end * (D.BASKET_FROM_BASELINE - D.BACKBOARD_FROM_BASELINE); // glass face
  const rimBackX = end * D.RIM_RADIUS;
  const bracketMidX = (rimBackX + backboardLX) / 2;
  const bracketLen = Math.abs(backboardLX - rimBackX) + 0.02;

  /** 5/8 inch steel stock — the real ring, in feet. */
  const STOCK_R = 0.026;

  // Net loops: small welded rings on the underside, not nubs. Twelve, per spec.
  const loops = useMemo(() => {
    const r = D.RIM_RADIUS * 0.995;
    return Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return {
        p: [Math.cos(a) * r, -0.038, Math.sin(a) * r] as [number, number, number],
        rot: [0, -a, 0] as [number, number, number],
      };
    });
  }, []);

  return (
    <group position={[0, D.RIM_HEIGHT, 0]}>
      {/* the ring — painted steel, clearcoat sheen, no self-illumination */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[D.RIM_RADIUS, STOCK_R, 20, 96]} />
        <meshPhysicalMaterial
          color={COLORS.rim}
          metalness={0.18}
          roughness={0.44}
          clearcoat={0.85}
          clearcoatRoughness={0.28}
          reflectivity={0.35}
        />
      </mesh>

      {/* net loops on the underside */}
      {loops.map((l, i) => (
        <mesh key={i} position={l.p} rotation={l.rot} castShadow>
          <torusGeometry args={[0.032, 0.008, 8, 18]} />
          <meshPhysicalMaterial
            color={COLORS.rim}
            metalness={0.2}
            roughness={0.5}
            clearcoat={0.6}
          />
        </mesh>
      ))}

      {/* breakaway arm, below the ring plane so it never crosses the front */}
      <mesh position={[bracketMidX, -0.075, 0]} castShadow>
        <boxGeometry args={[bracketLen, 0.11, 0.19]} />
        <meshPhysicalMaterial
          color={COLORS.metalDark}
          metalness={0.72}
          roughness={0.33}
          clearcoat={0.4}
        />
      </mesh>

      {/* spring housing — the block that lets the ring hinge down */}
      <mesh position={[rimBackX - end * 0.07, -0.03, 0]} castShadow>
        <boxGeometry args={[0.17, 0.185, 0.34]} />
        <meshPhysicalMaterial
          color={COLORS.rim}
          metalness={0.2}
          roughness={0.46}
          clearcoat={0.7}
        />
      </mesh>

      {/* the two hinge pins, catching light either side of the housing */}
      {[-0.16, 0.16].map((z) => (
        <mesh key={z} position={[rimBackX - end * 0.07, -0.03, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.05, 10]} />
          <meshStandardMaterial color="#9aa3b2" metalness={0.9} roughness={0.24} />
        </mesh>
      ))}

      {/* mounting plate bolted to the glass */}
      <mesh position={[backboardLX - end * 0.02, -0.02, 0]} castShadow>
        <boxGeometry args={[0.055, 0.42, 0.58]} />
        <meshPhysicalMaterial color={COLORS.metalDark} metalness={0.68} roughness={0.38} />
      </mesh>

      {/* four bolt heads on the plate */}
      {[[-0.14, -0.2], [-0.14, 0.2], [0.14, -0.2], [0.14, 0.2]].map(([y, z], i) => (
        <mesh
          key={i}
          position={[backboardLX - end * 0.05, y - 0.02, z]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.026, 0.026, 0.03, 6]} />
          <meshStandardMaterial color="#8c94a3" metalness={0.92} roughness={0.28} />
        </mesh>
      ))}
    </group>
  );
}
