import { TEAM_KITS } from "./kits";
/**
 * PLAYER CONFIG — the single, serialisable description of a player. Everything a
 * player looks like (and, later, plays like) is derived from this object; nothing
 * downstream hard-codes a body measurement or colour. Units are FEET (the court's
 * world unit) so a 6.5 ft config measures exactly 6.5 ft against the 10 ft rim.
 *
 * Design notes (how real games do it):
 *   • Physical attributes drive the anthropometry solver (config/anthropometry.ts),
 *     which converts them into a BodyPlan (joint positions, segment sizes).
 *   • Appearance/equipment are material + attachment choices on the same rig.
 *   • The config is plain data → trivially stored, networked, or generated later
 *     (real rosters, AI, multiplayer). Face-geometry attributes (nose/mouth/ear
 *     shape…) are reserved in the schema now; a procedural face at this fidelity
 *     would look uncanny, so the stylised head keeps them as future morph hooks.
 */

// ---- physical ---------------------------------------------------------------
export interface PhysicalConfig {
  /** standing height in FEET (NBA range ≈ 5.9 – 7.4) */
  height: number;
  /** wingspan as a ratio of height (NBA average ≈ 1.06) */
  wingspanRatio: number;
  /** shoulder (biacromial) width as a ratio of height (NBA ≈ 0.245 – 0.27) */
  shoulderWidthRatio: number;
  /** 0 = slender … 1 = maximum muscle definition */
  muscularity: number;
  /** 0 = very lean … 1 = heavy-set (widens waist/hips) */
  bodyFat: number;
  /** chest depth/size multiplier around 1 */
  chestScale: number;
  /** legs as a fraction of height; 0 keeps the anthropometric default */
  legLengthBias: number; // -0.05 … +0.05
  /** hand length multiplier around 1 (affects hand meshes) */
  handScale: number;
  /** shoe length multiplier around 1 */
  shoeScale: number;
  /** neck thickness multiplier around 1 */
  neckScale: number;
}

// ---- appearance --------------------------------------------------------------
export type HairStyle = "bald" | "short" | "curly" | "highTop";
export type BeardStyle = "none" | "stubble" | "full" | "goatee";

export interface AppearanceConfig {
  /** index into SKIN_TONES (materials/playerMaterials.ts) */
  skinTone: number;
  hairStyle: HairStyle;
  hairColor: string;
  beard: BeardStyle;
  beardColor: string;
  /** reserved future morph hooks (not yet rendered on the stylised head) */
  faceShape?: number;
  eyeColor?: string;
  noseShape?: number;
  mouthShape?: number;
  earShape?: number;
  eyebrows?: number;
}

// ---- equipment / uniform -------------------------------------------------------
export interface UniformConfig {
  teamName: string;
  number: string; // "0"–"99"
  kit: "home" | "away";
  /** home kit: primary = jersey body colour; away swaps with secondary */
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  shoeColor: string;
  sockColor: string;
  headband: boolean;
  wristbands: boolean;
  armSleeve: "none" | "left" | "right" | "both";
  legSleeve: "none" | "left" | "right" | "both";
}

// ---- gameplay / AI attributes ---------------------------------------------------
/**
 * 0–99 ratings (2K-style). Not rendered — they exist so future systems (AI
 * decision models, physics, the KAIROS shot-quality backend) read ability from
 * the same config that drives the body. E.g. `vertical` will set jump apex,
 * `speed` the locomotion clip rate, and shooting ratings can be mapped from the
 * ML player-skill tables served by the backend.
 */
export interface AttributeConfig {
  speed: number;
  acceleration: number;
  vertical: number;
  strength: number;
  stamina: number;
  shootingClose: number;
  shootingMid: number;
  shootingThree: number;
}

export type CourtPosition = "PG" | "SG" | "SF" | "PF" | "C";

export interface PlayerConfig {
  id: string;
  name: string;
  /** court position (drives archetype defaults; kept on the config for AI) */
  position: CourtPosition;
  physical: PhysicalConfig;
  appearance: AppearanceConfig;
  uniform: UniformConfig;
  attributes: AttributeConfig;
}

