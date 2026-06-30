import { useMemo } from "react";
import * as THREE from "three";
import { COURT_WIDTH, HALF_LENGTH } from "@/lib/courtDimensions";

const CENTER_X = -HALF_LENGTH / 2; // -23.5, half-court midpoint

/** Radial gradient floor texture — warm pool of light fading into the dark. */
function useArenaFloorTexture() {
  return useMemo(() => {
    const s = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.12, s / 2, s / 2, s * 0.5);
    g.addColorStop(0, "#3a322a");
    g.addColorStop(0.4, "#2b2620");
    g.addColorStop(0.72, "#1a1611");
    g.addColorStop(1, "#0d0b09");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/** Surrounding arena framing the HALF court: pool-of-light floor + low stands. */
export function Arena() {
  const floorTex = useArenaFloorTexture();
  const standColor = "#0f131c";
  const tiers = [0, 1, 2, 3];
  const longZ = COURT_WIDTH / 2 + 10;
  const baseX = HALF_LENGTH + 12;

  return (
    <group>
      {/* arena floor — light pool centered under the court */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CENTER_X, -0.55, 0]} receiveShadow>
        <circleGeometry args={[150, 64]} />
        <meshStandardMaterial map={floorTex} roughness={0.85} metalness={0.05} />
      </mesh>

      {/* long-side stands (±Z), running along the half-court length */}
      {[-1, 1].map((sz) =>
        tiers.map((t) => (
          <mesh
            key={`z${sz}-${t}`}
            position={[CENTER_X, 1 + t * 2.2, sz * (longZ + t * 5)]}
            receiveShadow
          >
            <boxGeometry args={[HALF_LENGTH + 40, 2.2, 5]} />
            <meshStandardMaterial color={standColor} roughness={0.95} />
          </mesh>
        )),
      )}
      {/* baseline stand behind the basket (-X) */}
      {tiers.map((t) => (
        <mesh key={`base-${t}`} position={[-(baseX + t * 5), 1 + t * 2.2, 0]} receiveShadow>
          <boxGeometry args={[5, 2.2, COURT_WIDTH + 26]} />
          <meshStandardMaterial color={standColor} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}
