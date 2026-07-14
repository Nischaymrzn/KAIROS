/**
 * PLAYER MODULE — public surface. Import from "player", never from deep paths:
 *
 *   import { Player, makePlayer, DEFAULT_PLAYER } from "../player";
 *
 * Layout:
 *   config/     PlayerConfig schema + anthropometry solver (all body math)
 *   materials/  skin tones, fabrics, shoes, jersey-number textures
 *   rig/        humanoid skeleton (standard bone names) + procedural body
 *   animation/  poses + AnimationController (procedural life, future clips)
 *   Player.tsx  the R3F component
 */
export { Player } from "./Player";
export type { PlayerProps } from "./Player";
export { makePlayer, makeArchetype, ARCHETYPES, DEFAULT_PLAYER } from "./config/PlayerConfig";
export type {
  PlayerConfig,
  PartialPlayer,
  CourtPosition,
  AttributeConfig,
  PhysicalConfig,
} from "./config/PlayerConfig";
export { solveBody } from "./config/anthropometry";
export type { BodyPlan } from "./config/anthropometry";
export { getJointWorldPositions } from "./rig/buildRig";
export type { BoneName, PlayerRig } from "./rig/buildRig";
export { SKIN_TONES } from "./materials/playerMaterials";
export type { PoseName } from "./animation/poses";