// ---- defaults ------------------------------------------------------------------
/** A representative modern wing: 6'6", +6% wingspan, athletic build. */
export const DEFAULT_PLAYER: PlayerConfig = {
  id: "default",
  name: "Player One",
  position: "SF",
  attributes: {
    speed: 80,
    acceleration: 80,
    vertical: 78,
    strength: 72,
    stamina: 85,
    shootingClose: 75,
    shootingMid: 72,
    shootingThree: 70,
  },
  physical: {
    height: 6.5,
    wingspanRatio: 1.06,
    shoulderWidthRatio: 0.26,
    muscularity: 0.65,
    bodyFat: 0.25,
    chestScale: 1.0,
    legLengthBias: 0,
    handScale: 1.0,
    shoeScale: 1.0,
    neckScale: 1.0,
  },
  appearance: {
    skinTone: 1,
    hairStyle: "short",
    hairColor: "#17120e",
    beard: "stubble",
    beardColor: "#17120e",
  },
  uniform: {
    // The Lakers gold strip, number 24. A real colourway rather than an invented
    // one is what makes the tank read as a jersey instead of a coloured vest.
    teamName: TEAM_KITS.lakers.teamName,
    number: "24",
    kit: "home",
    primaryColor: TEAM_KITS.lakers.primaryColor,
    secondaryColor: TEAM_KITS.lakers.secondaryColor,
    accentColor: TEAM_KITS.lakers.accentColor,
    shoeColor: TEAM_KITS.lakers.shoeColor,
    sockColor: TEAM_KITS.lakers.sockColor,
    headband: false,
    wristbands: true,
    armSleeve: "none",
    legSleeve: "none",
  },
};

export interface PartialPlayer {
  id?: string;
  name?: string;
  position?: CourtPosition;
  physical?: Partial<PhysicalConfig>;
  appearance?: Partial<AppearanceConfig>;
  uniform?: Partial<UniformConfig>;
  attributes?: Partial<AttributeConfig>;
}

/** Deep-merge a partial config over the default (config stays plain data). */
export function makePlayer(partial?: PartialPlayer): PlayerConfig {
  return {
    id: partial?.id ?? DEFAULT_PLAYER.id,
    name: partial?.name ?? DEFAULT_PLAYER.name,
    position: partial?.position ?? DEFAULT_PLAYER.position,
    physical: { ...DEFAULT_PLAYER.physical, ...partial?.physical },
    appearance: { ...DEFAULT_PLAYER.appearance, ...partial?.appearance },
    uniform: { ...DEFAULT_PLAYER.uniform, ...partial?.uniform },
    attributes: { ...DEFAULT_PLAYER.attributes, ...partial?.attributes },
  };
}

// ---- position archetypes ----------------------------------------------------------
/**
 * Real NBA positional anthropometrics (league averages, tracking-era): height,
 * wingspan ratio, shoulder breadth and build by position. `makeArchetype("C")`
 * gives a realistic 7-footer whose head tops out at exactly 7.0 ft against the
 * 10 ft rim — heights are in COURT FEET, so player/rim/court scale is one system.
 */
export const ARCHETYPES: Record<CourtPosition, PartialPlayer> = {
  PG: {
    position: "PG",
    physical: { height: 6.2, wingspanRatio: 1.05, shoulderWidthRatio: 0.252, muscularity: 0.55, bodyFat: 0.2 },
    attributes: { speed: 90, acceleration: 92, vertical: 82, strength: 55, shootingThree: 80 },
  },
  SG: {
    position: "SG",
    physical: { height: 6.42, wingspanRatio: 1.055, shoulderWidthRatio: 0.256, muscularity: 0.6, bodyFat: 0.22 },
    attributes: { speed: 86, acceleration: 86, vertical: 84, strength: 62, shootingThree: 82 },
  },
  SF: {
    position: "SF",
    physical: { height: 6.63, wingspanRatio: 1.06, shoulderWidthRatio: 0.26, muscularity: 0.65, bodyFat: 0.25 },
    attributes: { speed: 82, acceleration: 80, vertical: 80, strength: 70, shootingThree: 75 },
  },
  PF: {
    position: "PF",
    physical: { height: 6.79, wingspanRatio: 1.066, shoulderWidthRatio: 0.265, muscularity: 0.74, bodyFat: 0.3 },
    attributes: { speed: 74, acceleration: 72, vertical: 76, strength: 84, shootingThree: 65 },
  },
  C: {
    position: "C",
    physical: { height: 6.98, wingspanRatio: 1.075, shoulderWidthRatio: 0.27, muscularity: 0.78, bodyFat: 0.34 },
    attributes: { speed: 66, acceleration: 62, vertical: 72, strength: 92, shootingThree: 45 },
  },
};

/** Build a player from a position archetype, with optional overrides on top. */
export function makeArchetype(position: CourtPosition, overrides?: PartialPlayer): PlayerConfig {
  const arch = ARCHETYPES[position];
  return makePlayer({
    ...arch,
    ...overrides,
    id: overrides?.id ?? `${position.toLowerCase()}-archetype`,
    physical: { ...arch.physical, ...overrides?.physical },
    appearance: { ...arch.appearance, ...overrides?.appearance },
    uniform: { ...arch.uniform, ...overrides?.uniform },
    attributes: { ...arch.attributes, ...overrides?.attributes },
  });
}
