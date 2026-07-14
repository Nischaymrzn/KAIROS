import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { handTracker } from "../scene/handTracker";
import { SkeletonDebug, DEBUG_PLAYER_SKELETON } from "./debug/SkeletonDebug";
import { buildRig } from "./rig/buildRig";
import { AnimationController } from "./animation/AnimationController";
import { PlayerConfig, DEFAULT_PLAYER } from "./config/PlayerConfig";
import { PoseName } from "./animation/poses";

/**
 * PLAYER — the scene-facing component. Everything about the player is driven by
 * a PlayerConfig (see player/config); this component just instantiates the rig,
 * runs its AnimationController, and places it on the court:
 *
 *   <Player config={makePlayer({...})} position={[-30, 6]} lookAt={[-41.75, 0]} />
 *
 * `position` / `lookAt` are court coordinates [x, z] in feet (the shared frame
 * from constants/dimensions.ts) — feet stay planted on y = 0 by construction.
 * Mount as many <Player/>s as needed; each rig owns and disposes its resources.
 */
export interface PlayerProps {
  config?: PlayerConfig;
  /** court position [x, z] in feet */
  position?: [number, number];
  /** court point [x, z] the player faces (e.g. the rim) */
  lookAt?: [number, number];
  pose?: PoseName;
  /** bump to run the full multi-phase shot timeline for `shotVerb` */
  shotSignal?: number;
  shotVerb?: string;
  /** scales the sequence's jump height (real player verticals) */
  jumpScale?: number;
  /** shot distance in feet; adapts leg load, lift and release angle */
  shotDistance?: number;
  /**
   * Publish this player's hands to the shared `handTracker`, which is what the
   * ball rides.
   *
   * OFF BY DEFAULT, AND THAT IS THE POINT. `handTracker` is a single global, and
   * every mounted Player used to write it on every frame. With defenders on the
   * floor the last one rendered won, so the ball sat in a DEFENDER's hand instead
   * of the shooter's — a bug that only appears once a second body exists, which
   * is why it survived so long. Exactly one player may own the ball, so owning it
   * is opt-in and `ShooterPlayer` is the only caller that opts in.
   */
  tracksHands?: boolean;
}

export function Player({
  config = DEFAULT_PLAYER,
  position = [0, 0],
  lookAt,
  pose = "idle",
  shotSignal = 0,
  shotVerb = "pullup",
  jumpScale = 1,
  shotDistance = 18,
  tracksHands = false,
}: PlayerProps) {
  const rig = useMemo(() => buildRig(config), [config]);
  const controller = useMemo(() => new AnimationController(rig, pose), [rig, pose]);
  const last = useRef(0);

  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => controller.setPose(pose), [controller, pose]);
  useEffect(() => {
    if (shotSignal > 0) controller.playShot(shotVerb, jumpScale, shotDistance);
    // verb/scale are read at trigger time only — the signal is the event
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, shotSignal]);

  // face the target: rig is built facing +Z, so yaw = atan2(dx, dz)
  const yaw = lookAt
    ? Math.atan2(lookAt[0] - position[0], lookAt[1] - position[1])
    : 0;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const dt = Math.min(t - last.current, 0.1);
    last.current = t;
    controller.update(t, dt);

    // Court position is owned HERE, not by a React prop, because the controller
    // adds airborne travel to it every frame. Leaving `position` on the
    // <primitive> as well would mean a re-render snapping the shooter back to
    // the spot mid-flight — the step-back would visibly teleport home the moment
    // any unrelated state changed.
    //
    // Travel arrives in the rig's local frame (+z toward the rim) and is rotated
    // into court space by the same yaw the body is facing.
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const { x: tx, z: tz } = controller.travel;
    rig.root.position.x = position[0] + tx * cos + tz * sin;
    rig.root.position.z = position[1] - tx * sin + tz * cos;

    // Position AND orientation: the ball is seated in the shooting hand's own
    // frame, so it rides on the fingers through the whole motion instead of
    // floating at the midpoint between two wrists.
    //
    // Only the player who owns the ball publishes here. See `tracksHands`.
    if (tracksHands) {
      rig.bones.RightHand?.getWorldPosition(handTracker.right);
      rig.bones.RightHand?.getWorldQuaternion(handTracker.rightQ);
      rig.bones.LeftHand?.getWorldPosition(handTracker.left);
      rig.bones.LeftHand?.getWorldQuaternion(handTracker.leftQ);
      rig.bones.Spine2?.getWorldPosition(handTracker.chest);
      handTracker.live = true;
    }
  });

  return (
    <>
      <primitive
        object={rig.root}
        position={[position[0], 0, position[1]]}
        rotation={[0, yaw, 0]}
      />
      {DEBUG_PLAYER_SKELETON && <SkeletonDebug rig={rig} />}
    </>
  );
}
