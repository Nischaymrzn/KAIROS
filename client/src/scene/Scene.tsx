import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { Court } from "../court/Court";
import { Arena } from "../arena/Arena";
import { CourtInteraction } from "./CourtInteraction";
import { ShotMarker } from "./ShotMarker";
import { ShooterPlayer } from "./ShooterPlayer";
import { HeatOverlay } from "./HeatOverlay";
import { DefenderPlayer } from "./DefenderPlayer";
import { PlacedDefenders } from "./PlacedDefenders";
import { ShotArc } from "./ShotArc";
import { TrackedPlay } from "./TrackedPlay";
import { Lighting } from "./Lighting";
import { Skydome } from "./Skydome";
import { CameraRig, CAMERA_START, CAMERA_FOV } from "./CameraRig";
import { COLORS } from "../constants/theme";
import { useSceneLayers } from "../workspace/layers";

/**
 * Forces the drawing-buffer size from the window. R3F's ResizeObserver can fail to
 * fire inside embedded browsers, leaving the canvas at the default 300×150 — this
 * guarantees the scene always fills (and refits to) the viewport.
 */
function Resizer() {
  const setSize = useThree((s) => s.setSize);
  useEffect(() => {
    const resize = () => setSize(window.innerWidth, window.innerHeight);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [setSize]);
  return null;
}


/**
 * SCENE — the single persistent R3F canvas: backdrop, lighting, camera rig, the
 * arena + court, and the mode's active 3D layers.
 */
export function Scene() {
  const L = useSceneLayers();

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas
        shadows
        // Capped below 2 on purpose. At dpr 2 on a high-density laptop panel this
        // scene renders four times the pixels for a difference nobody looked at,
        // and it was the single largest cost in the frame.
        dpr={[1, 1.6]}
        // Lets R3F drop resolution while the camera is moving and restore it when
        // the view settles, so orbiting stays smooth instead of stuttering.
        performance={{ min: 0.5, max: 1, debounce: 180 }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          // Down from 1.12. The bowl went dark and the court lights came up to
          // compensate, which blew the hardwood out to a flat sheet of cream.
          toneMappingExposure: 0.98,
        }}
        camera={{ position: CAMERA_START, fov: CAMERA_FOV, near: 0.5, far: 1200 }}
      >
        <Resizer />
        <color attach="background" args={[COLORS.skyTop]} />
        <fog attach="fog" args={[COLORS.skyHorizon, 200, 460]} />

        <Skydome />
        <Lighting />
        <Arena />

        <group>
          <Court />
          {L.interact && <CourtInteraction />}
          {L.marker && <ShotMarker />}
          {L.shooter && <ShooterPlayer />}
          {L.heat && <HeatOverlay visible />}
          {L.defender && <DefenderPlayer />}
          {L.placedDefenders && <PlacedDefenders />}
          {L.arc && <ShotArc persistent={L.arcPersistent} />}
          {L.replay && <TrackedPlay />}
        </group>

        {/* Grounding shadow under the action only.
            This was scale 170 at resolution 1024, which re-rendered the entire
            court into a 1024² depth buffer on EVERY frame — a second full scene
            pass, for a smudge spread so thin over 170 feet that it was barely
            visible. The spotlight in <Lighting/> already casts the real shadows;
            this just seats the players and the ball on the floor, so it only
            needs to cover the half court the shot is taken from. */}
        <ContactShadows
          position={[-30, 0.005, 0]}
          scale={64}
          resolution={512}
          blur={2.4}
          opacity={0.42}
          far={26}
        />

        <CameraRig />
      </Canvas>
    </div>
  );
}
