/**
 * TEAM KITS — real colourways, as plain data.
 *
 * This lives in `config/` rather than beside the material builders on purpose.
 * `playerMaterials.ts` already imports `UniformConfig` from `PlayerConfig.ts`, so
 * defining the kits there and reading them from `DEFAULT_PLAYER` closed an import
 * cycle. `TEAM_KITS` is read while `PlayerConfig` is still evaluating its own
 * module body, which is exactly the case where a cycle resolves to `undefined`
 * instead of failing loudly. A leaf module with no imports cannot do that.
 *
 * `primaryColor` is the HOME body and `secondaryColor` the trim; `resolveKit`
 * swaps them for the away strip. Adding a team is a row here and nothing else.
 */
export const TEAM_KITS = {
  lakers: {
    teamName: "LAKERS",
    primaryColor: "#fdb927",   // gold body, the Icon strip
    secondaryColor: "#552583", // purple numbers and trim
    accentColor: "#552583",
    /** the thin line between number and body that real twill always carries */
    outlineColor: "#ffffff",
    shoeColor: "#f4f4f6",
    sockColor: "#f4f4f6",
  },
  /**
   * The opposing strip. Crimson, and the hue was measured rather than picked.
   *
   * Two earlier attempts failed for different reasons. Slate and white went
   * nearly black under the rim lights and against the dark lower bowl, so the
   * game read as "the gold ones and some shadows". Royal fixed that against gold
   * — 47 ΔE apart, excellent — but it lands 8.9 ΔE from the PAINTED KEY, well
   * under the 15 floor where two colours stop being separable, so a defender
   * standing in the paint disappeared into the floor.
   *
   * A kit has to clear three surfaces, not one: the other team, the key, and the
   * hardwood. Crimson is the only candidate tested that clears all three
   * (32 / 31 / 23), which is why it is here instead of something chosen to look
   * smart next to gold.
   */
  opponent: {
    teamName: "CRIMSON",
    primaryColor: "#c8323c",   // crimson body
    secondaryColor: "#f7f2ee", // bone-white numbers and trim
    accentColor: "#f7f2ee",
    outlineColor: "#4a0d12",
    shoeColor: "#f7f2ee",
    sockColor: "#f7f2ee",
  },
} as const;

export type TeamKitId = keyof typeof TEAM_KITS;
