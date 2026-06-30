import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { Lighting } from "./Lighting";
import { Arena } from "./Arena";
import { Court } from "@/components/court/Court";
import { ClickPlane } from "@/components/court/ClickPlane";
import { ShotMarker } from "@/components/court/ShotMarker";
import { HeatGrid } from "@/components/court/HeatGrid";
import { MovementPath } from "@/components/court/MovementPath";
import { Players } from "@/components/players/Players";
import { BallSystem } from "@/components/ball/BallSystem";

function SceneContents() {
  return (
    <>
      <Lighting />
      <fog attach="fog" args={["#11151d", 120, 380]} />
      <Arena />
      <Court />
      <ClickPlane />
      <HeatGrid />
      <MovementPath />
      <Players />
      <ShotMarker />
      <BallSystem />
      <ContactShadows position={[-23.5, 0.05, 0]} scale={110} blur={2.6} opacity={0.5} far={22} />
      <OrbitControls
        target={[-33, 6, 3]}
        enablePan
        minDistance={10}
        maxDistance={120}
        maxPolarAngle={Math.PI / 2.15}
      />
    </>
  );
}

/** The WebGL canvas hosting the 3D arena (transparent over the CSS backdrop). */
export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [-19, 9.5, 16], fov: 44, near: 0.5, far: 500 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
    >
      <SceneContents />
    </Canvas>
  );
}
