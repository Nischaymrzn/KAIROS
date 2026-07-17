/**
 * HEAT OVERLAY — InstancedMesh of flat squares rendered on the court floor, one
 * per cell from /explore. Color encodes probability: cold blue (low) → warm red
 * (high). Uses instanced rendering so 100–300 cells cost a single draw call.
 *
 * Mounted as a sibling of <Court/> inside the scene group. The overlay is only
 * visible when `visible` prop is true (toggled by the Analytics panel).
 */
import { useEffect, useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAnalyticsStore } from "../state/analyticsStore";
import { rateColor } from "../viz/palette";

const CELL_SIZE = 2.8; // feet — matches step=3 with slight overlap for no gaps
const dummy = new THREE.Object3D();

function probToColor(p: number): THREE.Color {
  return new THREE.Color(rateColor(Math.max(0, Math.min(1, p))));
}

interface Props { visible: boolean }

export function HeatOverlay({ visible }: Props) {
  const cells = useAnalyticsStore((s) => s.heatCells);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const opacityRef = useRef(0);

  const count = Math.max(cells.length, 1); // instanced mesh needs count ≥ 1
  const geometry = useMemo(() => new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    []
  );

  // update instance transforms + colors when cells change
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || cells.length === 0) return;
    cells.forEach((c, i) => {
      dummy.position.set(c.x, 0.03, c.z);
      dummy.rotation.x = -Math.PI / 2;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, probToColor(c.probability));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [cells]);

  // smooth fade in/out
  useFrame((_, dt) => {
    const target = visible && cells.length > 0 ? 0.62 : 0;
    opacityRef.current += (target - opacityRef.current) * Math.min(dt * 6, 1);
    material.opacity = opacityRef.current;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />
  );
}
