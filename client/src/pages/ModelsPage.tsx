/**
 * MODEL REGISTRY — every frozen production bundle, read live from /models
 * (each card is that bundle's own manifest, nothing hand-written). Shows the
 * core shot-quality lineage v1→v7, the era-drift / tracking / player-season
 * studies, and the movement model — with which endpoint each one powers.
 */
import { useEffect, useState } from "react";
import { getModels, type RegistryResponse, type ModelBundle } from "../api";
import { useScenarioStore } from "../scenario/scenarioStore";
import { ZONE_LABEL } from "../scenario/schema";

function metric(m: ModelBundle["manifest"], key: "auc" | "brier" | "accuracy" | "n") {
  const v = m.test_metrics?.[key];
  if (v == null) return null;
  return key === "n" ? v.toLocaleString() : v.toFixed(3);
}

/** name→number maps in a manifest (model leaderboards, study comparisons)
 *  rendered as labelled bars so the findings read at a glance. */
function ScoreBars({ title, scores }: { title: string; scores: Record<string, number> }) {
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 1;
  const min = Math.min(...entries.map(([, v]) => v));
  return (
    <div style={{ marginTop: 8 }}>
      <div className="an-label">{title}</div>
      {entries.map(([name, v]) => (
        <div key={name} className="rank-row" style={{ marginTop: 3 }}>
          <div className="rank-info">
            <span className="rank-type">{name.replace(/_/g, " ")}</span>
            <div className="rank-bar-wrap">
              <div
                className="rank-bar"
                style={{
                  // stretch the tiny AUC differences so the ordering is visible
                  width: `${20 + 80 * ((v - min) / Math.max(max - min, 1e-6))}%`,
                  background: v === max ? "#35c26e" : "#4c6ef5",
                }}
              />
            </div>
          </div>
          <span className="rank-pct" style={{ color: v === max ? "#35c26e" : "rgba(255,255,255,0.7)" }}>
            {v.toFixed(4)}
          </span>
        </div>
      ))}
    </div>
  );
}

function BundleCard({ b }: { b: ModelBundle }) {
  const m = b.manifest;
  const extra: [string, string][] = [];
  // surface any study-specific headline numbers the manifest carries
  for (const [k, v] of Object.entries(m)) {
    if (["version", "model", "calibration", "date", "test_metrics"].includes(k)) continue;
    if (typeof v === "number") extra.push([k.replace(/_/g, " "), v.toFixed(3)]);
    if (typeof v === "string" && v.length < 40 && k !== "note") extra.push([k.replace(/_/g, " "), v]);
  }
  const comparison = m.comparison as Record<string, number> | undefined;
  const leaderboard = m.val_leaderboard as Record<string, number> | undefined;
  const featureList = (m.era_features ?? m.features) as string[] | undefined;
  const note = m.note as string | undefined;
  const subtitle = (m.window ?? m.target) as string | undefined;
  return (
    <div className={`model-card ${b.active ? "active" : ""}`}>
      <div className="model-head">
        <span className="model-key">{b.key}</span>
        {b.active && <span className="model-live">ACTIVE</span>}
      </div>
      <div className="model-label">{b.label}</div>
      <div className="model-meta">
        {m.model && <span>{String(m.model)}</span>}
        {m.calibration && <span>· {String(m.calibration)}</span>}
        {m.date && <span>· {String(m.date)}</span>}
      </div>
      <div className="model-metrics">
        {(["auc", "brier", "accuracy", "n"] as const).map((k) => {
          const v = metric(m, k);
          return v ? (
            <div key={k}><span>{k.toUpperCase()}</span><strong>{v}</strong></div>
          ) : null;
        })}
      </div>
      {extra.length > 0 && (
        <div className="model-extra">
          {extra.slice(0, 4).map(([k, v]) => (
            <div key={k}><span>{k}</span><strong>{v}</strong></div>
          ))}
        </div>
      )}
      {subtitle && <div className="model-label" style={{ marginTop: 6 }}>{subtitle}</div>}
      {comparison && <ScoreBars title="Study comparison (test AUC)" scores={comparison} />}
      {leaderboard && <ScoreBars title="Validation leaderboard (AUC)" scores={leaderboard} />}
      {featureList && featureList.length > 0 && (
        <div className="model-serves" style={{ marginTop: 8 }}>
          {featureList.slice(0, 8).map((f) => <code key={f}>{f}</code>)}
          {featureList.length > 8 && <code>+{featureList.length - 8} more</code>}
        </div>
      )}
      {note && <div className="panel-note" style={{ marginTop: 8 }}>{note}</div>}
      {b.serves.length > 0 && (
        <div className="model-serves">
          {b.serves.map((s) => <code key={s}>{s}</code>)}
        </div>
      )}
    </div>
  );
}

