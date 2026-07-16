import { useEffect, useRef } from "react";
import type { ElementRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { CAMERA_VIEWS } from "./cameraPresets";
import { cameraStore } from "./cameraStore";
import { focusTracker } from "./focusTracker";

// initial framing (used by <Scene/> for the <Canvas camera> prop)
export const CAMERA_START = CAMERA_VIEWS[0].position;
export const CAMERA_TARGET = CAMERA_VIEWS[0].target;
export const CAMERA_FOV = CAMERA_VIEWS[0].fov;

// keep the orbit target within a sensible box around the half-court, so free
// panning can never fling the court out of view (it stays the subject)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TARGET_BOUNDS = { x: [-52, 4] as const, y: [0, 14] as const, z: [-28, 28] as const };
const _look = new THREE.Vector3();

/**
 * The camera composes for the whole canvas.
 *
 * There was a `setViewOffset` pass here that shifted the frame left to account
 * for the rail, dock and readout sitting on top of the canvas, so the action
 * would centre in the visible strip of court rather than behind a panel. It is
 * gone. Getting the sub-rectangle arithmetic wrong pushed the court out of frame
 * entirely and rendered a black canvas, and it did so at some viewport widths and
 * not others, which made it look like a camera or a lighting fault every time it
 * appeared. A slightly off-centre subject is a much smaller problem than a court
 * that vanishes, and the panels are translucent.
 */
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface Tween {
  t: number;
  dur: number;
  fromP: THREE.Vector3;
  toP: THREE.Vector3;
  fromT: THREE.Vector3;
  toT: THREE.Vector3;
  fromF: number;
  toF: number;
}

/**
 * CAMERA RIG — free-look controls plus a preset-view system:
 *   • orbit in every direction (drag left/right AND up/down), pan (right-drag),
 *     smooth damped zoom — all retained, from any view
 *   • jump to a named preset (constants in cameraPresets.ts) and it SMOOTHLY flies
 *     there (position + target + fov are tweened)
 *   • double-click cycles through the presets; number keys 1..N jump to one;
 *     "R" returns to Broadcast
 *   • polar limits keep you above the floor; a target clamp keeps the court framed
 * View selection is routed through cameraStore, shared with the <ViewControls/>
 * buttons so the DOM and the 3D camera stay in sync.
 */
export function CameraRig() {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const tween = useRef<Tween | null>(null);
  /** has the camera been placed at a preset at least once */
  const placed = useRef(false);

  useEffect(() => {
    const c0 = controls.current;
    const goTo = (index: number) => {
      const c = controls.current;
      const view = CAMERA_VIEWS[index];
      if (!c || !view) return;

      // SNAP THE FIRST ONE, TWEEN THE REST.
      //
      // A tween interpolates FROM wherever the camera currently is. When a panel
      // asks for its preset during mount, that is before the camera has been
      // placed, so the start point is the origin: the swoop begins from inside
      // the floor at the centre of the court, and for its duration the frame is
      // solid dark. It resolves in under a second in a browser, but it is a
      // glitch on every load that opens a panel, and under any clock where the
      // frame delta is small it never resolves at all.
      //
      // There is also nothing to animate away from on the first placement.
      if (!placed.current) {
        placed.current = true;
        camera.position.set(...view.position);
        c.target.set(...view.target);
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = view.fov;
          camera.updateProjectionMatrix();
        }
        c.update();
        return;
      }

      tween.current = {
        t: 0,
        dur: 0.85,
        fromP: camera.position.clone(),
        toP: new THREE.Vector3(...view.position),
        fromT: c.target.clone(),
        toT: new THREE.Vector3(...view.target),
        fromF: camera.fov,
        toF: view.fov,
      };
      c.enabled = false; // hand control to the tween until it lands
    };

    const unsub = cameraStore.subscribe(goTo);

    // DEV ONLY: ?cam=x,y,z,tx,ty,tz places the camera exactly, for inspecting
    // body and prop detail in a headless run where nothing can be orbited.
    const c = c0;
    if (import.meta.env.DEV && c) {
      const raw = new URLSearchParams(window.location.search).get("cam");
      if (raw) {
        const n = raw.split(",").map(Number);
        if (n.length >= 6 && n.every((v) => Number.isFinite(v))) {
          placed.current = true;
          camera.position.set(n[0], n[1], n[2]);
          c.target?.set?.(n[3], n[4], n[5]);
          if (camera instanceof THREE.PerspectiveCamera) {
            camera.fov = n[6] ?? 40;
            camera.updateProjectionMatrix();
          }
          c.update?.();
        }
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") return cameraStore.set(0);
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= CAMERA_VIEWS.length) cameraStore.set(n - 1);
    };
    const onDblClick = () => cameraStore.set((cameraStore.get() + 1) % CAMERA_VIEWS.length);

    const el = gl.domElement;
    window.addEventListener("keydown", onKey);
    el.addEventListener("dblclick", onDblClick);
    return () => {
      unsub();
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("dblclick", onDblClick);
    };
  }, [camera, gl]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const tw = tween.current;

    if (tw) {
      tw.t = Math.min(1, tw.t + delta / tw.dur);
      const e = easeInOut(tw.t);
      camera.position.lerpVectors(tw.fromP, tw.toP, e);
      c.target.lerpVectors(tw.fromT, tw.toT, e);
      const fov = tw.fromF + (tw.toF - tw.fromF) * e;
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      c.update();
      if (tw.t >= 1) {
        tween.current = null;
        c.enabled = true; // return control to the user
      }
      return;
    }

    // cinematic follow: while the ball is in flight (or the runner is running),
    // the orbit TARGET eases onto the subject — the user keeps orbit/zoom
    if (focusTracker.active) {
      const sf = focusTracker.shotFrame;

      // WHAT THE CAMERA LOOKS AT DURING A SHOT.
      //
      // Following the ball alone tilts the camera up as the ball rises, and by
      // the top of the arc the shooter is off the bottom of the frame and the
      // shot is playing against the back wall of the arena. A broadcast camera
      // holds the whole action — shooter, ball and rim — so the target sits on
      // the shooter-to-rim line at chest height and only leans PART of the way
      // toward the ball. The ball stays in frame; so does everything it means.
      if (sf) {
        const rimX = -41.75;
        _look.set((sf.x + rimX) / 2, 6.4, sf.z / 2);
        // only a quarter of the way to the ball: enough to follow, not enough to
        // let a high arc drag the rim and the shooter out of the bottom of frame
        _look.lerp(focusTracker.pos, 0.26);
        c.target.lerp(_look, Math.min(delta * 4.5, 1));
      } else {
        c.target.lerp(focusTracker.pos, Math.min(delta * 4.5, 1));
      }

      // SHOT CAM: during a shot flight, the camera POSITION also glides to a
      // broadcast-side framing — perpendicular to the shooter→rim line at its
      // midpoint, on whichever side the camera already is (no jarring flips)
      if (sf) {
        const rimX = -41.75;
        const mx = (sf.x + rimX) / 2;
        const mz = sf.z / 2;
        let dx = rimX - sf.x;
        let dz = 0 - sf.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        // perpendicular, on the camera's current side
        const side = camera.position.x * -dz + camera.position.z * dx >= mz * dx - mx * dz ? 1 : -1;
        // Standoff and height both carry the whole shooter-to-rim line plus the
        // arc above it. The previous 1.15x/24 ft framing put the camera close
        // enough that a shot from beyond the arc ran off both ends of the frame.
        const standoff = Math.max(len * 1.35, 29);
        const px = mx + -dz * standoff * side;
        const pz = mz + dx * standoff * side;
        const py = 7.5 + len * 0.1;
        camera.position.x += (px - camera.position.x) * Math.min(delta * 2.2, 1);
        camera.position.y += (py - camera.position.y) * Math.min(delta * 2.2, 1);
        camera.position.z += (pz - camera.position.z) * Math.min(delta * 2.2, 1);
      }
    }

    // free-look: clamp the pan target so the court can't be lost off-screen
    const t = c.target;
    t.set(
      clamp(t.x, TARGET_BOUNDS.x[0], TARGET_BOUNDS.x[1]),
      clamp(t.y, TARGET_BOUNDS.y[0], TARGET_BOUNDS.y[1]),
      clamp(t.z, TARGET_BOUNDS.z[0], TARGET_BOUNDS.z[1])
    );
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={CAMERA_TARGET}
      // smoothness
      enableDamping
      dampingFactor={0.06}
      rotateSpeed={0.8}
      zoomSpeed={0.9}
      panSpeed={0.8}
      // free movement
      enablePan
      screenSpacePanning
      // zoom range — tight enough that the court stays the subject
      minDistance={12}
      maxDistance={72}
      // orbit up/down freely, but stay above the floor and below straight-down
      minPolarAngle={0.08}
      maxPolarAngle={Math.PI / 2 - 0.045}
      // full 360° left/right
      minAzimuthAngle={-Infinity}
      maxAzimuthAngle={Infinity}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    />
  );
}
