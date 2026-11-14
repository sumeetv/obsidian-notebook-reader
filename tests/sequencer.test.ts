import { describe, expect, it } from "vitest";
import { buildNotebookSequence } from "../src/sequencer";
import { createMockApp } from "../src/testing/obsidian-mock";

function makeSources(
  seeds: Array<{
    path: string;
    content?: string;
    ctime?: number;
    mtime?: number;
    frontmatter?: Record<string, unknown>;
  }>
) {
  const app = createMockApp(
    seeds.map((s) => ({
      path: s.path,
      content: s.content ?? `# ${s.path}\nBody`,
      ctime: s.ctime,
      mtime: s.mtime,
      frontmatter: s.frontmatter,
    }))
  );
  return app.vault.getMarkdownFiles().map((file) => ({
    file,
    cache: app.metadataCache.getFileCache(file),
  }));
}

describe("buildNotebookSequence", () => {
  it("groups root notes first, keeps nested folders under parents, and sorts alphabetically by default", () => {
    const sources = makeSources([
      { path: "Walks/Courtyard.md" },
      { path: "Ideas/Note 10.md" },
      { path: "Ideas/Note 2.md" },
      { path: "Ideas/Sub/Nested.md" },
      { path: "Ideas Archive/Old.md" },
      { path: "Welcome.md" },
      { path: "Alpha.md" },
    ]);

    const res = buildNotebookSequence(sources, {
      sortOrder: "alpha",
      excludedFolders: [],
      hideDailyNotes: false,
    });

    expect(res.sections.map((s) => s.sectionLabel)).toEqual([
      "Root",
      "Ideas",
      "Ideas/Sub",
      "Ideas Archive",
      "Walks",
    ]);

    expect(res.sequence.map((n) => n.path)).toEqual([
      "Alpha.md",
      "Welcome.md",
      "Ideas/Note 2.md",
      "Ideas/Note 10.md",
      "Ideas/Sub/Nested.md",
      "Ideas Archive/Old.md",
      "Walks/Courtyard.md",
    ]);
  });

  it("uses frontmatter title when present for alphabetical sorting", () => {
    const sources = makeSources([
      { path: "Ideas/z-file.md", content: "---\ntitle: Aardvark\n---\nBody" },
      { path: "Ideas/a-file.md", content: "---\ntitle: Zebra\n---\nBody" },
    ]);

    const res = buildNotebookSequence(sources, {
      sortOrder: "alpha",
      excludedFolders: [],
      hideDailyNotes: false,
    });

    expect(res.sequence.map((n) => n.title)).toEqual(["Aardvark", "Zebra"]);
  });

  it("sorts chronologically within folders using frontmatter date > filename YYYY-MM-DD > ctime > mtime", () => {
    const sources = makeSources([
      {
        path: "Ideas/First by ctime.md",
        ctime: Date.UTC(2026, 0, 5),
        mtime: Date.UTC(2026, 5, 1),
      },
      {
        path: "Ideas/2026-01-03 Filename date.md",
        ctime: Date.UTC(2026, 2, 10),
        mtime: Date.UTC(2026, 2, 10),
      },
      {
        path: "Ideas/Frontmatter overrides all.md",
        content: "---\ndate: 2026-01-01\n---\nEarly note",
        ctime: Date.UTC(2026, 4, 1),
        mtime: Date.UTC(2026, 4, 1),
      },
      {
        path: "Ideas/Fallback mtime only.md",
        ctime: 0,
        mtime: Date.UTC(2026, 0, 10),
      },
    ]);

    const res = buildNotebookSequence(sources, {
      sortOrder: "date",
      excludedFolders: [],
      hideDailyNotes: false,
    });

    expect(res.sequence.map((n) => n.basename)).toEqual([
      "Frontmatter overrides all",
      "2026-01-03 Filename date",
      "First by ctime",
      "Fallback mtime only",
    ]);
  });

  it("excludes nested subfolders when parent folder is excluded and isolates root exclusion", () => {
    const sources = makeSources([
      { path: "RootNote.md" },
      { path: "Ideas/Main.md" },
      { path: "Ideas/Drafts/Early.md" },
      { path: "Ideas Archive/Kept.md" },
      { path: "Reading/Books.md" },
    ]);

    const withoutIdeas = buildNotebookSequence(sources, {
      sortOrder: "alpha",
      excludedFolders: ["Ideas"],
      hideDailyNotes: false,
    });

    expect(withoutIdeas.sequence.map((n) => n.path)).toEqual([
      "RootNote.md",
      "Ideas Archive/Kept.md",
      "Reading/Books.md",
    ]);

    const withoutRootOnly = buildNotebookSequence(sources, {
      sortOrder: "alpha",
      excludedFolders: [""],
      hideDailyNotes: false,
    });

    expect(withoutRootOnly.sequence.map((n) => n.path)).toEqual([
      "Ideas/Main.md",
      "Ideas/Drafts/Early.md",
      "Ideas Archive/Kept.md",
      "Reading/Books.md",
    ]);
  });

  it("detects daily-note folders by folder name or dated filenames and respects hideDailyNotes", () => {
    const sources = makeSources([
      { path: "Ideas/Attention.md" },
      { path: "Journal/Entry.md" },
      { path: "Logs/2026-11-01.md" },
      { path: "Logs/2026-11-02.md" },
      { path: "Logs/Summary.md" },
    ]);

    const hidden = buildNotebookSequence(sources, {
      sortOrder: "alpha",
      excludedFolders: [],
      hideDailyNotes: true,
    });

    expect(hidden.dailyFolders.has("Journal")).toBe(true);
    expect(hidden.dailyFolders.has("Logs")).toBe(true);
    expect(hidden.sequence.map((n) => n.path)).toEqual(["Ideas/Attention.md"]);

    const shown = buildNotebookSequence(sources, {
      sortOrder: "alpha",
      excludedFolders: [],
      hideDailyNotes: false,
    });

    expect(shown.sequence.map((n) => n.path)).toEqual([
      "Ideas/Attention.md",
      "Journal/Entry.md",
      "Logs/2026-11-01.md",
      "Logs/2026-11-02.md",
      "Logs/Summary.md",
    ]);
  });

  it("supports flat global A-Z and Date sorting without folder sectioning while honoring exclusions", () => {
    const sources = makeSources([
      { path: "Walks/Alpha walk.md", content: "---\ndate: 2026-01-05\n---\nWalk" },
      { path: "Ideas/Zeta idea.md", content: "---\ndate: 2026-01-01\n---\nIdea" },
      { path: "Reading/Middle book.md", content: "---\ndate: 2026-01-03\n---\nBook" },
      { path: "Journal/2026-01-02.md", content: "Daily note" },
    ]);

    const flatAlpha = buildNotebookSequence(sources, {
      sortOrder: "alpha",
      groupByFolder: false,
      excludedFolders: [],
      hideDailyNotes: true,
    });

    expect(flatAlpha.sections).toEqual([]);
    expect(flatAlpha.sequence.map((n) => n.path)).toEqual([
      "Walks/Alpha walk.md",
      "Reading/Middle book.md",
      "Ideas/Zeta idea.md",
    ]);

    const flatDate = buildNotebookSequence(sources, {
      sortOrder: "date",
      groupByFolder: false,
      excludedFolders: [],
      hideDailyNotes: true,
    });

    expect(flatDate.sections).toEqual([]);
    expect(flatDate.sequence.map((n) => n.path)).toEqual([
      "Ideas/Zeta idea.md",
      "Reading/Middle book.md",
      "Walks/Alpha walk.md",
    ]);
  });
});
