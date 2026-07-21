/**
 * PLAYBACK STORE — the tracked possession currently being replayed in the arena.
 *
 * Kept out of React state on purpose for the frame cursor. The clip runs at 25 Hz
 * and drives ten skeletons; pushing the frame index through React would re-render
 * the panel tree twenty-five times a second to move some bones. The panel sets a
 * clip and presses play, the scene reads the cursor in `useFrame`, and the two
 * never re-render each other.
 *
 * `frame` is therefore a plain mutable field, deliberately not part of the
 * subscribed state. Anything that needs to DISPLAY the frame (a scrubber) reads it
 * on its own animation frame rather than subscribing.
 */
import { create } from "zustand";
import type { ReplayDetail } from "../api";

/** Source rate of the SportVU logs. */
export const CLIP_HZ = 25;

interface PlaybackState {
  clip: ReplayDetail | null;
  playing: boolean;
  /** playback rate as a fraction of real time; below 1 so shape is readable */
  speed: number;
  open(clip: ReplayDetail): void;
  close(): void;
  setPlaying(v: boolean): void;
  setSpeed(v: number): void;
}

/** The frame cursor, outside React for the reason in the header. */
export const cursor = { frame: 0 };

export const usePlaybackStore = create<PlaybackState>((set) => ({
  clip: null,
  playing: false,
  speed: 0.5,
  open(clip) {
    cursor.frame = 0;
    set({ clip, playing: true });
  },
  close() {
    cursor.frame = 0;
    set({ clip: null, playing: false });
  },
  setPlaying(playing) { set({ playing }); },
  setSpeed(speed) { set({ speed }); },
}));
