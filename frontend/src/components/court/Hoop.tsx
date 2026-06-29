import { useMemo } from "react";
import * as THREE from "three";
import * as D from "@/lib/courtDimensions";

/** Net geometry built around the LOCAL origin (rim center at 0,0). */
function useNetGeometry() {
  return useMemo(() => {
    const strands = 14;
    const topR = D.RIM_RADIUS * 0.92;
    const botR = 0.34;
    const topY = 0;
    const botY = -1.4;
    const pts: number[] = [];
    const ring = (r: number, y: number, i: number) => {
      const a = (i / strands) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    };
    for (let i = 0; i < strands; i++) {
      const t = ring(topR, topY, i);
      const b = ring(botR, botY, i);
      pts.push(t.x, t.y, t.z, b.x, b.y, b.z); // vertical strand
      const bn = ring(botR, botY, i + 1);
      pts.push(t.x, t.y, t.z, bn.x, bn.y, bn.z); // diagonal weave
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
}

/**
 * Full hoop assembly for one end. Everything is built in LOCAL coordinates with
 * the rim center at the origin, then the whole group is placed at the basket —
 * so rim, net, backboard and pole stay aligned by construction.
 */
export function Hoop({ end }: { end: -1 | 1 }) {
  const bx = D.basketX(end);
  const net = useNetGeometry();

  // local offsets (relative to rim center)
  const backboardLX = end * (D.BASKET_FROM_BASELINE - D.BACKBOARD_FROM_BASELINE); // ±1.25
  const poleLX = end * (D.BASKET_FROM_BASELINE + 2.5); // pole 2.5ft beyond baseline
  const bbY = D.BACKBOARD_BOTTOM + D.BACKBOARD_HEIGHT / 2;

  return (
    <group position={[bx, 0, 0]}>
      {/* backboard glass */}
      <mesh position={[backboardLX, bbY, 0]} castShadow>
        <boxGeometry args={[0.1, D.BACKBOARD_HEIGHT, D.BACKBOARD_WIDTH]} />
        <meshPhysicalMaterial
          color="#dff0ff" transparent opacity={0.22} roughness={0.05}
          metalness={0} transmission={0.7} thickness={0.2}
        />
      </mesh>
      {/* backboard frame */}
      <lineSegments position={[backboardLX - end * 0.06, bbY, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(0.02, D.BACKBOARD_HEIGHT, D.BACKBOARD_WIDTH)]} />
        <lineBasicMaterial color="#f2f5fa" />
      </lineSegments>
      {/* shooter's square (just above the rim) */}
      <lineSegments position={[backboardLX - end * 0.06, D.RIM_HEIGHT + D.BACKBOARD_INNER_SQ_H / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(0.02, D.BACKBOARD_INNER_SQ_H, D.BACKBOARD_INNER_SQ_W)]} />
        <lineBasicMaterial color="#e8642a" />
      </lineSegments>

      {/* mounting bracket: backboard -> rim */}
      <mesh position={[(backboardLX - end * 0.4), D.RIM_HEIGHT, 0]} castShadow>
        <boxGeometry args={[Math.abs(backboardLX) + 0.4, 0.12, 0.18]} />
        <meshStandardMaterial color="#202734" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* rim (horizontal ring at the basket center) */}
      <mesh position={[0, D.RIM_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[D.RIM_RADIUS, 0.06, 18, 56]} />
        <meshStandardMaterial color="#e8642a" metalness={0.55} roughness={0.35} emissive="#7a2a08" emissiveIntensity={0.25} />
      </mesh>

      {/* net (hangs from the rim) */}
      <lineSegments geometry={net} position={[0, D.RIM_HEIGHT, 0]}>
        <lineBasicMaterial color="#f4f4f4" transparent opacity={0.8} />
      </lineSegments>

      {/* connector arm: backboard top -> pole */}
      <mesh position={[(backboardLX + poleLX) / 2, D.RIM_HEIGHT + 2.2, 0]} castShadow>
        <boxGeometry args={[Math.abs(poleLX - backboardLX), 0.3, 0.3]} />
        <meshStandardMaterial color="#1b212c" metalness={0.5} roughness={0.5} />
      </mesh>

      {/* stanchion / pole */}
      <mesh position={[poleLX, (D.RIM_HEIGHT + 2.2) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.55, D.RIM_HEIGHT + 2.2, 20]} />
        <meshStandardMaterial color="#161b24" metalness={0.55} roughness={0.45} />
      </mesh>
      {/* padded base */}
      <mesh position={[poleLX, 0.65, 0]} castShadow>
        <boxGeometry args={[3, 1.3, 4.2]} />
        <meshStandardMaterial color="#0d1320" roughness={0.85} />
      </mesh>
    </group>
  );
}
