/**
 * JUMBOTRON — the centre-hung scoreboard. Four LED faces show LIVE app state:
 * the active shooter, the current shot's make probability and quality — redrawn
 * whenever the prediction changes (a real scoreboard, not a sticker).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import * as D from "../constants/dimensions";
import { useShotStore } from "../state/shotStore";
import { usePlayersStore } from "../state/playersStore";

const QUALITY_COLOR: Record<string, string> = {
  Excellent: "#35c26e", Good: "#6fcf97", Average: "#f2c94c",
  Poor: "#f2994a", "Very Poor": "#eb5757",
};

function draw(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  name: string,
  pct: string,
  quality: string,
) {
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, W, H);
  // LED bezel
  ctx.strokeStyle = "#26304a";
  ctx.lineWidth = 10;
  ctx.strokeRect(6, 6, W - 12, H - 12);

  ctx.textAlign = "center";
  ctx.fillStyle = "#8ea4f8";
  ctx.font = "700 34px ui-sans-serif, system-ui";
  ctx.fillText("KAIROS", W / 2, 52);

  ctx.fillStyle = "#e8ebf2";
  ctx.font = "800 44px ui-sans-serif, system-ui";
  ctx.fillText(name.toUpperCase(), W / 2, 116);

  ctx.fillStyle = QUALITY_COLOR[quality] ?? "#f2c94c";
  ctx.font = "900 96px ui-sans-serif, system-ui";
  ctx.fillText(pct, W / 2, 216);
  ctx.font = "700 30px ui-sans-serif, system-ui";
  ctx.fillText(quality.toUpperCase(), W / 2, 254);
}

export function Jumbotron() {
  const { canvas, ctx, texture } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 280;
    const ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, ctx, texture };
  }, []);

  // live redraw on prediction / shooter change
  useEffect(() => {
    const render = () => {
      const pred = useShotStore.getState().prediction;
      const who = usePlayersStore.getState().active?.name ?? "KAIROS PLAYER";
      draw(
        ctx, canvas.width, canvas.height, who,
        pred ? `${Math.round(pred.probability * 100)}%` : "--",
        pred?.quality ?? "",
      );
      texture.needsUpdate = true;
    };
    render();
    const un1 = useShotStore.subscribe(render);
    const un2 = usePlayersStore.subscribe(render);
    return () => { un1(); un2(); texture.dispose(); };
  }, [canvas, ctx, texture]);

  const cx = D.FLOOR_CENTER_X;
  const W = 16, H = 9, DEPTH = 16;

  return (
    <group position={[cx, 52, 0]}>
      {/* hanging truss */}
      <mesh position={[0, 14, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 20, 8]} />
        <meshStandardMaterial color="#20242e" roughness={0.6} metalness={0.5} />
      </mesh>
      {/* housing */}
      <mesh>
        <boxGeometry args={[DEPTH + 0.6, H + 1.2, DEPTH + 0.6]} />
        <meshStandardMaterial color="#12151d" roughness={0.55} metalness={0.35} />
      </mesh>
      {/* four LED faces */}
      {([0, 1, 2, 3] as const).map((i) => {
        const a = (i * Math.PI) / 2;
        const r = DEPTH / 2 + 0.32;
        return (
          <mesh key={i} position={[Math.sin(a) * r, 0, Math.cos(a) * r]} rotation={[0, a, 0]}>
            <planeGeometry args={[W, H]} />
            <meshBasicMaterial map={texture} toneMapped={false} />
          </mesh>
        );
      })}
      {/* under-belly LED ring */}
      <mesh position={[0, -(H / 2) - 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[DEPTH / 2 - 2, DEPTH / 2 - 0.8, 32]} />
        <meshBasicMaterial color="#3a4bb0" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
