import type { CachedMetadata, TFile } from "obsidian";
import type { FolderSection, NoteEntry, SortOrder } from "./types/notebook";

const DAILY_FOLDER_REGEX = /^(daily|dailies|daily[-_ ]notes?|journal|journals)$/i;
const ISO_DATE_PREFIX_REGEX = /^(\d{4})-(\d{2})-(\d{2})(?:\b|[_ -]|$)/;
const ISO_DATE_EXACT_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface VaultNoteSource {
  file: TFile;
  cache: CachedMetadata | null;
}

export interface FolderSummary {
  folderPath: string;
  sectionLabel: string;
  noteCount: number;
  isDailyFolder: boolean;
  isExcluded: boolean;
}

export function normalizeFolderPath(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return trimmed;
}

export function getParentFolderPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return "";
  }
  return normalized.slice(0, lastSlash);
}

export function getTopFolder(folderPath: string): string {
  if (!folderPath) {
    return "Root";
  }
  const firstSlash = folderPath.indexOf("/");
  return firstSlash === -1 ? folderPath : folderPath.slice(0, firstSlash);
}

export function getFolderTabLabel(folderPath: string): string {
  if (!folderPath) {
    return "Root";
  }
  const segments = folderPath.split("/");
  if (segments.length === 1) {
    return segments[0];
  }
  return `${segments[segments.length - 1]} (${segments.slice(0, -1).join("/")})`;
}

