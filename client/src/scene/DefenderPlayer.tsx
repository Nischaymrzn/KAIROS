/**
 * DEFENDER — a second rig in a defensive stance, placed ON the shooter→rim line
 * at exactly the store's defenderDistance (the same number fed to the model's
 * contest features). Away kit so the matchup reads instantly.
 */
import { useMemo } from "react";
import { Player, makeArchetype } from "../player";
import * as D from "../constants/dimensions";
import { useShotStore } from "../state/shotStore";

export function DefenderPlayer() {
  const x = useShotStore((s) => s.scenario.x);
  const z = useShotStore((s) => s.scenario.z);
  const dist = useShotStore((s) => s.scenario.defenderDistance);

  const config = useMemo(
    () =>
      makeArchetype("SF", {
        uniform: { kit: "away", number: "" },
        appearance: { skinTone: 5 },
      }),
    []
  );

  if (dist == null) return null;

  // stand `dist` feet from the shooter, toward the rim
  const rim = { x: D.basketX(-1), z: 0 };
  const dx = rim.x - x;
  const dz = rim.z - z;
  const len = Math.hypot(dx, dz) || 1;
  const px = x + (dx / len) * dist;
  const pz = z + (dz / len) * dist;

  return (
    <Player config={config} position={[px, pz]} lookAt={[x, z]} pose="defensive" />
  );
}
