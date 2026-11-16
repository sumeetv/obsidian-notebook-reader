import type {
  NavButtonPosition,
  NotebookPersistedData,
  NoteEntry,
  PaneDescriptor,
  PaneSide,
  PassageAnchor,
  PassageRef,
  SortOrder,
  SpreadMode,
  SpreadSnapshot,
} from "./types/notebook";

export function createZeroAnchor(): PassageAnchor {
  return {
    scrollTop: 0,
    scrollRatio: 0,
    blockIndex: 0,
    blockOffsetRatio: 0,
  };
}

export function cloneAnchor(anchor?: Partial<PassageAnchor> | null): PassageAnchor {
  if (!anchor) {
    return createZeroAnchor();
  }
  return {
    scrollTop: typeof anchor.scrollTop === "number" && Number.isFinite(anchor.scrollTop) ? Math.max(0, anchor.scrollTop) : 0,
    scrollRatio:
      typeof anchor.scrollRatio === "number" && Number.isFinite(anchor.scrollRatio)
        ? Math.min(1, Math.max(0, anchor.scrollRatio))
        : 0,
    blockIndex:
      typeof anchor.blockIndex === "number" && Number.isFinite(anchor.blockIndex)
        ? Math.max(0, Math.floor(anchor.blockIndex))
        : 0,
    blockOffsetRatio:
      typeof anchor.blockOffsetRatio === "number" && Number.isFinite(anchor.blockOffsetRatio)
        ? Math.min(1, Math.max(0, anchor.blockOffsetRatio))
        : 0,
    headingText: typeof anchor.headingText === "string" ? anchor.headingText : undefined,
    excerpt: typeof anchor.excerpt === "string" ? anchor.excerpt : undefined,
  };
}

export function createDefaultPersistedData(): NotebookPersistedData {
  return {
    sortOrder: "alpha",
    groupByFolder: true,
    excludedFolders: [],
    hideDailyNotes: true,
    indexOpen: false,
    spreadMode: "consecutive",
    narrowActiveSlot: "left",
    navButtonPosition: "right",
    current: null,
    held: null,
    positionsByPath: {},
  };
}

function sanitizePassageRef(raw: unknown): PassageRef | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { path?: unknown; anchor?: unknown };
  if (typeof candidate.path !== "string" || candidate.path.length === 0) {
    return null;
  }
  return {
    path: candidate.path,
    anchor: cloneAnchor(candidate.anchor as Partial<PassageAnchor>),
  };
}

export class NotebookStateManager {
  private data: NotebookPersistedData;
  private compareHeldSide: PaneSide = "right";

  constructor(initial?: Partial<NotebookPersistedData> | null) {
    this.data = createDefaultPersistedData();
    if (initial) {
      this.hydrate(initial);
    }
  }

  hydrate(raw: Partial<NotebookPersistedData> | null | undefined): void {
    this.compareHeldSide = "right";
    const defaults = createDefaultPersistedData();
    if (!raw || typeof raw !== "object") {
      this.data = defaults;
      return;
    }

    const sortOrder: SortOrder = raw.sortOrder === "date" ? "date" : "alpha";
    const spreadMode: SpreadMode =
      raw.spreadMode === "pinned-left" ||
      raw.spreadMode === "pinned-right" ||
      raw.spreadMode === "compare"
        ? raw.spreadMode
        : "consecutive";
    const narrowActiveSlot: PaneSide = raw.narrowActiveSlot === "right" ? "right" : "left";
    const navButtonPosition: NavButtonPosition = raw.navButtonPosition === "left" ? "left" : "right";

    const excludedFolders = Array.isArray(raw.excludedFolders)
      ? Array.from(new Set(raw.excludedFolders.filter((v): v is string => typeof v === "string")))
      : [];

    const positionsByPath: Record<string, PassageAnchor> = {};
    if (raw.positionsByPath && typeof raw.positionsByPath === "object") {
      for (const [path, anchor] of Object.entries(raw.positionsByPath)) {
        if (typeof path === "string" && path.length > 0 && anchor && typeof anchor === "object") {
          positionsByPath[path] = cloneAnchor(anchor);
        }
      }
    }

    this.data = {
      sortOrder,
      groupByFolder:
        typeof raw.groupByFolder === "boolean" ? raw.groupByFolder : defaults.groupByFolder,
      excludedFolders,
      hideDailyNotes: typeof raw.hideDailyNotes === "boolean" ? raw.hideDailyNotes : defaults.hideDailyNotes,
      indexOpen: typeof raw.indexOpen === "boolean" ? raw.indexOpen : defaults.indexOpen,
      spreadMode,
      narrowActiveSlot,
      navButtonPosition,
      current: sanitizePassageRef(raw.current),
      held: sanitizePassageRef(raw.held),
      positionsByPath,
    };
  }

