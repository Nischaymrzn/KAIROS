/**
 * BASKETBALL — regulation size (9.5 in diameter, 0.79 ft), pebbled leather.
 *
 * What changed and why:
 *
 * The ball was a flat orange sphere at 24 segments with three torus seams. Two
 * problems. A basketball is covered in raised pebbling, and without it the ball
 * catches light like a billiard ball, which is the single most noticeable wrong
 * thing about a rendered basketball. And the seams were three great circles,
 * which is not the layout of a real ball: a real one has two circles crossing at
 * the poles plus two curved side seams, giving the eight panels everyone has
 * seen since childhood even if they have never counted them.
 *
 * The pebbling is a generated bump map rather than geometry, so it costs one
 * small texture and no triangles. It is the roughness AND the normal, because
 * pebbling changes both how rough the surface is and which way it faces.
 */
import { forwardRef, useMemo } from "react";
import * as THREE from "three";

export const BALL_RADIUS = 9.5 / 12 / 2; // feet

/** Pebbled leather: dense round bumps with a little size variation. */
function pebbleTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, S, S);

  // Poisson-ish scatter: a jittered grid reads as organic where a plain grid
  // reads as a waffle.
  const step = 7;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const px = x + (Math.random() - 0.5) * step * 0.8;
      const py = y + (Math.random() - 0.5) * step * 0.8;
      const r = step * (0.26 + Math.random() * 0.12);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, "#f2f2f2");
      g.addColorStop(0.65, "#9a9a9a");
      g.addColorStop(1, "#6b6b6b");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 3);
  return t;
}

export const Basketball = forwardRef<THREE.Group, { visible?: boolean }>(
  function Basketball({ visible = true }, ref) {
    const { body, seam, pebble } = useMemo(() => {
      const pebble = pebbleTexture();
      const body = new THREE.MeshStandardMaterial({
        color: "#c8611f",
        roughness: 0.94,
        metalness: 0,
        bumpMap: pebble,
        bumpScale: 0.0035,
        roughnessMap: pebble,
      });
      const seam = new THREE.MeshStandardMaterial({ color: "#241610", roughness: 0.85 });
      return { body, seam, pebble };
    }, []);

    // Two seams through the poles, and two side seams offset from the equator.
    // That is the eight-panel layout of a real ball; three great circles is not.
    const ring = useMemo(
      () => new THREE.TorusGeometry(BALL_RADIUS * 1.004, BALL_RADIUS * 0.028, 8, 64),
      [],
    );
    const sideSeam = useMemo(
      () => new THREE.TorusGeometry(BALL_RADIUS * 0.86, BALL_RADIUS * 0.026, 8, 56),
      [],
    );

    void pebble;

    return (
      <group ref={ref} visible={visible}>
        <mesh material={body} castShadow receiveShadow>
          <sphereGeometry args={[BALL_RADIUS, 40, 32]} />
        </mesh>

        {/* the two seams crossing at the poles */}
        <mesh geometry={ring} material={seam} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={ring} material={seam} rotation={[Math.PI / 2, Math.PI / 2, 0]} />

        {/* the two curved side seams, set off the equator on each side */}
        <mesh
          geometry={sideSeam}
          material={seam}
          position={[0, BALL_RADIUS * 0.5, 0]}
        />
        <mesh
          geometry={sideSeam}
          material={seam}
          position={[0, -BALL_RADIUS * 0.5, 0]}
        />
      </group>
    );
  },
);
