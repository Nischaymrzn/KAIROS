/**
 * SHOT SYSTEM PRIMITIVES — the reusable pieces every shot surface is built from.
 *
 * One module rather than a file-per-component because these are small, cohesive,
 * and always imported together; splitting them would add import noise without
 * improving tree-shaking (they are all used by the same two routes). If any one
 * grows past ~80 lines it should move to its own file.
 *
 * DESIGN RULES ENFORCED HERE
 *  - No component hard-codes a colour or spacing value; everything reads a token
 *    from `design/tokens.css`.
 *  - Every component that displays a number also displays its PROVENANCE, because
 *    this product mixes measured model output with coaching guidance and the user
 *    must always know which is which.
 *  - `CapabilityGate` is the single mechanism by which unavailable AI features are
 *    rendered. Nothing may mock an unavailable capability.
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AI_CAPABILITY, type CapabilityKey } from "./registry";

/* ────────────────────────────── provenance ────────────────────────────── */

/** Where a displayed value came from. Drives an explicit visual treatment so a
 *  coaching cue can never be mistaken for analysis of the user's own shot. */
export type Provenance = "model" | "measured" | "coaching" | "physics";

const PROVENANCE_LABEL: Record<Provenance, string> = {
  model: "Live model",
  measured: "Measured — NBA 2014-26",
  coaching: "Coaching guidance",
  physics: "Computed physics",
};

export const ProvenanceTag = memo(function ProvenanceTag({ kind }: { kind: Provenance }) {
  return (
    <span className={`prov prov-${kind}`} title={PROVENANCE_LABEL[kind]}>
      {PROVENANCE_LABEL[kind]}
    </span>
  );
});

/* ──────────────────────────────── layout ──────────────────────────────── */

export const SectionHeader = memo(function SectionHeader({
  title, subtitle, provenance, action,
}: { title: string; subtitle?: string; provenance?: Provenance; action?: ReactNode }) {
  return (
    <header className="sec-head">
      <div className="sec-head-text">
        <h2 className="sec-title">
          {title}
          {provenance && <ProvenanceTag kind={provenance} />}
        </h2>
        {subtitle && <p className="sec-sub">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
});

/* ──────────────────────────────── metrics ─────────────────────────────── */

export interface MetricProps {
  label: string;
  value: string | number;
  unit?: string;
  /** Optional context line, e.g. "league average 35.2%". */
  context?: string;
  /** Colour band for quality scales; omit for neutral numbers. */
  tone?: "excellent" | "good" | "average" | "poor" | "very-poor" | "neutral";
  provenance?: Provenance;
  /** Signed delta vs a reference, already formatted. */
  delta?: string;
}

export const MetricCard = memo(function MetricCard({
  label, value, unit, context, tone = "neutral", provenance, delta,
}: MetricProps) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-label">
        {label}
        {provenance && <ProvenanceTag kind={provenance} />}
      </div>
      <div className="metric-value">
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
        {delta && <span className="metric-delta">{delta}</span>}
      </div>
      {context && <div className="metric-context">{context}</div>}
    </div>
  );
});

/** Quality label → tone, defined ONCE. Previously duplicated as literal hex maps
 *  in CourtPage and elsewhere; that duplication is why panels drifted apart. */
export function qualityTone(q: string | undefined): MetricProps["tone"] {
  switch (q) {
    case "Excellent": return "excellent";
    case "Good": return "good";
    case "Average": return "average";
    case "Poor": return "poor";
    case "Very Poor": return "very-poor";
    default: return "neutral";
  }
}

/* ────────────────────────────── capability ────────────────────────────── */

/**
 * Renders `children` only when the named capability actually exists. Otherwise it
 * renders an honest explanation of what would be required.
 *
 * This is the mechanism that keeps the product truthful. The brief asks for pose
 * analysis, form-fault detection and personalised correction; none of those are
 * possible without a camera pipeline this system does not have. Rather than mock
 * them, the slot is reserved and labelled.
 */
