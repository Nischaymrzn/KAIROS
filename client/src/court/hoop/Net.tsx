import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import * as D from "../../constants/dimensions";
import { COLORS } from "../../constants/theme";
import { netImpact } from "../../scene/netImpact";

/**
 * NET — a hanging diamond weave with real thickness, and it moves when the ball
 * goes through.
 *
 * Was line segments, which render one pixel wide at any distance and read as a
 * wireframe rather than cord. Each strand is now an instanced cylinder, so the
 * net has visible thickness and catches the court light. ~230 instances in one
 * draw call.
 *
 * Motion: the rim ring is fixed, lower rings are displaced by an impulse that
 * decays over about half a second. Instance matrices are only rewritten while
 * that impulse is alive, so a hanging net costs nothing per frame.
 */
const STRANDS = 12;
const LEVELS = 9;
const DROP = 1.45;
const CORD_R = 0.018;

function restRing(level: number) {
  const t = level / (LEVELS - 1);
  const topR = D.RIM_RADIUS * 0.96;
  const botR = 0.33;
  // taper fast at first, then hold: the classic pinch just below the rim
  const r = topR + (botR - topR) * Math.pow(t, 0.7);
  const y = -DROP * Math.pow(t, 0.92);
  return { r, y };
}

export function Net() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const decay = useRef(0);

  const { nodes, links, count } = useMemo(() => {
    const nodes: THREE.Vector3[][] = [];
    for (let l = 0; l < LEVELS; l++) {
      const { r, y } = restRing(l);
      const row: THREE.Vector3[] = [];
      for (let i = 0; i < STRANDS; i++) {
        const a = (i / STRANDS) * Math.PI * 2;
        row.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      nodes.push(row);
    }

    const links: [number, number, number, number][] = [];
    for (let l = 0; l < LEVELS - 1; l++) {
      for (let i = 0; i < STRANDS; i++) {
        const j = (i + 1) % STRANDS;
        links.push([l, i, l + 1, j]);
        links.push([l, j, l + 1, i]);
      }
    }
    for (const l of [0, 4, LEVELS - 1]) {
      for (let i = 0; i < STRANDS; i++) links.push([l, i, l, (i + 1) % STRANDS]);
    }
    return { nodes, links, count: links.length };
  }, []);

  const geo = useMemo(() => new THREE.CylinderGeometry(CORD_R, CORD_R, 1, 5, 1), []);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: COLORS.netColor, roughness: 0.85, metalness: 0 }),
    []
  );
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  // scratch objects, reused every rebuild
  const scratch = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      mid: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      q: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
      live: nodes.map((row) => row.map((v) => v.clone())),
    }),
    [nodes]
  );

  const rebuild = () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const s = scratch;
    for (let k = 0; k < count; k++) {
      const [l0, i0, l1, i1] = links[k];
      s.a.copy(s.live[l0][i0]);
      s.b.copy(s.live[l1][i1]);
      s.mid.addVectors(s.a, s.b).multiplyScalar(0.5);
      s.dir.subVectors(s.b, s.a);
      const len = s.dir.length() || 1e-4;
      s.dir.divideScalar(len);
      s.q.setFromUnitVectors(s.up, s.dir);
      s.scale.set(1, len, 1);
      s.m.compose(s.mid, s.q, s.scale);
      mesh.setMatrixAt(k, s.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  useEffect(rebuild, [count]);

  useFrame((_, dt) => {
    if (netImpact.pending) {
      netImpact.pending = false;
      decay.current = 1;
    }
    if (decay.current <= 0) return;

    decay.current = Math.max(decay.current - dt * 2.2, 0);
    const s = scratch;
    const e = decay.current;
    // a ball through the middle pushes the lower rings out and down, then the
    // net swings back; the rim ring never moves because it is tied to the hooks
    const swing = Math.sin(e * Math.PI * 3) * e * e;
    for (let l = 0; l < LEVELS; l++) {
      const grip = l / (LEVELS - 1);
      const rest = nodes[l];
      for (let i = 0; i < STRANDS; i++) {
        const p = s.live[l][i];
        p.copy(rest[i]);
        if (l === 0) continue;
        const out = 1 + swing * 0.35 * grip;
        p.x = rest[i].x * out;
        p.z = rest[i].z * out;
        p.y = rest[i].y - swing * 0.22 * grip;
      }
    }
    rebuild();
    if (decay.current === 0) rebuild();
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geo, mat, count]}
      position={[0, D.RIM_HEIGHT, 0]}
      castShadow
    />
  );
}
