/**
 * LIGHTING — GAME NIGHT. The house goes dark; the court sits in a pool of warm
 * light from the overhead banks (whose visible fixtures are in <ArenaCeiling/>):
 *   • dim cool hemisphere + low ambient → the dark bowl never goes pure black
 *   • two warm SPOT pools over the court (decay 0 so intensity reads classically;
 *     one casts the shadows) → the broadcast look, hero court
 *   • faint cool rim/fill directionals → players and hoop separate from the dark
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";

/** Spot that aims at a target point (three needs the target in the scene). */
function AimedSpot({
  position, target, intensity, color, angle, penumbra, castShadow = false,
}: {
  position: [number, number, number];
  target: [number, number, number];
  intensity: number;
  color: string;
  angle: number;
  penumbra: number;
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(new THREE.Object3D());

  useEffect(() => {
    const t = targetRef.current;
    t.position.set(...target);
    if (ref.current) ref.current.target = t;
  }, [target]);

  return (
    <>
      <spotLight
        ref={ref}
        position={position}
        intensity={intensity}
        color={color}
        angle={angle}
        penumbra={penumbra}
        decay={0}
        castShadow={castShadow}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-near={10}
        shadow-camera-far={160}
      />
      <primitive object={targetRef.current} />
    </>
  );
}

export function Lighting() {
  return (
    <>
      {/* The room reads light because its SURFACES are light (theme.ts), not
          because ambient is flooded. Too much ambient flattens every form in the
          scene, the player worst of all, so it stays low and the directional
          contrast below does the modelling. */}
      {/* The bowl is dark now, so ambient drops with it. Flooding ambient to
          compensate is what made every form in the scene look flat — the
          modelling comes from the two court pools below, not from fill. */}
      <hemisphereLight args={["#5b6884", "#141926", 0.5]} />
      <ambientLight intensity={0.2} color="#c2cde4" />

      {/* main court pool — warm bank over the half court, casts the shadows */}
      <AimedSpot
        position={[-24, 72, 14]}
        target={[-24, 0, 0]}
        intensity={1.85}
        color="#ffedd2"
        angle={0.62}
        penumbra={0.45}
        castShadow
      />
      {/* second pool from the other sideline (no shadow — perf) */}
      <AimedSpot
        position={[-16, 70, -18]}
        target={[-30, 0, 0]}
        intensity={1.15}
        color="#ffe7c4"
        angle={0.58}
        penumbra={0.5}
      />

      {/* cool fill + rim so bodies and the hoop separate from the bowl */}
      <directionalLight position={[-60, 30, -30]} intensity={0.26} color="#8fa6d8" />
      <directionalLight position={[20, 24, 30]} intensity={0.22} color="#a8bbe6" />
    </>
  );
}
