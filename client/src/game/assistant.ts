/**
 * COACH ASSISTANT — answers questions from the model and the tracked corpus.
 *
 * WHAT THIS IS, PLAINLY. It is not a language model and it does not pretend to be
 * one. There is no LLM credential in this project, and wiring the UI to sound like
 * a chatbot while inventing basketball advice would be the single most dishonest
 * thing this codebase could do: every other number on screen is measured, and a
 * confident sentence with nothing behind it would poison all of them by
 * association.
 *
 * What it is instead: a question router over the same engines the panels use.
 * Every answer is produced by asking the trained model or the 2015-16 tracked
 * corpus and reporting what came back, with the figure attached. If a question
 * does not map to something measurable, it says so and lists what it can answer,
 * rather than guessing.
 *
 * That constraint is what makes it worth having. "Is this a good shot?" answered
 * with the model's own probability against the league rate from that zone is
 * useful precisely because it cannot drift from what the rest of the app says.
 */
import { rankShots, getGamePlan, getDelivery, isAbort } from "../api";
import type { Scenario } from "../scenario/schema";
import { ZONE_BASE, ZONE_LABEL, zoneOf } from "../scenario/schema";

export interface Answer {
  /** the reply, already phrased */
  text: string;
  /** where the number came from, shown as a tag */
  source: "model" | "tracked" | "none";
  /** follow-ups worth offering after this answer */
  followUps?: string[];
}

export interface AskContext {
  scenario: Scenario;
  distance: number;
  probability: number | null;
  defenderFt: number | null;
  signal?: AbortSignal;
}

const VERB_LABEL: Record<string, string> = {
  dunk: "dunk", driving_layup: "driving layup", layup: "layup",
  floater: "floater", hook: "hook", catch_shoot: "catch and shoot",
  pullup: "pull-up", stepback: "step-back", fadeaway: "fadeaway",
};

/** Every question the assistant can actually answer, offered up front. */
export const SUGGESTIONS = [
  "Is this a good shot?",
  "What should I shoot from here?",
  "How should he take it?",
  "How do I defend this?",
  "Does the defender matter here?",
  "What do teams run from here?",
];