export function ModelsPage() {
  const [reg, setReg] = useState<RegistryResponse | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    getModels().then(setReg).catch(() => setErr(true));
  }, []);

  const core = reg?.bundles.filter((b) => b.family === "core") ?? [];
  const studies = reg?.bundles.filter((b) => b.family !== "core") ?? [];

  return (
    <div className="models-page">
      <div className="panel-title big">Production Model Registry</div>
      {err && <div className="an-stat">registry unavailable — backend offline</div>}
      {reg && (
        <>
          <div className="panel-note" style={{ marginBottom: 10 }}>
            read live from each frozen bundle's manifest · serving core: v{String(reg.latest_core_version)} ·
            swap a bundle behind the API and this page (and every prediction) updates with zero client changes
          </div>

          <div className="an-label">Specialty models</div>
          <div className="model-grid">
            {studies.map((b) => <BundleCard key={b.key} b={b} />)}
          </div>

          <div className="an-label" style={{ marginTop: 14 }}>
            Core shot-quality lineage (chronological, leak-free evaluation)
          </div>
          <div className="model-grid">
            {[...core].reverse().map((b) => <BundleCard key={b.key} b={b} />)}
          </div>

          <ScenarioMeaning />

          <div className="panel-note" style={{ marginTop: 12 }}>
            honest ceiling: single-shot make prediction tops out near AUC 0.70 on public
            context features — the era-drift, tracking and player-season studies document
            what moves that needle and what doesn't (see thesis reports)
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What the registry's numbers mean for the shot currently on the court.
 *
 * A metrics page that never mentions the live scenario invites the reading that
 * 0.70 AUC makes a 41% shot a fact. It does not: the model separates makes from
 * misses better than chance, and a probability stays a probability.
 */
function ScenarioMeaning() {
  const scenario = useScenarioStore((s) => s.scenario);
  const prediction = useScenarioStore((s) => s.prediction);
  const d = useScenarioStore((s) => s.derived)();
  if (!prediction) return null;

  const pct = prediction.probability * 100;
  const zonePct = d.zoneRate * 100;
  const delta = pct - zonePct;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="an-label">What this means for the shot on the court</div>
      <div className="panel-note" style={{ lineHeight: 1.55 }}>
        The current scenario — {ZONE_LABEL[d.zone]}, {d.distance.toFixed(1)} ft,
        {" "}{scenario.shot.shotType.replace(/_/g, " ")} — scores{" "}
        <strong>{pct.toFixed(1)}%</strong>, against {zonePct.toFixed(1)}% for an average
        attempt from that zone ({delta >= 0 ? "+" : ""}{delta.toFixed(1)} points).
        {d.expectedPoints != null && (
          <> That is <strong>{d.expectedPoints.toFixed(2)} expected points</strong> at {d.points} per make.</>
        )}
        <br /><br />
        AUC 0.70 describes ranking, not certainty: give the model any made shot and any
        missed one and it scores the make higher about 70% of the time. It says nothing
        about whether <em>this</em> attempt drops. The number to trust here is the
        calibration — reliability 0.0001, ECE 0.0070 — which is what makes
        &ldquo;{pct.toFixed(0)}%&rdquo; mean {pct.toFixed(0)} out of 100 rather than a vibe.
      </div>
    </div>
  );
}