  getData(): NotebookPersistedData {
    return {
      sortOrder: this.data.sortOrder,
      groupByFolder: this.data.groupByFolder,
      excludedFolders: [...this.data.excludedFolders],
      hideDailyNotes: this.data.hideDailyNotes,
      indexOpen: this.data.indexOpen,
      spreadMode: this.data.spreadMode,
      narrowActiveSlot: this.data.narrowActiveSlot,
      navButtonPosition: this.data.navButtonPosition,
      current: this.data.current
        ? { path: this.data.current.path, anchor: cloneAnchor(this.data.current.anchor) }
        : null,
      held: this.data.held
        ? { path: this.data.held.path, anchor: cloneAnchor(this.data.held.anchor) }
        : null,
      positionsByPath: Object.fromEntries(
        Object.entries(this.data.positionsByPath).map(([k, v]) => [k, cloneAnchor(v)])
      ),
    };
  }

  get sortOrder(): SortOrder {
    return this.data.sortOrder;
  }

  get groupByFolder(): boolean {
    return this.data.groupByFolder;
  }

  get excludedFolders(): readonly string[] {
    return this.data.excludedFolders;
  }

  get hideDailyNotes(): boolean {
    return this.data.hideDailyNotes;
  }

  get indexOpen(): boolean {
    return this.data.indexOpen;
  }

  get spreadMode(): SpreadMode {
    return this.data.spreadMode;
  }

  get narrowActiveSlot(): PaneSide {
    return this.data.narrowActiveSlot;
  }

  get navButtonPosition(): NavButtonPosition {
    return this.data.navButtonPosition;
  }

  get current(): PassageRef | null {
    return this.data.current;
  }

  get held(): PassageRef | null {
    return this.data.held;
  }

  setSortOrder(order: SortOrder): void {
    this.data.sortOrder = order;
  }

  setGroupByFolder(groupByFolder: boolean): void {
    this.data.groupByFolder = groupByFolder;
  }

  toggleGroupByFolder(): void {
    this.data.groupByFolder = !this.data.groupByFolder;
  }

  setHideDailyNotes(hide: boolean): void {
    this.data.hideDailyNotes = hide;
  }

  toggleFolderExclusion(folderPath: string): void {
    const idx = this.data.excludedFolders.indexOf(folderPath);
    if (idx >= 0) {
      this.data.excludedFolders.splice(idx, 1);
    } else {
      this.data.excludedFolders.push(folderPath);
    }
  }

  setExcludedFolders(folders: string[]): void {
    this.data.excludedFolders = Array.from(new Set(folders));
  }

  setIndexOpen(open: boolean): void {
    this.data.indexOpen = open;
  }

  toggleIndex(): void {
    this.data.indexOpen = !this.data.indexOpen;
  }

  setNarrowActiveSlot(side: PaneSide): void {
    this.data.narrowActiveSlot = side;
  }

  setNavButtonPosition(pos: NavButtonPosition): void {
    this.data.navButtonPosition = pos;
  }

  getAnchorForPath(path: string): PassageAnchor {
    if (this.data.current?.path === path) {
      return cloneAnchor(this.data.current.anchor);
    }
    if (this.data.held?.path === path) {
      return cloneAnchor(this.data.held.anchor);
    }
    return cloneAnchor(this.data.positionsByPath[path]);
  }

