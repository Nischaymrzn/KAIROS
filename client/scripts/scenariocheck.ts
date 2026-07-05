/**
 * SCENARIO CHECK — the guarantees the scenario engine is supposed to hold.
 *
 * The one that matters most: mechanics must never reach the model payload. The
 * backend's CourtScenario defaults every field it does not recognise, so a
 * jumpAngle sent to /predict/court would be silently dropped while looking, in
 * the network tab, as though the model consumed it. That is exactly the false
 * precision the build is meant to avoid, so it is asserted rather than trusted.
 */
import {
  DEFAULT_SCENARIO, FIELDS, OPEN_FLOOR_FT, Scenario, contest, contestIsLive, expectedPoints,
  layerOf, pointValue, shotDistance, toCourtPayload, zoneOf, ZONE_BASE, HOOP_X,
} from "../src/scenario/schema";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
};

const at = (x: number, z: number, over: Partial<Scenario> = {}): Scenario => ({
  ...DEFAULT_SCENARIO, ...over, shot: { ...DEFAULT_SCENARIO.shot, x, z },
});

console.log("payload contains only what the model accepts");
{
  const s = at(-26, 1.5);
  s.mechanics.jumpAngle = 71;
  s.mechanics.dribbles = 9;
  const p = toCourtPayload(s) as Record<string, unknown>;
  const allowed = new Set([
    "x", "z", "shotType", "playerId", "positionGroup",
    "quarter", "shotClock", "scoreMargin", "defenderDistance",
  ]);
  ok("no unexpected keys", Object.keys(p).every((k) => allowed.has(k)), Object.keys(p).join(","));
  ok("jumpAngle never sent", !("jumpAngle" in p));
  ok("dribbles never sent", !("dribbles" in p));
  ok("touchTime never sent", !("touchTime" in p));
  ok("releaseHeight never sent", !("releaseHeight" in p));
  // An empty floor is an OPEN shot, not a missing value. Omitting the field let
  // the model impute the training median, which lands where a defender at three
  // to four feet scores, so placing a body at a normal contest distance changed
  // nothing and the control looked broken.
  ok("an empty floor is sent as open, not omitted",
    p.defenderDistance === OPEN_FLOOR_FT, String(p.defenderDistance));
}

console.log("\nprovenance is declared for every control");
{
  // Under v7 this asserted the opposite, and correctly so: that window carries no
  // season where per-shot defender distance is public, so the column was constant
  // and the feature was dropped. v8 trains across 2014-15 and 2015-16, where the
  // measurement exists, so the model splits on it and a 26 ft pull-up sweeps
  // 0.3675 at 1 ft to 0.4230 at 12 ft. The check follows the artefact.
  ok("defenderDistance is a model feature under v8", layerOf("defenderDistance") === "model");
  ok("contest is reported live, not hardcoded", contestIsLive() === true);
  ok("jumpAngle is physics", layerOf("jumpAngle") === "physics");
  ok("dribbles is physics", layerOf("dribbles") === "physics");
  ok("shotClock is a model feature", layerOf("shotClock") === "model");
  ok("shot position is a model feature", layerOf("x") === "model");
  ok("every field carries a reason", Object.values(FIELDS).every((f) => f.note.length > 20));
}

console.log("\nzones follow NBA geometry");
{
  ok("at the rim -> restricted", zoneOf(at(HOOP_X + 2, 0)) === "restricted");
  ok("8 ft in the lane -> paint", zoneOf(at(HOOP_X + 7, 2)) === "paint");
  ok("18 ft wing -> midrange", zoneOf(at(HOOP_X + 14, 11)) === "midrange");
  ok("22 ft on the baseline -> corner3", zoneOf(at(HOOP_X + 3, 22.5)) === "corner3");
  ok("26 ft up top -> break3", zoneOf(at(HOOP_X + 25, 4)) === "break3");
  ok("threes are worth 3", pointValue(at(HOOP_X + 25, 4)) === 3);
  ok("twos are worth 2", pointValue(at(HOOP_X + 14, 11)) === 2);
}

