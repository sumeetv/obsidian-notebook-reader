export type SortOrder = "alpha" | "date";

export type SpreadMode = "consecutive" | "pinned-left" | "pinned-right" | "compare";

export type PaneSide = "left" | "right";

export interface NoteEntry {
  /** Normalized vault-relative path, e.g. "Ideas/Attention is a material.md" or "Welcome.md" */
  path: string;
  /** Filename without extension */
  basename: string;
  /** Display title (frontmatter title if non-empty string, otherwise basename) */
  title: string;
  /** Normalized folder path ("" for root-level notes, "Ideas", "Ideas/Sub") */
  folderPath: string;
  /** Human-readable section divider label ("Root" for "", otherwise folderPath) */
  sectionLabel: string;
  /** Top-level folder segment for compact tab labels ("Root" for "", otherwise first segment) */
  topFolder: string;
  /** File creation timestamp in ms */
  ctime: number;
  /** File modification timestamp in ms */
  mtime: number;
  /** Resolved chronological timestamp in ms */
  effectiveDateMs: number;
  /** Short YYYY-MM-DD formatted date label */
  dateLabel: string;
  /** True when the note matches daily-note conventions */
  isDailyNote: boolean;
}

export interface FolderSection {
  /** Folder path key ("" for root-level notes) */
  folderPath: string;
  /** Human-readable section label ("Root" or folderPath) */
  sectionLabel: string;
  /** Compact tab label (basename of folderPath or "Root", with depth cue if nested) */
  tabLabel: string;
  /** Notes belonging to this exact folder in active sequence order */
  notes: NoteEntry[];
  /** Index of the first note of this section inside the flat sequence */
  startIndex: number;
  /** Index of the last note of this section inside the flat sequence */
  endIndex: number;
  /** True if this folder is detected as a daily-note folder */
  isDailyFolder: boolean;
}

export interface PassageAnchor {
  /** Exact pixel scrollTop within the pane scroll container */
  scrollTop: number;
  /** Normalized 0..1 scroll progress ratio when maxScroll > 0 */
  scrollRatio: number;
  /** Index of the first block-level element visible at the top of the pane */
  blockIndex: number;
  /** Fraction (0..1) scrolled into that visible block element */
  blockOffsetRatio: number;
  /** Nearest preceding heading text if present */
  headingText?: string;
  /** Short readable excerpt near the top of the viewport */
  excerpt?: string;
}

export interface PassageRef {
  path: string;
  anchor: PassageAnchor;
}

export interface NotebookPersistedData {
  sortOrder: SortOrder;
  groupByFolder: boolean;
  excludedFolders: string[];
  hideDailyNotes: boolean;
  indexOpen: boolean;
  spreadMode: SpreadMode;
  narrowActiveSlot: PaneSide;
  current: PassageRef | null;
  held: PassageRef | null;
  positionsByPath: Record<string, PassageAnchor>;
}

export interface PaneDescriptor {
  side: PaneSide;
  role: "current" | "next" | "held";
  entry: NoteEntry;
  anchor: PassageAnchor;
  isPinned: boolean;
  isOutsideFilter: boolean;
  sequenceIndex: number;
}

export interface SpreadSnapshot {
  mode: SpreadMode;
  left: PaneDescriptor | null;
  right: PaneDescriptor | null;
  currentIndex: number;
  totalNotes: number;
  heldRef: PassageRef | null;
  heldEntry: NoteEntry | null;
  isHeldOutsideFilter: boolean;
}
