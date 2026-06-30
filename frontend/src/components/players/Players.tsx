import { Player } from "./Player";
import { useAppStore } from "@/store/useAppStore";
import { PLAYERS } from "@/lib/dummyData";
import { basketX } from "@/lib/courtDimensions";
import type { Player as PlayerT } from "@/lib/types";

const BX = basketX(-1);

// generic defender body
const DEFENDER: PlayerT = {
  id: 8, name: "Defender", team: "AWY", jersey: 0, position: "F", heightIn: 79,
  jerseyColor: "#b51e34", accentColor: "#ece5da",
  catchShootRate: 0, pullUpRate: 0, drivesPerGame: 0,
};

/** Shooter (holding the ball) + any manually-placed defenders. */
export function Players() {
  const scenario = useAppStore((s) => s.scenario);
  const defenders = useAppStore((s) => s.defenders);
  const shooter = PLAYERS.find((p) => p.id === scenario.playerId) ?? PLAYERS[0];
  const { x, z } = scenario.position;
  const faceBasket = Math.atan2(BX - x, 0 - z);

  return (
    <group>
      <Player
        player={shooter}
        position={[x, z]}
        facing={faceBasket}
        shotType={scenario.shotType}
        holdsBall
        highlight
      />
      {defenders.map((d, i) => (
        <Player
          key={i}
          player={DEFENDER}
          position={[d.x, d.z]}
          facing={Math.atan2(x - d.x, z - d.z)}
          defender
        />
      ))}
    </group>
  );
}
