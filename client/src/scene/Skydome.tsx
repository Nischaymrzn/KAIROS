import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { COLORS } from "../constants/theme";

/**
 * SKYDOME — a large inward-facing sphere with a soft vertical gradient (dark at the
 * top, a touch lighter toward the horizon). It surrounds the whole scene so there
 * is never raw black behind the court from any orbit angle — the "arena is dark"
 * look of an NBA 2K-style viewer. The real arena geometry will sit inside it later.
 */
function createGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, COLORS.skyHorizon); // sphere bottom (v=0) → horizon
  g.addColorStop(0.45, COLORS.skyHorizon);
  g.addColorStop(1.0, COLORS.skyTop); // sphere top (v=1) → darkest
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function Skydome() {
  const texture = useMemo(() => createGradientTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh scale={[-1, 1, 1]} renderOrder={-1}>
      {/* big radius so parallax is negligible → reads as a static environment */}
      <sphereGeometry args={[480, 32, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}
