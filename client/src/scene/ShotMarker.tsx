/**
 * SHOT MARKER — a thin pulsing ring on the floor at the shooter's court position.
 * Gives immediate visual feedback before the prediction lands.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useShotStore } from "../state/shotStore";

export function ShotMarker() {
  const x = useShotStore((s) => s.scenario.x);
  const z = useShotStore((s) => s.scenario.z);
  const pending = useShotStore((s) => s.prediction?.pending ?? false);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const t = clock.getElapsedTime();
    // pulse opacity when prediction is in-flight
    const base = pending ? 0.55 + Math.sin(t * 6) * 0.25 : 0.7;
    (ringRef.current.material as THREE.MeshBasicMaterial).opacity = base;
    // subtle scale breathe
    const s = 1 + Math.sin(t * 2.5) * 0.04;
    ringRef.current.scale.setScalar(s);
  });

  return (
    <mesh ref={ringRef} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.4, 1.7, 48]} />
      <meshBasicMaterial color="#4c6ef5" transparent opacity={0.7} depthWrite={false} />
    </mesh>
  );
}