console.log("\nderived values");
{
  const s = at(HOOP_X + 18, 0);
  ok("distance measured from the rim", Math.abs(shotDistance(s) - 18) < 1e-6);
  ok("xP = probability x point value", Math.abs(expectedPoints(s, 0.5) - 1.0) < 1e-9);
  const three = at(HOOP_X + 25, 4);
  ok("a 40% three beats a 50% two on xP",
    expectedPoints(three, 0.4) > expectedPoints(at(HOOP_X + 14, 11), 0.5),
    `${expectedPoints(three, 0.4).toFixed(2)} vs ${expectedPoints(at(HOOP_X + 14, 11), 0.5).toFixed(2)}`);
  ok("every zone has a league rate", Object.values(ZONE_BASE).every((z) => z.rate > 0.3 && z.rate < 0.7));
}

console.log("\ncontest geometry from placed defenders");
{
  const s = at(HOOP_X + 18, 0);
  ok("no defenders -> no contest", contest(s).closest === null && contest(s).helpers === 0);

  s.defenders = [
    { id: "a", x: HOOP_X + 14, z: 0, role: "primary" },
    { id: "b", x: HOOP_X + 10, z: 6, role: "help" },
    { id: "c", x: HOOP_X + 2, z: 1, role: "help" },
  ];
  const c = contest(s);
  ok("closest is the nearest defender", Math.abs((c.closest ?? 0) - 4) < 1e-6, `${c.closest?.toFixed(2)} ft`);
  ok("second closest ranked next", (c.second ?? 0) > (c.closest ?? 0));
  ok("helpers counts the rest", c.helpers === 2);
  ok("defender in the rim line reads ~0 degrees", (c.angle ?? 99) < 1, `${c.angle?.toFixed(1)} deg`);
  ok("closest reaches the payload", toCourtPayload(s).defenderDistance === 4);

  const side = at(HOOP_X + 18, 0);
  side.defenders = [{ id: "a", x: HOOP_X + 18, z: 5, role: "primary" }];
  ok("defender square to the side reads ~90 degrees",
    Math.abs((contest(side).angle ?? 0) - 90) < 1, `${contest(side).angle?.toFixed(1)} deg`);
}

// ---------------------------------------------------------------------------
// The legacy stores are now facades over the engine. If they stop mirroring,
// ~20 components silently show a situation the engine is not predicting on,
// which is worse than an error, so it is asserted rather than assumed.
console.log("\nlegacy stores mirror the engine");
{
  const { useScenarioStore } = await import("../src/scenario/scenarioStore");
  const { useShotStore } = await import("../src/state/shotStore");
  const { useDefenseStore } = await import("../src/state/defenseStore");
  const sc = () => useScenarioStore.getState();

  sc().setPosition(-30, 6);
  ok("shooter position mirrors",
    useShotStore.getState().scenario.x === -30 && useShotStore.getState().scenario.z === 6);

  sc().setShotType("stepback");
  ok("shot type mirrors", useShotStore.getState().scenario.shotType === "stepback");

  sc().setPlayer(201939, "G");
  ok("player mirrors", useShotStore.getState().scenario.playerId === 201939);

  sc().clearDefenders();
  ok("no defenders -> undefined distance",
    useShotStore.getState().scenario.defenderDistance === undefined);
  ok("defender list starts empty", useDefenseStore.getState().defenders.length === 0);

  sc().addDefender(-34, 6);
  sc().addDefender(-30, 12);
  ok("defenders reach the legacy store", useDefenseStore.getState().defenders.length === 2);
  ok("closest distance mirrors to the shot store",
    Math.abs((useShotStore.getState().scenario.defenderDistance ?? 0) - 4) < 0.11,
    `${useShotStore.getState().scenario.defenderDistance} ft`);

  // writing through the OLD api must move the ENGINE, not a private copy
  useShotStore.getState().setShotPosition(-26, 0);
  ok("legacy setter writes through to the engine", sc().scenario.shot.x === -26);

  useDefenseStore.getState().clearDefenders();
  ok("legacy clear writes through", sc().scenario.defenders.length === 0);

  useShotStore.getState().setDefenderDistance(3);
  const c = sc().derived().contest;
  ok("legacy distance setter places a real defender on the shot line",
    c.closest != null && Math.abs(c.closest - 3) < 0.05 && (c.angle ?? 99) < 1,
    `${c.closest?.toFixed(2)} ft at ${c.angle?.toFixed(1)} deg`);

  ok("capped at five defenders", (() => {
    sc().clearDefenders();
    for (let i = 0; i < 8; i++) sc().addDefender(-20 - i * 3, i * 3);
    return sc().scenario.defenders.length === 5;
  })());

  ok("clicking a placed defender removes him", (() => {
    sc().clearDefenders();
    sc().addDefender(-30, 5);
    sc().addDefender(-30, 5);
    return sc().scenario.defenders.length === 0;
  })());

  ok("first is primary, the rest are help", (() => {
    sc().clearDefenders();
    sc().addDefender(-34, 0);
    sc().addDefender(-30, 9);
    const ds = sc().scenario.defenders;
    return ds[0].role === "primary" && ds[1].role === "help";
  })());

  ok("moving the shooter re-derives contest", (() => {
    sc().clearDefenders();
    sc().setPosition(-26, 0);
    sc().addDefender(-30, 0);              // 4 ft away
    const before = sc().derived().contest.closest ?? 0;
    sc().setPosition(-28, 0);              // shooter steps toward him
    const after = sc().derived().contest.closest ?? 0;
    return Math.abs(before - 4) < 0.01 && Math.abs(after - 2) < 0.01;
  })());
}