export function compareStringsNatural(a: string, b: string): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  if (cmp !== 0) {
    return cmp;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Deterministic folder path comparison:
 * - Root ("") sorts first.
 * - Non-root folders sort segment-by-segment so parent folders always appear
 *   immediately ahead of their nested subfolders.
 */
export function compareFolderPaths(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return -1;
  if (b === "") return 1;

  const segA = a.split("/");
  const segB = b.split("/");
  const minLen = Math.min(segA.length, segB.length);

  for (let i = 0; i < minLen; i++) {
    const cmp = compareStringsNatural(segA[i], segB[i]);
    if (cmp !== 0) {
      return cmp;
    }
  }

  return segA.length - segB.length;
}

function parseIsoDateUtc(raw: string): { ms: number; label: string } | null {
  const trimmed = raw.trim();
  const exact = ISO_DATE_EXACT_REGEX.exec(trimmed);
  if (exact) {
    const year = Number(exact[1]);
    const month = Number(exact[2]);
    const day = Number(exact[3]);
    const ms = Date.UTC(year, month - 1, day);
    if (isValidCalendarDate(year, month, day) && !Number.isNaN(ms)) {
      return { ms, label: `${exact[1]}-${exact[2]}-${exact[3]}` };
    }
    return null;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return { ms: parsed, label: formatUtcDate(parsed) };
  }
  return null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveFrontmatterDate(cache: CachedMetadata | null): { ms: number; label: string } | null {
  const fm = cache?.frontmatter;
  if (!fm) return null;

  const candidate = fm.date ?? fm.created ?? fm.created_at ?? fm.date_created;
  if (typeof candidate === "string") {
    return parseIsoDateUtc(candidate);
  }
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    const ms = candidate.getTime();
    return { ms, label: formatUtcDate(ms) };
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return { ms: candidate, label: formatUtcDate(candidate) };
  }
  return null;
}

function resolveBasenameDate(basename: string): { ms: number; label: string } | null {
  const match = ISO_DATE_PREFIX_REGEX.exec(basename.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day);
  return { ms, label: `${match[1]}-${match[2]}-${match[3]}` };
}

export function isFolderDailyByName(folderPath: string): boolean {
  if (!folderPath) return false;
  return folderPath.split("/").some((segment) => DAILY_FOLDER_REGEX.test(segment.trim()));
}

export function resolveNoteEntry(source: VaultNoteSource): NoteEntry {
  const { file, cache } = source;
  const folderPath = normalizeFolderPath(getParentFolderPath(file.path));
  const rawTitle = cache?.frontmatter?.title;
  const title =
    typeof rawTitle === "string" && rawTitle.trim().length > 0 ? rawTitle.trim() : file.basename;

  const fmDate = resolveFrontmatterDate(cache);
  const nameDate = resolveBasenameDate(file.basename);
  const ctime = typeof file.stat?.ctime === "number" && file.stat.ctime > 0 ? file.stat.ctime : 0;
  const mtime = typeof file.stat?.mtime === "number" && file.stat.mtime > 0 ? file.stat.mtime : 0;

  let effectiveDateMs = 0;
  let dateLabel = "";

  if (fmDate) {
    effectiveDateMs = fmDate.ms;
    dateLabel = fmDate.label;
  } else if (nameDate) {
    effectiveDateMs = nameDate.ms;
    dateLabel = nameDate.label;
  } else if (ctime > 0) {
    effectiveDateMs = ctime;
    dateLabel = formatUtcDate(ctime);
  } else if (mtime > 0) {
    effectiveDateMs = mtime;
    dateLabel = formatUtcDate(mtime);
  } else {
    effectiveDateMs = 0;
    dateLabel = "Undated";
  }

  const isDailyNote = isFolderDailyByName(folderPath) || Boolean(nameDate && folderPath !== "");

  return {
    path: file.path,
    basename: file.basename,
    title,
    folderPath,
    sectionLabel: folderPath || "Root",
    topFolder: getTopFolder(folderPath),
    ctime,
    mtime,
    effectiveDateMs,
    dateLabel,
    isDailyNote,
  };
}

export function computeDailyFolderSet(entries: readonly NoteEntry[]): Set<string> {
  const byFolder = new Map<string, { total: number; datedNames: number }>();
  for (const entry of entries) {
    const existing = byFolder.get(entry.folderPath) ?? { total: 0, datedNames: 0 };
    existing.total += 1;
    if (ISO_DATE_PREFIX_REGEX.test(entry.basename.trim())) {
      existing.datedNames += 1;
    }
    byFolder.set(entry.folderPath, existing);
  }

  const dailyFolders = new Set<string>();
  for (const [folderPath, stats] of byFolder.entries()) {
    if (!folderPath) continue;
    if (isFolderDailyByName(folderPath) || (stats.total >= 1 && stats.datedNames / stats.total >= 0.5)) {
      dailyFolders.add(folderPath);
    }
  }
  return dailyFolders;
}

export function isFolderExcluded(folderPath: string, excludedFolders: readonly string[]): boolean {
  const normalizedTarget = normalizeFolderPath(folderPath);
  for (const rawExcluded of excludedFolders) {
    const excluded = normalizeFolderPath(rawExcluded);
    if (excluded === "") {
      if (normalizedTarget === "") {
        return true;
      }
      continue;
    }
    if (normalizedTarget === excluded || normalizedTarget.startsWith(`${excluded}/`)) {
      return true;
    }
  }
  return false;
}

export function compareNotesWithinFolder(a: NoteEntry, b: NoteEntry, sortOrder: SortOrder): number {
  if (sortOrder === "date") {
    if (a.effectiveDateMs !== b.effectiveDateMs) {
      return a.effectiveDateMs - b.effectiveDateMs;
    }
  }

  const titleCmp = compareStringsNatural(a.title, b.title);
  if (titleCmp !== 0) return titleCmp;

  const baseCmp = compareStringsNatural(a.basename, b.basename);
  if (baseCmp !== 0) return baseCmp;

  return compareStringsNatural(a.path, b.path);
}

export interface SequenceResult {
  allEntries: NoteEntry[];
  allEntriesByPath: Map<string, NoteEntry>;
  sequence: NoteEntry[];
  sections: FolderSection[];
  folders: FolderSummary[];
  dailyFolders: Set<string>;
}

export function buildNotebookSequence(
  sources: readonly VaultNoteSource[],
  options: {
    sortOrder: SortOrder;
    excludedFolders: readonly string[];
    hideDailyNotes: boolean;
  }
): SequenceResult {
  const allEntries = sources.map(resolveNoteEntry);
  const allEntriesByPath = new Map<string, NoteEntry>();
  for (const entry of allEntries) {
    allEntriesByPath.set(entry.path, entry);
  }

  const dailyFolders = computeDailyFolderSet(allEntries);

  const folderGroups = new Map<string, NoteEntry[]>();
  for (const entry of allEntries) {
    const list = folderGroups.get(entry.folderPath);
    if (list) {
      list.push(entry);
    } else {
      folderGroups.set(entry.folderPath, [entry]);
    }
  }

  const sortedFolderPaths = Array.from(folderGroups.keys()).sort(compareFolderPaths);

  const folders: FolderSummary[] = sortedFolderPaths.map((folderPath) => {
    const group = folderGroups.get(folderPath) ?? [];
    const isDailyFolder = dailyFolders.has(folderPath);
    const excludedByList = isFolderExcluded(folderPath, options.excludedFolders);
    return {
      folderPath,
      sectionLabel: folderPath || "Root",
      noteCount: group.length,
      isDailyFolder,
      isExcluded: excludedByList || (options.hideDailyNotes && isDailyFolder),
    };
  });

  const sequence: NoteEntry[] = [];
  const sections: FolderSection[] = [];

  for (const folderPath of sortedFolderPaths) {
    const isDailyFolder = dailyFolders.has(folderPath);
    if (isFolderExcluded(folderPath, options.excludedFolders)) {
      continue;
    }
    if (options.hideDailyNotes && isDailyFolder) {
      continue;
    }

    const group = [...(folderGroups.get(folderPath) ?? [])];
    group.sort((a, b) => compareNotesWithinFolder(a, b, options.sortOrder));

    if (group.length === 0) continue;

    const startIndex = sequence.length;
    sequence.push(...group);
    const endIndex = sequence.length - 1;

    sections.push({
      folderPath,
      sectionLabel: folderPath || "Root",
      tabLabel: getFolderTabLabel(folderPath),
      notes: group,
      startIndex,
      endIndex,
      isDailyFolder,
    });
  }

  return {
    allEntries,
    allEntriesByPath,
    sequence,
    sections,
    folders,
    dailyFolders,
  };
}
