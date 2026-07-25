/**
 * PLAY STUDY — ten real players, from where the possession started.
 *
 * The tracking corpus was previously either unused or shown as a replay of the
 * shooter alone. Both waste it. A shooter's path says nothing about WHY the shot
 * was there; the other nine players are the reason it existed. This panel plays
 * the whole floor from the first tracked frame — which is the point the user
 * asked for, the moment the movement actually starts, not the release.
 *
 * WHAT A COACH CAN READ HERE AND NOWHERE ELSE IN THE APP
 *  · shape. Five attackers and five defenders in their real spacing, top-down, so
 *    a foot of separation is a foot everywhere on the floor.
 *  · assignment. Each defender is joined to the attacker he is closest to, which
 *    is how a switch or a help rotation becomes visible instead of inferred.
 *  · the moment it broke. The shooter's separation is measured every frame, so
 *    the frame where he got free is a number, not an impression.
 *
 * Everything here is recorded fact from 2015-16 SportVU. The only model output is
 * the probability shown against the real outcome, and it is labelled as such.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listReplays, getReplay, isAbort, type ReplayDetail, type ReplayPlay } from "../../api";
import { TacticalBoard, fx, fz, flen } from "../../viz/TacticalBoard";
import { TEAM, INK, STATUS } from "../../viz/palette";

/** Frame layout, flat, as documented by backend/services/replay.py. */
const BALL_X = 2, BALL_Z = 3, BALL_H = 4, P0 = 5;

const playerAt = (f: number[], i: number) => ({ x: f[P0 + i * 2], z: f[P0 + i * 2 + 1] });
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