// ---------------------------------------------------------------------------
// Placing a defender has to change the answer. This is the whole complaint the
// contest work addressed, so it is asserted end to end rather than trusted: the
// payload must carry the distance, and the offline heuristic — which is what
// answers when the API is unreachable, and which used to ignore contest
// completely — must return a different number for a different distance.
console.log("\nmoving a defender changes the prediction");
{
  const { offlinePredict } = await import("../src/state/offlinePredictor");
  const { useScenarioStore } = await import("../src/scenario/scenarioStore");
  const sc = () => useScenarioStore.getState();

  sc().clearDefenders();
  sc().setPosition(-24, 0);          // a 17.75 ft pull-up
  sc().setShotType("pullup");

  const open = offlinePredict(toCourtPayload(sc().scenario) as never).probability;

  sc().setNearestOnLine(1.5);        // smothered
  const tight = offlinePredict(toCourtPayload(sc().scenario) as never).probability;

  sc().setNearestOnLine(8);          // clean look
  const loose = offlinePredict(toCourtPayload(sc().scenario) as never).probability;

  ok("a smothered shot is worse than a clean one", tight < loose,
    `${tight.toFixed(3)} vs ${loose.toFixed(3)}`);
  ok("the swing is big enough to see", loose - tight > 0.02,
    `${((loose - tight) * 100).toFixed(1)} points`);
  ok("an empty floor reads as open", Math.abs(open - loose) < 0.06,
    `open ${open.toFixed(3)} vs 8 ft ${loose.toFixed(3)}`);
  sc().clearDefenders();
}

// A court click has to move the shooter by default. When defenders were mounted
// on only three of nine routes, defaulting to "defender" was harmless; they are
// placeable everywhere now, so that default would mean the shooter could never
// be moved by clicking the floor.
console.log("\nthe court's default click target");
{
  const { useDefenseStore } = await import("../src/state/defenseStore");
  ok("a court click moves the shooter unless told otherwise",
    useDefenseStore.getState().placement === "shooter",
    useDefenseStore.getState().placement);
}

// ---------------------------------------------------------------------------
// The API base must be RESOLVED before the first request, not guessed at.
// config.ts promises the client "must never break over port drift", and it did
// break: the base initialised to the first candidate unverified, so with
// .env.local pointing at :8001 and the backend on :8000 the boot prediction
// fired into nothing and fell back to the heuristic. Discovery then healed the
// base, so the status chip read "live model" beside a heuristic probability of
// 53 per cent where the model said 39.1 -- the interface contradicting itself,
// with the wrong number the more prominent of the two.
console.log("\nthe API base is resolved, and a change is announced");
{
  const cfg = await import("../src/api/config");
  ok("discovery can be awaited before the first request",
    typeof cfg.ensureApiBase === "function");
  ok("a base change is subscribable", typeof cfg.onApiBaseChange === "function");
  ok("a stale resolution can be invalidated",
    typeof cfg.invalidateApiBase === "function");

  let announced: string | null = null;
  const off = cfg.onApiBaseChange((b) => { announced = b; });
  ok("subscribing returns an unsubscribe", typeof off === "function");
  off();
  ok("no spurious announcement on subscribe", announced === null);
}

