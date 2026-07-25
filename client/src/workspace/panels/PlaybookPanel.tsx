/**
 * PLAYBOOK — "I am here, in this situation. What do I run?"
 *
 * This is the play study rebuilt around the coach's actual question. A browser of
 * 188 clips is a filing cabinet: it shows real movement and leaves the reader to
 * work out which of it applies to them. A coach standing at a spot on the floor
 * with a defender on his shooter wants the plays that MATCH, and he wants to be
 * told what they returned.
 *
 * So everything here is driven by the scenario on the court:
 *
 *   1. WHICH SHOT. Every action ranked by expected points from this exact spot,
 *      from the model. Expected points rather than make percentage, because that
 *      is the only ranking that can compare a floater with a three.
 *   2. WHAT TEAMS RAN. Tracked possessions filtered to this distance, sorted by
 *      how close they are to the situation, played on the tactical board from the
 *      first tracked frame with all ten players.
 *   3. WHAT IT RETURNED. The observed outcome of the matched plays, as a rate over
 *      the matches rather than a single anecdote.
 *
 * The board is the same component the standalone study uses, so the court a coach
 * reads here is the court he reads everywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import {
  listReplays, getReplay, rankShots, isAbort,
  type ReplayDetail, type ReplayPlay, type RankedShot,
} from "../../api";
import { TacticalBoard, fx, fz, flen } from "../../viz/TacticalBoard";
import { TEAM, INK, STATUS } from "../../viz/palette";
import { usePlaybackStore, cursor } from "../../state/playbackStore";

const BALL_X = 2, BALL_Z = 3, BALL_H = 4, P0 = 5;
const playerAt = (f: number[], i: number) => ({ x: f[P0 + i * 2], z: f[P0 + i * 2 + 1] });
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

const VERB_LABEL: Record<string, string> = {
  dunk: "Dunk", driving_layup: "Driving layup", layup: "Layup",
  floater: "Floater", hook: "Hook", catch_shoot: "Catch and shoot",
  pullup: "Pull-up", stepback: "Step-back", fadeaway: "Fadeaway",
};

/** How wide a band of tracked shots counts as "this situation", in feet. */
const MATCH_FT = 3.5;