export const CapabilityGate = memo(function CapabilityGate({
  need, title, requires, children,
}: { need: CapabilityKey; title: string; requires: string; children: ReactNode }) {
  if (AI_CAPABILITY[need]) return <>{children}</>;
  return (
    <div className="cap-gate" role="note">
      <div className="cap-gate-icon" aria-hidden="true">◍</div>
      <div>
        <div className="cap-gate-title">{title}</div>
        <p className="cap-gate-body">
          Not available in this build. <strong>Requires: {requires}.</strong> The
          model scores shot context and returns a calibrated make probability — it
          has never observed a human body, so it cannot comment on your mechanics.
        </p>
      </div>
    </div>
  );
});

/* ───────────────────────────── empty / error ──────────────────────────── */

export const EmptyState = memo(function EmptyState({
  title, body, action,
}: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <p className="empty-body">{body}</p>
      {action}
    </div>
  );
});

export const LoadingRow = memo(function LoadingRow({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
});

/* ──────────────────────────── phase timeline ──────────────────────────── */

export interface PhaseTimelineProps {
  phases: { name: string; at: number; body: string; cue: string }[];
  /** Controlled active index; omit for internal state. */
  active?: number;
  onSelect?: (index: number) => void;
  /** When true the timeline auto-advances, mirroring animation playback. */
  playing?: boolean;
  /** Total motion duration in seconds, used to pace auto-advance. */
  durationSec?: number;
}

/**
 * The mechanics timeline. Drives — and is driven by — the 3D animation, so the
 * written phase and the moving body never disagree.
 *
 * Performance: auto-advance uses a single rAF loop with a time origin rather than
 * one timer per phase, so it costs one callback per frame regardless of phase
 * count and stays in step with the render loop. It cancels on unmount and pause.
 */
export const PhaseTimeline = memo(function PhaseTimeline({
  phases, active, onSelect, playing = false, durationSec = 2,
}: PhaseTimelineProps) {
  const [internal, setInternal] = useState(0);
  const current = active ?? internal;
  const raf = useRef<number>();
  const t0 = useRef<number>(0);

  const select = useCallback((i: number) => {
    setInternal(i);
    onSelect?.(i);
  }, [onSelect]);

  useEffect(() => {
    if (!playing) return;
    t0.current = performance.now();
    const tick = (now: number) => {
      const p = ((now - t0.current) / 1000 / durationSec) % 1;
      // last phase whose `at` has been passed
      let idx = 0;
      for (let i = 0; i < phases.length; i++) if (phases[i].at <= p) idx = i;
      setInternal((prev) => (prev === idx ? prev : idx));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, durationSec, phases]);

  return (
    <div className="timeline">
      <div className="timeline-track" role="tablist" aria-label="Shot phases">
        {phases.map((ph, i) => (
          <button
            key={ph.name}
            role="tab"
            aria-selected={i === current}
            className={`timeline-node ${i === current ? "on" : ""} ${i < current ? "past" : ""}`}
            style={{ left: `${ph.at * 100}%` }}
            onClick={() => select(i)}
          >
            <span className="timeline-dot" aria-hidden="true" />
            <span className="timeline-name">{ph.name}</span>
          </button>
        ))}
        <div className="timeline-fill" style={{ width: `${(phases[current]?.at ?? 0) * 100}%` }} />
      </div>
      <div className="timeline-detail" role="tabpanel">
        <div className="timeline-cue">{phases[current]?.cue}</div>
        <p className="timeline-body">{phases[current]?.body}</p>
      </div>
    </div>
  );
});

/* ─────────────────────────── coaching content ─────────────────────────── */

export const CoachingPanel = memo(function CoachingPanel({
  mistakes, checkpoints,
}: {
  mistakes: { fault: string; fix: string }[];
  checkpoints: string[];
}) {
  return (
    <div className="coach-grid">
      <div className="coach-col">
        <SectionHeader title="Common mistakes" provenance="coaching" />
        <ul className="fault-list">
          {mistakes.map((m) => (
            <li key={m.fault} className="fault">
              <div className="fault-what">{m.fault}</div>
              <div className="fault-fix">{m.fix}</div>
            </li>
          ))}
        </ul>
      </div>
      <div className="coach-col">
        <SectionHeader title="Self-check" subtitle="Verify without equipment" provenance="coaching" />
        <ul className="check-list">
          {checkpoints.map((c) => <li key={c} className="check">{c}</li>)}
        </ul>
      </div>
    </div>
  );
});