  /**
   * Persist the live scroll anchor for a given role/path.
   * Keeping role-aware updates ensures pinned held references keep their
   * exact reached passage while browsing other notes (or even when temporarily
   * inspecting the same note in both panes).
   */
  recordScrollAnchor(path: string, role: "current" | "next" | "held", anchor: PassageAnchor): void {
    const clean = cloneAnchor(anchor);
    this.data.positionsByPath[path] = clean;
    if (role !== "held" && this.data.current?.path === path) {
      this.data.current = { path, anchor: cloneAnchor(clean) };
    } else if (role === "held" && this.data.held?.path === path) {
      this.data.held = { path, anchor: cloneAnchor(clean) };
    }
  }

  /**
   * Reconciles `current` and `held` against the current vault entries and active
   * filtered sequence. Preserves an existing `held` reference even if its folder
   * is currently excluded from the sequence, as long as the note still exists.
   */
  reconcile(sequence: readonly NoteEntry[], allEntriesByPath: ReadonlyMap<string, NoteEntry>): void {
    if (this.data.held && !allEntriesByPath.has(this.data.held.path)) {
      this.data.held = null;
      if (this.data.spreadMode !== "consecutive") {
        this.data.spreadMode = "consecutive";
      }
    }

    if (sequence.length === 0) {
      if (this.data.current && !allEntriesByPath.has(this.data.current.path)) {
        this.data.current = null;
      }
      return;
    }

    const inSequence = this.data.current
      ? sequence.some((entry) => entry.path === this.data.current?.path)
      : false;

    const currentExistsAtAll = this.data.current
      ? allEntriesByPath.has(this.data.current.path)
      : false;

    // Allow viewing an excluded note as `current` only if the user explicitly
    // swapped into a held note that lives outside the current filter.
    const viewingHeldOutsideFilter =
      currentExistsAtAll &&
      this.data.current &&
      this.data.held &&
      this.data.spreadMode !== "consecutive" &&
      this.data.current.path === this.data.held.path;

    if (!inSequence && !viewingHeldOutsideFilter) {
      // Wait: if current is excluded because user changed folder filters (and isn't just viewing it via swap),
      // pick the first note in sequence while preserving saved positionsByPath.
      const first = sequence[0];
      this.data.current = {
        path: first.path,
        anchor: cloneAnchor(this.data.positionsByPath[first.path]),
      };
    }
  }

  /**
   * Navigates the active browsing slot (`current`) to a target note in the sequence.
   */
  navigateToNote(path: string, sequence: readonly NoteEntry[]): boolean {
    const target = sequence.find((e) => e.path === path);
    if (!target) return false;

    this.data.current = {
      path: target.path,
      anchor: cloneAnchor(this.data.positionsByPath[target.path]),
    };

    if (
      this.data.spreadMode === "pinned-right" ||
      (this.data.spreadMode === "compare" && this.compareHeldSide === "right")
    ) {
      this.data.narrowActiveSlot = "left";
    } else if (this.data.spreadMode === "pinned-left" || this.data.spreadMode === "compare") {
      this.data.narrowActiveSlot = "right";
    }
    return true;
  }

