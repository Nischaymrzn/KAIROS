import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useAppStore } from "@/store/useAppStore";

/**
 * Predicted approach path into the current shot (movement/GRU model). Drawn as
 * a glowing line from where the player starts the action to the release spot.
 */
export function MovementPath() {
  const on = useAppStore((s) => s.moveOn);
  const path = useAppStore((s) => s.movePath);

  const points = useMemo(
    () => path.map((w) => new THREE.Vector3(w.x, 0.22, w.z)),
    [path],
  );

  if (!on || points.length < 2) return null;
  const start = points[0];
  return (
    <group>
      <Line points={points} color="#38bdf8" lineWidth={4} transparent opacity={0.9} />
      {/* start-of-move marker */}
      <mesh position={[start.x, 0.3, start.z]}>
        <sphereGeometry args={[0.55, 18, 18]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </mesh>
    </group>
  );
}
