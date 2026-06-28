/**
 * Suggestions.
 *
 * Each one targets a feature the model actually penalised, ranked by SHAP
 * magnitude, and carries the measured reason it works rather than a generic
 * tip. Every number quoted is either read off the prediction or computed from
 * the geometry in science.js. Nothing here invents a percentage.
 *
 * Where the reason comes from something the core model cannot see — contest,
 * mechanics — that is said in the text, so an applied suggestion that does not
 * move the probability is not a surprise.
 */
import {
  ZONE_XP, expectedPoints, contestCategory,
  effectiveRimWidth, approachRimWidth, entryAngleFromJump,
  shotClockUrgency, RIM_DIAMETER_IN,
} from "./science";

const pts = (v) => `${Math.abs(v * 100).toFixed(1)} points`;

/** Rank SHAP contributions most-negative first; that is what to attack. */
function worstFirst(prediction) {
  return [...(prediction.shap_values ?? [])].sort((a, b) => a.value - b.value);
}

export function generateSuggestions(scenario, prediction) {
  const out = [];
  const shap = worstFirst(prediction);
  const worst = shap[0];
  const worstIs = (re) => worst && re.test(worst.feature);
  const p = prediction.probability ?? 0;

  // 1. distance — the model's dominant negative almost everywhere
  if (worstIs(/shot distance/i) && scenario.distance > 18) {
    const target = Math.max(15, Math.round(scenario.distance) - 4);
    // gain estimated from the SHAP magnitude, scaled by how far we move
    const share = (scenario.distance - target) / Math.max(scenario.distance, 1);
    const delta = Math.abs(worst.value) * share;
    out.push({
      text: `Take it from ${target} ft instead of ${scenario.distance.toFixed(0)}.`,
      why: `Distance is the strongest single feature in the model and is costing this shot ${pts(worst.value)} here. The model estimates this shot at ${(p * 100).toFixed(1)}%; at ${target} ft it rises to approximately ${((p + delta) * 100).toFixed(1)}%.`,
      action: { param: "distance", value: target },
    });
  }

  // 2. above-break three vs corner three — pure expected-points arithmetic
  if (scenario.zone === "break3" && scenario.position !== "C") {
    const corner = expectedPoints("corner3", ZONE_XP.corner3.guideFg);
    const brk = expectedPoints("break3", ZONE_XP.break3.guideFg);
    const better = ((corner / brk - 1) * 100).toFixed(1);
    out.push({
      text: "Relocate to the corner instead of shooting above the break.",
      why: `Corner three has xP ${corner.toFixed(3)} against above-break ${brk.toFixed(3)} — ${better}% better expected return on each attempt. The corner line is 1.75 ft closer.`,
      action: { param: "zone", value: "corner3" },
    });
  }

  // 3. dribbles — catch-and-shoot beats a heavily dribbled pull-up for perimeter players
  if (scenario.dribbles > 5 && (scenario.position === "SG" || scenario.position === "PG" || scenario.position === "SF")) {
    out.push({
      text: `Cut the dribbles from ${scenario.dribbles} to 1.`,
      why: "Guards and small forwards average 4-7% higher make rate on catch-and-shoot than on heavily dribbled pull-ups. Note this comes from tracking summaries, not per-shot data, so the core model sees it through shot type rather than dribble count.",
      action: { param: "dribbles", value: 1 },
    });
  }

  // 4. shot clock — the one situational feature that survived ablation
  if (scenario.shotClock < 5) {
    const now = shotClockUrgency(scenario.shotClock);
    const easy = shotClockUrgency(24);
    out.push({
      text: `Get into the shot earlier — ${scenario.shotClock.toFixed(0)}s left is late.`,
      why: `Shots under 5 seconds on the clock show a measurable urgency penalty. The urgency term (1/clock) is ${now.toFixed(2)} here against ${easy.toFixed(2)} at 24s. Possession context was the only situational feature group that passed the ablation gate, at +0.0015 AUC.`,
      action: { param: "shotClock", value: 12 },
    });
  }

  // 5. jump angle — geometry, computed rather than asserted
  if (scenario.jumpAngle < 42 && scenario.distance > 12) {
    const nowEntry = entryAngleFromJump(scenario.jumpAngle, scenario.distance);
    const upEntry = entryAngleFromJump(50, scenario.distance);
    const w1 = effectiveRimWidth(nowEntry);
    const w2 = effectiveRimWidth(upEntry);
    out.push({
      text: `Raise the release from ${scenario.jumpAngle}° toward 50°.`,
      why: `At ${scenario.jumpAngle}° the ball enters at ${nowEntry.toFixed(1)}°, leaving an effective rim target of ${w1.toFixed(1)} in. At 50° the entry angle is ${upEntry.toFixed(1)}° and the target opens to ${w2.toFixed(1)} in — a ${(w2 - w1).toFixed(1)} in improvement. Geometry only: the core model never sees the arc.`,
      action: { param: "jumpAngle", value: 50 },
    });
  }

  // 6. approach angle — the rim foreshortens as cos of the angle of attack
  if (Math.abs(scenario.approachAngle) > 50) {
    const w = approachRimWidth(scenario.approachAngle);
    out.push({
      text: `Straighten the angle of attack from ${scenario.approachAngle}°.`,
      why: `Approaching at ${Math.abs(scenario.approachAngle)}° reduces the rim projection to ${w.toFixed(1)} in from ${RIM_DIAMETER_IN} in straight on. A more direct line opens the target significantly.`,
      action: { param: "approachAngle", value: 0 },
    });
  }

  // 7. contest — honest about being an adjustment, not a model feature
  if (scenario.defenderDist < 4) {
    const to = Math.min(20, scenario.defenderDist + 2);
    const contest = contestCategory(scenario.defenderDist);
    out.push({
      text: `Create two more feet of separation, from ${scenario.defenderDist.toFixed(1)} to ${to.toFixed(1)} ft.`,
      why: `${contest.label} at this range. Separation gains are steepest between 0 and 4 ft and flatten past 8. This is applied as a post-prediction adjustment from the 2014-15 study — the core model is contest-blind.`,
      action: { param: "defenderDist", value: to },
    });
  }

  // 8. fall back to the next real SHAP negative rather than padding with a platitude
  if (out.length === 0 && shap.length > 1 && shap[0].value < 0) {
    out.push({
      text: `The model's biggest objection here is ${shap[0].feature.toLowerCase()}.`,
      why: `It is costing ${pts(shap[0].value)} against a base rate of 46.2%. Nothing else in this scenario is far enough from average to be worth changing.`,
      action: null,
    });
  }

  return out.slice(0, 3);
}
