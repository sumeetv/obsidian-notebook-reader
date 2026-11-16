import { describe, expect, it } from "vitest";
import { buildNotebookSequence } from "../src/sequencer";
import { NotebookStateManager } from "../src/state";
import { createMockApp } from "../src/testing/obsidian-mock";

function setupSequence(hideDailyNotes = true) {
  const app = createMockApp([
    { path: "Ideas/A.md", content: "Note A" },
    { path: "Ideas/B.md", content: "Note B" },
    { path: "Ideas/C.md", content: "Note C" },
    { path: "Reading/G.md", content: "Gardens" },
    { path: "Journal/2026-11-10.md", content: "Daily note" },
  ]);
  const sources = app.vault.getMarkdownFiles().map((file) => ({
    file,
    cache: app.metadataCache.getFileCache(file),
  }));
  return buildNotebookSequence(sources, {
    sortOrder: "alpha",
    excludedFolders: [],
    hideDailyNotes,
  });
}

describe("NotebookStateManager", () => {
  it("opens consecutive facing pages and handles end-of-sequence cleanly", () => {
    const seq = setupSequence(true);
    const state = new NotebookStateManager();
    state.reconcile(seq.sequence, seq.allEntriesByPath);

    let spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("consecutive");
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.right?.entry.path).toBe("Ideas/B.md");

    // Step to last note
    state.navigateToNote("Reading/G.md", seq.sequence);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.left?.entry.path).toBe("Reading/G.md");
    expect(spread.right).toBeNull();
  });

  it("holds either left or right page in view while browsing the opposite pane independently", () => {
    const seq = setupSequence(true);
    const state = new NotebookStateManager();
    state.reconcile(seq.sequence, seq.allEntriesByPath);

    // Scroll left (A) and right (B) independently, then hold left page
    state.recordScrollAnchor("Ideas/A.md", "current", {
      scrollTop: 240,
      scrollRatio: 0.4,
      blockIndex: 3,
      blockOffsetRatio: 0.2,
    });
    state.holdVisibleSide("left", seq.sequence, seq.allEntriesByPath);

    let spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("pinned-left");
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.left?.anchor.scrollTop).toBe(240);
    expect(spread.left?.isPinned).toBe(true);
    expect(spread.right?.entry.path).toBe("Ideas/B.md");

    // Step forward while pinned-left: left remains A at 240, right advances to C then G
    state.step(1, seq.sequence);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.left?.anchor.scrollTop).toBe(240);
    expect(spread.right?.entry.path).toBe("Ideas/C.md");

    // Return to consecutive browsing while keeping held reference
    state.returnToConsecutive(seq.sequence);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("consecutive");
    expect(spread.left?.entry.path).toBe("Ideas/C.md");
    expect(spread.right?.entry.path).toBe("Reading/G.md");
    expect(spread.heldEntry?.path).toBe("Ideas/A.md");

    // Hold right page (G) and browse left independently
    state.holdVisibleSide("right", seq.sequence, seq.allEntriesByPath);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("pinned-right");
    expect(spread.right?.entry.path).toBe("Reading/G.md");
    expect(spread.right?.isPinned).toBe(true);
    expect(spread.left?.entry.path).toBe("Ideas/C.md");

    state.step(-1, seq.sequence);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.left?.entry.path).toBe("Ideas/B.md");
    expect(spread.right?.entry.path).toBe("Reading/G.md");
  });

  it("swaps current and held passages predictably with exact scroll anchors and supports compare mode", () => {
    const seq = setupSequence(true);
    const state = new NotebookStateManager();
    state.reconcile(seq.sequence, seq.allEntriesByPath);

    state.recordScrollAnchor("Ideas/A.md", "current", {
      scrollTop: 310,
      scrollRatio: 0.5,
      blockIndex: 4,
      blockOffsetRatio: 0.1,
    });
    state.holdVisibleSide("left", seq.sequence, seq.allEntriesByPath);

    // Browse right pane to Reading/G.md and scroll to 520
    state.navigateToNote("Reading/G.md", seq.sequence);
    state.recordScrollAnchor("Reading/G.md", "current", {
      scrollTop: 520,
      scrollRatio: 0.8,
      blockIndex: 8,
      blockOffsetRatio: 0.5,
    });

    // Switch to compare mode
    state.returnToConsecutive(seq.sequence);
    state.toggleCompare(seq.sequence, seq.allEntriesByPath);
    let spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("compare");
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.left?.anchor.scrollTop).toBe(310);
    expect(spread.right?.entry.path).toBe("Reading/G.md");
    expect(spread.right?.anchor.scrollTop).toBe(520);

    // Swap once -> held becomes G (520), current becomes A (310)
    state.swapHeldAndCurrent(seq.allEntriesByPath);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.left?.entry.path).toBe("Reading/G.md");
    expect(spread.left?.anchor.scrollTop).toBe(520);
    expect(spread.right?.entry.path).toBe("Ideas/A.md");
    expect(spread.right?.anchor.scrollTop).toBe(310);

    // Swap again -> toggles cleanly back
    state.swapHeldAndCurrent(seq.allEntriesByPath);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.left?.anchor.scrollTop).toBe(310);
    expect(spread.right?.entry.path).toBe("Reading/G.md");
    expect(spread.right?.anchor.scrollTop).toBe(520);
  });

  it("preserves an existing held reference when its folder is excluded and marks it outside filter", () => {
    const seqAll = setupSequence(false);
    const state = new NotebookStateManager({ hideDailyNotes: false });
    state.reconcile(seqAll.sequence, seqAll.allEntriesByPath);

    // Hold a daily note while daily notes are visible
    state.navigateToNote("Journal/2026-11-10.md", seqAll.sequence);
    state.recordScrollAnchor("Journal/2026-11-10.md", "current", {
      scrollTop: 180,
      scrollRatio: 0.3,
      blockIndex: 2,
      blockOffsetRatio: 0,
    });
    state.holdVisibleSide("left", seqAll.sequence, seqAll.allEntriesByPath);

    // Now exclude daily notes
    state.setHideDailyNotes(true);
    const seqFiltered = setupSequence(true);
    state.reconcile(seqFiltered.sequence, seqFiltered.allEntriesByPath);

    const spread = state.getSpread(seqFiltered.sequence, seqFiltered.allEntriesByPath);
    expect(spread.heldEntry?.path).toBe("Journal/2026-11-10.md");
    expect(spread.isHeldOutsideFilter).toBe(true);
    expect(spread.left?.isOutsideFilter).toBe(true);
    expect(spread.left?.anchor.scrollTop).toBe(180);
  });

  it("handles note renames and deletions gracefully", () => {
    const seq = setupSequence(true);
    const state = new NotebookStateManager();
    state.reconcile(seq.sequence, seq.allEntriesByPath);

    state.recordScrollAnchor("Ideas/A.md", "current", {
      scrollTop: 150,
      scrollRatio: 0.25,
      blockIndex: 2,
      blockOffsetRatio: 0,
    });
    state.holdVisibleSide("left", seq.sequence, seq.allEntriesByPath);
    state.navigateToNote("Ideas/C.md", seq.sequence);

    // Rename held note A -> Ideas/A-renamed.md
    state.handleRename("Ideas/A.md", "Ideas/A-renamed.md");
    expect(state.held?.path).toBe("Ideas/A-renamed.md");
    expect(state.held?.anchor.scrollTop).toBe(150);

    // Delete current note C -> falls back to surviving neighbor in sequence
    const remaining = seq.sequence.filter((e) => e.path !== "Ideas/C.md");
    state.handleDelete("Ideas/C.md", remaining);
    expect(state.current?.path).toBe("Ideas/A.md");

    // Delete held note -> clears held gracefully and returns to consecutive mode
    state.handleDelete("Ideas/A-renamed.md", remaining);
    expect(state.held).toBeNull();
    expect(state.spreadMode).toBe("consecutive");
  });

  it("keeps the left page as current when unpinning the left page or clearing held", () => {
    const seq = setupSequence(true);
    const state = new NotebookStateManager();
    state.reconcile(seq.sequence, seq.allEntriesByPath);

    state.recordScrollAnchor("Ideas/A.md", "current", {
      scrollTop: 240,
      scrollRatio: 0.4,
      blockIndex: 3,
      blockOffsetRatio: 0.2,
    });

    // Pin left page on [Ideas/A.md, Ideas/B.md], then unpin it -> keeps [Ideas/A.md, Ideas/B.md]
    state.holdVisibleSide("left", seq.sequence, seq.allEntriesByPath);
    expect(state.spreadMode).toBe("pinned-left");
    expect(state.narrowActiveSlot).toBe("right");

    state.holdVisibleSide("left", seq.sequence, seq.allEntriesByPath);
    let spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("consecutive");
    expect(state.narrowActiveSlot).toBe("left");
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.left?.anchor.scrollTop).toBe(240);
    expect(spread.right?.entry.path).toBe("Ideas/B.md");

    // Pin left, browse right away to Ideas/C.md, then clearHeld(seq.sequence) -> restores Ideas/A.md
    state.holdVisibleSide("left", seq.sequence, seq.allEntriesByPath);
    state.step(1, seq.sequence);
    expect(state.getSpread(seq.sequence, seq.allEntriesByPath).right?.entry.path).toBe("Ideas/C.md");

    state.clearHeld(seq.sequence);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("consecutive");
    expect(state.narrowActiveSlot).toBe("left");
    expect(state.held).toBeNull();
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.left?.anchor.scrollTop).toBe(240);
    expect(spread.right?.entry.path).toBe("Ideas/B.md");

    // In compare mode (left = Ideas/A.md, right = Reading/G.md), unpinning left via holdVisibleSide
    // and clearing held via clearHeld both preserve Ideas/A.md as current
    state.recordScrollAnchor("Ideas/A.md", "current", {
      scrollTop: 310,
      scrollRatio: 0.5,
      blockIndex: 4,
      blockOffsetRatio: 0.1,
    });
    state.holdVisibleSide("left", seq.sequence, seq.allEntriesByPath);
    state.navigateToNote("Reading/G.md", seq.sequence);
    state.returnToConsecutive(seq.sequence);
    state.toggleCompare(seq.sequence, seq.allEntriesByPath);
    expect(state.spreadMode).toBe("compare");

    state.holdVisibleSide("left", seq.sequence, seq.allEntriesByPath);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("consecutive");
    expect(state.narrowActiveSlot).toBe("left");
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.left?.anchor.scrollTop).toBe(310);
    expect(spread.right?.entry.path).toBe("Ideas/B.md");

    state.navigateToNote("Reading/G.md", seq.sequence);
    state.toggleCompare(seq.sequence, seq.allEntriesByPath);
    expect(state.spreadMode).toBe("compare");

    state.clearHeld(seq.sequence);
    spread = state.getSpread(seq.sequence, seq.allEntriesByPath);
    expect(spread.mode).toBe("consecutive");
    expect(state.narrowActiveSlot).toBe("left");
    expect(state.held).toBeNull();
    expect(spread.left?.entry.path).toBe("Ideas/A.md");
    expect(spread.left?.anchor.scrollTop).toBe(310);
    expect(spread.right?.entry.path).toBe("Ideas/B.md");

    // If the held note is outside the filtered sequence, clearHeld keeps the in-sequence current note
    const seqAll = setupSequence(false);
    const filteredState = new NotebookStateManager({ hideDailyNotes: false });
    filteredState.reconcile(seqAll.sequence, seqAll.allEntriesByPath);
    filteredState.navigateToNote("Journal/2026-11-10.md", seqAll.sequence);
    filteredState.holdVisibleSide("left", seqAll.sequence, seqAll.allEntriesByPath);
    filteredState.setHideDailyNotes(true);
    const seqFiltered = setupSequence(true);
    filteredState.reconcile(seqFiltered.sequence, seqFiltered.allEntriesByPath);

    filteredState.clearHeld(seqFiltered.sequence);
    const filteredSpread = filteredState.getSpread(seqFiltered.sequence, seqFiltered.allEntriesByPath);
    expect(filteredSpread.mode).toBe("consecutive");
    expect(filteredState.narrowActiveSlot).toBe("left");
    expect(filteredState.held).toBeNull();
    expect(filteredSpread.left?.entry.path).toBe("Reading/G.md");
  });
});
