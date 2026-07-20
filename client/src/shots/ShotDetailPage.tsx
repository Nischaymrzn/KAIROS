/**
 * SHOT DETAIL — the ONE template every shot type renders through.
 *
 * The brief requires that "every shot page includes overview, visualization,
 * step-by-step mechanics, animated demonstration, AI feedback, performance
 * metrics, improvement suggestions, practice recommendations, progress history"
 * and that the interaction pattern is identical across shot types. That is
 * achieved by having exactly one component: content varies, layout never does.
 *
 * INTEGRATION
 *  - Reads the shot from `registry.ts` by route param. Unknown id -> empty state.
 *  - Drives the PERSISTENT 3D scene through `shotStore` (position + verb), so the
 *    court behind this panel always shows the shot being read about. No second
 *    canvas is created; there is one scene for the whole app.
 *  - Fetches the live model probability for every zone this shot is played from,
 *    in ONE batched pass, so the zone switcher is instant after first paint.
 *
 * HONESTY
 *  - `backendVerb === null` (free throws) means the model has no vocabulary for
 *    this action. The page says so instead of scoring a different shot.
 *  - Pose/form/progress sections are wrapped in `CapabilityGate` and render an
 *    explanation, never a mock.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { predictBatch } from "../api";
import type { CourtScenario } from "../api/types";
import { useShotStore, type ShotVerb } from "../state/shotStore";
import { getShot, ZONES, expectedPoints, type ZoneId } from "./registry";
import {
  SectionHeader, MetricCard, PhaseTimeline, CoachingPanel,
  CapabilityGate, EmptyState, LoadingRow, qualityTone,
} from "./components";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function ShotDetailPage() {
  const { shotId } = useParams<{ shotId: string }>();
  const shot = getShot(shotId);

  const [zone, setZone] = useState<ZoneId | null>(null);
  const [preds, setPreds] = useState<Record<string, { probability: number; quality: string }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  const setShotPosition = useShotStore((s) => s.setShotPosition);
  const setShotType = useShotStore((s) => s.setShotType);

  // default zone = the first one this action is actually played from
  const activeZone = zone ?? shot?.zones[0] ?? null;

  /* One batched request covering every zone for this action. Zone switching is
     then a local lookup — no request per click, no loading flash. */
  useEffect(() => {
    if (!shot || !shot.backendVerb) { setPreds(null); return; }
    const ctrl = new AbortController();
    const points: CourtScenario[] = shot.zones.map((z) => ({
      x: ZONES[z].spot.x, z: ZONES[z].spot.z, shotType: shot.backendVerb!,
    }));
    setFailed(false);
    predictBatch(points, ctrl.signal)
      .then((r) => {
        const map: Record<string, { probability: number; quality: string }> = {};
        shot.zones.forEach((z, i) => { if (r.predictions[i]) map[z] = r.predictions[i]; });
        setPreds(map);
      })
      .catch((e) => { if (e?.name !== "AbortError") setFailed(true); });
    return () => ctrl.abort();
  }, [shot]);

  /* Keep the persistent 3D scene in step with what is being read. */
  useEffect(() => {
    if (!shot || !activeZone) return;
    const spot = ZONES[activeZone].spot;
    setShotPosition(spot.x, spot.z);
    if (shot.backendVerb) setShotType(shot.backendVerb as ShotVerb);
  }, [shot, activeZone, setShotPosition, setShotType]);

  const live = activeZone && preds ? preds[activeZone] : undefined;
  const zoneMeta = activeZone ? ZONES[activeZone] : undefined;

  const xp = useMemo(
    () => (live && activeZone ? expectedPoints(live.probability, activeZone) : null),
    [live, activeZone],
  );

  if (!shot) {
    return (
      <div className="panel shot-detail">
        <EmptyState
          title="Unknown shot"
          body="That shot is not in the library."
          action={<Link className="btn" to="/shots">Back to the library</Link>}
        />
      </div>
    );
  }

  return (
    <div className="panel shot-detail">
      <nav className="crumb">
        <Link to="/shots">Shot library</Link> <span aria-hidden="true">/</span> {shot.label}
      </nav>

      {/* ── Overview ─────────────────────────────────────────────────── */}
      <header className="shot-hero">
        <div>
          <h1 className="shot-title">{shot.label}</h1>
          <p className="shot-summary">{shot.summary}</p>
        </div>
        <div className="shot-badges">
          <span className={`badge fam-${shot.family}`}>{shot.family}</span>
          <span className="badge" title="Relative difficulty, coaching judgement">
            difficulty {"●".repeat(shot.difficulty)}<span className="dim">{"○".repeat(5 - shot.difficulty)}</span>
          </span>
        </div>
      </header>

      {/* ── Zone switcher: the second axis of the shot model ──────────── */}
      <SectionHeader
        title="Where you're taking it from"
        subtitle="The same action scores differently by location — that is why location is a separate model input."
      />
      <div className="zone-switch" role="tablist" aria-label="Court zone">
        {shot.zones.map((z) => (
          <button
            key={z}
            role="tab"
            aria-selected={z === activeZone}
            className={`zone-btn ${z === activeZone ? "on" : ""}`}
            onClick={() => setZone(z)}
          >
            {ZONES[z].label}
            <span className="zone-btn-sub">{ZONES[z].pointValue}PT</span>
          </button>
        ))}
      </div>

      {/* ── Performance metrics ──────────────────────────────────────── */}
      <SectionHeader
        title="Performance"
        subtitle={shot.backendVerb
          ? "Live model prediction for a league-median shooter at this spot."
          : "This action is not in the model's vocabulary — see the note below."}
      />

      {!shot.backendVerb ? (
        <div className="cap-gate" role="note">
          <div className="cap-gate-icon" aria-hidden="true">◍</div>
          <div>
            <div className="cap-gate-title">Not scored by the shot model</div>
            <p className="cap-gate-body">
              Free throws are not field goals, so they are absent from the model's
              training data entirely. The league average below is measured, but no
              live prediction is offered rather than scoring a different shot and
              labelling it as this one.
            </p>
          </div>
        </div>
      ) : failed ? (
        <EmptyState title="Model unreachable" body="Could not reach the prediction API. The backend may not be running." />
      ) : !preds ? (
        <LoadingRow rows={2} />
      ) : null}

      <div className="metric-grid">
        {shot.backendVerb && live && (
          <>
            <MetricCard
              label="Make probability" value={pct(live.probability)}
              tone={qualityTone(live.quality)} provenance="model"
              context={`Model verdict: ${live.quality}`}
            />
            <MetricCard
              label="Expected points" value={xp!.toFixed(2)}
              provenance="model"
              context={`${zoneMeta?.pointValue}PT × make probability`}
            />
          </>
        )}
        {shot.leagueRate !== null && (
          <MetricCard
            label="League average, this action" value={pct(shot.leagueRate)}
            provenance="measured"
            context={shot.sampleSize ? `${shot.sampleSize.toLocaleString()} attempts` : "2014-26 corpus"}
          />
        )}
        {zoneMeta && (
          <MetricCard
            label={`League average, ${zoneMeta.label.toLowerCase()}`} value={pct(zoneMeta.leagueRate)}
            provenance="measured"
            context={zoneMeta.sampleSize ? `${zoneMeta.sampleSize.toLocaleString()} attempts` : undefined}
          />
        )}
      </div>

      {/* ── Mechanics + animation, driven by ONE timeline ─────────────── */}
      <SectionHeader
        title="Mechanics"
        subtitle="Scrub the phases, or play them against the 3D shooter behind this panel."
        provenance="coaching"
        action={
          <button className="btn btn-sm" onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}>
            {playing ? "Pause" : "Play motion"}
          </button>
        }
      />
      <PhaseTimeline phases={shot.coaching.phases} playing={playing} durationSec={2.4} />

      {/* ── Coaching content ─────────────────────────────────────────── */}
      <CoachingPanel mistakes={shot.coaching.mistakes} checkpoints={shot.coaching.checkpoints} />

      {/* ── AI sections: gated, never mocked ─────────────────────────── */}
      <SectionHeader title="Your shot" subtitle="Analysis of your own mechanics" />
      <CapabilityGate
        need="formFaultDetection"
        title="Form analysis"
        requires="a camera feed and a pose-estimation pipeline"
      >
        <div />
      </CapabilityGate>
      <CapabilityGate
        need="personalProgressHistory"
        title="Progress history"
        requires="logging of your real attempts, not model-scored simulations"
      >
        <div />
      </CapabilityGate>
      <CapabilityGate
        need="drillRecommendation"
        title="Practice plan"
        requires="a drill library and a recommendation model"
      >
        <div />
      </CapabilityGate>

      <footer className="shot-foot">
        <Link className="btn" to="/">Try this shot in the Court Lab</Link>
        <Link className="btn btn-ghost" to="/explorer">See it across the whole floor</Link>
      </footer>
    </div>
  );
}

export default ShotDetailPage;
