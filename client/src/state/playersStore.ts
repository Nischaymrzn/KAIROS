/**
 * PLAYERS STORE — the real roster from /players plus the "active shooter".
 * Selecting a player does three real things at once:
 *   1. the 3D body is rebuilt from his MEASURED height/wingspan (court feet),
 *   2. the model scenario's playerId/positionGroup switch to him (so /predict
 *      uses his real profile features),
 *   3. the physics release point derives from his real reach + vertical.
 */
import { create } from "zustand";
import { getPlayers, getPlayerById, type RosterPlayer } from "../api";
import { useShotStore } from "./shotStore";

export interface CompareRow {
  player: RosterPlayer;
  probability: number;
  quality: string;
}

interface PlayersState {
  roster: RosterPlayer[];
  totalKnownIds: number;
  loading: boolean;
  error: string | null;
  /** currently active shooter (null = generic scenario player, id 0) */
  active: RosterPlayer | null;
  compare: CompareRow[];
  compareLoading: boolean;

  fetchRoster(): void;
  selectPlayer(p: RosterPlayer | null): void;
  loadById(id: number): Promise<RosterPlayer | null>;
}

let fetched = false;

export const usePlayersStore = create<PlayersState>((set, get) => ({
  roster: [],
  totalKnownIds: 0,
  loading: false,
  error: null,
  active: null,
  compare: [],
  compareLoading: false,

  fetchRoster() {
    if (fetched && get().roster.length > 0) return;
    fetched = true;
    set({ loading: true, error: null });
    getPlayers()
      .then((r) => set({ roster: r.players, totalKnownIds: r.total_known_ids, loading: false }))
      .catch((e) => set({ loading: false, error: String(e?.message ?? e) }));
  },

  selectPlayer(p) {
    set({ active: p });
    // switch the model scenario to this real player (id 0 = generic)
    useShotStore.getState().setShooter(p?.id ?? 0, p?.position ?? "G");
  },

  async loadById(id) {
    try {
      const p = await getPlayerById(id);
      // merge into the visible roster so he becomes selectable/comparable
      set((s) => ({
        roster: s.roster.some((r) => r.id === p.id) ? s.roster : [...s.roster, p],
      }));
      return p;
    } catch {
      return null;
    }
  },
}));
