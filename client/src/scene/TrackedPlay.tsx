/**
 * TRACKED PLAY — the possession as markers, then the shot as yours.
 *
 * WHY MARKERS AND NOT TEN BODIES.
 * This first rendered all ten players as full procedural rigs. It worked, and it
 * was the wrong call twice over. It cost roughly double the scene's previous
 * maximum body count for figures the camera never gets close to — enough that a
 * software renderer could not finish a frame at all. And, the part that actually
 * matters, ten walking figures is a WORSE picture of a possession than ten dots:
 * spacing is the thing being read, and a marker is nothing but spacing. The
 * tactical board makes the same choice for the same reason.
 *
 * WHAT HAPPENS AT THE END.
 * The clip's last frame is the release, so the recording stops exactly where the
 * interesting part starts. Rather than reconstruct a shot nobody recorded, the
 * possession HANDS OVER: at the final frame the scenario is set to the situation
 * the play produced — shooter on his release spot, his nearest defender on his,
 * the recorded action selected — and the markers clear.
 *
 * The ordinary shooter and arc then mount through the usual path, so the user
 * takes the shot themselves with the full model behind it. That is better than
 * watching a reconstruction: the question at the end of a possession is "what is
 * this shot worth", and now it can be fired and answered.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { usePlaybackStore, cursor, CLIP_HZ } from "../state/playbackStore";
import { useScenarioStore } from "../scenario/scenarioStore";
import { TEAM } from "../viz/palette";
import type { ShotVerb } from "../scenario/schema";

const P0 = 5;
/** Marker radius in feet — about a shoulder width, so spacing reads true. */
const DOT_R = 1.15;
const DOT_Y = 0.06;

/**
 * The corpus records NBA action strings ("Turnaround Fadeaway shot"); the
 * scenario is keyed by our own verbs. Longest match wins so "Driving Layup" is
 * not swallowed by "Layup".
 */
const ACTION_VERBS: [string, ShotVerb][] = [
  ["driving layup", "driving_layup"],
  ["finger roll", "driving_layup"],
  ["reverse layup", "layup"],
  ["step back", "stepback"],
  ["stepback", "stepback"],
  ["fadeaway", "fadeaway"],
  ["turnaround", "fadeaway"],
  ["pullup", "pullup"],
  ["pull-up", "pullup"],
  ["floating", "floater"],
  ["floater", "floater"],
  ["hook", "hook"],
  ["dunk", "dunk"],
  ["layup", "layup"],
  ["tip", "layup"],
  ["jump shot", "catch_shoot"],
];

export function verbFor(action: string): ShotVerb {
  const a = action.toLowerCase();
  let best: ShotVerb = "pullup";
  let len = 0;
  for (const [needle, verb] of ACTION_VERBS) {
    if (a.includes(needle) && needle.length > len) { len = needle.length; best = verb; }
  }
  return best;
}

export interface Handoff {
  shot: [number, number];
  defender: [number, number] | null;
  verb: ShotVerb;
  /** how closely he was actually guarded at the release, in feet */
  contestFt: number | null;
}

/**
 * The situation the possession left behind: shooter on his release spot, the
 * defender who was really nearest to him on his, and the recorded action.
 *
 * Exported and pure so the handoff can be asserted without mounting a scene,
 * which matters here because this component cannot be screenshotted reliably.
 */
export function handoffScenario(clip: {
  lineup: { id: number; side: string }[];
  frames: number[][];
  shooterId: number;
  action: string;
}): Handoff | null {
  const si = clip.lineup.findIndex((p) => p.id === clip.shooterId);
  if (si < 0) return null;
  const f = clip.frames[clip.frames.length - 1];
  const at = (i: number): [number, number] => [f[P0 + i * 2], f[P0 + i * 2 + 1]];
  const shot = at(si);
  const side = clip.lineup[si].side;

  let defender: [number, number] | null = null;
  let best = Infinity;
  clip.lineup.forEach((p, i) => {
    if (p.side === side) return;
    const spot = at(i);
    const d = Math.hypot(spot[0] - shot[0], spot[1] - shot[1]);
    if (d < best) { best = d; defender = spot; }
  });

  return {
    shot,
    defender,
    verb: verbFor(clip.action),
    contestFt: defender ? Number(best.toFixed(2)) : null,
  };
}

