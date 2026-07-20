/**
 * SHOT LIBRARY — the index into the shot system.
 *
 * Filtering is client-side over a small in-memory registry (10 entries today,
 * ~25 at full scope), so there is no request, no virtualization and no debounce
 * needed. If the registry ever exceeds a few hundred entries this grid should be
 * virtualized — but adding that now would be complexity without a measurement.
 *
 * Every card links to the SAME detail template; there are no per-shot layouts.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SHOTS, ZONES, type ShotFamily } from "./registry";
import { SectionHeader, EmptyState } from "./components";

const FAMILIES: { id: ShotFamily | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "jumper", label: "Jumpers" },
  { id: "finish", label: "Finishing" },
  { id: "post", label: "Post" },
  { id: "set", label: "Set shots" },
];

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function ShotLibraryPage() {
  const [family, setFamily] = useState<ShotFamily | "all">("all");
  const [query, setQuery] = useState("");

  const shots = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SHOTS.filter((s) => {
      if (family !== "all" && s.family !== family) return false;
      if (!q) return true;
      return s.label.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q);
    });
  }, [family, query]);

  return (
    <div className="panel shot-library">
      <SectionHeader
        title="Shot library"
        subtitle="Every shot uses the same page: mechanics, live model prediction, coaching, self-checks."
      />

      <div className="lib-controls">
        <div className="seg" role="tablist" aria-label="Shot family">
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={family === f.id}
              className={`seg-btn ${family === f.id ? "on" : ""}`}
              onClick={() => setFamily(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="lib-search"
          type="search"
          placeholder="Search shots…"
          aria-label="Search shots"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {shots.length === 0 ? (
        <EmptyState
          title="No shots match"
          body="Try a different family or clear the search."
          action={<button className="btn" onClick={() => { setFamily("all"); setQuery(""); }}>Reset</button>}
        />
      ) : (
        <ul className="shot-grid">
          {shots.map((s) => (
            <li key={s.id}>
              <Link className="shot-card" to={`/shots/${s.id}`}>
                <div className="shot-card-head">
                  <span className="shot-card-title">{s.label}</span>
                  <span className={`badge fam-${s.family}`}>{s.family}</span>
                </div>
                <p className="shot-card-sum">{s.summary}</p>
                <div className="shot-card-foot">
                  <span className="shot-card-stat">
                    {s.leagueRate !== null ? pct(s.leagueRate) : "·"}
                    <span className="dim"> league avg</span>
                  </span>
                  <span className="shot-card-zones">
                    {s.zones.slice(0, 3).map((z) => ZONES[z].label).join(" · ")}
                    {s.zones.length > 3 && ` +${s.zones.length - 3}`}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="lib-note">
        League averages are measured over 2,524,865 NBA shots (2014-26). Mechanics
        and coaching cues are standard instruction, not model output — the platform
        has no camera and cannot analyse your own form.
      </p>
    </div>
  );
}

export default ShotLibraryPage;
