/**
 * TYPOGRAPHY CHECK — the two faces stay in their lanes.
 *
 * The interface mixes Space Grotesk and Inter. A mix only works if the boundary
 * is a rule rather than a mood, so this asserts the rule mechanically:
 *
 *   Space Grotesk  names, section labels, buttons that read as labels, and any
 *                  number a reader scans for a value.
 *   Inter          everything anyone actually reads as a sentence.
 *
 * Three ways that decays without anyone noticing, all caught here:
 *
 *  1. A selector in the display block stops existing because the component was
 *     renamed or deleted. The rule then sits in the bundle styling nothing, and
 *     the element it used to style silently falls back to Inter. Not
 *     hypothetical: writing that block the first time left five dead selectors,
 *     one of them inherited from a panel deleted in an earlier pass.
 *  2. Someone adds a prose class to the display block, and paragraphs start
 *     rendering in a face chosen for numerals.
 *  3. index.html stops requesting a family the tokens still name, so the whole
 *     thing degrades to the fallback stack without a single error.
 *
 * Static on purpose. It reads the stylesheets and the components rather than a
 * browser, because the app owns a WebGL canvas and a headless render is the
 * least reliable way to learn something this check can prove from the source.
 *
 *   npx tsx scripts/typecheck-fonts.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");

let fail = 0;
const assert = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
};

/** Every file under src with the given extension. */
function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

/**
 * Comments sit between `}` and the next `{`, exactly where the crude rule
 * splitter below reads a selector from. Leaving them in made a comment
 * containing the word "value" turn an unrelated rule into an apparent numeric
 * readout, which is how this check first reported a fault that was its own.
 */
const decomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const cssFiles = walk(SRC, ".css");
const tsxFiles = walk(SRC, ".tsx");
const allCss = cssFiles.map((f) => decomment(readFileSync(f, "utf8"))).join("\n");
const allTsx = tsxFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

/** Selector text and declaration body for every rule in the stylesheets. */
function* rules(css: string) {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    yield { sel: m[1].trim(), body: m[2] };
  }
}

// ---------------------------------------------------------------------------
console.log("both faces are requested and defined");

const link = html.match(/fonts\.googleapis\.com\/css2\?([^"]+)/)?.[1] ?? "";
assert("index.html requests Inter", /family=Inter:/.test(link));
assert("index.html requests Space Grotesk", /family=Space\+Grotesk:/.test(link));
assert("the request is one stylesheet, not two round trips",
  (html.match(/fonts\.googleapis\.com\/css2/g) ?? []).length === 1);
assert("display=swap, so text paints before the font arrives", /display=swap/.test(link));

const tokens = readFileSync(join(SRC, "design/tokens.css"), "utf8");
const displayToken = tokens.match(/--font-display:\s*([^;]+);/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
const sansToken = tokens.match(/--font-sans:\s*([^;]+);/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";

assert("--font-display leads with Space Grotesk",
  displayToken.startsWith('"Space Grotesk"'), displayToken.slice(0, 44));
assert("--font-sans leads with Inter", sansToken.startsWith("Inter"), sansToken.slice(0, 44));
assert("--font-display falls back through Inter", displayToken.includes("Inter"));
assert("--font-display ends on a sans fallback, not a serif",
  displayToken.split(",").pop()!.trim() === "sans-serif");

// A family named in the tokens but never fetched degrades with no error at all.
for (const fam of ["Space Grotesk", "Inter"]) {
  const named = displayToken.includes(fam) || sansToken.includes(fam);
  assert(`${fam} is both named and fetched`, !named || link.includes(fam.replace(/ /g, "+")));
}

// ---------------------------------------------------------------------------
console.log("\nevery selector wearing the display face still exists");

// Two different questions need two different readings of the same selectors.
//
//   displaySelectors  the class each selector ANCHORS on. Used for liveness: if
//                     `.cx-note b` is in the sheet, `.cx-note` had better still
//                     exist in a component.
//   dressedDirectly   only selectors that target the class ITSELF. Used for the
//                     prose check, because `.cx-note b` puts the display face on
//                     a nested numeral, not on the sentence around it. Reading
//                     the anchor there would report prose in the wrong face when
//                     the prose is in the right one.
const displaySelectors = new Set<string>();
const dressedDirectly = new Set<string>();
for (const { sel, body } of rules(allCss)) {
  if (!body.includes("var(--font-display)")) continue;
  for (const one of sel.split(",")) {
    const s = one.trim();
    const cls = s.match(/^\.([a-z][a-z0-9-]*)/i)?.[1];
    if (!cls) continue;
    displaySelectors.add(cls);
    // no descendant, child or sibling step after the class itself
    if (/^\.[a-z][a-z0-9-]*(:[a-z-]+(\([^)]*\))?)*$/i.test(s)) dressedDirectly.add(cls);
  }
}
assert("the display block is not empty", displaySelectors.size > 0,
  `${displaySelectors.size} selectors`);

// className="a b", className={`a ${x}`} and clsx-style joins all leave the class
// as a bare token in the source, so a word-boundary search is enough.
const dead = [...displaySelectors].filter((c) => !new RegExp(`\\b${c}\\b`).test(allTsx));
assert("no display selector styles a component that no longer exists",
  dead.length === 0, dead.length ? dead.join(", ") : `all ${displaySelectors.size} live`);

// ---------------------------------------------------------------------------
console.log("\nprose stays in the face built for prose");

// Anything whose name says it holds a sentence must never take the display face.
const proseClasses = [...new Set(
  [...allTsx.matchAll(/\b([a-z]+-(?:note|body|copy|desc|text|hint))\b/g)].map((m) => m[1]),
)];
assert("there are prose classes to check", proseClasses.length > 0,
  `${proseClasses.length} found`);

const misdressed = proseClasses.filter((c) => dressedDirectly.has(c));
assert("no prose class wears the display face", misdressed.length === 0,
  misdressed.length ? misdressed.join(", ") : proseClasses.slice(0, 6).join(", "));

// ---------------------------------------------------------------------------
console.log("\nthe faces are reached through tokens, never named inline");

const offenders: string[] = [];
for (const f of cssFiles) {
  if (f.endsWith("tokens.css")) continue;        // the one file allowed to name them
  for (const m of decomment(readFileSync(f, "utf8")).matchAll(/font-family:\s*([^;]+);/g)) {
    if (!m[1].includes("var(--font")) offenders.push(`${relative(ROOT, f)}: ${m[1].trim()}`);
  }
}
assert("no stylesheet hard-codes a family outside tokens.css",
  offenders.length === 0, offenders.slice(0, 3).join(" | ") || "all via var(--font-*)");

// Numerals must not reflow as their digits change. That is the entire reason the
// display face is allowed on them, so it is checked rather than assumed.
let numeral = 0;
let untabular = 0;
for (const { sel, body } of rules(allCss)) {
  if (!body.includes("var(--font-display)")) continue;
  // Only the element that actually SHOWS the figure. Keying on the whole
  // selector flagged `.al-nums span`, which is the uppercase label beside the
  // number, not the number — a block named "nums" contains both.
  const target = sel.split(",")[0].trim().split(/\s+/).pop() ?? "";
  if (!/^(b|strong)$/.test(target) && !/pct|num|val/.test(target)) continue;
  numeral++;
  if (!/tabular-nums|var\(--tnum\)/.test(body)) untabular++;
}
assert("numeric readouts are tabular so they do not jitter",
  untabular === 0, `${numeral - untabular} of ${numeral} rules`);

console.log(fail === 0 ? "\nall typography checks passed" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