export function PlayStudyPanel() {
  const [plays, setPlays] = useState<ReplayPlay[]>([]);
  const [clip, setClip] = useState<ReplayDetail | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const raf = useRef(0);
  const last = useRef(0);

  // ---- the catalogue --------------------------------------------------------
  useEffect(() => {
    const ctrl = new AbortController();
    listReplays(60, ctrl.signal)
      .then((r) => {
        setPlays(r.plays);
        if (r.plays.length) load(r.plays[0]);
      })
      .catch((e) => { if (!isAbort(e)) setErr("No tracked clips available."); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback((p: ReplayPlay) => {
    setClip(null);
    setFrame(0);
    setPlaying(false);
    getReplay(p.gameId, p.eventId)
      .then((c) => { setClip(c); setPlaying(true); })
      .catch((e) => { if (!isAbort(e)) setErr("That clip could not be read."); });
  }, []);

  // ---- playback. 25 Hz source, played at half speed so shape is readable -----
  useEffect(() => {
    if (!playing || !clip) return;
    const step = (t: number) => {
      if (t - last.current > 80) {
        last.current = t;
        setFrame((f) => {
          if (f + 1 >= clip.frames.length) { setPlaying(false); return f; }
          return f + 1;
        });
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, clip]);

  // ---- geometry for the frame on screen -------------------------------------
  const read = useMemo(() => {
    if (!clip) return null;
    const f = clip.frames[Math.min(frame, clip.frames.length - 1)];
    const shooterIdx = clip.lineup.findIndex((p) => p.id === clip.shooterId);
    const shooterSide = clip.lineup[shooterIdx]?.side;

    const players = clip.lineup.map((p, i) => ({
      ...p,
      ...playerAt(f, i),
      attacking: p.side === shooterSide,
      isShooter: i === shooterIdx,
    }));

    const attackers = players.filter((p) => p.attacking);
    const defenders = players.filter((p) => !p.attacking);

    // Each defender joined to his nearest attacker. Not the real assignment — no
    // public data carries that — but it is what a coach reads off a still, and it
    // makes switches and help rotations visible as the line jumps.
    const marks = defenders.map((d) => {
      let best = attackers[0];
      let bd = Infinity;
      for (const a of attackers) {
        const dd = dist(d, a);
        if (dd < bd) { bd = dd; best = a; }
      }
      return { d, a: best, ft: bd };
    });

    const shooter = players[shooterIdx];
    const onShooter = shooter
      ? Math.min(...defenders.map((d) => dist(d, shooter)))
      : null;

    return {
      f, players, attackers, defenders, marks, shooter, onShooter,
      ball: { x: f[BALL_X], z: f[BALL_Z], h: f[BALL_H] },
      gameClock: f[0], shotClock: f[1],
    };
  }, [clip, frame]);

  /** Separation on the shooter for every frame — the play's story as one line. */
  const separation = useMemo(() => {
    if (!clip) return [];
    const si = clip.lineup.findIndex((p) => p.id === clip.shooterId);
    if (si < 0) return [];
    const side = clip.lineup[si].side;
    const opp = clip.lineup.map((p, i) => ({ i, p })).filter((r) => r.p.side !== side);
    return clip.frames.map((f) => {
      const s = playerAt(f, si);
      return Math.min(...opp.map((o) => dist(playerAt(f, o.i), s)));
    });
  }, [clip]);

  if (err) return <div className="pn-body"><div className="pn-note">{err}</div></div>;
  if (!clip || !read) {
    return <div className="pn-body"><div className="pn-note">loading tracked plays</div></div>;
  }

  const trailFrom = Math.max(0, frame - 18);
  const maxSep = Math.max(...separation, 8);

  return (
    <div className="pn-body ps">
      {/* ---- which play ------------------------------------------------------ */}
      <select
        className="ps-pick"
        value={`${clip.gameId}:${clip.eventId}`}
        onChange={(e) => {
          const [g, ev] = e.target.value.split(":").map(Number);
          const p = plays.find((x) => x.gameId === g && x.eventId === ev);
          if (p) load(p);
        }}
      >
        {plays.map((p) => (
          <option key={`${p.gameId}:${p.eventId}`} value={`${p.gameId}:${p.eventId}`}>
            {p.away} at {p.home} · {p.action} · {p.distance} ft · {p.made ? "made" : "missed"}
          </option>
        ))}
      </select>

      {/* ---- the floor ------------------------------------------------------- */}
      <TacticalBoard
        label={`Ten tracked players, ${clip.away.abbr} at ${clip.home.abbr}, ${clip.action} from ${clip.distance} feet, ${clip.made ? "made" : "missed"}`}
      >
        {/* where each player came from */}
        {clip.lineup.map((p, i) => {
          const pts = clip.frames.slice(trailFrom, frame + 1)
            .map((f) => { const q = playerAt(f, i); return `${fx(q.x)},${fz(q.z)}`; })
            .join(" ");
          const attacking = p.side === read.shooter?.side;
          return (
            <polyline
              key={`t${p.id}`} points={pts} fill="none"
              stroke={attacking ? TEAM.offense : TEAM.defense}
              strokeWidth={1.5} strokeOpacity={0.34} strokeLinecap="round"
            />
          );
        })}

        {/* who is guarding whom */}
        {read.marks.map((m) => (
          <line
            key={`m${m.d.id}`}
            x1={fx(m.d.x)} y1={fz(m.d.z)} x2={fx(m.a.x)} y2={fz(m.a.z)}
            stroke={INK.muted} strokeWidth={1} strokeDasharray="3 4" strokeOpacity={0.55}
          />
        ))}

        {/* the ball. Radius grows with height so a pass reads differently from a
            dribble without needing a second channel. */}
        <circle
          cx={fx(read.ball.x)} cy={fz(read.ball.z)}
          r={flen(0.8) + read.ball.h * 0.5}
          fill="none" stroke="#f5b04b" strokeWidth={1.2} strokeOpacity={0.5}
        />
        <circle cx={fx(read.ball.x)} cy={fz(read.ball.z)} r={flen(0.8)} fill="#f5b04b" />

        {/* the players */}
        {read.players.map((p) => (
          <g key={p.id}>
            {p.isShooter && (
              <circle cx={fx(p.x)} cy={fz(p.z)} r={flen(2.1)} fill="none"
                stroke={STATUS.good} strokeWidth={2} />
            )}
            <circle
              cx={fx(p.x)} cy={fz(p.z)} r={flen(1.45)}
              fill={p.attacking ? TEAM.offense : TEAM.defense}
              stroke={INK.surface} strokeWidth={2}
            />
            <text
              x={fx(p.x)} y={fz(p.z) + 4} textAnchor="middle"
              fontSize={11} fontWeight={700} fill="#fff"
            >
              {p.jersey}
            </text>
          </g>
        ))}
      </TacticalBoard>

      {/* ---- transport ------------------------------------------------------- */}
      <div className="ps-transport">
        <button className="ps-play" onClick={() => {
          if (frame >= clip.frames.length - 1) setFrame(0);
          setPlaying((v) => !v);
        }}>
          {playing ? "❚❚" : "▶"}
        </button>
        <input
          type="range" min={0} max={clip.frames.length - 1} value={frame}
          onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
        />
        <span className="ps-clock">
          {read.shotClock.toFixed(1)}<em>s</em>
        </span>
      </div>

      {/* ---- separation over the possession ---------------------------------- */}
      <div className="pn-label">Space on the shooter</div>
      <svg className="ps-sep" viewBox={`0 0 300 56`} role="img"
        aria-label={`Separation on the shooter across the possession, ending at ${read.onShooter?.toFixed(1)} feet`}>
        <line x1={0} y1={56 - (6 / maxSep) * 52} x2={300} y2={56 - (6 / maxSep) * 52}
          stroke={INK.grid} strokeWidth={1} strokeDasharray="4 4" />
        <polyline
          points={separation.map((s, i) =>
            `${(i / Math.max(separation.length - 1, 1)) * 300},${56 - (s / maxSep) * 52}`).join(" ")}
          fill="none" stroke={TEAM.offense} strokeWidth={2} strokeLinejoin="round" />
        <circle
          cx={(frame / Math.max(separation.length - 1, 1)) * 300}
          cy={56 - ((separation[frame] ?? 0) / maxSep) * 52}
          r={4} fill={TEAM.offense} stroke={INK.surface} strokeWidth={2} />
      </svg>
      <div className="ps-legend">
        <span><i style={{ background: TEAM.offense }} />attack</span>
        <span><i style={{ background: TEAM.defense }} />defence</span>
        <span><i className="ring" />shooter</span>
        <b>{read.onShooter != null ? `${read.onShooter.toFixed(1)} ft now` : ""}</b>
      </div>

      {/* ---- what the play was ----------------------------------------------- */}
      <div className="ps-facts">
        <div><span>Shot</span><b>{clip.action}</b></div>
        <div><span>From</span><b>{clip.distance} ft</b></div>
        <div><span>Result</span>
          <b className={clip.made ? "up" : "down"}>{clip.made ? "made" : "missed"}</b>
        </div>
        <div><span>Shooter</span><b>{read.shooter?.name ?? "·"}</b></div>
      </div>

      <div className="pn-note">
        {clip.away.abbr} at {clip.home.abbr}, {clip.date}. Recorded positions at 25 Hz, played
        from the first tracked frame.
      </div>
    </div>
  );
}
