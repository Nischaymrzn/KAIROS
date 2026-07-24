/**
 * COACH — the four decisions a coach actually makes about a shot.
 *
 * This was a suggestion list beside a percentage, which is a player's view: it
 * answers "how do I make this one better". A coach is not taking the shot. He is
 * choosing which shot his team takes, teaching how to take it, and deciding what
 * to give up at the other end. So the screen is built around those questions:
 *
 *   WORTH TAKING?   expected points against the alternatives from this spot. Not
 *                   make percentage, because a 38% three beats a 48% long two and
 *                   make percentage says the opposite.
 *   BEST OPTION     the measured alternatives, each one click away.
 *   HOW TO TAKE IT  measured delivery from tracked releases: hold time and feet.
 *   WHAT TO GIVE UP the contest grid, which says where pressure actually pays.
 *
 * The delivery and give-up sections are OBSERVED outcomes over 19,022 tracked
 * 2015-16 releases, not model output. The model answers what a shot is worth;
 * only tracking can answer how it should be taken, and keeping the two visually
 * separate is why each section names its own source.
 */
import { useEffect, useState } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { ZONE_BASE, ZONE_LABEL } from "../../scenario/schema";
import { buildAdvice, Tip } from "../../game/advice";
import { getDelivery, getGamePlan, type Delivery, type GamePlan } from "../../api";

/** A make rate rendered as a bar, so a column of them compares at a glance. */
function Rate({ cell, best }: { cell?: { makeRate: number; n: number }; best: number }) {
  if (!cell) return <span className="cx-none">too few</span>;
  return (
    <span className="cx-rate" title={`${cell.n.toLocaleString()} tracked shots`}>
      <span className="cx-bar" style={{ width: `${(cell.makeRate / best) * 100}%` }} />
      <b>{(cell.makeRate * 100).toFixed(0)}%</b>
    </span>
  );
}