// ---------------------------------------------------------------------------
// The bug this guards: placing a defender did not change the number.
//
// An empty floor used to omit defenderDistance, the model imputed the training
// median for the missing column, and that imputation scores the same as a
// defender at three to four feet. So the difference between NOBODY guarding you
// and someone in your chest was nothing, which is the opposite of the one thing
// this feature exists to show.
console.log("\nan empty floor differs from a guarded one");
{
  const { offlinePredict } = await import("../src/state/offlinePredictor");
  const { useScenarioStore } = await import("../src/scenario/scenarioStore");
  const sc = () => useScenarioStore.getState();

  sc().clearDefenders();
  sc().setPosition(-26, 1.5);
  sc().setShotType("pullup");
  const openPayload = toCourtPayload(sc().scenario);
  const open = offlinePredict(openPayload as never).probability;

  sc().setNearestOnLine(3.2);
  const guardedPayload = toCourtPayload(sc().scenario);
  const guarded = offlinePredict(guardedPayload as never).probability;

  ok("an empty floor sends open, not a missing value",
    openPayload.defenderDistance === OPEN_FLOOR_FT,
    String(openPayload.defenderDistance));
  ok("a placed defender sends where he stands",
    Math.abs((guardedPayload.defenderDistance ?? 0) - 3.2) < 0.1,
    String(guardedPayload.defenderDistance));
  ok("putting a body on the floor lowers the shot", guarded < open,
    `${(open * 100).toFixed(1)}% open -> ${(guarded * 100).toFixed(1)}% guarded`);
  ok("and by enough to see", (open - guarded) * 100 > 1.5,
    `${((open - guarded) * 100).toFixed(1)} points`);
  sc().clearDefenders();
}

// ---------------------------------------------------------------------------
// A court click may only do what the current mode gives the user a control for.
//
// Placement is a sticky global set from the command bar, which only Court and
// Coach mount. Choosing "defender" in Court and switching to Predict left every
// click dropping defenders into a scored question, with nothing on screen to
// turn it off. Capability now follows the mode that owns the control.
console.log("\na click can only do what the mode offers a control for");
{
  const { layersFor } = await import("../src/workspace/layers");
  const none: never[] = [];

  ok("Court can place defenders", layersFor(none, "court").placeDefenders);
  ok("Coach can place defenders", layersFor(none, "coach").placeDefenders);
  ok("Predict cannot place defenders", !layersFor(none, "predict").placeDefenders);
  ok("Learn cannot place defenders", !layersFor(none, "learn").placeDefenders);

  // Predict deals the scenario and scores the call, so no click may edit it.
  ok("Predict takes no court clicks at all", !layersFor(none, "predict").interact);
  for (const m of ["court", "coach", "learn"] as const) {
    ok(`${m} still takes court clicks`, layersFor(none, m).interact);
  }

  // Drawn and editable are different questions; conflating them was the bug.
  for (const m of ["court", "predict", "coach", "learn"] as const) {
    ok(`${m} still draws the defenders`, layersFor(none, m).placedDefenders);
  }
}

// ---------------------------------------------------------------------------
// THE SHOT CAN ACTUALLY BE FIRED.
//
// Pressing SHOOT does three things in sequence: the scenario bumps a signal, the
// shot store mirrors it, and the scene has a shooter and an arc mounted to act on
// it. Break any link and the button still looks live, still enables, still
// animates its hover — and nothing happens. That is exactly how this failed:
// putting a tracked possession on the floor unmounts the shooter and the arc, so
// SHOOT silently became a no-op with no way to tell from the screen.
console.log("\npressing shoot reaches the scene");
{
  const { layersFor } = await import("../src/workspace/layers");
  const { useShotStore } = await import("../src/state/shotStore");
  const { useScenarioStore: sc } = await import("../src/scenario/scenarioStore");
  const none = [] as never[];

  // 1. the signal moves
  const before = sc.getState().shootSignal;
  sc.getState().triggerShot();
  const after = sc.getState().shootSignal;
  ok("firing bumps the scenario signal", after === before + 1, `${before} -> ${after}`);

  // 2. the shot store, which the scene subscribes to, sees the same bump
  ok("the shot store mirrors the signal the scene reads",
    useShotStore.getState().shootSignal === after,
    `${useShotStore.getState().shootSignal} vs ${after}`);

  // 3. something is mounted to act on it, in every mode that shows the button
  for (const m of ["court", "coach", "learn"] as const) {
    const L = layersFor(none, m);
    ok(`${m} mounts a shooter to take it`, L.shooter);
    ok(`${m} mounts the arc that flies the ball`, L.arc);
  }

  // A tracked possession deliberately takes the floor, and the command bar
  // closes it before firing so the button is never a no-op.
  const withReplay = layersFor(none, "court", true);
  ok("a tracked possession takes the shooter off the floor",
    !withReplay.shooter && !withReplay.arc);
  ok("and puts its own ten players there instead", withReplay.replay);
}