  step(delta: number, sequence: readonly NoteEntry[]): boolean {
    if (sequence.length === 0) return false;
    const currentIndex = this.data.current
      ? sequence.findIndex((e) => e.path === this.data.current?.path)
      : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(sequence.length - 1, baseIndex + delta));
    if (nextIndex === currentIndex && currentIndex >= 0) {
      return false;
    }
    return this.navigateToNote(sequence[nextIndex].path, sequence);
  }

  jumpToFolder(folderPath: string, sequence: readonly NoteEntry[]): boolean {
    const firstInFolder = sequence.find((e) => e.folderPath === folderPath);
    if (!firstInFolder) return false;
    return this.navigateToNote(firstInFolder.path, sequence);
  }

  /**
   * Holds the passage currently shown on `side` ("left" | "right"), keeping it
   * pinned in view on that side while the opposite pane remains independently browsable.
   * Holding a pane that is already the pinned held page returns to consecutive browsing
   * while preserving the held bookmark.
   */
  holdVisibleSide(
    side: PaneSide,
    sequence: readonly NoteEntry[],
    allEntriesByPath: ReadonlyMap<string, NoteEntry>
  ): void {
    const spread = this.getSpread(sequence, allEntriesByPath);
    const targetPane = side === "left" ? spread.left : spread.right;
    if (!targetPane) return;

    const alreadyPinnedHere = Boolean(targetPane.isPinned);

    if (alreadyPinnedHere && this.data.held?.path === targetPane.entry.path) {
      this.data.held = {
        path: targetPane.entry.path,
        anchor: cloneAnchor(targetPane.anchor),
      };
      this.data.positionsByPath[targetPane.entry.path] = cloneAnchor(targetPane.anchor);
      if (side === "left" && sequence.some((e) => e.path === targetPane.entry.path)) {
        this.data.current = {
          path: targetPane.entry.path,
          anchor: cloneAnchor(targetPane.anchor),
        };
      }
      this.data.spreadMode = "consecutive";
      this.data.narrowActiveSlot = "left";
      return;
    }

    const previousHeld = this.data.held
      ? { path: this.data.held.path, anchor: cloneAnchor(this.data.held.anchor) }
      : null;

    this.data.held = {
      path: targetPane.entry.path,
      anchor: cloneAnchor(targetPane.anchor),
    };
    this.data.positionsByPath[targetPane.entry.path] = cloneAnchor(targetPane.anchor);

    if (this.data.spreadMode === "consecutive") {
      if (side === "left") {
        // Keep right page visible as the browsable `current` note when holding the left page.
        if (spread.right) {
          this.data.current = {
            path: spread.right.entry.path,
            anchor: cloneAnchor(spread.right.anchor),
          };
        }
        this.data.spreadMode = "pinned-left";
        this.data.narrowActiveSlot = "right";
      } else {
        // Keep left page as the browsable `current` note when holding the right page.
        this.data.spreadMode = "pinned-right";
        this.data.narrowActiveSlot = "left";
      }
      return;
    }

    // If user switches which side is pinned (e.g., from pinned-left/compare to pinned-right),
    // promote the opposite pane (previousHeld) to `current` so the visible opposite note stays in place.
    const oppositeSide: PaneSide = side === "left" ? "right" : "left";
    const oppositePane = oppositeSide === "left" ? spread.left : spread.right;
    if (oppositePane) {
      this.data.current = {
        path: oppositePane.entry.path,
        anchor: cloneAnchor(oppositePane.anchor),
      };
    } else if (previousHeld) {
      this.data.current = previousHeld;
    }

    this.data.spreadMode = side === "left" ? "pinned-left" : "pinned-right";
    this.data.narrowActiveSlot = oppositeSide;
  }

  returnToConsecutive(sequence: readonly NoteEntry[]): void {
    this.data.spreadMode = "consecutive";
    this.data.narrowActiveSlot = "left";
    // If `current` happens to be outside the sequence (after swapping to an excluded note),
    // move back to the first note in sequence on explicit return to consecutive browsing.
    if (this.data.current && !sequence.some((e) => e.path === this.data.current?.path)) {
      if (sequence.length > 0) {
        const first = sequence[0];
        this.data.current = {
          path: first.path,
          anchor: cloneAnchor(this.data.positionsByPath[first.path]),
        };
      } else {
        this.data.current = null;
      }
    }
  }

  /**
   * Exchanges `current` and `held` (including their exact passage anchors) so
   * repeated tapping toggles predictably between the two reading positions.
   */
  swapHeldAndCurrent(allEntriesByPath: ReadonlyMap<string, NoteEntry>): boolean {
    if (!this.data.held || !allEntriesByPath.has(this.data.held.path)) {
      return false;
    }

    const oldHeld: PassageRef = {
      path: this.data.held.path,
      anchor: cloneAnchor(this.data.held.anchor),
    };
    const oldCurrent: PassageRef | null = this.data.current
      ? {
          path: this.data.current.path,
          anchor: cloneAnchor(this.data.current.anchor),
        }
      : null;

    this.data.current = oldHeld;
    this.data.positionsByPath[oldHeld.path] = cloneAnchor(oldHeld.anchor);

    if (oldCurrent && allEntriesByPath.has(oldCurrent.path)) {
      this.data.held = oldCurrent;
      this.data.positionsByPath[oldCurrent.path] = cloneAnchor(oldCurrent.anchor);
    } else {
      this.data.held = null;
    }

    return true;
  }

  /**
   * Toggles side-by-side comparison of `current` and `held`
   * at their preserved passage anchors without shifting the left panel when `held` is not there.
   */
  toggleCompare(sequence: readonly NoteEntry[], allEntriesByPath: ReadonlyMap<string, NoteEntry>): boolean {
    if (!this.data.held || !allEntriesByPath.has(this.data.held.path)) {
      return false;
    }

    if (this.data.spreadMode === "compare") {
      if (
        this.compareHeldSide === "left" &&
        sequence.some((e) => e.path === this.data.held?.path)
      ) {
        this.data.current = {
          path: this.data.held.path,
          anchor: cloneAnchor(this.data.held.anchor),
        };
      }
      this.returnToConsecutive(sequence);
    } else {
      const spread = this.getSpread(sequence, allEntriesByPath);
      const heldOnLeft = spread.left?.entry.path === this.data.held.path;

      if (heldOnLeft) {
        this.compareHeldSide = "left";
        if (this.data.spreadMode === "consecutive" && spread.right) {
          this.data.current = {
            path: spread.right.entry.path,
            anchor: cloneAnchor(spread.right.anchor),
          };
        }
      } else {
        this.compareHeldSide = "right";
      }

      this.data.spreadMode = "compare";
      this.data.narrowActiveSlot = "right";
    }
    return true;
  }

  clearHeld(sequence?: readonly NoteEntry[]): void {
    const heldPinnedLeft =
      this.data.spreadMode === "pinned-left" ||
      (this.data.spreadMode === "compare" && this.compareHeldSide === "left");
    if (
      heldPinnedLeft &&
      this.data.held &&
      sequence?.some((e) => e.path === this.data.held?.path)
    ) {
      this.data.current = {
        path: this.data.held.path,
        anchor: cloneAnchor(this.data.held.anchor),
      };
    }
    this.data.held = null;
    if (this.data.spreadMode !== "consecutive") {
      this.data.spreadMode = "consecutive";
      this.data.narrowActiveSlot = "left";
    }
  }

  handleRename(oldPath: string, newPath: string): void {
    if (this.data.positionsByPath[oldPath]) {
      this.data.positionsByPath[newPath] = cloneAnchor(this.data.positionsByPath[oldPath]);
      delete this.data.positionsByPath[oldPath];
    }
    if (this.data.current?.path === oldPath) {
      this.data.current = {
        path: newPath,
        anchor: cloneAnchor(this.data.current.anchor),
      };
    }
    if (this.data.held?.path === oldPath) {
      this.data.held = {
        path: newPath,
        anchor: cloneAnchor(this.data.held.anchor),
      };
    }
  }

  handleDelete(deletedPath: string, nextSequence: readonly NoteEntry[]): void {
    const oldCurrentIndex =
      this.data.current?.path === deletedPath
        ? -1
        : this.data.current
          ? nextSequence.findIndex((e) => e.path === this.data.current?.path)
          : -1;

    delete this.data.positionsByPath[deletedPath];

    if (this.data.held?.path === deletedPath) {
      this.data.held = null;
      if (this.data.spreadMode !== "consecutive") {
        this.data.spreadMode = "consecutive";
      }
    }

    if (this.data.current?.path === deletedPath) {
      if (nextSequence.length === 0) {
        this.data.current = null;
      } else {
        const fallbackIdx = Math.max(0, Math.min(nextSequence.length - 1, oldCurrentIndex));
        const fallback = nextSequence[fallbackIdx];
        this.data.current = {
          path: fallback.path,
          anchor: cloneAnchor(this.data.positionsByPath[fallback.path]),
        };
      }
    }
  }

  private resolveHeldSide(): PaneSide {
    if (this.data.spreadMode === "pinned-right") return "right";
    if (this.data.spreadMode === "compare") return this.compareHeldSide;
    return "left";
  }

  getSpread(
    sequence: readonly NoteEntry[],
    allEntriesByPath: ReadonlyMap<string, NoteEntry>
  ): SpreadSnapshot {
    const indexByPath = new Map<string, number>();
    sequence.forEach((entry, idx) => indexByPath.set(entry.path, idx));

    const heldEntry = this.data.held ? allEntriesByPath.get(this.data.held.path) ?? null : null;
    const isHeldOutsideFilter = Boolean(heldEntry && !indexByPath.has(heldEntry.path));

    const currentEntry = this.data.current
      ? allEntriesByPath.get(this.data.current.path) ?? null
      : sequence[0] ?? null;

    if (!currentEntry) {
      // Even if the active browsing sequence is empty, preserve a held note if it exists.
      if (heldEntry && this.data.held && this.data.spreadMode !== "consecutive") {
        const heldSide = this.resolveHeldSide();
        const heldPane: PaneDescriptor = {
          side: heldSide,
          role: "held",
          entry: heldEntry,
          anchor: cloneAnchor(this.data.held.anchor),
          isPinned: true,
          isOutsideFilter: isHeldOutsideFilter,
          sequenceIndex: -1,
        };
        return {
          mode: this.data.spreadMode,
          left: heldPane.side === "left" ? heldPane : null,
          right: heldPane.side === "right" ? heldPane : null,
          currentIndex: -1,
          totalNotes: sequence.length,
          heldRef: this.data.held,
          heldEntry,
          isHeldOutsideFilter,
        };
      }

      return {
        mode: this.data.spreadMode,
        left: null,
        right: null,
        currentIndex: -1,
        totalNotes: sequence.length,
        heldRef: this.data.held,
        heldEntry,
        isHeldOutsideFilter,
      };
    }

    const currentIndex = indexByPath.get(currentEntry.path) ?? -1;
    const currentAnchor =
      this.data.current?.path === currentEntry.path
        ? cloneAnchor(this.data.current.anchor)
        : cloneAnchor(this.data.positionsByPath[currentEntry.path]);
    const isCurrentOutsideFilter = currentIndex === -1;

    const currentPane = (side: PaneSide): PaneDescriptor => ({
      side,
      role: "current",
      entry: currentEntry,
      anchor: currentAnchor,
      isPinned: false,
      isOutsideFilter: isCurrentOutsideFilter,
      sequenceIndex: currentIndex,
    });

    if (
      heldEntry &&
      this.data.held &&
      (this.data.spreadMode === "pinned-left" ||
        this.data.spreadMode === "pinned-right" ||
        this.data.spreadMode === "compare")
    ) {
      const heldSide = this.resolveHeldSide();
      const browseSide: PaneSide = heldSide === "left" ? "right" : "left";
      const heldPane: PaneDescriptor = {
        side: heldSide,
        role: "held",
        entry: heldEntry,
        anchor: cloneAnchor(this.data.held.anchor),
        isPinned: true,
        isOutsideFilter: isHeldOutsideFilter,
        sequenceIndex: indexByPath.get(heldEntry.path) ?? -1,
      };
      const browsePane = currentPane(browseSide);

      return {
        mode: this.data.spreadMode,
        left: heldSide === "left" ? heldPane : browsePane,
        right: heldSide === "right" ? heldPane : browsePane,
        currentIndex,
        totalNotes: sequence.length,
        heldRef: this.data.held,
        heldEntry,
        isHeldOutsideFilter,
      };
    }

    // Consecutive two-page spread
    const nextEntry =
      currentIndex >= 0 && currentIndex + 1 < sequence.length ? sequence[currentIndex + 1] : null;
    const rightPane: PaneDescriptor | null = nextEntry
      ? {
          side: "right",
          role: "next",
          entry: nextEntry,
          anchor: cloneAnchor(this.data.positionsByPath[nextEntry.path]),
          isPinned: false,
          isOutsideFilter: false,
          sequenceIndex: currentIndex + 1,
        }
      : null;

    return {
      mode: "consecutive",
      left: currentPane("left"),
      right: rightPane,
      currentIndex,
      totalNotes: sequence.length,
      heldRef: this.data.held,
      heldEntry,
      isHeldOutsideFilter,
    };
  }
}
