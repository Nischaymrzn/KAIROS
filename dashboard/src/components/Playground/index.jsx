/**
 * The court, its controls and its result, as one component.
 *
 * Every page that needs a court renders this instead of assembling its own, so
 * the three-column layout, the defender handling and the prediction wiring
 * exist once. It reads the shared scenario by default; Compare passes its own
 * isolated store through `pg` so two of them can sit side by side without
 * touching each other.
 *
 * Modes
 *   full      three columns: controls, court, result. The working surface.
 *   compact   court and a small result. Used two-up on Compare.
 *   readonly  court only, no controls and no buttons.
 */
import { useEffect, useMemo, useRef } from "react";

import { CourtCanvas, zoneAt } from "../CourtCanvas";
import { ShotControls } from "../ShotControls";
import { ProbabilityGauge } from "../ProbabilityGauge";
import { SHAPChart } from "../SHAPChart";
import { SuggestionBox } from "../SuggestionBox";
import { ContestPanel } from "../ContestPanel";
import { DefenderList } from "./DefenderList";
import { generateSuggestions } from "../../suggestions";
import { ZONES } from "../../mockData";
import { usePrediction } from "../../hooks/usePrediction";
import { useSavedScenarios } from "../../hooks/useSavedScenarios";
import { usePlayground, useScenarioPayload } from "../../state/playgroundStore";

function Placeholder({ children }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center rounded-lg
                    border border-dashed border-border-subtle p-5 text-center
                    text-sm text-txt-muted">
      {children}
    </div>
  );
}

export function Playground({
  pg: pgOverride,
  mode = "full",
  showControls = true,
  showResult = true,
  showSuggestions = true,
  label,
  onPrediction,
}) {
  // hooks cannot be called conditionally, so the shared store is always read;
  // an override simply wins when a page supplies one
  const shared = usePlayground();
  const pg = pgOverride ?? shared;

  const payload = useScenarioPayload(pg);
  const { prediction: pred } = usePrediction(payload);
  const saved = useSavedScenarios();
  const zone = zoneAt(pg.shooter.x, pg.shooter.y);

  // record the shot once per simulate, not once per prediction refresh
  const recorded = useRef(0);
  useEffect(() => {
    if (!pred || pg.simKey === 0 || recorded.current === pg.simKey) return;
    recorded.current = pg.simKey;
    pg.recordShot(pred.probability, pred.probability >= 0.5);
  }, [pg, pred]);

  useEffect(() => { if (pred) onPrediction?.(pred, payload); }, [pred, payload, onPrediction]);

  const suggestions = useMemo(
    () => (pred ? generateSuggestions({ ...pg.scenario, zone }, pred) : []),
    [pred, pg.scenario, zone],
  );

  const made = pred ? pred.probability >= 0.5 : null;
  const delta = pred ? (pred.probability - pred.zone_average) * 100 : 0;
  const zoneMeta = ZONES[zone];
  const compact = mode === "compact";
  const readonly = mode === "readonly";

  const court = (
    <div className="card flex flex-col items-center gap-4">
      {label && (
        <div className="self-start rounded-full border border-border-strong bg-bg-raised
                        px-3 py-1 text-[11px] font-semibold text-txt-primary">
          {label}
        </div>
      )}
      <CourtCanvas
        shooter={pg.shooter}
        defenders={pg.defenders}
        probability={pred?.probability ?? 0.5}
        jumpAngle={pg.scenario.jumpAngle}
        simulateKey={pg.simKey}
        made={made}
        onCourtClick={readonly ? undefined : pg.setPosition}
        onDefenderMove={readonly ? undefined : pg.moveDefender}
      />
      {!readonly && (
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={pg.simulate}>Simulate shot</button>
          <button
            className="btn"
            onClick={() => saved.save({
              scenario: pg.scenario, shooter: pg.shooter, defenders: pg.defenders, zone,
              probability: pred?.probability ?? null,
              label: `${zoneMeta.label} ${pg.scenario.distance.toFixed(0)} ft`,
            })}
          >
            Save{saved.items.length > 0 && ` (${saved.items.length})`}
          </button>
          <button className="btn" onClick={pg.reset}>Reset</button>
        </div>
      )}
    </div>
  );

  if (readonly) return court;

  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        {court}
        <div className="card">
          {pred ? (
            <ProbabilityGauge
              probability={pred.probability}
              label={pred.quality_label}
              live={pred.live}
              zoneAverage={pred.zone_average}
            />
          ) : <Placeholder>Simulate to see shot quality</Placeholder>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      {showControls ? (
        <div className="flex flex-col gap-5">
          <ShotControls scenario={pg.scenario} onChange={pg.setScenario} />
          <DefenderList pg={pg} />
        </div>
      ) : <div />}

      {court}

      {showResult ? (
        <div className="flex flex-col gap-5">
          <div className="card">
            {pred ? (
              <>
                <ProbabilityGauge
                  probability={pred.probability}
                  label={pred.quality_label}
                  live={pred.live}
                  zoneAverage={pred.zone_average}
                />
                <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-6">
                  <div>
                    <div className="label">Expected points</div>
                    <div className="stat text-xl">{pred.expected_points.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="label">vs zone average</div>
                    <div className={`stat text-xl ${delta >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-[11px] text-txt-muted">
                  {zoneMeta.label} · league {(zoneMeta.rate * 100).toFixed(1)}% · {zoneMeta.points} PT
                </div>
                <div className="mt-6 border-t border-line pt-6">
                  <div className="label mb-3">Feature contributions</div>
                  <SHAPChart shapValues={pred.shap_values} probability={pred.probability} />
                </div>
                <ContestPanel scenario={payload} baseProbability={pred.probability} />
              </>
            ) : (
              <Placeholder>
                Click a spot on the court and simulate to see shot quality.
              </Placeholder>
            )}
          </div>

          {showSuggestions && pred && (
            <SuggestionBox
              suggestions={suggestions}
              onApply={(a) => pg.setScenario({ [a.param]: a.value })}
            />
          )}
        </div>
      ) : <div />}
    </div>
  );
}
