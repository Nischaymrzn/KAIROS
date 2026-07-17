/**
 * COURT INTERACTION — invisible floor plane that intercepts pointer clicks and
 * translates them to court coordinates [x, z] in feet, then commits them to the
 * shot store. The player rig and PredictionPanel react to that store update.
 *
 * Drag vs click: only a pointer-up within 5 px and 200 ms of pointer-down counts
 * as a shot placement — the orbit-controls drag must not trigger predictions.
 */
import { useRef } from "react";
import { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import * as D from "../constants/dimensions";
import { useShotStore } from "../state/shotStore";
import { useDefenseStore } from "../state/defenseStore";
import { getSceneLayers } from "../workspace/layers";

const COURT_Y = 0; // floor is y=0 in world space

export function CourtInteraction() {
  const setShotPosition = useShotStore((s) => s.setShotPosition);
  const downTime = useRef(0);
  const downPos = useRef<[number, number]>([0, 0]);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    downTime.current = performance.now();
    downPos.current = [e.clientX, e.clientY];
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const dt = performance.now() - downTime.current;
    const dx = e.clientX - downPos.current[0];
    const dy = e.clientY - downPos.current[1];
    const moved = Math.hypot(dx, dy);

    // ignore orbit drags — only register as a click if short + stationary
    if (dt > 250 || moved > 6) return;

    // point is on the floor plane (y≈0); clamp to half-court playing area
    const x = THREE.MathUtils.clamp(e.point.x, D.HALF_LENGTH * -1 + 2, -D.BASKET_FROM_BASELINE - 2);
    const z = THREE.MathUtils.clamp(e.point.z, -D.HALF_WIDTH + 2, D.HALF_WIDTH - 2);

    // The toggle decides whether a click drops a defender or moves the shooter,
    // but only in the modes that actually show that toggle. Asking
    // `placedDefenders` here conflated being drawn with being editable, which let
    // a placement chosen in Court follow the user into modes with no way to
    // change it back.
    const def = useDefenseStore.getState();
    const canPlaceDefenders = getSceneLayers().placeDefenders;
    if (canPlaceDefenders && def.placement === "defender") {
      def.toggleDefenderAt(x, z);
    } else {
      setShotPosition(x, z);
    }
    e.stopPropagation();
  };

  return (
    <mesh
      position={[0, COURT_Y - 0.01, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* covers the full court so sideline / baseline clicks also register */}
      <planeGeometry args={[D.COURT_LENGTH, D.COURT_WIDTH]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
