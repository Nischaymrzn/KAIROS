/**
 * FILM STORE — the film room's clip log. Every fired shot is recorded
 * automatically (scenario, shooter, the model's live verdict, timestamp) by
 * subscribing to the shot store's shootSignal; clips persist in localStorage.
 * REPLAY restores the exact context — shooter, spot, shot type — waits for the
 * prediction to settle, then fires the same shot animation again.
 */
import { create } from "zustand";
import { useShotStore, ShotVerb } from "./shotStore";
import { usePlayersStore } from "./playersStore";

const STORAGE_KEY = "hoopiq.film";
const MAX_CLIPS = 30;

export interface FilmClip {
  id: number;
  at: string; // ISO timestamp
  x: number;
  z: number;
  shotType: ShotVerb;
  playerId: number;
  playerName: string | null;
  positionGroup: string;
  defenderDistance?: number;
  probability: number | null;
  quality: string | null;
  source: "live" | "offline" | null;
}

interface FilmState {
  clips: FilmClip[];
  replayingId: number | null;
  replay(clip: FilmClip): void;
  remove(id: number): void;
  clear(): void;
}

function load(): FilmClip[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FilmClip[]) : [];
  } catch {
    return [];
  }
}

function save(clips: FilmClip[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clips));
  } catch {
    /* storage full/blocked — the in-memory log still works */
  }
}

let nextId = Date.now();
let replayTimer: ReturnType<typeof setTimeout> | null = null;

export const useFilmStore = create<FilmState>((set, get) => ({
  clips: load(),
  replayingId: null,

  replay(clip) {
    const shot = useShotStore.getState();
    const players = usePlayersStore.getState();
    // restore the shooter (roster player if we can find him, else raw ids)
    const rosterHit = players.roster.find((p) => p.id === clip.playerId) ?? null;
    players.selectPlayer(rosterHit); // also routes playerId/positionGroup for id≠0
    if (!rosterHit && clip.playerId !== 0) {
      shot.setShooter(clip.playerId, clip.positionGroup);
    }
    shot.setShotType(clip.shotType);
    shot.setDefenderDistance(clip.defenderDistance);
    shot.setShotPosition(clip.x, clip.z);
    set({ replayingId: clip.id });
    // let the fresh prediction land, then roll the clip
    if (replayTimer) clearTimeout(replayTimer);
    replayTimer = setTimeout(() => {
      useShotStore.getState().triggerShot();
      replayTimer = setTimeout(() => set({ replayingId: null }), 2600);
    }, 700);
  },

  remove(id) {
    const clips = get().clips.filter((c) => c.id !== id);
    set({ clips });
    save(clips);
  },

  clear() {
    set({ clips: [] });
    save([]);
  },
}));

// ---- automatic recording: every shootSignal bump becomes a clip -----------------
useShotStore.subscribe((state, prev) => {
  if (state.shootSignal === prev.shootSignal || state.shootSignal === 0) return;
  const { scenario, prediction } = state;
  const active = usePlayersStore.getState().active;
  const clip: FilmClip = {
    id: nextId++,
    at: new Date().toISOString(),
    x: scenario.x,
    z: scenario.z,
    shotType: scenario.shotType,
    playerId: scenario.playerId,
    playerName: active?.name ?? null,
    positionGroup: scenario.positionGroup,
    defenderDistance: scenario.defenderDistance,
    probability: prediction?.probability ?? null,
    quality: prediction?.quality ?? null,
    source: prediction?.source ?? null,
  };
  const clips = [clip, ...useFilmStore.getState().clips].slice(0, MAX_CLIPS);
  useFilmStore.setState({ clips });
  save(clips);
});