export function TrackedPlay() {
  const clip = usePlaybackStore((s) => s.clip);
  const playing = usePlaybackStore((s) => s.playing);
  const speed = usePlaybackStore((s) => s.speed);
  const acc = useRef(0);
  const handed = useRef(false);

  const dots = useRef<(THREE.Mesh | null)[]>([]);
  const ring = useRef<THREE.Mesh>(null);
  const ball = useRef<THREE.Mesh>(null);

  useEffect(() => { handed.current = false; cursor.frame = 0; acc.current = 0; }, [clip]);

  /** Side and role decided once, so the render loop only moves things. */
  const marks = useMemo(() => {
    if (!clip) return [];
    const shooterSide = clip.lineup.find((p) => p.id === clip.shooterId)?.side;
    return clip.lineup.map((p) => ({
      attacking: p.side === shooterSide,
      isShooter: p.id === clip.shooterId,
    }));
  }, [clip]);

  const shooterIdx = marks.findIndex((m) => m.isShooter);

  useFrame((_, dt) => {
    if (!clip) return;
    const frames = clip.frames;

    if (playing) {
      acc.current += dt * CLIP_HZ * speed;
      if (acc.current >= 1) {
        cursor.frame += Math.floor(acc.current);
        acc.current %= 1;
        if (cursor.frame >= frames.length - 1) {
          cursor.frame = frames.length - 1;
          usePlaybackStore.getState().setPlaying(false);
        }
      }
    }

    const f = frames[Math.min(Math.max(cursor.frame, 0), frames.length - 1)];
    for (let i = 0; i < marks.length; i++) {
      const m = dots.current[i];
      if (m) m.position.set(f[P0 + i * 2], DOT_Y, f[P0 + i * 2 + 1]);
    }
    if (ring.current && shooterIdx >= 0) {
      ring.current.position.set(
        f[P0 + shooterIdx * 2], DOT_Y - 0.01, f[P0 + shooterIdx * 2 + 1],
      );
    }
    if (ball.current) ball.current.position.set(f[2], Math.max(f[4], 0.45), f[3]);

    // ---- the handoff -------------------------------------------------------
    // Once, at the last frame. Closing playback clears `replay` through the layer
    // rules, which unmounts this component, so it must never run twice.
    if (!handed.current && cursor.frame >= frames.length - 1) {
      handed.current = true;
      const h = handoffScenario(clip);
      if (h) {
        const s = useScenarioStore.getState();
        s.setShotType(h.verb);
        s.setPosition(h.shot[0], h.shot[1]);
        s.clearDefenders();
        if (h.defender) s.addDefender(h.defender[0], h.defender[1]);
      }
      usePlaybackStore.getState().close();
    }
  });

  if (!clip) return null;

  return (
    <group>
      {/* the shooter's ring sits under his marker so the marker stays legible */}
      {shooterIdx >= 0 && (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[DOT_R * 1.6, DOT_R * 1.95, 28]} />
          <meshBasicMaterial color="#35c26e" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      )}

      {marks.map((m, i) => (
        <mesh
          key={i}
          ref={(node) => { dots.current[i] = node; }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[m.isShooter ? DOT_R * 1.2 : DOT_R, 24]} />
          <meshBasicMaterial
            color={m.attacking ? TEAM.offense : TEAM.defense}
            transparent
            opacity={m.isShooter ? 1 : 0.84}
            depthWrite={false}
          />
        </mesh>
      ))}

      <mesh ref={ball}>
        <sphereGeometry args={[0.42, 16, 12]} />
        <meshBasicMaterial color="#f5b04b" />
      </mesh>
    </group>
  );
}
