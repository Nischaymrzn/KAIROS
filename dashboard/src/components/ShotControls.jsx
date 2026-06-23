import { useState } from "react";
import { SHOT_TYPES, POSITIONS } from "../mockData";
import { isClutch } from "../science";
import { contestCategory, shotClockUrgency, dribbleRate } from "../science";

function Row({ label, value, children }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="label">{label}</span>
        <span className="stat text-xs text-txt-primary">{value}</span>
      </div>
      {children}
    </div>
  );
}

export function ShotControls({ scenario, onChange }) {
  const gameClockSec = (scenario.minsLeft ?? 8) * 60 + (scenario.secsLeft ?? 30);
  const clutch = isClutch(gameClockSec, scenario.scoreMargin) && scenario.period >= 4;
  const [openMech, setOpenMech] = useState(false);
  const set = (k) => (e) => onChange({ [k]: Number(e.target.value) });

  const contest = contestCategory(scenario.defenderDist);
  const contestTone = {
    red: "text-accent-red", orange: "text-accent-orange",
    amber: "text-accent-amber", green: "text-accent-green",
  }[contest.tone];
  const clockTone =
    scenario.shotClock < 5 ? "text-accent-red" : scenario.shotClock < 10 ? "text-accent-amber" : "text-txt-primary";
  const marginTone =
    scenario.scoreMargin < 0 ? "text-accent-red" : scenario.scoreMargin > 0 ? "text-accent-green" : "text-txt-primary";

  return (
    <div className="card space-y-5">
      <div>
        <div className="label mb-2">Player type</div>
        <div className="grid grid-cols-5 gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p.id}
              title={p.label}
              onClick={() => onChange({ position: p.id })}
              className={`h-9 rounded-md text-xs font-medium border transition-colors duration-150 ${
                scenario.position === p.id
                  ? "bg-accent-blue border-accent-blue text-white"
                  : "bg-bg-tertiary border-line text-txt-secondary hover:text-txt-primary"
              }`}
            >
              {p.id}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="label mb-2">Shot type</div>
        <select
          value={scenario.shotType}
          onChange={(e) => onChange({ shotType: e.target.value })}
          className="w-full bg-bg-tertiary border border-line rounded-md h-9 px-2 text-sm text-txt-primary
                     focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
        >
          {SHOT_TYPES.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.label} — {(it.rate * 100).toFixed(1)}% league
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <Row
        label="Defender distance"
        value={<span className={contestTone}>{scenario.defenderDist.toFixed(1)} ft</span>}
      >
        <input type="range" min="0" max="20" step="0.5" value={scenario.defenderDist} onChange={set("defenderDist")} />
        <p className="text-[11px] text-txt-muted leading-relaxed mt-1">
          Defender distance is estimated from league-wide contest patterns. Per-shot tracking
          data is not publicly available beyond 2015-16, so this does not feed the core model.
        </p>
        <div className={`text-[11px] mt-1 ${contestTone}`}>{contest.label}</div>
      </Row>

      <Row
        label="Shot clock"
        value={<span className={clockTone}>{scenario.shotClock.toFixed(0)} s</span>}
      >
        <input type="range" min="0" max="24" step="1" value={scenario.shotClock} onChange={set("shotClock")} />
        <div className="text-[11px] text-txt-muted mt-1">
          urgency {shotClockUrgency(scenario.shotClock).toFixed(3)}
        </div>
      </Row>

      <div>
        <div className="label mb-2">Period</div>
        <div className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5].map((q) => (
            <button
              key={q}
              onClick={() => onChange({ period: q })}
              className={`h-9 rounded-md text-xs font-medium border transition-colors duration-150 ${
                scenario.period === q
                  ? "bg-accent-blue border-accent-blue text-white"
                  : "bg-bg-tertiary border-line text-txt-secondary hover:text-txt-primary"
              }`}
            >
              {q === 5 ? "OT" : `Q${q}`}
            </button>
          ))}
        </div>
      </div>

      <Row
        label="Score margin"
        value={<span className={marginTone}>{scenario.scoreMargin > 0 ? "+" : ""}{scenario.scoreMargin}</span>}
      >
        <input type="range" min="-30" max="30" step="1" value={scenario.scoreMargin} onChange={set("scoreMargin")} />
      </Row>

      <Row
        label="Time left in period"
        value={
          <span className="inline-flex items-center gap-2">
            {clutch && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-red/15 text-accent-red border border-accent-red/40">
                CLUTCH
              </span>
            )}
            <span>{scenario.minsLeft}:{String(scenario.secsLeft).padStart(2, "0")}</span>
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <input type="range" min="0" max="11" step="1" value={scenario.minsLeft} onChange={set("minsLeft")} />
            <div className="text-[10px] text-txt-muted text-center mt-0.5">min</div>
          </div>
          <div>
            <input type="range" min="0" max="59" step="1" value={scenario.secsLeft} onChange={set("secsLeft")} />
            <div className="text-[10px] text-txt-muted text-center mt-0.5">sec</div>
          </div>
        </div>
        <p className="text-[11px] text-txt-muted leading-relaxed mt-1">
          A model feature, and it moves the answer. Clutch is the last 5 minutes within
          5 points — shown as a label only, because this project measured the effect as
          null: score margin correlates 0.0014 with the outcome.
        </p>
      </Row>

      <Row label="Dribbles before shot" value={scenario.dribbles}>
        <div className="flex items-center gap-2">
          <button className="btn !px-3 !py-1" onClick={() => onChange({ dribbles: Math.max(0, scenario.dribbles - 1) })}>−</button>
          <input type="range" min="0" max="10" step="1" value={scenario.dribbles} onChange={set("dribbles")} />
          <button className="btn !px-3 !py-1" onClick={() => onChange({ dribbles: Math.min(10, scenario.dribbles + 1) })}>+</button>
        </div>
      </Row>

      <Row label="Touch time" value={`${scenario.touchTime.toFixed(1)} s`}>
        <input type="range" min="0" max="6" step="0.1" value={scenario.touchTime} onChange={set("touchTime")} />
        <div className="text-[11px] text-txt-muted mt-1">
          {dribbleRate(scenario.dribbles, scenario.touchTime).toFixed(1)} dribbles per second
        </div>
      </Row>

      <div className="border-t border-line pt-4">
        <button
          onClick={() => setOpenMech((o) => !o)}
          className="flex items-center justify-between w-full label hover:text-txt-secondary"
          aria-expanded={openMech}
        >
          <span>Shot mechanics</span>
          <span>{openMech ? "−" : "+"}</span>
        </button>

        {openMech && (
          <div className="space-y-5 mt-4">
            <Row label="Jump angle" value={`${scenario.jumpAngle}°`}>
              <input type="range" min="30" max="90" step="1" value={scenario.jumpAngle} onChange={set("jumpAngle")} />
            </Row>

            <div>
              <div className="label mb-2">Release height</div>
              <div className="grid grid-cols-3 gap-1">
                {["Low", "Medium", "High"].map((h) => (
                  <button
                    key={h}
                    onClick={() => onChange({ releaseHeight: h })}
                    className={`h-9 rounded-md text-xs border transition-colors duration-150 ${
                      scenario.releaseHeight === h
                        ? "bg-accent-blue border-accent-blue text-white"
                        : "bg-bg-tertiary border-line text-txt-secondary hover:text-txt-primary"
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="label mb-2">Hand placement</div>
              <div className="grid grid-cols-2 gap-1">
                {["One Hand", "Two Hand", "Finger Roll", "Hook"].map((h) => (
                  <button
                    key={h}
                    onClick={() => onChange({ handPlacement: h })}
                    className={`h-9 rounded-md text-xs border transition-colors duration-150 ${
                      scenario.handPlacement === h
                        ? "bg-accent-blue border-accent-blue text-white"
                        : "bg-bg-tertiary border-line text-txt-secondary hover:text-txt-primary"
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <Row
              label="Approach angle"
              value={
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 border-t-2 border-r-2 border-accent-blue"
                    style={{ transform: `rotate(${scenario.approachAngle - 45}deg)` }}
                  />
                  {scenario.approachAngle}°
                </span>
              }
            >
              <input type="range" min="-90" max="90" step="5" value={scenario.approachAngle} onChange={set("approachAngle")} />
            </Row>

            <Row label="Shot distance" value={`${scenario.distance.toFixed(1)} ft`}>
              <input type="range" min="1" max="35" step="0.5" value={scenario.distance} onChange={set("distance")} />
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}
