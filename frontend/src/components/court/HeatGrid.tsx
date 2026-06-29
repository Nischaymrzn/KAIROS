import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useAppStore } from "@/store/useAppStore";

const TILE = 1.9;      // tile size (ft); grid step is 2 ft
const MAX_TILES = 512; // instanced-mesh capacity (grid is ~380)

/** Map a make probability to a red→amber→green tile colour. The model's grid
 * range is roughly 0.30–0.60, so we spread the ramp across that band. */
function probColor(p: number, c: THREE.Color): void {
  const t = Math.max(0, Math.min(1, (p - 0.3) / 0.3));
  c.setHSL(t * 0.33, 0.85, 0.5); // 0 = red, 0.33 = green
}

/**
 * Shot Explorer: a half-court heat map of the model's make probability for the
 * selected shot type + shooter, one instanced tile per sampled court point.
 */
export function HeatGrid() {
  const on = useAppStore((s) => s.explorerOn);
  const cells = useAppStore((s) => s.explorerCells);
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || cells.length === 0) return;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      dummy.position.set(c.x, 0.07, c.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      probColor(c.p, color);
      mesh.setColorAt(i, color);
    }
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [cells, dummy, color]);

  if (!on || cells.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_TILES]}>
      <planeGeometry args={[TILE, TILE]} />
      <meshBasicMaterial
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
        toneMapped={false}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
