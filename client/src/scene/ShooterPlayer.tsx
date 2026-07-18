/**
 * SHOOTER — the interactive player at the shot spot. When a REAL roster player
 * is active, the 3D body is rebuilt from his measured height/wingspan and his
 * weight-mapped build (court, rim and body share one unit: feet). Firing a shot
 * runs the verb's full multi-phase timeline (gather → rise → release at the
 * jump apex → land) — the same releaseAt instant ShotArc launches the ball,
 * and his real max vertical scales the leap.
 */
import { useMemo } from "react";
import { useEffect } from "react";
import { makePlayer, DEFAULT_PLAYER, type CourtPosition } from "../player";
import { CharacterOrFallback } from "../player/GlbCharacter";
import { physiqueFromMeasure } from "../player/config/anthropometry";
import { sequenceKeyFor } from "../player/animation/sequences";
import { useShotStore } from "../state/shotStore";
import { usePlayersStore } from "../state/playersStore";
import { useCharacterStore } from "../state/characterStore";
import * as D from "../constants/dimensions";

const POS_MAP: Record<string, CourtPosition> = { G: "SG", F: "SF", C: "C" };
const LEAGUE_VERTICAL_IN = 32; // sequence jump heights are tuned to this

export function ShooterPlayer() {
  const x = useShotStore((s) => s.scenario.x);
  const z = useShotStore((s) => s.scenario.z);
  const verb = useShotStore((s) => s.scenario.shotType);
  const shootSignal = useShotStore((s) => s.shootSignal);
  const active = usePlayersStore((s) => s.active);
  const glbAvailable = useCharacterStore((s) => s.glbAvailable);
  const checkGlb = useCharacterStore((s) => s.check);
  useEffect(() => checkGlb(), [checkGlb]);

  const config = useMemo(() => {
    if (!active?.profile.height_in) return DEFAULT_PLAYER;
    const hIn = active.profile.height_in;
    const wingspanRatio = active.profile.wingspan_in
      ? active.profile.wingspan_in / hIn
      : 1.06;
    // build follows his REAL weight: Curry (185 lb) reads lean, Zion (284) massive
    const physique = active.profile.weight_lb
      ? physiqueFromMeasure(hIn, active.profile.weight_lb)
      : {};
    return makePlayer({
      id: String(active.id),
      name: active.name ?? `#${active.id}`,
      position: POS_MAP[active.position ?? "F"] ?? "SF",
      physical: { height: hIn / 12, wingspanRatio, ...physique },
      uniform: { number: "" }, // real jersey numbers aren't in the lookup — show none
    });
  }, [active]);

  // distance from the hoop drives leg load, lift and release angle
  const shotDistance = Math.hypot(x - D.basketX(-1), z);

  // his real vertical scales the leap (league-average vertical = 1.0)
  const jumpScale = (active?.profile.max_vertical_in ?? LEAGUE_VERTICAL_IN) / LEAGUE_VERTICAL_IN;

  return (
    <CharacterOrFallback
      glbAvailable={glbAvailable}
      config={config}
      position={[x, z]}
      lookAt={[D.basketX(-1), 0]}
      pose="idle"
      shotSignal={shootSignal}
      shotVerb={sequenceKeyFor(verb, x, z)}
      jumpScale={jumpScale}
      shotDistance={shotDistance}
      // the shooter holds the ball, so he is the one player who publishes hands
      tracksHands
    />
  );
}
