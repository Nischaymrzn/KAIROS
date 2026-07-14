/**
 * GLB CHARACTER — the real skinned human player (client/public/models/player.glb).
 *
 * Motion strategy (robust by construction):
 *   • IDLE: the file's own Idle mocap clip plays through an AnimationMixer —
 *     professional motion, zero retargeting risk.
 *   • SHOTS: the mixer fades out and our AnimationController drives the bones
 *     through the verb's timeline (gather → rise → release at apex → land),
 *     each pose composed ON TOP of the harvested idle stance (q_rest × q_pose);
 *     afterwards the mixer fades back in.
 *
 * The model is measured in bind pose, scaled to the ACTIVE player's real
 * height, arms lengthened to his wingspan, and grounded so the feet sit on the
 * floor. Missing/broken file → the procedural athlete renders instead.
 */
import { Component, ReactNode, Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { AnimationController } from "./animation/AnimationController";
import { shotSequence } from "./animation/sequences";
import { solveBody } from "./config/anthropometry";
import type { PlayerRig, BoneName } from "./rig/buildRig";
import { Player, PlayerProps } from "./Player";
import { SkeletonDebug, DEBUG_PLAYER_SKELETON } from "./debug/SkeletonDebug";

export const GLB_URL = "/models/player.glb";

const DBG = (k: string, v: unknown) => {
  (window as unknown as { __glb: Record<string, unknown> }).__glb ??= {};
  (window as unknown as { __glb: Record<string, unknown> }).__glb[k] = v;
};

/** "mixamorig:Hips" / "mixamorigHips" / "Hips" → "Hips"; also maps UE-style
 *  skeletons (pelvis/spine_01/upperarm_l…) so Unreal-flavoured rigs work too. */
const UE_ALIASES: Record<string, string> = {
  pelvis: "Hips", spine_01: "Spine", spine_02: "Spine1", spine_03: "Spine2",
  neck_01: "Neck", head: "Head",
  clavicle_l: "LeftShoulder", upperarm_l: "LeftArm", lowerarm_l: "LeftForeArm", hand_l: "LeftHand",
  clavicle_r: "RightShoulder", upperarm_r: "RightArm", lowerarm_r: "RightForeArm", hand_r: "RightHand",
  thigh_l: "LeftUpLeg", calf_l: "LeftLeg", foot_l: "LeftFoot",
  thigh_r: "RightUpLeg", calf_r: "RightLeg", foot_r: "RightFoot",
};

function canonical(name: string): string {
  const stripped = name.replace(/^mixamorig[:_]?/i, "");
  return UE_ALIASES[stripped.toLowerCase()] ?? stripped;
}

/** Rest stance from the model's own idle clip (first keyframe per bone) —
 *  shot poses compose on top of this, so T-pose rests never leak through. */
function restFromIdle(
  animations: THREE.AnimationClip[],
): Partial<Record<BoneName, THREE.Quaternion>> {
  const rest: Partial<Record<BoneName, THREE.Quaternion>> = {};
  const clip = animations.find((a) => /idle/i.test(a.name)) ?? animations[0];
  if (!clip) return rest;
  for (const track of clip.tracks) {
    const m = track.name.match(/^(.+)\.quaternion$/);
    if (!m || track.values.length < 4) continue;
    rest[canonical(m[1]) as BoneName] = new THREE.Quaternion(
      track.values[0], track.values[1], track.values[2], track.values[3]
    );
  }
  return rest;
}

function GlbInner(props: PlayerProps) {
  const {
    config, position = [0, 0], lookAt, pose = "idle",
    shotSignal = 0, shotVerb = "pullup", jumpScale = 1, shotDistance = 18,
  } = props;
  const gltf = useGLTF(GLB_URL);

  const built = useMemo(() => {
    const model = SkeletonUtils.clone(gltf.scene);
    const bones: Partial<Record<BoneName, THREE.Bone>> = {};
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[canonical(o.name) as BoneName] = o as THREE.Bone;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false; // skinned bounds lag the pose
      }
    });
    if (!bones.Hips || !bones.Head) {
      DBG("rig", "unusable: no Hips/Head");
      return null;
    }

    // Measure stature from BONES in bind pose — Box3 on skinned meshes is
    // unreliable (it can collapse to ~0 and blow the scale up by 1000×; that
    // bug rendered the first install invisible). Bone positions are exact in
    // any unit system: head joint ≈ 93% of stature, ankle ≈ 4%, so the
    // head→ankle span is ≈ 89% of standing height.
    model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.skeleton.pose();
    });
    model.updateWorldMatrix(true, true);
    const v = new THREE.Vector3();
    const headY = bones.Head.getWorldPosition(v).y;
    const footY = Math.min(
      bones.LeftFoot ? bones.LeftFoot.getWorldPosition(v).y : Infinity,
      bones.RightFoot ? bones.RightFoot.getWorldPosition(v).y : Infinity,
      headY - 0.01
    );
    const statureNative = Math.max((headY - footY) / 0.89, 1e-6);
    const targetH = config?.physical.height ?? 6.5;
    const s = targetH / statureNative;

    // container = the rig root the controller/jump writes to; the model sits
    // inside it, scaled and lifted so the feet rest exactly on y = 0
    const container = new THREE.Group();
    model.scale.setScalar(s);
    model.updateWorldMatrix(true, true);
    const ankleWorld = Math.min(
      bones.LeftFoot ? bones.LeftFoot.getWorldPosition(v).y : Infinity,
      bones.RightFoot ? bones.RightFoot.getWorldPosition(v).y : Infinity
    );
    // ankle joint sits ~4% of stature above the sole
    model.position.y = -(ankleWorld - targetH * 0.04);
    container.add(model);

    // wingspan: lengthen the arm chains beyond the default proportion
    const armScale = (config?.physical.wingspanRatio ?? 1.06) / 1.06;
    bones.LeftArm?.scale.setScalar(armScale);
    bones.RightArm?.scale.setScalar(armScale);

    const rig: PlayerRig = {
      root: container as PlayerRig["root"],
      bones: bones as PlayerRig["bones"],
      plan: solveBody((config ?? { physical: undefined }).physical ?? ({} as never)),
      dispose: () => undefined, // geometry belongs to the GLTF cache
      restQuat: restFromIdle(gltf.animations),
    };

    // the model's own idle mocap
    const mixer = new THREE.AnimationMixer(model);
    const idleClip = gltf.animations.find((a) => /idle/i.test(a.name)) ?? gltf.animations[0];
    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
    idleAction?.play();

    DBG("rig", { bones: Object.keys(bones).length, statureNative: +statureNative.toFixed(2), scale: +s.toFixed(3), idle: idleClip?.name ?? null });
    return { rig, mixer, idleAction };
  }, [gltf, config]);

  const controller = useMemo(
    () => (built ? new AnimationController(built.rig, pose) : null),
    [built, pose]
  );

  // during a shot the controller owns the bones; otherwise the mixer does
  const shotUntil = useRef(0);
  useEffect(() => {
    if (!built || !controller || shotSignal === 0) return;
    const seq = shotSequence(shotVerb);
    controller.playShot(shotVerb, jumpScale, shotDistance);
    built.idleAction?.fadeOut(0.12);
    shotUntil.current = performance.now() / 1000 + seq.duration;
    const t = setTimeout(() => {
      built.idleAction?.reset().fadeIn(0.3).play();
    }, seq.duration * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotSignal]);

  const last = useRef(0);
  useFrame(({ clock }) => {
    if (!built || !controller) return;
    const t = clock.getElapsedTime();
    const dt = Math.min(t - last.current, 0.1);
    last.current = t;
    if (performance.now() / 1000 < shotUntil.current) {
      controller.update(t, dt); // shot timeline owns the skeleton
    } else {
      built.mixer.update(dt); // professional idle mocap owns it
      built.rig.root.position.y = 0;
    }
  });

  if (!built) return <Player {...props} />; // unusable rig → procedural athlete

  const yaw = lookAt
    ? Math.atan2(lookAt[0] - position[0], lookAt[1] - position[1])
    : 0;

  return (
    <>
      <primitive
        object={built.rig.root}
        position={[position[0], 0, position[1]]}
        rotation={[0, yaw, 0]}
      />
      {DEBUG_PLAYER_SKELETON && <SkeletonDebug rig={built.rig} />}
    </>
  );
}

/** Error boundary: a broken/missing GLB must never blank the scene. */
class GlbBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(err: unknown) {
    DBG("boundaryTripped", String(err).slice(0, 200));
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Character with automatic fallback: GLB when `glbAvailable`, procedural
 * athlete otherwise (and while the GLB streams in, and if it fails to parse).
 */
export function CharacterOrFallback({ glbAvailable, ...props }: PlayerProps & { glbAvailable: boolean }) {
  if (!glbAvailable) return <Player {...props} />;
  return (
    <GlbBoundary fallback={<Player {...props} />}>
      <Suspense fallback={<Player {...props} />}>
        <GlbInner {...props} />
      </Suspense>
    </GlbBoundary>
  );
}
