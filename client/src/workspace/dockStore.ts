/**
 * DOCK STORE — which capability panels are open, and in what order.
 *
 * This replaces the router as the way the user gets between capabilities. The
 * previous build gave each one its own route, which meant that looking at how to
 * defend a shot cost you the heat map, and comparing two spots meant losing the
 * arc you had just set up. Everything the user was working on was destroyed by
 * the act of looking at something else.
 *
 * Here a capability is a PANEL. Opening one does not close another, the 3D court
 * never unmounts, and the scenario is untouched by any of it. The rail toggles;
 * the dock stacks.
 *
 * Panel state persists, so the workspace a user arranged is the workspace they
 * come back to.
 */
import { create } from "zustand";

export type ModuleId =
  | "predict" | "practice" | "defend" | "explore" | "physics"
  | "players" | "movement" | "models" | "challenge" | "session" | "film"
  | "study" | "compare";

const STORAGE_KEY = "hoopiq.dock.v2";

/**
 * Nothing on a first visit.
 *
 * This opened three panels by default, which stacked into a full-height column of
 * headings, notes and scoreboards down the right of the court — the first thing
 * anyone saw was text, not basketball. The court now arrives clean, with the
 * probability readout and nothing else; panels are added from the rail when a
 * question needs one.
 */
const DEFAULT_OPEN: ModuleId[] = [];

interface DockState {
  open: ModuleId[];
  /** the module the camera and 3D layers should favour, or null for free look */
  focus: ModuleId | null;
  /** one panel expanded on its own; the rest step aside rather than closing */
  solo: ModuleId | null;
  /** collapsed panels stay in the dock but show only their header */
  collapsed: ModuleId[];

  toggle(id: ModuleId): void;
  openModule(id: ModuleId): void;
  close(id: ModuleId): void;
  setFocus(id: ModuleId | null): void;
  toggleCollapsed(id: ModuleId): void;
  toggleSolo(id: ModuleId): void;
  isOpen(id: ModuleId): boolean;
  reset(): void;
}

function load(): { open: ModuleId[]; collapsed: ModuleId[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: DEFAULT_OPEN, collapsed: [] };
    const p = JSON.parse(raw);
    return {
      open: Array.isArray(p.open) ? p.open : DEFAULT_OPEN,
      collapsed: Array.isArray(p.collapsed) ? p.collapsed : [],
    };
  } catch {
    return { open: DEFAULT_OPEN, collapsed: [] };
  }
}

function save(open: ModuleId[], collapsed: ModuleId[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, collapsed }));
  } catch {
    /* layout memory is a convenience, never a blocker */
  }
}

export const useDockStore = create<DockState>((set, get) => {
  const initial = load();
  return {
    open: initial.open,
    collapsed: initial.collapsed,
    focus: null,
    solo: null,

    toggle(id) {
      const { open } = get();
      const next = open.includes(id) ? open.filter((m) => m !== id) : [...open, id];
      set({ open: next, focus: next.includes(id) ? id : null });
      save(next, get().collapsed);
    },
    openModule(id) {
      const { open } = get();
      if (open.includes(id)) {
        set({ focus: id });
        return;
      }
      const next = [...open, id];
      set({ open: next, focus: id });
      save(next, get().collapsed);
    },
    close(id) {
      const next = get().open.filter((m) => m !== id);
      set({ open: next, focus: null, solo: get().solo === id ? null : get().solo });
      save(next, get().collapsed);
    },
    setFocus: (focus) => set({ focus }),
    toggleSolo(id) {
      set((s) => ({ solo: s.solo === id ? null : id, focus: id }));
    },
    toggleCollapsed(id) {
      const { collapsed } = get();
      const next = collapsed.includes(id) ? collapsed.filter((m) => m !== id) : [...collapsed, id];
      set({ collapsed: next });
      save(get().open, next);
    },
    isOpen: (id) => get().open.includes(id),
    reset() {
      set({ open: DEFAULT_OPEN, collapsed: [], focus: null, solo: null });
      save(DEFAULT_OPEN, []);
    },
  };
});