// ---------------------------------------------------------------------------
// A tracked possession hands the shot over.
//
// The clip's last frame is the release, so the recording stops where the shot
// starts. Reconstructing a flight nobody recorded was the first attempt and the
// wrong one: the possession now sets the scenario to the situation it produced —
// shooter on his release spot, his nearest defender on his, the recorded action —
// and the user fires it with the real model behind it.
//
// Asserted here rather than on screen because the scene this runs in cannot be
// screenshotted on a software renderer.
console.log("\na tracked possession hands over a shootable scenario");
{
  const { handoffScenario, verbFor } = await import("../src/scene/TrackedPlay");

  // two attackers and two defenders; the shooter is 0, and 3 is nearest to him
  const clip = {
    shooterId: 10,
    action: "Turnaround Fadeaway shot",
    lineup: [
      { id: 10, side: "home" }, { id: 11, side: "home" },
      { id: 20, side: "away" }, { id: 21, side: "away" },
    ],
    //      clock shot ballx ballz ballh | p0        p1        p2         p3
    frames: [
      [24, 20, -30, 0, 6, -20, 0, -25, 8, -34, 9, -30, 12],
      [23, 19, -26, 2, 7, -26, 2, -24, 7, -33, 8, -27, 3],
    ],
  };

  const h = handoffScenario(clip)!;
  ok("the shooter lands on his release spot",
    h.shot[0] === -26 && h.shot[1] === 2, `${h.shot[0]}, ${h.shot[1]}`);
  ok("the NEAREST defender is the one placed",
    !!h.defender && h.defender[0] === -27 && h.defender[1] === 3,
    h.defender ? `${h.defender[0]}, ${h.defender[1]}` : "none");
  ok("the contest it reports is the distance between them",
    h.contestFt != null && Math.abs(h.contestFt - Math.hypot(1, 1)) < 0.01,
    `${h.contestFt} ft`);
  ok("the recorded action becomes the selected verb", h.verb === "fadeaway", h.verb);

  // action strings are matched on the longest phrase, or "Driving Layup" would
  // resolve to a standing layup
  ok("driving layup does not collapse to layup",
    verbFor("Driving Layup Shot") === "driving_layup");
  ok("step back does not collapse to a jump shot",
    verbFor("Step Back Jump shot") === "stepback");
  ok("an unknown action falls back rather than throwing",
    verbFor("Some New Shot") === "pullup");

  // a clip whose shooter is missing from the lineup must not place anything
  ok("a clip with no identifiable shooter hands over nothing",
    handoffScenario({ ...clip, shooterId: 999 }) === null);
}

