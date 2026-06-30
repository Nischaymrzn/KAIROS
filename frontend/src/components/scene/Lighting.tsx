import { useRef } from "react";
import * as THREE from "three";

/** Broadcast/studio lighting: soft fill + a warm key with a spotlight pool. */
export function Lighting() {
  const spot = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(null);

  return (
    <>
      <hemisphereLight args={["#dfe9ff", "#23201b", 0.85]} />
      <ambientLight intensity={0.6} />

      {/* key light (casts the main shadows) */}
      <directionalLight
        position={[26, 48, 24]}
        intensity={1.25}
        color="#fff6e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-far={180}
        shadow-bias={-0.0004}
      />
      {/* cool fill from opposite side */}
      <directionalLight position={[-40, 34, -28]} intensity={0.45} color="#c2d4ff" />

      {/* warm spotlight pool over the attacking half (the action area) */}
      <object3D ref={target} position={[-24, 0, 0]} />
      <spotLight
        ref={spot}
        position={[-24, 60, 6]}
        angle={0.5}
        penumbra={0.85}
        intensity={1.1}
        distance={140}
        color="#fff1da"
        target={target.current ?? undefined}
      />
    </>
  );
}
