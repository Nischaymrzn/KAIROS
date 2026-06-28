import type { ThreeEvent } from "@react-three/fiber";
import { useAppStore } from "@/store/useAppStore";
import { COURT_WIDTH, HALF_LENGTH } from "@/lib/courtDimensions";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Invisible half-court catcher: click to place the shooter or a defender. */
export function ClickPlane() {
  const setPosition = useAppStore((s) => s.setPosition);
  const addDefender = useAppStore((s) => s.addDefender);
  const placeMode = useAppStore((s) => s.placeMode);

  const handle = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const x = clamp(e.point.x, -46, -2);
    const z = clamp(e.point.z, -23, 23);
    if (placeMode === "shooter") setPosition({ x, z });
    else addDefender({ x, z });
  };

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[-HALF_LENGTH / 2, 0.03, 0]}
      onPointerDown={handle}
    >
      <planeGeometry args={[HALF_LENGTH, COURT_WIDTH]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
