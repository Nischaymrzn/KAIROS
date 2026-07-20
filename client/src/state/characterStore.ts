/**
 * CHARACTER STORE — is a real character model available? Checks once at boot
 * whether `public/models/player.glb` exists (HEAD request). When the user
 * drops a licensed Mixamo-compatible character there, every shooter renders
 * with it automatically; otherwise the procedural athlete is used.
 */
import { create } from "zustand";
import { GLB_URL } from "../player/GlbCharacter";

interface CharacterState {
  glbAvailable: boolean;
  checked: boolean;
  check(): void;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  glbAvailable: false,
  checked: false,
  check() {
    if (get().checked) return;
    set({ checked: true });
    fetch(GLB_URL, { method: "HEAD" })
      .then((r) => {
        const type = r.headers.get("content-type") ?? "";
        // vite dev returns index.html for missing files — require a binary type
        set({ glbAvailable: r.ok && !type.includes("text/html") });
      })
      .catch(() => set({ glbAvailable: false }));
  },
}));
