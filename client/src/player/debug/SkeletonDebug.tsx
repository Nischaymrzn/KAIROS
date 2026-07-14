/**
 * SKELETON DEBUG — coloured markers on every controllable joint, plus the ball
 * hold point, release point and rim centre. Toggle with DEBUG_PLAYER_SKELETON
 * (or ?skeleton in the URL) to check the animation is structurally right before
 * judging the shaded result.
 *
 * Markers are drawn on top (depthTest off) so they stay visible through the
 * body, and they follow the live bone world positions each frame.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PlayerRig, BoneName } from "../rig/buildRig";
import { handTracker } from "../../scene/handTracker";
import * as D from "../../constants/dimensions";

export const DEBUG_PLAYER_SKELETON =
  typeof window !== "undefined" && window.location.search.includes("skeleton");

const GROUPS: [string, BoneName[]][] = [
  ["#ff4d4d", ["Head", "Neck"]],
  ["#ffd24d", ["Spine", "Spine1", "Spine2", "Hips"]],
  ["#4dd2ff", ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"]],
  ["#ff9a4d", ["RightShoulder", "RightArm", "RightForeArm", "RightHand"]],
  ["#7dff4d", ["LeftUpLeg", "LeftLeg", "LeftFoot"]],
  ["#c04dff", ["RightUpLeg", "RightLeg", "RightFoot"]],
];

const ORDER: BoneName[] = GROUPS.flatMap(([, b]) => b);

export function SkeletonDebug({ rig }: { rig: PlayerRig }) {
  const dots = useRef<THREE.InstancedMesh>(null);
  const bones = useMemo(() => ORDER.filter((n) => rig.bones[n]), [rig]);

  const { geo, mat, colors } = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.09, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ depthTest: false, toneMapped: false });
    const colors = new Float32Array(bones.length * 3);
    let i = 0;
    const c = new THREE.Color();
    for (const [hex, group] of GROUPS) {
      for (const n of group) {
        if (!rig.bones[n]) continue;
        c.set(hex);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        i++;
      }
    }
    return { geo, mat, colors };
  }, [bones, rig]);

  const scratch = useMemo(
    () => ({ m: new THREE.Matrix4(), v: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) }),
    []
  );

  useFrame(() => {
    const mesh = dots.current;
    if (!mesh) return;
    const sc = scratch;
    bones.forEach((n, i) => {
      rig.bones[n].getWorldPosition(sc.v);
      sc.m.compose(sc.v, sc.q, sc.s);
      mesh.setMatrixAt(i, sc.m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={dots} args={[geo, mat, bones.length]} renderOrder={999}>
        <instancedBufferAttribute attach="instanceColor" args={[colors, 3]} />
      </instancedMesh>
      {/* ball hold point (between the hands) */}
      <mesh position={handTracker.right} renderOrder={999}>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} toneMapped={false} />
      </mesh>
      {/* rim centre */}
      <mesh position={[D.basketX(-1), D.RIM_HEIGHT, 0]} renderOrder={999}>
        <sphereGeometry args={[0.1, 8, 6]} />
        <meshBasicMaterial color="#00ffcc" depthTest={false} toneMapped={false} />
      </mesh>
    </>
  );
}
