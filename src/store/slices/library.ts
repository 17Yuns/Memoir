import type { AppStore, LibraryPanelMode } from "../types";
import type { NavFilter, ScopedFilter } from "../../domain/notes";

type LibrarySliceContext = {
  set: (partial: Partial<AppStore>) => void;
  scheduleQuery: () => void;
  runQueryNow: () => void;
  revealLibrary?: () => void;
};

export function createLibrarySlice({ set, scheduleQuery, runQueryNow, revealLibrary }: LibrarySliceContext) {
  return {
    setQuery(query: string) {
      set({ query });
      scheduleQuery();
    },
    setNavFilter(navFilter: NavFilter) {
      revealLibrary?.();
      set({ navFilter, scopedFilter: null, mobilePanel: "library", libraryPanelMode: "notes" });
      runQueryNow();
    },
    setScopedFilter(scopedFilter: ScopedFilter) {
      revealLibrary?.();
      set({ scopedFilter, navFilter: "all", mobilePanel: "library", libraryPanelMode: "notes" });
      runQueryNow();
    },
    setLibraryPanelMode(libraryPanelMode: LibraryPanelMode) {
      revealLibrary?.();
      set({
        libraryPanelMode,
        mobilePanel: libraryPanelMode === "graph" ? "editor" : "library",
      });
    },
  };
}