// ---------------------------------------------------------------------------
// EXACTLY ONE PLAYER OWNS THE BALL.
//
// `handTracker` is a single global that the ball rides. Every mounted Player used
// to write it every frame, so with defenders on the floor the last one rendered
// won and the ball sat in a DEFENDER's hand. The bug cannot appear until a second
// body exists, which is why it survived so long, and it comes straight back if
// anyone adds `tracksHands` to a second component without thinking.
//
// A source check, because the thing being protected is an ownership rule rather
// than a value: no amount of rendering proves that only one writer exists.
console.log("\nexactly one player publishes hands for the ball");
{
  const { readFileSync, readdirSync, statSync } = await import("fs");
  const { join, basename } = await import("path");
  const SRC = new URL("../src", import.meta.url).pathname.replace(/^.([A-Za-z]:)/, "$1");

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const f = join(dir, e);
      if (statSync(f).isDirectory()) walk(f, out);
      else if (f.endsWith(".tsx") || f.endsWith(".ts")) out.push(f);
    }
    return out;
  };
  const files = walk(SRC).map((f) => ({ name: basename(f), src: readFileSync(f, "utf8") }));

  // Components that ASK to own the ball. Player.tsx defines and consumes the
  // prop, so it is the declaration site rather than a claim.
  const owners = files
    .filter((f) => f.name !== "Player.tsx" && f.src.includes("tracksHands"))
    .map((f) => f.name);
  ok("only one component claims the ball", owners.length === 1, owners.join(", ") || "none");
  ok("and it is the shooter", owners[0] === "ShooterPlayer.tsx", owners[0] ?? "none");

  // `handTracker.live = true` is the unambiguous write. handTracker.ts declares
  // the singleton; everything else either writes it or merely reads it.
  const writers = files
    .filter((f) => f.name !== "handTracker.ts" && f.src.includes("handTracker.live = true"))
    .map((f) => f.name);
  ok("the tracker is written from one place only", writers.length === 1,
    writers.join(", ") || "none");
  ok("that place is the generic Player, behind the opt-in",
    writers[0] === "Player.tsx", writers[0] ?? "none");

  // and the write must be guarded, not unconditional
  const player = files.find((f) => f.name === "Player.tsx")!;
  ok("the write sits behind the tracksHands guard",
    player.src.includes("if (tracksHands)"));
}

// ---------------------------------------------------------------------------
// The handoff lands the bodies on the LAST DOT, exactly.
//
// The synthetic case above proves the arithmetic. This proves it against the real
// corpus, because the requirement is precision: the 3D shooter has to stand where
// the final marker stood, not near it.
//
// It also checks the anchor itself. An audit of all 188 clips found the last frame
// agrees with the RECORDED shot distance for 97.3% of them (median error 1.07 ft),
// so the last frame really is the release and is the right thing to hand over.
console.log("\nthe handoff lands on the last marker, against real clips");
{
  const { handoffScenario } = await import("../src/scene/TrackedPlay");
  const { listReplays, getReplay } = await import("../src/api");
  const P0 = 5;
  const RIM_X = -41.75;

  try {
    const list = await listReplays(6);
    let checked = 0;
    let exact = 0;
    let defExact = 0;
    let anchored = 0;

    for (const row of list.plays.slice(0, 5)) {
      const clip = await getReplay(row.gameId, row.eventId);
      const h = handoffScenario(clip);
      if (!h) continue;
      checked++;

      const f = clip.frames[clip.frames.length - 1];
      const si = clip.lineup.findIndex((q) => q.id === clip.shooterId);
      const sx = f[P0 + si * 2];
      const sz = f[P0 + si * 2 + 1];
      if (h.shot[0] === sx && h.shot[1] === sz) exact++;

      // the placed defender is the nearest opponent at that same frame
      let bx = 0, bz = 0, best = Infinity;
      clip.lineup.forEach((q, i) => {
        if (q.side === clip.lineup[si].side) return;
        const x = f[P0 + i * 2], z = f[P0 + i * 2 + 1];
        const d = Math.hypot(x - sx, z - sz);
        if (d < best) { best = d; bx = x; bz = z; }
      });
      if (h.defender && h.defender[0] === bx && h.defender[1] === bz) defExact++;

      // the frame handed over is really the release: his distance to the rim
      // should match the shot distance the record carries
      const rimDist = Math.hypot(sx - RIM_X, sz);
      if (Math.abs(rimDist - clip.distance) <= 3) anchored++;
    }

    ok("real clips hand over at all", checked > 0, `${checked} checked`);
    ok("the shooter lands on the exact final marker", exact === checked,
      `${exact} of ${checked}`);
    ok("the defender lands on the exact nearest opponent", defExact === checked,
      `${defExact} of ${checked}`);
    ok("the handed-over frame is the release", anchored === checked,
      `${anchored} of ${checked} within 3 ft of the recorded distance`);
  } catch {
    console.log("  skip  no replay corpus served; run the API to check this");
  }
}

console.log(fail === 0 ? "\nall scenario checks passed" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
