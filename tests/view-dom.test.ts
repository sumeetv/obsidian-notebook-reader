import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotebookReaderPlugin from "../src/main";
import { createMockApp, type MockNoteSeed, WorkspaceLeaf } from "../src/testing/obsidian-mock";
import { NotebookReaderView, NOTEBOOK_VIEW_TYPE } from "../src/view";

function polyfillPointerEvent(): void {
  if (typeof globalThis.PointerEvent === "undefined") {
    class MockPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "touch";
      }
    }
    (globalThis as any).PointerEvent = MockPointerEvent;
  }
}

function makeRichVaultSeeds(): MockNoteSeed[] {
  const longParagraphs = Array.from(
    { length: 24 },
    (_, i) =>
      `## Section ${i + 1}\n\nLong reading passage ${i + 1} with [[Constraints make room]] and detail about steady attention across pages.`
  ).join("\n\n");

  return [
    {
      path: "Ideas/Attention is a material.md",
      content: `---\ntitle: Attention is a material\ndate: 2026-10-12\n---\n\nOpening thought.\n\n${longParagraphs}`,
    },
    {
      path: "Ideas/Constraints make room.md",
      content: `---\ntitle: Constraints make room\ndate: 2026-09-23\n---\n\nShort note with an embed:\n\n![[Slow knowledge]]\n\nAnd link to [[Gardens and paths]].`,
    },
    {
      path: "Ideas/Slow knowledge.md",
      content: `---\ntitle: Slow knowledge\ndate: 2026-11-02\n---\n\nSlow knowledge unfolds on revisit.\n\n${longParagraphs}`,
    },
    {
      path: "Reading/Gardens and paths.md",
      content: `---\ntitle: Gardens and paths\ndate: 2026-08-14\n---\n\nA garden grows beyond its initial outline.\n\n${longParagraphs}`,
    },
    {
      path: "Walks/Courtyard observations.md",
      content: `---\ntitle: Courtyard observations\ndate: 2026-10-08\n---\n\nMoss between stones.`,
    },
    {
      path: "Journal/2026-11-10.md",
      content: `# 2026-11-10\n\nDaily entry excluded by default.`,
    },
  ];
}

async function mountPluginView(seeds: MockNoteSeed[]) {
  const app = createMockApp(seeds, "Fieldnotes");
  const plugin = new NotebookReaderPlugin(app as any, {
    id: "obsidian-notebook-reader",
    name: "Notebook Reader",
    version: "0.1.0",
    minAppVersion: "1.5.0",
    description: "",
    author: "",
  });
  await plugin.onload();
  const leaf = new WorkspaceLeaf();
  const view = (
    plugin as unknown as {
      createViewInstance: (type: string, leaf: WorkspaceLeaf) => NotebookReaderView;
    }
  ).createViewInstance(NOTEBOOK_VIEW_TYPE, leaf);
  await view.onOpen();
  document.body.innerHTML = "";
  document.body.appendChild(view.containerEl);
  return { app, plugin, leaf, view };
}