export function CoachPanel() {
  const scenario = useScenarioStore((s) => s.scenario);
  const prediction = useScenarioStore((s) => s.prediction);
  const derived = useScenarioStore((s) => s.derived)();

  const [tips, setTips] = useState<Tip[]>([]);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [plan, setPlan] = useState<GamePlan | null>(null);

  const base = prediction?.probability ?? null;
  const contest = derived.contest.closest;
  const dist = derived.distance;

  // ---- suggestions, measured by re-scoring one change at a time -------------
  useEffect(() => {
    if (base == null) return;
    let dead = false;
    const ctrl = new AbortController();
    setBusy(true);
    const t = setTimeout(async () => {
      const out = await buildAdvice({
        scenario, base, distance: dist, nearestDefender: contest,
        signal: ctrl.signal, store: useScenarioStore.getState(),
      });
      if (!dead) { setTips(out.slice(0, 4)); setBusy(false); }
    }, 320);
    return () => { dead = true; clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, scenario.shot.x, scenario.shot.z, scenario.shot.shotType,
      scenario.game.shotClock, contest]);

  // ---- the tracked corpus, for delivery and for what to concede ------------
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      getDelivery(dist, ctrl.signal).then(setDelivery).catch(() => setDelivery(null));
      getGamePlan(dist, contest, ctrl.signal).then(setPlan).catch(() => setPlan(null));
    }, 280);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [dist, contest]);

  const zoneRate = ZONE_BASE[derived.zone].rate;
  const xp = base != null ? base * derived.points : null;
  const zoneXp = zoneRate * derived.points;

  const holdBest = delivery
    ? Math.max(...Object.values(delivery.hold.rows).map((r) => r.makeRate), 0.01)
    : 1;
  const feetBest = delivery
    ? Math.max(...Object.values(delivery.feet.rows).map((r) => r.makeRate), 0.01)
    : 1;

  return (
    <div className="coach">
      {/* ---- is this worth taking ------------------------------------------ */}
      <div className="coach-now">
        <div className="coach-pct">{base != null ? `${Math.round(base * 100)}%` : "·"}</div>
        <div className="coach-sub">
          make probability
          <br />
          {ZONE_LABEL[derived.zone]} · {dist.toFixed(0)} ft · {derived.points} pt
          <br />
          <span className={base != null && base > zoneRate ? "up" : "down"}>
            {base != null
              ? `${base > zoneRate ? "+" : ""}${Math.round((base - zoneRate) * 100)} vs this zone`
              : ""}
          </span>
        </div>
      </div>

      {/* Expected points is the number that compares a two with a three, so it is
          worth showing, but only beside the zone rate. Alone it is unreadable. */}
      <div className="coach-xp">
        <b>{xp != null ? xp.toFixed(2) : "·"}</b>
        <span>expected points</span>
        <em>
          {zoneXp != null ? `league ${zoneXp.toFixed(2)} from here` : ""}
        </em>
      </div>

      {/* ---- what to run instead ------------------------------------------- */}
      <div className="coach-label">Better option from here</div>
      {busy && <div className="coach-wait">testing changes</div>}
      {!busy && tips.length === 0 && (
        <div className="coach-none">Nothing improves this one. Good look.</div>
      )}
      {tips.map((t) => (
        <button key={t.id} className="coach-tip" onClick={t.apply}>
          <span className="coach-gain">+{Math.round(t.delta * 100)}</span>
          <span className="coach-text">
            <strong>{t.label}</strong>
            <em>{t.why}</em>
          </span>
        </button>
      ))}

      {/* ---- how it should be taken ---------------------------------------- */}
      {delivery && (
        <>
          <div className="coach-label">
            How to take it <span className="cx-src">tracked</span>
          </div>

          <div className="cx-block">
            <div className="cx-head">
              <span>Ball in hand</span>
              {delivery.hold.swingPts != null && (
                <b className={delivery.hold.swingPts > 0 ? "up" : "down"}>
                  {delivery.hold.swingPts > 0 ? "+" : ""}{delivery.hold.swingPts} pts
                </b>
              )}
            </div>
            {delivery.hold.bands.map((b) => (
              <div key={b.key} className="cx-row">
                <span>{b.label}</span>
                <Rate cell={delivery.hold.rows[b.key]} best={holdBest} />
              </div>
            ))}
          </div>

          <div className="cx-block">
            <div className="cx-head">
              <span>Feet at release</span>
              {delivery.feet.swingPts != null && (
                <b className={delivery.feet.swingPts > 0 ? "up" : "down"}>
                  {delivery.feet.swingPts > 0 ? "+" : ""}{delivery.feet.swingPts} pts
                </b>
              )}
            </div>
            {delivery.feet.bands.map((b) => (
              <div key={b.key} className="cx-row">
                <span>{b.label}</span>
                <Rate cell={delivery.feet.rows[b.key]} best={feetBest} />
              </div>
            ))}
          </div>

          {/* The one finding worth saying in words, because a coach teaching two
              different things at two ends of the floor needs to know it is not a
              contradiction. */}
          {delivery.inversion.rimSetVsMoving != null &&
           delivery.inversion.threeSetVsMoving != null && (
            <div className="cx-note">
              Momentum helps at the rim and hurts from range. Set feet are worth{" "}
              <b>{delivery.inversion.threeSetVsMoving} pts</b> on a three and{" "}
              <b>{Math.abs(delivery.inversion.rimSetVsMoving)} pts</b> against you at
              the rim.
            </div>
          )}
        </>
      )}

      {/* ---- what to concede at the other end ------------------------------- */}
      {plan?.contestValuePts != null && plan.rimContestValuePts != null && (
        <>
          <div className="coach-label">
            What to contest <span className="cx-src">tracked</span>
          </div>
          <div className="cx-note">
            Closing out here is worth <b>{plan.contestValuePts} pts</b>, against{" "}
            <b>{plan.rimContestValuePts}</b> at the rim. Pressure buys far more
            further out, so help off the arc last.
          </div>
        </>
      )}

      {delivery && (
        <div className="pn-note">
          {delivery.totalPlays.toLocaleString()} tracked 2015-16 releases. Outcomes,
          not predictions.
        </div>
      )}
    </div>
  );
}