interface Intent {
  id: string;
  /** every term must appear for the intent to match */
  all?: string[];
  /** any one term is enough */
  any: string[];
  run(c: AskContext): Promise<Answer>;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

const INTENTS: Intent[] = [
  // ---- is this worth taking --------------------------------------------------
  {
    id: "quality",
    any: ["good shot", "worth", "should i shoot", "is this good", "quality", "bad shot"],
    async run(c) {
      if (c.probability == null) {
        return { text: "No prediction on screen yet. Place a shooter first.", source: "none" };
      }
      const zone = zoneOf(c.scenario);
      const base = ZONE_BASE[zone];
      const edge = c.probability - base.rate;
      const xp = c.probability * base.points;
      const leagueXp = base.rate * base.points;
      const verdict =
        edge > 0.03 ? "Better than a normal look from there."
        : edge < -0.03 ? "Worse than a normal look from there."
        : "About what that spot usually returns.";
      return {
        source: "model",
        text: `${pct(c.probability)} from ${ZONE_LABEL[zone]}, against a league ${pct(base.rate)}. `
          + `${verdict} In points that is ${xp.toFixed(2)} against ${leagueXp.toFixed(2)}.`,
        followUps: ["What should I shoot from here?", "How should he take it?"],
      };
    },
  },

  // ---- which action ----------------------------------------------------------
  {
    id: "which",
    any: ["what should i shoot", "which shot", "best shot", "what shot", "options", "instead"],
    async run(c) {
      const r = await rankShots({
        x: c.scenario.shot.x, z: c.scenario.shot.z,
        playerId: c.scenario.player.playerId,
        positionGroup: c.scenario.player.positionGroup,
        quarter: c.scenario.game.quarter,
        shotClock: c.scenario.game.shotClock,
        scoreMargin: c.scenario.game.scoreMargin,
        defenderDistance: c.defenderFt ?? undefined,
      }, c.signal);
      const top = r.ranked.slice(0, 3);
      if (!top.length) return { text: "The model returned no ranking for that spot.", source: "none" };
      const list = top
        .map((t) => `${VERB_LABEL[t.shot_type] ?? t.shot_type} ${t.expected_points.toFixed(2)}`)
        .join(", ");
      const current = r.ranked.find((t) => t.shot_type === c.scenario.shot.shotType);
      const gap = current ? top[0].expected_points - current.expected_points : 0;
      return {
        source: "model",
        text: `Ranked by expected points: ${list}. `
          + (gap > 0.04
            ? `You have a ${VERB_LABEL[c.scenario.shot.shotType] ?? c.scenario.shot.shotType} selected, which is ${gap.toFixed(2)} points behind the best option.`
            : `Your current selection is already at or near the top.`),
        followUps: ["How should he take it?", "How do I defend this?"],
      };
    },
  },

  // ---- delivery --------------------------------------------------------------
  {
    id: "how",
    any: ["how should", "how do i take", "technique", "deliver", "footwork", "feet", "catch and shoot", "quick"],
    async run(c) {
      const d = await getDelivery(c.distance, c.signal);
      const hold = d.hold.swingPts;
      const feet = d.feet.swingPts;
      if (hold == null && feet == null) {
        return { text: `Not enough tracked shots from ${d.bandLabel.toLowerCase()} to say.`, source: "tracked" };
      }
      const bits: string[] = [];
      if (hold != null) {
        bits.push(hold > 0
          ? `getting it off inside four tenths of a second is worth ${hold} points over holding it`
          : `holding it is worth ${Math.abs(hold)} points over a quick release here`);
      }
      if (feet != null) {
        bits.push(feet > 0
          ? `and being set is worth ${feet} points over shooting on the move`
          : `and momentum into the shot is worth ${Math.abs(feet)} points over being set`);
      }
      return {
        source: "tracked",
        text: `From ${d.bandLabel.toLowerCase()}, ${bits.join(", ")}. `
          + `Measured over ${d.totalPlays.toLocaleString()} tracked releases.`,
        followUps: ["How do I defend this?", "Is this a good shot?"],
      };
    },
  },

  // ---- defending -------------------------------------------------------------
  {
    id: "defend",
    any: ["defend", "defence", "defense", "contest", "close out", "closeout", "stop"],
    async run(c) {
      const p = await getGamePlan(c.distance, c.defenderFt, c.signal);
      if (p.contestValuePts == null || p.rimContestValuePts == null) {
        return { text: "Not enough tracked shots at this range to price a contest.", source: "tracked" };
      }
      return {
        source: "tracked",
        text: `Closing out here is worth ${p.contestValuePts} points, against `
          + `${p.rimContestValuePts} at the rim. Pressure buys far more the further out `
          + `you are, so if you have to help off someone, help off the arc last.`,
        followUps: ["What do teams run from here?", "Does the defender matter here?"],
      };
    },
  },

  // ---- does contest move the number -----------------------------------------
  {
    id: "sensitivity",
    any: ["defender matter", "does the defender", "contest matter", "how much does the defender"],
    async run(c) {
      const p = await getGamePlan(c.distance, c.defenderFt, c.signal);
      const here = c.defenderFt;
      const state = here == null
        ? "Nobody is on the floor, so this is scoring as an open look."
        : `The nearest defender is ${here.toFixed(1)} ft away.`;
      if (p.contestValuePts == null) {
        return { text: `${state} Not enough tracked shots here to price it.`, source: "tracked" };
      }
      return {
        source: "tracked",
        text: `${state} Across tracked shots from ${p.bandLabel.toLowerCase()}, the gap between `
          + `tightly guarded and open is ${p.contestValuePts} points of make rate. `
          + `The model reads the nearest defender only.`,
        followUps: ["How do I defend this?"],
      };
    },
  },

  // ---- what teams ran --------------------------------------------------------
  {
    id: "teams",
    any: ["teams run", "what do teams", "real plays", "what happens", "tracked", "film"],
    async run(c) {
      const p = await getGamePlan(c.distance, c.defenderFt, c.signal);
      if (!p.observed) {
        return { text: "No tracked shots match this distance and contest.", source: "tracked" };
      }
      return {
        source: "tracked",
        text: `${p.bandLabel}, ${p.contestLabel.toLowerCase()}: real players made `
          + `${pct(p.observed.makeRate)} over ${p.observed.n.toLocaleString()} tracked shots. `
          + `Open the Playbook tab to watch the possessions that match.`,
        followUps: ["How do I defend this?", "How should he take it?"],
      };
    },
  },
];

/** Route a question to the engine that can answer it. */
export async function ask(qRaw: string, c: AskContext): Promise<Answer> {
  const q = qRaw.toLowerCase().trim();
  if (!q) return { text: "Ask me about the shot on the floor.", source: "none" };

  let hit: Intent | undefined;
  let bestLen = 0;
  for (const i of INTENTS) {
    if (!(i.all ?? []).every((k) => q.includes(k))) continue;
    for (const k of i.any) {
      if (q.includes(k) && k.length > bestLen) {
        bestLen = k.length;
        hit = i;
      }
    }
  }

  if (!hit) {
    return {
      source: "none",
      text: "I answer from the model and the tracked 2015-16 corpus, so I only take "
        + "questions those can actually settle. Try one of these.",
      followUps: SUGGESTIONS,
    };
  }

  try {
    return await hit.run(c);
  } catch (e) {
    if (isAbort(e)) return { text: "", source: "none" };
    return { text: "That lookup failed. The API may be down.", source: "none" };
  }
}
