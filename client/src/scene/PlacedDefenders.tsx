/**
 * PLACED DEFENDERS — the bodies the user puts on the floor.
 *
 * Three things were wrong with the old version and all of them mattered once
 * defenders became a real input rather than a slider.
 *
 * They were all the SAME MAN. One shared config meant five identical players in
 * identical stances, which reads as a formation rather than as defenders, and
 * made it impossible to tell which one you had just placed.
 *
 * They all stood the SAME WAY regardless of the situation. A defender eighteen
 * feet from the ball does not close out like one at three feet. The nearest man
 * now contests with a hand up; the rest sit in a normal stance.
 *
 * And the one the model reads was marked only by a floor ring, so nothing about
 * the BODY said which defender the number came from.
 *
 * The nearest defender is the production model's only contest input, so he is
 * marked clearly. The others still matter to the tracking study model through the
 * second distance and the help count, and they change the geometry the user is
 * reading, so they are not decoration.
 */
import { useMemo } from "react";
import { Player, makeArchetype } from "../player";
import { useScenarioStore } from "../scenario/scenarioStore";

/** A little variety so five defenders are five people, not one man copied. */
const LOOKS = [
  { skinTone: 5, hairStyle: "short" as const, height: 6.5 },
  { skinTone: 3, hairStyle: "curly" as const, height: 6.75 },
  { skinTone: 6, hairStyle: "bald" as const, height: 6.9 },
  { skinTone: 2, hairStyle: "short" as const, height: 6.3 },
  { skinTone: 7, hairStyle: "highTop" as const, height: 6.6 },
];

export function PlacedDefenders() {
  const defenders = useScenarioStore((s) => s.scenario.defenders);
  const shot = useScenarioStore((s) => s.scenario.shot);
  const derived = useScenarioStore((s) => s.derived)();

  // One config per slot, built once. Rebuilding a rig every frame would be a
  // rebuild of every mesh on the body.
  const configs = useMemo(
    () =>
      LOOKS.map((look, i) =>
        makeArchetype(i % 2 === 0 ? "SF" : "PF", {
          physical: { height: look.height },
          uniform: { kit: "away", number: String(i + 1) },
          appearance: {
            skinTone: look.skinTone,
            hairStyle: look.hairStyle,
            beard: i === 2 ? "full" : "none",
          },
        }),
      ),
    [],
  );

  const nearestId = useMemo(() => {
    if (!defenders.length) return null;
    let best = defenders[0];
    let bestD = Infinity;
    for (const d of defenders) {
      const dist = Math.hypot(d.x - shot.x, d.z - shot.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best.id;
  }, [defenders, shot.x, shot.z]);

  return (
    <group>
      {defenders.map((d, i) => {
        const dist = Math.hypot(d.x - shot.x, d.z - shot.z);
        const isNearest = d.id === nearestId;
        // Close and on the ball means a contest, hand up. Otherwise he is just
        // in a stance. This is the difference between five statues and defence.
        const contesting = isNearest && dist < 7;
        return (
          <group key={d.id}>
            <Player
              config={configs[i % configs.length]}
              position={[d.x, d.z]}
              lookAt={[shot.x, shot.z]}
              pose={contesting ? "contest" : "defensive"}
            />
            {isNearest && (
              <mesh position={[d.x, 0.02, d.z]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.5, 1.85, 48]} />
                <meshBasicMaterial
                  color="#eb5757"
                  transparent
                  opacity={0.8}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        );
      })}

      {/* The shot line, drawn from the shooter to the rim, so the ANGLE the
          tracking model reads is visible rather than a number in a panel. A
          defender standing on this line is the worst place for him to be. */}
      {defenders.length > 0 && (
        <mesh
          position={[(shot.x + -41.75) / 2, 0.015, shot.z / 2]}
          rotation={[-Math.PI / 2, 0, -Math.atan2(0 - shot.z, -41.75 - shot.x)]}
        >
          <planeGeometry args={[derived.distance, 0.16]} />
          <meshBasicMaterial
            color="#7c93ff"
            transparent
            opacity={0.32}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
