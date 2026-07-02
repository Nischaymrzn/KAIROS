/** Shared domain types for the HoopIQ frontend. */

export type Vec2 = { x: number; z: number }; // court position in feet

export type ShotTypeId =
  | "catch_shoot"
  | "pullup"
  | "stepback"
  | "driving_layup"
  | "dunk"
  | "floater"
  | "hook"
  | "fadeaway";

export interface ShotType {
  id: ShotTypeId;
  label: string;
  is3ptCapable: boolean;
  pose: ShotPose;
}

export type PositionGroup = "G" | "F" | "C";

export interface Player {
  id: number;
  name: string;
  team: string;
  jersey: number;
  position: PositionGroup;
  heightIn: number;
  jerseyColor: string;
  accentColor: string;
  // season tendencies (dummy)
  catchShootRate: number;
  pullUpRate: number;
  drivesPerGame: number;
}

export type ShotPose = "shoot" | "layup" | "dunk" | "floater" | "hook";

export interface ShotScenario {
  position: Vec2; // shooter location on court (feet)
  shotType: ShotTypeId;
  playerId: number;
}

export interface Prediction {
  probability: number; // 0..1
  quality: "excellent" | "good" | "average" | "poor" | "very poor";
}
