import type { Player, ShotType } from "./types";

/** Dummy roster — placeholder players until the real model/data is wired in. */
// Home team — realistic royal-blue & white kit.
const HOME_JERSEY = "#1d428a";
const HOME_TRIM = "#eef2f8";

export const PLAYERS: Player[] = [
  { id: 1, name: "Marcus Vale", team: "HOM", jersey: 7, position: "G", heightIn: 75,
    jerseyColor: HOME_JERSEY, accentColor: HOME_TRIM, catchShootRate: 0.41, pullUpRate: 0.32, drivesPerGame: 12.4 },
  { id: 2, name: "Andre Cole", team: "HOM", jersey: 23, position: "F", heightIn: 80,
    jerseyColor: HOME_JERSEY, accentColor: HOME_TRIM, catchShootRate: 0.36, pullUpRate: 0.18, drivesPerGame: 7.1 },
  { id: 3, name: "Dimitri Novak", team: "HOM", jersey: 11, position: "C", heightIn: 84,
    jerseyColor: HOME_JERSEY, accentColor: HOME_TRIM, catchShootRate: 0.12, pullUpRate: 0.05, drivesPerGame: 2.3 },
  { id: 4, name: "Jaylen Brooks", team: "HOM", jersey: 3, position: "G", heightIn: 74,
    jerseyColor: HOME_JERSEY, accentColor: HOME_TRIM, catchShootRate: 0.44, pullUpRate: 0.39, drivesPerGame: 14.8 },
  { id: 5, name: "Theo Castellan", team: "HOM", jersey: 45, position: "F", heightIn: 82,
    jerseyColor: HOME_JERSEY, accentColor: HOME_TRIM, catchShootRate: 0.29, pullUpRate: 0.14, drivesPerGame: 5.6 },
];

export const SHOT_TYPES: ShotType[] = [
  { id: "catch_shoot", label: "Catch & Shoot", is3ptCapable: true, pose: "shoot" },
  { id: "pullup", label: "Pull-Up Jumper", is3ptCapable: true, pose: "shoot" },
  { id: "stepback", label: "Step-Back", is3ptCapable: true, pose: "shoot" },
  { id: "fadeaway", label: "Fadeaway", is3ptCapable: true, pose: "shoot" },
  { id: "driving_layup", label: "Driving Layup", is3ptCapable: false, pose: "layup" },
  { id: "dunk", label: "Dunk", is3ptCapable: false, pose: "dunk" },
  { id: "floater", label: "Floater", is3ptCapable: false, pose: "floater" },
  { id: "hook", label: "Hook Shot", is3ptCapable: false, pose: "hook" },
];
