import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAppStore } from "@/store/useAppStore";
import { PLAYERS } from "@/lib/dummyData";
import { POSES } from "@/lib/poses";
import { getBallTexture } from "@/lib/ballTexture";
import { basketX, RIM_HEIGHT } from "@/lib/courtDimensions";

const REF_H = 6.5;
const HIP_Y = 3.35;
const BX = basketX(-1);
const CYCLE = 3.2; // seconds
const HOLD = 0.34; // fraction in hands
const LAND = 0.9; // fraction when it reaches the rim

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The basketball: held at the shooter's release point, then animated along a
 * realistic arc into the rim on a loop (swish + reset). Spins throughout.
 */
export function BallSystem() {
  const scenario = useAppStore((s) => s.scenario);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const tex = useMemo(() => getBallTexture(), []);

  const { setPoint, rim, arc } = useMemo(() => {
    const player = PLAYERS.find((pl) => pl.id === scenario.playerId) ?? PLAYERS[0];
    const scale = player.heightIn / 12 / REF_H;
    const pose = POSES[scenario.shotType];
    const { x, z } = scenario.position;
    const f = Math.atan2(BX - x, 0 - z);
    const fwd = pose.ball[2] * scale;
    const side = pose.ball[0] * scale;
    const sp: [number, number, number] = [
      x + Math.sin(f) * fwd + Math.cos(f) * side,
      (HIP_Y + pose.ball[1]) * scale + pose.lift * scale,
      z + Math.cos(f) * fwd - Math.sin(f) * side,
    ];
    const rm: [number, number, number] = [BX, RIM_HEIGHT, 0];
    const dist = Math.hypot(sp[0] - rm[0], sp[2] - rm[2]);
    return { setPoint: sp, rim: rm, arc: 2.6 + dist * 0.06 };
  }, [scenario]);

  useFrame((state) => {
    const m = meshRef.current;
    if (!m) return;
    const phase = (state.clock.elapsedTime % CYCLE) / CYCLE;

    let px = setPoint[0], py = setPoint[1], pz = setPoint[2];
    let spin = 0.04;
    if (phase > HOLD) {
      const u = Math.min(1, (phase - HOLD) / (LAND - HOLD));
      px = lerp(setPoint[0], rim[0], u);
      pz = lerp(setPoint[2], rim[2], u);
      py = lerp(setPoint[1], rim[1], u) + Math.sin(u * Math.PI) * arc;
      spin = 0.16;
    }
    m.position.set(px, py, pz);
    m.rotation.x += spin;
    m.rotation.y += spin * 0.4;

    // fade out into the net, fade a fresh ball back into the hands
    if (matRef.current) {
      let o = 1;
      if (phase > 0.86) o = 1 - (phase - 0.86) / 0.14;
      else if (phase < 0.05) o = phase / 0.05;
      matRef.current.opacity = Math.max(0, Math.min(1, o));
    }
  });

  return (
    <mesh ref={meshRef} position={setPoint} castShadow>
      <sphereGeometry args={[0.4, 36, 36]} />
      <meshStandardMaterial
        ref={matRef}
        map={tex}
        roughness={0.82}
        metalness={0.02}
        bumpMap={tex}
        bumpScale={0.012}
        transparent
      />
    </mesh>
  );
}
