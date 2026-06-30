import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useAppStore } from "@/store/useAppStore";
import { QUALITY_COLOR } from "@/lib/dummyPredictor";
import { basketX, RIM_HEIGHT } from "@/lib/courtDimensions";

const BX = basketX(-1);

const RAW_COLOR: Record<string, string> = {
  excellent: "#22c55e", good: "#84cc16", average: "#f59e0b",
  poor: "#f97316", "very poor": "#ef4444",
};

/** Floor marker at the shooter spot + parabolic trajectory to the rim. */
export function ShotMarker() {
  const scenario = useAppStore((s) => s.scenario);
  const prediction = useAppStore((s) => s.prediction);
  const { x, z } = scenario.position;
  const color = RAW_COLOR[prediction.quality];

  // parabolic trajectory points from release to rim
  const points = useMemo(() => {
    const start = new THREE.Vector3(x, 6.5, z);
    const end = new THREE.Vector3(BX, RIM_HEIGHT, 0);
    const apex = 6 + (1 - prediction.probability) * 3; // worse shots arc oddly higher
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const p = new THREE.Vector3().lerpVectors(start, end, t);
      p.y += Math.sin(t * Math.PI) * apex;
      pts.push(p);
    }
    return pts;
  }, [x, z, prediction.probability]);

  return (
    <group>
      {/* glowing floor ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.12, z]}>
        <ringGeometry args={[1.6, 2.1, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.1, z]}>
        <circleGeometry args={[1.6, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      {/* vertical beam */}
      <mesh position={[x, 3, z]}>
        <cylinderGeometry args={[0.06, 0.06, 6, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>

      {/* trajectory */}
      <Line points={points} color={color} lineWidth={3} transparent opacity={0.9} dashed dashScale={4} />
    </group>
  );
}

export { QUALITY_COLOR };