export function PlaybookPanel() {
  const scenario = useScenarioStore((s) => s.scenario);
  const derived = useScenarioStore((s) => s.derived)();
  const setShotType = useScenarioStore((s) => s.setShotType);

  const [all, setAll] = useState<ReplayPlay[]>([]);
  const [pick, setPick] = useState(0);
  const [clip, setClip] = useState<ReplayDetail | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ranked, setRanked] = useState<RankedShot[] | null>(null);
  const raf = useRef(0);
  const last = useRef(0);
  const openIn3D = usePlaybackStore((s) => s.open);
  const closeIn3D = usePlaybackStore((s) => s.close);
  const live3D = usePlaybackStore((s) => s.clip);
  const live3DPlaying = usePlaybackStore((s) => s.playing);

  const target = derived.distance;
  const contest = derived.contest.closest;

  // ---- 1. which shot, from the model ---------------------------------------
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      rankShots({
        x: scenario.shot.x, z: scenario.shot.z,
        playerId: scenario.player.playerId,
        positionGroup: scenario.player.positionGroup,
        quarter: scenario.game.quarter,
        shotClock: scenario.game.shotClock,
        scoreMargin: scenario.game.scoreMargin,
        defenderDistance: contest ?? undefined,
      }, ctrl.signal)
        .then((r) => setRanked(r.ranked))
        .catch((e) => { if (!isAbort(e)) setRanked(null); });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [scenario.shot.x, scenario.shot.z, scenario.player.playerId,
      scenario.player.positionGroup, scenario.game.quarter,
      scenario.game.shotClock, scenario.game.scoreMargin, contest]);

  // ---- the catalogue, fetched once -----------------------------------------
  useEffect(() => {
    const ctrl = new AbortController();
    listReplays(200, ctrl.signal)
      .then((r) => setAll(r.plays))
      .catch((e) => { if (!isAbort(e)) setAll([]); });
    return () => ctrl.abort();
  }, []);

  // ---- 2. the plays that match this situation ------------------------------
  const matches = useMemo(() => {
    if (!all.length) return [];
    return all
      .filter((p) => Math.abs(p.distance - target) <= MATCH_FT)
      .sort((a, b) => Math.abs(a.distance - target) - Math.abs(b.distance - target));
  }, [all, target]);

  /**
   * Keep the possession you are watching when the match set is recomputed.
   *
   * This reset `pick` to 0 on every change of distance, and the handoff changes
   * the distance BY DESIGN — it moves the shooter onto the release spot of the
   * very play just watched. So the sequence was: watch a possession, hand over,
   * distance updates, matches re-filter, pick snaps to 0, and the board silently
   * loads a DIFFERENT play while the court shows the shooter from the old one.
   * The two views disagreeing was that, not a coordinate problem.
   *
   * The clip that is open stays open as long as it is still in the set.
   */
  const openKey = clip ? `${clip.gameId}:${clip.eventId}` : null;
  useEffect(() => {
    if (!matches.length) return;
    if (openKey) {
      const i = matches.findIndex((m) => `${m.gameId}:${m.eventId}` === openKey);
      if (i >= 0) { setPick((cur) => (cur === i ? cur : i)); return; }
    }
    setPick(0);
    // `openKey` is read, not depended on: re-running when the OPEN CLIP changes
    // would fight the loader below, which is what sets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  useEffect(() => {
    const p = matches[pick];
    if (!p) { setClip(null); return; }
    const ctrl = new AbortController();
    setClip(null); setFrame(0); setPlaying(false);
    getReplay(p.gameId, p.eventId, ctrl.signal)
      .then((c) => { setClip(c); setPlaying(true); })
      .catch((e) => { if (!isAbort(e)) setClip(null); });
    return () => ctrl.abort();
  }, [matches, pick]);

  /**
   * Playback, in two modes, and only ever ONE cursor on screen at a time.
   *
   * The board used to keep its own `frame` while the arena advanced the shared
   * `cursor` independently. Both were playing the same possession at different
   * speeds from different start times, so the diagram and the floor showed
   * different moments of it — which is exactly the "they do not match" this
   * fixes. Two cursors for one play is one cursor too many.
   *
   * When the arena has this clip, the board FOLLOWS it: the scene owns time and
   * the panel reads it. The read is on an animation frame rather than a store
   * subscription because the cursor moves 12 times a second and driving React
   * from it was the reason it was pulled out of state to begin with.
   */
  const mirroring = !!live3D && live3D.eventId === clip?.eventId;

  useEffect(() => {
    if (!clip) return;

    if (mirroring) {
      const follow = () => {
        setFrame((f) => (cursor.frame === f ? f : cursor.frame));
        raf.current = requestAnimationFrame(follow);
      };
      raf.current = requestAnimationFrame(follow);
      return () => cancelAnimationFrame(raf.current);
    }

    if (!playing) return;
    const step = (t: number) => {
      if (t - last.current > 80) {
        last.current = t;
        setFrame((f) => (f + 1 >= clip.frames.length ? (setPlaying(false), f) : f + 1));
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, clip, mirroring]);

  const read = useMemo(() => {
    if (!clip) return null;
    const f = clip.frames[Math.min(frame, clip.frames.length - 1)];
    const si = clip.lineup.findIndex((p) => p.id === clip.shooterId);
    const side = clip.lineup[si]?.side;
    const players = clip.lineup.map((p, i) => ({
      ...p, ...playerAt(f, i), attacking: p.side === side, isShooter: i === si,
    }));
    const defs = players.filter((p) => !p.attacking);
    const shooter = players[si];
    return {
      players, shooter,
      marks: defs.map((d) => {
        let best = players.find((p) => p.attacking)!;
        let bd = Infinity;
        for (const a of players) {
          if (!a.attacking) continue;
          const dd = dist(d, a);
          if (dd < bd) { bd = dd; best = a; }
        }
        return { d, a: best };
      }),
      ball: { x: f[BALL_X], z: f[BALL_Z], h: f[BALL_H] },
      shotClock: f[1],
    };
  }, [clip, frame]);

  useEffect(() => () => { usePlaybackStore.getState().close(); }, []);

  const step = useCallback((d: 1 | -1) => {
    setPick((i) => (i + d + matches.length) % Math.max(matches.length, 1));
  }, [matches.length]);

  const madeRate = matches.length
    ? matches.filter((m) => m.made).length / matches.length
    : null;

  /** Space on the shooter at the release frame, which is the last one. */
  const relSep = useMemo(() => {
    if (!clip) return null;
    const si = clip.lineup.findIndex((p) => p.id === clip.shooterId);
    if (si < 0) return null;
    const side = clip.lineup[si].side;
    const f = clip.frames[clip.frames.length - 1];
    const s = playerAt(f, si);
    const opp = clip.lineup
      .map((p, i) => ({ i, p }))
      .filter((r) => r.p.side !== side)
      .map((r) => dist(playerAt(f, r.i), s));
    return opp.length ? Math.min(...opp) : null;
  }, [clip]);

  /**
   * The takeaway, derived rather than written. Separation at release and the
   * outcome are both facts about THIS possession, so the sentence changes with
   * the play instead of being a caption that is true of everything.
   */
  const lesson = useMemo(() => {
    if (!clip || relSep == null) return "";
    const open = relSep >= 6;
    const tight = relSep < 3;
    if (clip.made && open) {
      return `He got ${relSep.toFixed(1)} ft of daylight before releasing. That is the shot you are running this for.`;
    }
    if (clip.made && tight) {
      return `Made it with a hand in his face at ${relSep.toFixed(1)} ft. A shot that goes in contested is not a shot worth designing.`;
    }
    if (!clip.made && tight) {
      return `Only ${relSep.toFixed(1)} ft of space at release. The miss starts before the shot does.`;
    }
    return `${relSep.toFixed(1)} ft of space at release, and it missed. Good look, wrong night.`;
  }, [clip, relSep]);
  const bestXp = ranked?.length ? Math.max(...ranked.map((r) => r.expected_points)) : 1;

  return (
    <div className="pn-body pb">
      {/* ---- the situation, stated once ------------------------------------- */}
      <div className="pb-sit">
        <b>{target.toFixed(0)} ft</b>
        <span>
          {contest != null ? `defender ${contest.toFixed(1)} ft` : "open floor"} ·{" "}
          {scenario.game.shotClock}s
        </span>
      </div>

      {/* ---- 1. which shot -------------------------------------------------- */}
      <div className="pn-label">Best shot from here <span className="cx-src">model</span></div>
      {!ranked && <div className="pn-note">ranking the options</div>}
      {ranked && (
        <div className="pb-rank" role="list">
          {ranked.slice(0, 5).map((r) => {
            const on = r.shot_type === scenario.shot.shotType;
            return (
              <button
                key={r.shot_type} role="listitem"
                className={`pb-opt ${on ? "on" : ""}`}
                onClick={() => setShotType(r.shot_type as never)}
                title={`${Math.round(r.probability * 100)}% × ${r.point_value} pts`}
              >
                <span className="pb-opt-bar" style={{ width: `${(r.expected_points / bestXp) * 100}%` }} />
                <span className="pb-opt-name">{VERB_LABEL[r.shot_type] ?? r.shot_type}</span>
                <b>{r.expected_points.toFixed(2)}</b>
              </button>
            );
          })}
        </div>
      )}
      <div className="pn-note">
        Expected points, not make rate. It is the only ranking that can compare a
        two with a three.
      </div>

      {/* ---- 2. what teams ran --------------------------------------------- */}
      <div className="pn-label">
        What teams ran from here <span className="cx-src">tracked</span>
      </div>

      {matches.length === 0 && (
        <div className="pn-note">No tracked possessions within {MATCH_FT} ft of this spot.</div>
      )}

      {matches.length > 0 && clip && read && (
        <>
          <TacticalBoard
            label={`Tracked possession, ${clip.action} from ${clip.distance} feet, ${clip.made ? "made" : "missed"}`}
          >
            {clip.lineup.map((p, i) => {
              const pts = clip.frames.slice(Math.max(0, frame - 18), frame + 1)
                .map((f) => { const q = playerAt(f, i); return `${fx(q.x)},${fz(q.z)}`; }).join(" ");
              return (
                <polyline key={`t${p.id}`} points={pts} fill="none"
                  stroke={p.side === read.shooter?.side ? TEAM.offense : TEAM.defense}
                  strokeWidth={1.5} strokeOpacity={0.34} strokeLinecap="round" />
              );
            })}
            {read.marks.map((m) => (
              <line key={`m${m.d.id}`}
                x1={fx(m.d.x)} y1={fz(m.d.z)} x2={fx(m.a.x)} y2={fz(m.a.z)}
                stroke={INK.muted} strokeWidth={1} strokeDasharray="3 4" strokeOpacity={0.5} />
            ))}
            <circle cx={fx(read.ball.x)} cy={fz(read.ball.z)} r={flen(0.8)} fill="#f5b04b" />
            {read.players.map((p) => (
              <g key={p.id}>
                {p.isShooter && (
                  <circle cx={fx(p.x)} cy={fz(p.z)} r={flen(2.1)} fill="none"
                    stroke={STATUS.good} strokeWidth={2} />
                )}
                <circle cx={fx(p.x)} cy={fz(p.z)} r={flen(1.45)}
                  fill={p.attacking ? TEAM.offense : TEAM.defense}
                  stroke={INK.surface} strokeWidth={2} />
                <text x={fx(p.x)} y={fz(p.z) + 4} textAnchor="middle"
                  fontSize={11} fontWeight={700} fill="#fff">{p.jersey}</text>
              </g>
            ))}
          </TacticalBoard>

          <div className="ps-transport">
            <button className="ps-play" onClick={() => {
              if (mirroring) {
                if (cursor.frame >= clip.frames.length - 1) cursor.frame = 0;
                usePlaybackStore.getState().setPlaying(!live3DPlaying);
                return;
              }
              if (frame >= clip.frames.length - 1) setFrame(0);
              setPlaying((v) => !v);
            }}>{(mirroring ? live3DPlaying : playing) ? "❚❚" : "▶"}</button>
            <input
              type="range" min={0} max={clip.frames.length - 1} value={frame}
              onChange={(e) => {
                const v = Number(e.target.value);
                // Scrubbing drives the floor too, so the two never diverge.
                if (mirroring) {
                  usePlaybackStore.getState().setPlaying(false);
                  cursor.frame = v;
                } else {
                  setPlaying(false);
                }
                setFrame(v);
              }}
            />
            <span className="ps-clock">{read.shotClock.toFixed(1)}<em>s</em></span>
          </div>

          <div className="pb-nav">
            <button onClick={() => step(-1)} aria-label="Previous possession">‹</button>
            <span>
              {clip.action} · <b className={clip.made ? "up" : "down"}>
                {clip.made ? "made" : "missed"}
              </b>
              <em> {pick + 1} of {matches.length}</em>
            </span>
            <button onClick={() => step(1)} aria-label="Next possession">›</button>
          </div>

          <div className="ps-legend">
            <span><i style={{ background: TEAM.offense }} />attack</span>
            <span><i style={{ background: TEAM.defense }} />defence</span>
            <span><i className="ring" />shooter</span>
          </div>

          {/* Watch it on the real floor. The board shows the shape; the arena
              shows what a coach would actually see from the sideline. */}
          <button
            className={`pb-viz ${live3D ? "on" : ""}`}
            onClick={() => {
              if (live3D && live3D.eventId === clip.eventId) closeIn3D();
              else openIn3D(clip);
            }}
          >
            {live3D && live3D.eventId === clip.eventId
              ? "Stop in the arena"
              : "Watch in the arena"}
          </button>

          {/* ---- how the shot was taken ----------------------------------- */}
          <div className="pn-label">How this shot was taken</div>
          <div className="pb-how">
            <div>
              <span>Action</span>
              <b>{clip.action}</b>
            </div>
            <div>
              <span>Range</span>
              <b>{clip.distance} ft</b>
            </div>
            <div>
              <span>Shooter</span>
              <b>{read.shooter?.name ?? "·"}</b>
            </div>
            <div>
              <span>Space at release</span>
              <b>{relSep != null ? `${relSep.toFixed(1)} ft` : "·"}</b>
            </div>
          </div>
          <div className="pb-lesson">{lesson}</div>

          {/* ---- 3. what it returned ---------------------------------------- */}
          {madeRate != null && (
            <div className="pb-return">
              Across <b>{matches.length}</b> tracked possessions from this range,
              teams shot <b>{Math.round(madeRate * 100)}%</b>.
            </div>
          )}
        </>
      )}
    </div>
  );
}