describe("NotebookReaderView DOM & interaction flows", () => {
  beforeEach(() => {
    polyfillPointerEvent();
    document.body.innerHTML = "";
  });

  it("renders facing consecutive notes, strips frontmatter, renders links/embeds, and hides daily notes by default", async () => {
    const { view } = await mountPluginView(makeRichVaultSeeds());

    const leftTitle = view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent;
    const rightTitle = view.contentEl.querySelector('.nb-page-right .nb-page-title')?.textContent;
    expect(leftTitle).toBe("Attention is a material");
    expect(rightTitle).toBe("Constraints make room");

    // Frontmatter should not leak into rendered markdown body
    const leftHtml = view.contentEl.querySelector('.nb-page-left .nb-page-markdown')?.innerHTML ?? "";
    expect(leftHtml).not.toContain("date: 2026-10-12");
    expect(leftHtml).toContain("internal-link");

    // Embed should render cleanly
    const rightHtml = view.contentEl.querySelector('.nb-page-right .nb-page-markdown')?.innerHTML ?? "";
    expect(rightHtml).toContain("internal-embed");

    // Daily note folder should be excluded by default (5 non-daily notes)
    expect(view.contentEl.querySelector(".nb-page-counter")?.textContent).toBe("1–2 / 5");
  });

  it("previews titles during thumb-edge glide without reading the vault or changing the spread, commits on release, and cancels cleanly", async () => {
    const { app, view } = await mountPluginView(makeRichVaultSeeds());
    const track = view.contentEl.querySelector(".nb-edge-track") as HTMLElement;
    const preview = view.contentEl.querySelector(".nb-edge-preview") as HTMLElement;

    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      top: 100,
      left: 900,
      width: 60,
      height: 500,
      right: 960,
      bottom: 600,
      x: 900,
      y: 100,
      toJSON: () => ({}),
    });

    const readsBeforeGlide = app.vault.cachedReadCount + app.vault.readCount;

    // Press and glide near the bottom of the fore-edge (Walks / Courtyard observations)
    track.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: 930, clientY: 350, bubbles: true })
    );
    track.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 7, pointerType: "touch", clientX: 925, clientY: 580, bubbles: true })
    );

    expect(preview.hasAttribute("hidden")).toBe(false);
    expect(preview.querySelector(".nb-edge-preview-title")?.textContent).toBe("Courtyard observations");
    expect(preview.querySelector(".nb-edge-preview-meta")?.textContent).toContain("Walks · Page 5 of 5");

    // Positioned above touch point (relY = 480 -> previewTop <= 480 - 98 - 12)
    const previewTop = Number.parseInt(preview.style.top, 10);
    expect(previewTop).toBeLessThan(480);

    // Spread MUST NOT have changed during glide
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Attention is a material"
    );

    // Zero vault reads during glide
    expect(app.vault.cachedReadCount + app.vault.readCount).toBe(readsBeforeGlide);

    // Cancel via pointercancel -> spread stays on Attention is a material, preview hides
    track.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 7, pointerType: "touch", clientX: 925, clientY: 580, bubbles: true })
    );
    expect(preview.hasAttribute("hidden")).toBe(true);
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Attention is a material"
    );

    // Press, glide to Slow knowledge (middle), and release -> commits navigation
    track.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 8, pointerType: "touch", clientX: 930, clientY: 200, bubbles: true })
    );
    track.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 8, pointerType: "touch", clientX: 930, clientY: 350, bubbles: true })
    );
    expect(preview.querySelector(".nb-edge-preview-title")?.textContent).toBe("Slow knowledge");

    track.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 8, pointerType: "touch", clientX: 930, clientY: 350, bubbles: true })
    );

    // Wait a tick for async MarkdownRenderer
    await new Promise((r) => setTimeout(r, 10));
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Slow knowledge"
    );
  });

  it("preserves independent scroll positions across hold, browse, index toggle, swap, compare, and view reopen", async () => {
    const { app, plugin, view } = await mountPluginView(makeRichVaultSeeds());

    const leftScroll = view.contentEl.querySelector('[data-pane-scroll="left"]') as HTMLElement;
    const rightScroll = view.contentEl.querySelector('[data-pane-scroll="right"]') as HTMLElement;

    // Simulate scrollable geometry in jsdom
    Object.defineProperty(leftScroll, "scrollHeight", { configurable: true, value: 2400 });
    Object.defineProperty(leftScroll, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(rightScroll, "scrollHeight", { configurable: true, value: 1800 });
    Object.defineProperty(rightScroll, "clientHeight", { configurable: true, value: 600 });

    leftScroll.scrollTop = 420;
    leftScroll.dispatchEvent(new Event("scroll"));
    rightScroll.scrollTop = 190;
    rightScroll.dispatchEvent(new Event("scroll"));

    // Hold left page (Attention is a material at 420)
    (view.contentEl.querySelector(".nb-bottombar button:nth-child(3)") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(leftScroll.scrollTop).toBe(420);

    // Browse right pane forward to Gardens and paths and scroll to 640
    (view.contentEl.querySelector('[aria-label="Next page"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    (view.contentEl.querySelector('[aria-label="Next page"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));

    expect(view.contentEl.querySelector('.nb-page-right .nb-page-title')?.textContent).toBe(
      "Gardens and paths"
    );
    rightScroll.scrollTop = 640;
    rightScroll.dispatchEvent(new Event("scroll"));

    // Open and close Indexed Folio -> preserves both scroll positions
    const indexBtn = view.contentEl.querySelector(".nb-index-btn") as HTMLButtonElement;
    indexBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(view.contentEl.querySelector(".nb-folio-index")).not.toBeNull();
    expect(leftScroll.scrollTop).toBe(420);
    expect(rightScroll.scrollTop).toBe(640);

    (view.contentEl.querySelector(".nb-folio-close-btn") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(leftScroll.scrollTop).toBe(420);
    expect(rightScroll.scrollTop).toBe(640);

    // Swap -> left gets Gardens (640), right gets Attention (420)
    (view.contentEl.querySelector(".nb-swap-btn") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Gardens and paths"
    );
    expect(view.contentEl.querySelector('.nb-page-right .nb-page-title')?.textContent).toBe(
      "Attention is a material"
    );
    expect(leftScroll.scrollTop).toBe(640);
    expect(rightScroll.scrollTop).toBe(420);

    // Close view and reopen from persisted plugin data -> restores both locations
    await view.onClose();

    const plugin2 = new NotebookReaderPlugin(app as any, plugin.manifest);
    const saved = await plugin.loadData();
    vi.spyOn(plugin2, "loadData").mockResolvedValue(saved);
    await plugin2.onload();
    const leaf2 = new WorkspaceLeaf();
    const view2 = (
      plugin2 as unknown as {
        createViewInstance: (type: string, leaf: WorkspaceLeaf) => NotebookReaderView;
      }
    ).createViewInstance(NOTEBOOK_VIEW_TYPE, leaf2);
    await view2.onOpen();

    const leftScroll2 = view2.contentEl.querySelector('[data-pane-scroll="left"]') as HTMLElement;
    const rightScroll2 = view2.contentEl.querySelector('[data-pane-scroll="right"]') as HTMLElement;
    expect(view2.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Gardens and paths"
    );
    expect(view2.contentEl.querySelector('.nb-page-right .nb-page-title')?.textContent).toBe(
      "Attention is a material"
    );
    expect(leftScroll2.scrollTop).toBe(640);
    expect(rightScroll2.scrollTop).toBe(420);
  });

  it("separates vertical/diagonal reading gestures from horizontal page swipes", async () => {
    const { view } = await mountPluginView(makeRichVaultSeeds());
    const spread = view.contentEl.querySelector(".nb-book-spread") as HTMLElement;

    // Diagonal scroll gesture (dx = 50, dy = 140) must NOT change spread
    spread.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 300, clientY: 200, bubbles: true })
    );
    spread.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, pointerType: "touch", clientX: 250, clientY: 340, bubbles: true })
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Attention is a material"
    );

    // Clean horizontal swipe left (dx = -140, dy = 8) DOES advance spread
    spread.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 250, bubbles: true })
    );
    spread.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 2, pointerType: "touch", clientX: 260, clientY: 258, bubbles: true })
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Constraints make room"
    );
  });

  it("handles empty browsing set and large 150-note collection without reading vault during edge glide", async () => {
    // 1. Empty browsing set (all folders daily-only with default hideDailyNotes: true)
    const { view: emptyView } = await mountPluginView([
      { path: "Journal/2026-11-10.md", content: "Daily note only" },
    ]);
    expect(emptyView.contentEl.querySelector(".nb-empty-title")?.textContent).toBe(
      "No notes in this notebook view"
    );
    expect(emptyView.contentEl.querySelector(".nb-page-counter")?.textContent).toBe("0 / 0");

    // 2. Large collection of 150 notes across 10 folders
    const largeSeeds: MockNoteSeed[] = [];
    for (let i = 1; i <= 150; i++) {
      const folderNum = String(((i - 1) % 10) + 1).padStart(2, "0");
      largeSeeds.push({
        path: `Section-${folderNum}/Note ${String(i).padStart(3, "0")}.md`,
        content: `# Note ${i}\n\nParagraph for note ${i}.`,
      });
    }
    const { app, view: largeView } = await mountPluginView(largeSeeds);
    expect(largeView.contentEl.querySelector(".nb-page-counter")?.textContent).toBe("1–2 / 150");

    const track = largeView.contentEl.querySelector(".nb-edge-track") as HTMLElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 900,
      width: 60,
      height: 600,
      right: 960,
      bottom: 600,
      x: 900,
      y: 0,
      toJSON: () => ({}),
    });

    const readsBefore = app.vault.cachedReadCount + app.vault.readCount;
    track.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 3, pointerType: "touch", clientX: 930, clientY: 100, bubbles: true })
    );
    for (let y = 120; y <= 550; y += 30) {
      track.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 3, pointerType: "touch", clientX: 930, clientY: y, bubbles: true })
      );
    }
    expect(app.vault.cachedReadCount + app.vault.readCount).toBe(readsBefore);
    expect(largeView.contentEl.querySelector(".nb-edge-preview-meta")?.textContent).toContain("of 150");
    track.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 3, pointerType: "touch", clientX: 930, clientY: 550, bubbles: true })
    );
  });

  it("navigates internal links inside notebook and cleans up view resources on close", async () => {
    const { app, view } = await mountPluginView(makeRichVaultSeeds());

    // Clicking an internal link inside the left pane navigates to Constraints make room
    const link = view.contentEl.querySelector('.nb-page-left a.internal-link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    link.click();
    await new Promise((r) => setTimeout(r, 15));
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Constraints make room"
    );

    // Pressing Escape cancels an active thumb-edge drag
    const track = view.contentEl.querySelector(".nb-edge-track") as HTMLElement;
    const preview = view.contentEl.querySelector(".nb-edge-preview") as HTMLElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 900,
      width: 60,
      height: 500,
      right: 960,
      bottom: 500,
      x: 900,
      y: 0,
      toJSON: () => ({}),
    });
    track.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 9, pointerType: "touch", clientX: 930, clientY: 460, bubbles: true })
    );
    expect(preview.hasAttribute("hidden")).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(preview.hasAttribute("hidden")).toBe(true);
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Constraints make room"
    );

    // Closing the view cleans up content and remains safe when vault changes afterwards
    await view.onClose();
    expect(view.contentEl.innerHTML).toBe("");
    app.vault.updateContent("Ideas/Constraints make room.md", "# Updated\n\nAfter close.");
    await new Promise((r) => setTimeout(r, 100));
    expect(view.contentEl.innerHTML).toBe("");
  });

  it("toggles sort order, folder exclusions while preserving outside-filter held note, and defines equal-width pane CSS", async () => {
    const { view } = await mountPluginView(makeRichVaultSeeds());

    // Switch to Date ordering -> preserves current note ("Attention is a material") while re-ordering sequence
    // so Constraints make room (2026-09-23) is now before it and Slow knowledge (2026-11-02) is facing it.
    const dateBtn = view.contentEl.querySelector('[data-sort="date"]') as HTMLButtonElement;
    dateBtn.click();
    await new Promise((r) => setTimeout(r, 15));
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Attention is a material"
    );
    expect(view.contentEl.querySelector('.nb-page-right .nb-page-title')?.textContent).toBe(
      "Slow knowledge"
    );
    expect(view.contentEl.querySelector(".nb-page-counter")?.textContent).toBe("2–3 / 5");

    (view.contentEl.querySelector('[aria-label="Previous page"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 15));
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe(
      "Constraints make room"
    );

    // Open Folders popover, include daily notes, jump to Journal, hold it, then re-exclude daily notes
    (view.contentEl.querySelector(".nb-folders-btn") as HTMLButtonElement).click();
    const dailyCheckbox = view.contentEl.querySelector(".is-daily-toggle input") as HTMLInputElement;
    expect(dailyCheckbox.checked).toBe(false);
    dailyCheckbox.checked = true;
    dailyCheckbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 15));
    expect(view.contentEl.querySelector(".nb-page-counter")?.textContent).toContain("/ 6");

    // Jump to Journal tab and hold it
    const journalTab = view.contentEl.querySelector('[data-folder-path="Journal"]') as HTMLButtonElement;
    journalTab.click();
    await new Promise((r) => setTimeout(r, 15));
    expect(view.contentEl.querySelector('.nb-page-left .nb-page-title')?.textContent).toBe("2026-11-10");
    (view.contentEl.querySelector('.nb-page-left .nb-pane-pin-btn') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 15));

    // Re-exclude daily notes -> held reference stays preserved and clearly labeled outside filter
    dailyCheckbox.checked = false;
    dailyCheckbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 15));
    expect(view.contentEl.querySelector(".nb-held-summary")?.textContent).toContain("Outside current filter");

    // Open Indexed Folio -> shows Held · Outside current filter section alongside active sequence
    (view.contentEl.querySelector(".nb-index-btn") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 15));
    expect(view.contentEl.querySelector(".nb-folio-section.is-outside-filter")).not.toBeNull();

    // Verify stylesheet guarantees equal-width facing pages and matched scrollbar gutters
    const css = fs.readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr);");
    expect(css).toContain("scrollbar-gutter: stable;");
  });
});
