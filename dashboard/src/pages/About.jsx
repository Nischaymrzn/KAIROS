export function About() {
  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="h-title text-2xl">About HoopIQ</h1>
      </header>

      <div className="space-y-6">
        <section className="card">
          <h2 className="h-title text-lg mb-3">What this is</h2>
          <p className="text-sm text-txt-secondary leading-relaxed">
            Field-goal percentage treats every shot the same. A contested pull-up with two seconds on the
            shot clock and a wide-open corner catch-and-shoot count identically in a box score, even though
            one is a far harder attempt than the other. HoopIQ scores a shot on its own terms: given where it
            was taken, what kind of shot it was, who took it and what was happening at the time, how often
            does an attempt like this actually go in?
          </p>
          <p className="text-sm text-txt-secondary leading-relaxed mt-3">
            It is built for coaches and players thinking about shot selection, not for people who want a
            single number to settle an argument. Every prediction comes with the factors that drove it.
          </p>
        </section>

        <section className="card">
          <h2 className="h-title text-lg mb-3">How it works</h2>
          <p className="text-sm text-txt-secondary leading-relaxed">
            The model is gradient boosting trained on NBA shot events. Each shot carries where it was taken
            from, the action type, the zone, the game period and clock, a reconstructed shot clock, and
            player-level context: measured profile, tracking tendencies and historical shooting rates. Every
            statistic derived from the data is fitted on the training seasons only.
          </p>
          <p className="text-sm text-txt-secondary leading-relaxed mt-3">
            The split is chronological. Earlier seasons train, a later season is held out, and it is read
            once. Random splits are not used, because they let future games inform predictions about the
            past. Eight model families were compared on identical data before one was selected.
          </p>
          <p className="text-sm text-txt-secondary leading-relaxed mt-3">
            The output is a calibrated probability, not a verdict. Calibrated means that across all the shots
            the model calls 40%, close to 40% of them go in.
          </p>
        </section>

        <section className="card">
          <h2 className="h-title text-lg mb-3">Known Limitations</h2>
          <p className="text-xs text-txt-muted mb-4 leading-relaxed">
            Each of these was measured rather than estimated. The figures come from the
            held-out 2025-26 test season (n = 219,157) unless stated otherwise.
          </p>
          <ul className="space-y-4 text-sm text-txt-secondary leading-relaxed mb-6">
            <li>
              <span className="text-txt-primary">Defender distance.</span> The core model does not
              incorporate per-shot defender distance for seasons after 2015-16. That data is
              commercially restricted to NBA franchises. The defender slider applies an estimated
              contextual adjustment based on the 2014-15 shot logs dataset, which is the only
              public source for this variable. Sweeping it moves the core model&apos;s output by
              exactly zero; the adjusted figure is shown separately from the calibrated one.
            </li>
            <li>
              <span className="text-txt-primary">Thin-support players.</span> Players with fewer
              than 50 shots in training data are under-predicted by approximately{" "}
              <span className="stat">2.8 percentage points</span> (gap −0.0277, 95% CI
              [−0.0395, −0.0169], n = 6,340). The model over-shrinks toward the league average for
              players with limited history. Players with <em>no</em> history are handled correctly,
              so it is the thin sliver of data that misleads it, not the absence of data. Per-band
              recalibration was tried as a fix and rejected: three of five bands got worse.
            </li>
            <li>
              <span className="text-txt-primary">Three-point AUC.</span> The model discriminates
              better at the rim (<span className="stat">AUC 0.72</span>) than on three-point
              attempts (<span className="stat">AUC 0.60</span>). Three-pointers vary less
              contextually — one open three looks much like another at the model&apos;s feature
              resolution, whereas a layup&apos;s difficulty swings enormously with context.
            </li>
            <li>
              <span className="text-txt-primary">Single-shot ceiling.</span> Post-release entry
              angle has an R² of just <span className="stat">0.046</span> from pre-release
              features. The millimetres of wrist angle at release that determine make or miss are
              not recoverable from contextual data. AUC 0.70 is the frontier of public data, not a
              shortfall — the same methods reach 0.81 on the player-season task, where that
              execution noise averages out.
            </li>
          </ul>
          <h3 className="h-title text-sm mb-3 pt-4 border-t border-line">General</h3>
          <ul className="space-y-3 text-sm text-txt-secondary leading-relaxed">
            <li>
              <span className="text-txt-primary">Tracking data.</span> Raw player-tracking data after the
              2015-16 season is commercially restricted and is not public. This system uses aggregated
              tracking summaries and engineered features from publicly available NBA data. Per-shot defender
              distance therefore does not exist across the modelling window, and the core model is blind to
              contest: the defender controls in this app inform the trajectory and the suggestions, not the
              core prediction.
            </li>
            <li>
              <span className="text-txt-primary">Irreducible uncertainty.</span> A shot outcome is close to a
              coin flip. The league makes about 47% of attempts, and even a dunk misses roughly one time in
              nine. Most of the error in any shot-make model is fixed by that fact before any modelling
              begins. A model claiming very high accuracy on single shots has almost certainly leaked
              information that would not be available before the ball is released.
            </li>
            <li>
              <span className="text-txt-primary">Advisory only.</span> This is a probability, not a guarantee,
              and not an instruction. Decisions remain with coaches and players.
            </li>
            <li>
              <span className="text-txt-primary">Data scope.</span> All data is public and event-level. No
              biometric or personal data is used.
            </li>
          </ul>
        </section>

        <section className="card">
          <h2 className="h-title text-lg mb-3">Academic context</h2>
          <p className="text-sm text-txt-secondary leading-relaxed">
            BSc (Hons) Computing with Artificial Intelligence, individual project. The research question is
            how much predictive value contextual machine learning adds over a zone-average expected-points
            baseline, and where the ceiling on that value lies.
          </p>
        </section>
      </div>
    </div>
  );
}
