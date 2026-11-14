import {
  Component,
  ItemView,
  MarkdownRenderer,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
  type CachedMetadata,
  type ViewStateResult,
} from "obsidian";
import { FolioIndexPanel } from "./folio-index";
import { buildNotebookSequence, type FolderSummary, type SequenceResult } from "./sequencer";
import { cloneAnchor, createZeroAnchor, NotebookStateManager } from "./state";
import { ThumbEdgeController } from "./thumb-edge";
import type {
  NotebookPersistedData,
  NoteEntry,
  PaneDescriptor,
  PaneSide,
  PassageAnchor,
  SortOrder,
} from "./types/notebook";

export const NOTEBOOK_VIEW_TYPE = "obsidian-notebook-reader-view";

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, pre, table";
const NARROW_BREAKPOINT_PX = 740;

export interface NotebookPluginHost {
  getStateManager(): NotebookStateManager;
  persistState(): Promise<void>;
  getSequenceResult(): SequenceResult;
}

interface PaneElements {
  paneEl: HTMLDivElement;
  headerEl: HTMLDivElement;
  roleBadgeEl: HTMLSpanElement;
  folderLabelEl: HTMLSpanElement;
  dateLabelEl: HTMLSpanElement;
  pinBtn: HTMLButtonElement;
  scrollEl: HTMLDivElement;
  articleEl: HTMLElement;
  titleEl: HTMLHeadingElement;
  markdownEl: HTMLDivElement;
  footerMetaEl: HTMLDivElement;
}

interface RenderedPaneState {
  path: string;
  mtime: number;
  component: Component;
  renderSeq: number;
}

export function extractMarkdownBody(raw: string, cache: CachedMetadata | null): string {
  const endOffset = cache?.frontmatterPosition?.end?.offset;
  if (typeof endOffset === "number" && endOffset > 0 && endOffset <= raw.length) {
    return raw.slice(endOffset).replace(/^\s*\r?\n/, "");
  }

  // Fallback strip if MetadataCache hasn't indexed a newly created note yet
  if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
    const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw);
    if (match) {
      return raw.slice(match[0].length).replace(/^\s*\r?\n/, "");
    }
  }
  return raw;
}

export function captureScrollAnchor(scrollEl: HTMLElement): PassageAnchor {
  const scrollTop = Math.max(0, scrollEl.scrollTop);
  const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  const scrollRatio = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0;

  const blocks = Array.from(scrollEl.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  let blockIndex = 0;
  let blockOffsetRatio = 0;
  let headingText: string | undefined;
  let excerpt: string | undefined;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const tag = block.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const hText = block.textContent?.trim();
      if (hText) headingText = hText;
    }

    const top = block.offsetTop;
    const height = block.offsetHeight;
    if (height > 0 && top + height >= scrollTop + 4) {
      blockIndex = i;
      blockOffsetRatio = Math.min(1, Math.max(0, (scrollTop - top) / height));
      const text = block.textContent?.trim();
      if (text) {
        excerpt = text.slice(0, 96);
      }
      break;
    }
  }

  return {
    scrollTop,
    scrollRatio,
    blockIndex,
    blockOffsetRatio,
    headingText,
    excerpt,
  };
}

export function restoreScrollAnchor(scrollEl: HTMLElement, anchor: PassageAnchor): void {
  const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  if (maxScroll > 0) {
    if (anchor.scrollTop > 0 && anchor.scrollTop <= maxScroll + 2) {
      scrollEl.scrollTop = anchor.scrollTop;
      return;
    }

    if (anchor.blockIndex > 0) {
      const blocks = Array.from(scrollEl.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
      const target = blocks[Math.min(anchor.blockIndex, blocks.length - 1)];
      if (target && target.offsetTop > 0) {
        const computed = target.offsetTop + target.offsetHeight * anchor.blockOffsetRatio;
        scrollEl.scrollTop = Math.min(maxScroll, Math.max(0, computed));
        return;
      }
    }

    scrollEl.scrollTop = Math.min(maxScroll, Math.max(0, anchor.scrollRatio * maxScroll));
    return;
  }

  // Fallback for environments without computed scrollHeight (e.g. unit test DOMs)
  scrollEl.scrollTop = Math.max(0, anchor.scrollTop);
}

export class NotebookReaderView extends ItemView {
  private readonly host: NotebookPluginHost;

  private rootEl!: HTMLDivElement;
  private brandTitleEl!: HTMLSpanElement;
  private sortAlphaBtn!: HTMLButtonElement;
  private sortDateBtn!: HTMLButtonElement;
  private foldersBtn!: HTMLButtonElement;
  private folderPopoverEl!: HTMLDivElement;
  private indexToggleBtn!: HTMLButtonElement;
  private narrowSwitchBar!: HTMLDivElement;
  private narrowLeftBtn!: HTMLButtonElement;
  private narrowRightBtn!: HTMLButtonElement;

  private spreadEl!: HTMLDivElement;
  private leftPane!: PaneElements;
  private rightPane!: PaneElements;
  private rightRailEl!: HTMLDivElement;

  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private holdLeftBtn!: HTMLButtonElement;
  private holdRightBtn!: HTMLButtonElement;
  private consecutiveBtn!: HTMLButtonElement;
  private swapBtn!: HTMLButtonElement;
  private compareBtn!: HTMLButtonElement;
  private heldStatusEl!: HTMLSpanElement;
  private pageCounterEl!: HTMLSpanElement;

  private thumbEdge: ThumbEdgeController | null = null;
  private folioIndex: FolioIndexPanel | null = null;
  private folderPopoverOpen = false;
  private isNarrow = false;
  private resizeObserver: ResizeObserver | null = null;

  private renderedPanes: Record<PaneSide, RenderedPaneState | null> = {
    left: null,
    right: null,
  };
  private currentDescriptors: Record<PaneSide, PaneDescriptor | null> = {
    left: null,
    right: null,
  };
  private paneScrollEpoch: Record<PaneSide, number> = { left: 0, right: 0 };
  private lastRestoredScrollTop: Record<PaneSide, number> = { left: 0, right: 0 };
  private renderCounter = 0;
  private persistTimer: number | null = null;
  private isClosed = false;
  private lastSequence: SequenceResult | null = null;

  constructor(leaf: WorkspaceLeaf, host: NotebookPluginHost) {
    super(leaf);
    this.host = host;
    this.icon = "book-open";
  }

  getViewType(): string {
    return NOTEBOOK_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Notebook Reader";
  }

  getIcon(): string {
    return "book-open";
  }

  getState(): Record<string, unknown> {
    this.snapshotLiveAnchors();
    return {
      notebookState: this.host.getStateManager().getData(),
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (state && typeof state === "object" && "notebookState" in state) {
      const payload = (state as { notebookState?: Partial<NotebookPersistedData> }).notebookState;
      if (payload) {
        this.host.getStateManager().hydrate(payload);
      }
    }
    if (this.rootEl && !this.isClosed) {
      await this.refresh({ forcePaneRerender: true });
    }
  }

  async onOpen(): Promise<void> {
    this.isClosed = false;
    this.contentEl.empty();
    this.contentEl.addClass("nb-view-host");

    this.buildShell();
    this.bindInteractions();
    this.observeContainerWidth();

    await this.refresh({ forcePaneRerender: true });
  }

  async onClose(): Promise<void> {
    this.isClosed = true;
    this.snapshotLiveAnchors();
    await this.host.persistState();

    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.unloadPaneComponent("left");
    this.unloadPaneComponent("right");

    this.thumbEdge?.destroy();
    this.thumbEdge = null;
    this.folioIndex?.destroy();
    this.folioIndex = null;

    this.contentEl.empty();
  }

  private buildShell(): void {
    this.rootEl = this.contentEl.createDiv({ cls: "nb-root" });

    // 1. Top Toolbar
    const topbar = this.rootEl.createDiv({ cls: "nb-topbar" });

    const brandGroup = topbar.createDiv({ cls: "nb-brand-group" });
    const brandIcon = brandGroup.createSpan({ cls: "nb-brand-icon", attr: { "aria-hidden": "true" } });
    setIcon(brandIcon, "book-open");
    this.brandTitleEl = brandGroup.createSpan({
      cls: "nb-brand-title",
      text: this.app.vault.getName() || "Notebook",
    });

    const topControls = topbar.createDiv({ cls: "nb-top-controls" });

    const sortGroup = topControls.createDiv({
      cls: "nb-segmented",
      attr: { role: "group", "aria-label": "Note ordering" },
    });
    this.sortAlphaBtn = sortGroup.createEl("button", {
      cls: "nb-seg-btn",
      type: "button",
      text: "A–Z",
      attr: { "data-sort": "alpha", "aria-pressed": "true" },
    });
    this.sortDateBtn = sortGroup.createEl("button", {
      cls: "nb-seg-btn",
      type: "button",
      text: "Date",
      attr: { "data-sort": "date", "aria-pressed": "false" },
    });

    const folderMenuWrap = topControls.createDiv({ cls: "nb-folder-menu-wrap" });
    this.foldersBtn = folderMenuWrap.createEl("button", {
      cls: "nb-top-btn nb-folders-btn",
      type: "button",
      text: "Folders ▾",
      attr: { "aria-expanded": "false", "aria-haspopup": "true" },
    });
    this.folderPopoverEl = folderMenuWrap.createDiv({
      cls: "nb-folder-popover",
      attr: { hidden: "true", role: "dialog", "aria-label": "Folder visibility" },
    });

    this.indexToggleBtn = topControls.createEl("button", {
      cls: "nb-top-btn nb-index-btn",
      type: "button",
      text: "Index",
      attr: { "aria-pressed": "false" },
    });

    // Narrow-screen slot switcher (hidden on iPad landscape / wide viewports)
    this.narrowSwitchBar = this.rootEl.createDiv({
      cls: "nb-narrow-switch",
      attr: { role: "tablist", "aria-label": "Visible page slot" },
    });
    this.narrowLeftBtn = this.narrowSwitchBar.createEl("button", {
      cls: "nb-narrow-tab",
      type: "button",
      text: "Left page",
      attr: { role: "tab", "aria-selected": "true" },
    });
    this.narrowRightBtn = this.narrowSwitchBar.createEl("button", {
      cls: "nb-narrow-tab",
      type: "button",
      text: "Right page",
      attr: { role: "tab", "aria-selected": "false" },
    });

    // 2. Main Stage (Open Book Spread + Right Rail)
    const stageEl = this.rootEl.createDiv({ cls: "nb-main-stage" });

    const bookFrameEl = stageEl.createDiv({ cls: "nb-book-frame" });
    this.spreadEl = bookFrameEl.createDiv({ cls: "nb-book-spread" });

    this.leftPane = this.createPaneElements(this.spreadEl, "left");
    this.spreadEl.createDiv({ cls: "nb-gutter", attr: { "aria-hidden": "true" } });
    this.rightPane = this.createPaneElements(this.spreadEl, "right");

    this.rightRailEl = stageEl.createDiv({ cls: "nb-right-rail" });

    // 3. Bottom Action & Placekeeping Bar
    const bottombar = this.rootEl.createDiv({ cls: "nb-bottombar" });

    const actionGroup = bottombar.createDiv({ cls: "nb-bottom-actions" });
    this.prevBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn nb-nav-btn",
      type: "button",
      text: "← Prev",
      attr: { "aria-label": "Previous page" },
    });
    this.nextBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn nb-nav-btn",
      type: "button",
      text: "Next →",
      attr: { "aria-label": "Next page" },
    });
    this.holdLeftBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn",
      type: "button",
      text: "Hold left page",
    });
    this.holdRightBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn",
      type: "button",
      text: "Hold right page",
    });
    this.consecutiveBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn",
      type: "button",
      text: "Consecutive",
      attr: { title: "Return to consecutive-note browsing" },
    });
    this.swapBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn nb-swap-btn",
      type: "button",
      text: "⇄ Swap",
      attr: { title: "Swap current and held reading positions" },
    });
    this.compareBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn nb-compare-btn",
      type: "button",
      text: "Compare",
      attr: { "aria-pressed": "false", title: "Compare held and current passages side by side" },
    });

    const statusGroup = bottombar.createDiv({ cls: "nb-bottom-status" });
    this.heldStatusEl = statusGroup.createSpan({ cls: "nb-held-summary" });
    this.pageCounterEl = statusGroup.createSpan({ cls: "nb-page-counter" });

    this.mountRightRail();
  }

  private createPaneElements(parent: HTMLElement, side: PaneSide): PaneElements {
    const paneEl = parent.createDiv({
      cls: `nb-page-pane nb-page-${side}`,
      attr: { "data-side": side },
    });

    const headerEl = paneEl.createDiv({ cls: "nb-page-header" });
    const metaLeft = headerEl.createDiv({ cls: "nb-page-header-meta" });
    const roleBadgeEl = metaLeft.createSpan({ cls: "nb-role-badge" });
    const folderLabelEl = metaLeft.createSpan({ cls: "nb-page-folder-pill" });
    const dateLabelEl = metaLeft.createSpan({ cls: "nb-page-date-label" });

    const pinBtn = headerEl.createEl("button", {
      cls: "nb-pane-pin-btn",
      type: "button",
      text: side === "left" ? "Hold left" : "Hold right",
      attr: { "aria-pressed": "false" },
    });

    const scrollEl = paneEl.createDiv({
      cls: "nb-page-scroll",
      attr: { "data-pane-scroll": side, tabindex: "0" },
    });
    const articleEl = scrollEl.createEl("article", { cls: "nb-page-article" });
    const titleEl = articleEl.createEl("h1", { cls: "nb-page-title" });
    const markdownEl = articleEl.createDiv({ cls: "nb-page-markdown markdown-rendered" });
    const footerMetaEl = articleEl.createDiv({ cls: "nb-page-footer-meta" });

    return {
      paneEl,
      headerEl,
      roleBadgeEl,
      folderLabelEl,
      dateLabelEl,
      pinBtn,
      scrollEl,
      articleEl,
      titleEl,
      markdownEl,
      footerMetaEl,
    };
  }

  private mountRightRail(): void {
    const state = this.host.getStateManager();
    this.thumbEdge?.destroy();
    this.thumbEdge = null;
    this.folioIndex?.destroy();
    this.folioIndex = null;
    this.rightRailEl.empty();

    if (state.indexOpen) {
      this.rightRailEl.addClass("is-index-open");
      this.rightRailEl.removeClass("is-edge-open");
      this.folioIndex = new FolioIndexPanel(this.rightRailEl, {
        onSelectNote: (path) => void this.navigateToNote(path),
        onActivateHeld: () => void this.activateHeldNote(),
        onCloseIndex: () => void this.setIndexOpen(false),
      });
    } else {
      this.rightRailEl.removeClass("is-index-open");
      this.rightRailEl.addClass("is-edge-open");
      this.thumbEdge = new ThumbEdgeController(this.rightRailEl, {
        onCommitNote: (path) => void this.navigateToNote(path),
        onSelectFolder: (folderPath) => void this.jumpToFolder(folderPath),
        onStep: (delta) => void this.stepSpread(delta),
        onActivateHeld: () => void this.activateHeldNote(),
      });
    }
  }

  private bindInteractions(): void {
    this.registerDomEvent(this.sortAlphaBtn, "click", () => void this.setSortOrder("alpha"));
    this.registerDomEvent(this.sortDateBtn, "click", () => void this.setSortOrder("date"));

    this.registerDomEvent(this.foldersBtn, "click", (e: MouseEvent) => {
      e.stopPropagation();
      this.toggleFolderPopover();
    });

    this.registerDomEvent(document, "click", (e: MouseEvent) => {
      if (!this.folderPopoverOpen) return;
      const target = e.target as Node | null;
      if (target && !this.folderPopoverEl.contains(target) && !this.foldersBtn.contains(target)) {
        this.closeFolderPopover();
      }
    });

    this.registerDomEvent(this.indexToggleBtn, "click", () => {
      void this.setIndexOpen(!this.host.getStateManager().indexOpen);
    });

    this.registerDomEvent(this.narrowLeftBtn, "click", () => {
      this.host.getStateManager().setNarrowActiveSlot("left");
      this.applyNarrowSlotVisibility();
      this.schedulePersist();
    });

    this.registerDomEvent(this.narrowRightBtn, "click", () => {
      this.host.getStateManager().setNarrowActiveSlot("right");
      this.applyNarrowSlotVisibility();
      this.schedulePersist();
    });

    this.registerDomEvent(this.prevBtn, "click", () => void this.stepSpread(-1));
    this.registerDomEvent(this.nextBtn, "click", () => void this.stepSpread(1));
    this.registerDomEvent(this.holdLeftBtn, "click", () => void this.holdSide("left"));
    this.registerDomEvent(this.holdRightBtn, "click", () => void this.holdSide("right"));
    this.registerDomEvent(this.leftPane.pinBtn, "click", () => void this.holdSide("left"));
    this.registerDomEvent(this.rightPane.pinBtn, "click", () => void this.holdSide("right"));
    this.registerDomEvent(this.consecutiveBtn, "click", () => void this.returnToConsecutive());
    this.registerDomEvent(this.swapBtn, "click", () => void this.swapHeldAndCurrent());
    this.registerDomEvent(this.compareBtn, "click", () => void this.toggleCompare());

    // Independent pane scroll capture
    const bindScrollCapture = (side: PaneSide, scrollEl: HTMLElement) => {
      this.registerDomEvent(scrollEl, "scroll", () => {
        if (Math.abs(scrollEl.scrollTop - this.lastRestoredScrollTop[side]) > 1) {
          this.paneScrollEpoch[side] += 1;
        }
        const desc = this.currentDescriptors[side];
        if (!desc) return;
        const anchor = captureScrollAnchor(scrollEl);
        this.host.getStateManager().recordScrollAnchor(desc.entry.path, desc.role, anchor);
        this.schedulePersist();
      });
    };
    bindScrollCapture("left", this.leftPane.scrollEl);
    bindScrollCapture("right", this.rightPane.scrollEl);

    // Internal link delegation for both reading panes
    const bindLinkHandler = (side: PaneSide, markdownEl: HTMLElement) => {
      this.registerDomEvent(markdownEl, "click", (e: MouseEvent) => {
        const targetEl = e.target as HTMLElement | null;
        const link = targetEl?.closest("a.internal-link") as HTMLAnchorElement | null;
        if (!link) return;
        const href = link.getAttribute("data-href") || link.getAttribute("href");
        if (!href) return;
        e.preventDefault();
        const desc = this.currentDescriptors[side];
        const sourcePath = desc?.entry.path ?? "";
        void this.handleInternalLinkClick(href, sourcePath);
      });
    };
    bindLinkHandler("left", this.leftPane.markdownEl);
    bindLinkHandler("right", this.rightPane.markdownEl);

    // Deliberate horizontal page-swipe on the spread (strictly separate from vertical reading scroll)
    let swipeStart: { x: number; y: number; time: number; pointerId: number } | null = null;
    this.registerDomEvent(this.spreadEl, "pointerdown", (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, a, input, select, pre, table, .nb-edge-track")) {
        return;
      }
      swipeStart = {
        x: e.clientX,
        y: e.clientY,
        time: Date.now(),
        pointerId: e.pointerId,
      };
    });
    this.registerDomEvent(this.spreadEl, "pointerup", (e: PointerEvent) => {
      if (!swipeStart || e.pointerId !== swipeStart.pointerId) return;
      const dx = e.clientX - swipeStart.x;
      const dy = e.clientY - swipeStart.y;
      const elapsed = Date.now() - swipeStart.time;
      swipeStart = null;

      if (elapsed < 700 && Math.abs(dx) > 85 && Math.abs(dx) > Math.abs(dy) * 2.5) {
        void this.stepSpread(dx < 0 ? 1 : -1);
      }
    });
    this.registerDomEvent(this.spreadEl, "pointercancel", () => {
      swipeStart = null;
    });
  }

  private observeContainerWidth(): void {
    const updateWidth = (width: number) => {
      const nextNarrow = width > 0 && width < NARROW_BREAKPOINT_PX;
      if (nextNarrow !== this.isNarrow) {
        this.isNarrow = nextNarrow;
        this.rootEl?.toggleClass("is-narrow", nextNarrow);
        this.applyNarrowSlotVisibility();
      }
    };

    const rect = this.rootEl.getBoundingClientRect();
    if (rect.width > 0) {
      updateWidth(rect.width);
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          updateWidth(entry.contentRect.width);
        }
      });
      this.resizeObserver.observe(this.rootEl);
    }
  }

  private applyNarrowSlotVisibility(): void {
    const state = this.host.getStateManager();
    const activeSlot = state.narrowActiveSlot;

    this.leftPane.paneEl.toggleClass("is-narrow-hidden", this.isNarrow && activeSlot !== "left");
    this.rightPane.paneEl.toggleClass("is-narrow-hidden", this.isNarrow && activeSlot !== "right");

    this.narrowLeftBtn.toggleClass("is-active", activeSlot === "left");
    this.narrowLeftBtn.setAttr("aria-selected", activeSlot === "left" ? "true" : "false");
    this.narrowRightBtn.toggleClass("is-active", activeSlot === "right");
    this.narrowRightBtn.setAttr("aria-selected", activeSlot === "right" ? "true" : "false");

    const leftLabel = this.currentDescriptors.left?.role === "held"
      ? "Held page"
      : this.currentDescriptors.left?.entry.title ?? "Left page";
    const rightLabel = this.currentDescriptors.right?.role === "held"
      ? "Held page"
      : this.currentDescriptors.right?.entry.title ?? "Right page";

    this.narrowLeftBtn.setText(`Left: ${leftLabel}`);
    this.narrowRightBtn.setText(`Right: ${rightLabel}`);
  }

  private snapshotLiveAnchors(): void {
    const state = this.host.getStateManager();
    for (const side of ["left", "right"] as const) {
      const desc = this.currentDescriptors[side];
      const pane = side === "left" ? this.leftPane : this.rightPane;
      if (desc && pane?.scrollEl) {
        const anchor = captureScrollAnchor(pane.scrollEl);
        state.recordScrollAnchor(desc.entry.path, desc.role, anchor);
      }
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.host.persistState();
    }, 180);
  }

  private async setSortOrder(order: SortOrder): Promise<void> {
    const state = this.host.getStateManager();
    if (state.sortOrder === order) return;
    this.snapshotLiveAnchors();
    state.setSortOrder(order);
    await this.refresh({ forcePaneRerender: false });
    await this.host.persistState();
  }

  private async setIndexOpen(open: boolean): Promise<void> {
    const state = this.host.getStateManager();
    if (state.indexOpen === open) return;
    this.snapshotLiveAnchors();
    state.setIndexOpen(open);
    this.mountRightRail();
    await this.refresh({ forcePaneRerender: false });
    await this.host.persistState();
  }

  private toggleFolderPopover(): void {
    if (this.folderPopoverOpen) {
      this.closeFolderPopover();
    } else {
      this.folderPopoverOpen = true;
      this.renderFolderPopover(this.lastSequence?.folders ?? this.host.getSequenceResult().folders);
      this.folderPopoverEl.removeAttribute("hidden");
      this.foldersBtn.setAttr("aria-expanded", "true");
    }
  }

  private closeFolderPopover(): void {
    this.folderPopoverOpen = false;
    this.folderPopoverEl.setAttr("hidden", "true");
    this.foldersBtn.setAttr("aria-expanded", "false");
  }

  private renderFolderPopover(folders: readonly FolderSummary[]): void {
    const state = this.host.getStateManager();
    this.folderPopoverEl.empty();

    const header = this.folderPopoverEl.createDiv({ cls: "nb-popover-header" });
    header.createSpan({ cls: "nb-popover-title", text: "Sections & exclusions" });

    const dailyToggleLabel = this.folderPopoverEl.createEl("label", { cls: "nb-popover-row is-daily-toggle" });
    const dailyCheckbox = dailyToggleLabel.createEl("input", {
      type: "checkbox",
    });
    dailyCheckbox.checked = !state.hideDailyNotes;
    dailyToggleLabel.createSpan({ text: "Include daily-note folders" });
    dailyCheckbox.addEventListener("change", () => {
      void this.toggleIncludeDailyNotes(dailyCheckbox.checked);
    });

    const listEl = this.folderPopoverEl.createDiv({ cls: "nb-popover-folder-list" });
    for (const folder of folders) {
      const row = listEl.createEl("label", { cls: "nb-popover-row" });
      const checkbox = row.createEl("input", { type: "checkbox" });
      const isExcludedExplicitly = state.excludedFolders.includes(folder.folderPath);
      const disabledByDaily = state.hideDailyNotes && folder.isDailyFolder;
      checkbox.checked = !isExcludedExplicitly && !disabledByDaily;
      checkbox.disabled = disabledByDaily;

      row.createSpan({ cls: "nb-popover-folder-name", text: folder.sectionLabel });
      if (folder.isDailyFolder) {
        row.createSpan({ cls: "nb-popover-tag", text: "Daily" });
      }
      row.createSpan({ cls: "nb-popover-count", text: String(folder.noteCount) });

      checkbox.addEventListener("change", () => {
        void this.toggleFolderInclusion(folder.folderPath);
      });
    }
  }

  private async toggleIncludeDailyNotes(includeDaily: boolean): Promise<void> {
    this.snapshotLiveAnchors();
    this.host.getStateManager().setHideDailyNotes(!includeDaily);
    await this.refresh({ forcePaneRerender: false });
    if (this.folderPopoverOpen && this.lastSequence) {
      this.renderFolderPopover(this.lastSequence.folders);
    }
    await this.host.persistState();
  }

  private async toggleFolderInclusion(folderPath: string): Promise<void> {
    this.snapshotLiveAnchors();
    this.host.getStateManager().toggleFolderExclusion(folderPath);
    await this.refresh({ forcePaneRerender: false });
    if (this.folderPopoverOpen && this.lastSequence) {
      this.renderFolderPopover(this.lastSequence.folders);
    }
    await this.host.persistState();
  }

  private async navigateToNote(path: string): Promise<void> {
    this.snapshotLiveAnchors();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    if (this.host.getStateManager().navigateToNote(path, seq.sequence)) {
      await this.refresh({ forcePaneRerender: false });
      await this.host.persistState();
    }
  }

  private async jumpToFolder(folderPath: string): Promise<void> {
    this.snapshotLiveAnchors();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    if (this.host.getStateManager().jumpToFolder(folderPath, seq.sequence)) {
      await this.refresh({ forcePaneRerender: false });
      await this.host.persistState();
    }
  }

  private async stepSpread(delta: number): Promise<void> {
    this.snapshotLiveAnchors();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    if (this.host.getStateManager().step(delta, seq.sequence)) {
      await this.refresh({ forcePaneRerender: false });
      await this.host.persistState();
    }
  }

  private async holdSide(side: PaneSide): Promise<void> {
    this.snapshotLiveAnchors();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    this.host.getStateManager().holdVisibleSide(side, seq.sequence, seq.allEntriesByPath);
    await this.refresh({ forcePaneRerender: false });
    await this.host.persistState();
  }

  private async returnToConsecutive(): Promise<void> {
    this.snapshotLiveAnchors();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    this.host.getStateManager().returnToConsecutive(seq.sequence);
    await this.refresh({ forcePaneRerender: false });
    await this.host.persistState();
  }

  private async swapHeldAndCurrent(): Promise<void> {
    this.snapshotLiveAnchors();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    if (this.host.getStateManager().swapHeldAndCurrent(seq.allEntriesByPath)) {
      await this.refresh({ forcePaneRerender: false });
      await this.host.persistState();
    }
  }

  private async toggleCompare(): Promise<void> {
    this.snapshotLiveAnchors();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    if (this.host.getStateManager().toggleCompare(seq.sequence, seq.allEntriesByPath)) {
      await this.refresh({ forcePaneRerender: false });
      await this.host.persistState();
    }
  }

  private async activateHeldNote(): Promise<void> {
    this.snapshotLiveAnchors();
    const state = this.host.getStateManager();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    if (!state.held) return;

    if (seq.sequence.some((e) => e.path === state.held?.path) && state.spreadMode === "consecutive") {
      state.toggleCompare(seq.sequence, seq.allEntriesByPath);
    } else if (state.spreadMode === "consecutive") {
      state.toggleCompare(seq.sequence, seq.allEntriesByPath);
    } else {
      state.swapHeldAndCurrent(seq.allEntriesByPath);
    }
    await this.refresh({ forcePaneRerender: false });
    await this.host.persistState();
  }

  private async handleInternalLinkClick(href: string, sourcePath: string): Promise<void> {
    const cleanLink = href.split("#")[0].split("|")[0].trim();
    const dest = cleanLink
      ? this.app.metadataCache.getFirstLinkpathDest(cleanLink, sourcePath)
      : null;
    const seq = this.lastSequence ?? this.host.getSequenceResult();

    if (dest && dest.extension === "md") {
      if (seq.sequence.some((e) => e.path === dest.path)) {
        await this.navigateToNote(dest.path);
        return;
      }
      new Notice(`"${dest.basename}" is outside the active folder filter; opening in Obsidian.`);
    }

    await this.app.workspace.openLinkText(href, sourcePath, false);
  }

  async refresh(options: { forcePaneRerender?: boolean; invalidatedPaths?: Set<string> } = {}): Promise<void> {
    if (this.isClosed || !this.rootEl) return;

    const state = this.host.getStateManager();
    const seqResult = this.host.getSequenceResult();
    this.lastSequence = seqResult;

    state.reconcile(seqResult.sequence, seqResult.allEntriesByPath);
    const spread = state.getSpread(seqResult.sequence, seqResult.allEntriesByPath);

    // Top bar state
    this.sortAlphaBtn.toggleClass("is-active", state.sortOrder === "alpha");
    this.sortAlphaBtn.setAttr("aria-pressed", state.sortOrder === "alpha" ? "true" : "false");
    this.sortDateBtn.toggleClass("is-active", state.sortOrder === "date");
    this.sortDateBtn.setAttr("aria-pressed", state.sortOrder === "date" ? "true" : "false");

    const hiddenCount = seqResult.folders.filter((f) => f.isExcluded).length;
    this.foldersBtn.setText(hiddenCount > 0 ? `Folders (${hiddenCount} hidden) ▾` : "Folders ▾");

    this.indexToggleBtn.toggleClass("is-active", state.indexOpen);
    this.indexToggleBtn.setAttr("aria-pressed", state.indexOpen ? "true" : "false");
    this.indexToggleBtn.setText(state.indexOpen ? "Close index" : "Index");

    // Render left and right panes
    await Promise.all([
      this.renderPane("left", spread.left, options),
      this.renderPane("right", spread.right, options),
    ]);

    this.currentDescriptors.left = spread.left;
    this.currentDescriptors.right = spread.right;

    // Update right rail (either Thumb-edge or Indexed Folio)
    if (state.indexOpen && this.folioIndex) {
      this.folioIndex.render({ sections: seqResult.sections, spread });
    } else if (!state.indexOpen && this.thumbEdge) {
      this.thumbEdge.update({
        sequence: seqResult.sequence,
        sections: seqResult.sections,
        spread,
      });
    }

    // Bottom bar controls
    const hasNotes = seqResult.sequence.length > 0;
    const atStart = !hasNotes || spread.currentIndex <= 0;
    const atEnd = !hasNotes || spread.currentIndex >= seqResult.sequence.length - 1;
    this.prevBtn.disabled = atStart;
    this.nextBtn.disabled = atEnd;

    this.holdLeftBtn.disabled = !spread.left;
    this.holdRightBtn.disabled = !spread.right;

    const leftPinned = spread.mode === "pinned-left" || spread.mode === "compare";
    const rightPinned = spread.mode === "pinned-right";
    this.holdLeftBtn.setText(leftPinned ? "Unpin left" : "Hold left page");
    this.holdLeftBtn.toggleClass("is-active", leftPinned);
    this.holdRightBtn.setText(rightPinned ? "Unpin right" : "Hold right page");
    this.holdRightBtn.toggleClass("is-active", rightPinned);

    this.consecutiveBtn.disabled = spread.mode === "consecutive";
    this.consecutiveBtn.toggleClass("is-visible", spread.mode !== "consecutive");

    const hasHeld = Boolean(spread.heldEntry);
    this.swapBtn.disabled = !hasHeld;
    this.compareBtn.disabled = !hasHeld;
    this.compareBtn.toggleClass("is-active", spread.mode === "compare");
    this.compareBtn.setAttr("aria-pressed", spread.mode === "compare" ? "true" : "false");

    if (spread.heldEntry) {
      const filterSuffix = spread.isHeldOutsideFilter ? " (Outside current filter)" : "";
      this.heldStatusEl.setText(`Held: ${spread.heldEntry.title}${filterSuffix}`);
      this.heldStatusEl.toggleClass("is-outside-filter", spread.isHeldOutsideFilter);
    } else {
      this.heldStatusEl.setText("No held page");
      this.heldStatusEl.removeClass("is-outside-filter");
    }

    if (seqResult.sequence.length === 0) {
      this.pageCounterEl.setText("0 / 0");
    } else if (spread.mode === "consecutive" && spread.right && spread.currentIndex >= 0) {
      this.pageCounterEl.setText(
        `${spread.currentIndex + 1}–${spread.currentIndex + 2} / ${seqResult.sequence.length}`
      );
    } else if (spread.currentIndex >= 0) {
      this.pageCounterEl.setText(`${spread.currentIndex + 1} / ${seqResult.sequence.length}`);
    } else {
      this.pageCounterEl.setText(`– / ${seqResult.sequence.length}`);
    }

    this.applyNarrowSlotVisibility();
  }

  private unloadPaneComponent(side: PaneSide): void {
    const existing = this.renderedPanes[side];
    if (existing) {
      this.removeChild(existing.component);
      existing.component.unload();
      this.renderedPanes[side] = null;
    }
  }

  private async renderPane(
    side: PaneSide,
    descriptor: PaneDescriptor | null,
    options: { forcePaneRerender?: boolean; invalidatedPaths?: Set<string> }
  ): Promise<void> {
    const pane = side === "left" ? this.leftPane : this.rightPane;

    if (!descriptor) {
      this.unloadPaneComponent(side);
      pane.paneEl.addClass("is-empty");
      pane.paneEl.removeClass("is-pinned", "is-outside-filter");
      pane.roleBadgeEl.setText("");
      pane.folderLabelEl.setText("");
      pane.dateLabelEl.setText("");
      pane.pinBtn.disabled = true;
      pane.pinBtn.setAttr("aria-pressed", "false");
      pane.titleEl.setText("");
      pane.markdownEl.empty();

      const emptyBox = pane.markdownEl.createDiv({ cls: "nb-empty-pane" });
      if ((this.lastSequence?.sequence.length ?? 0) === 0) {
        if (side === "left") {
          emptyBox.createDiv({ cls: "nb-empty-title", text: "No notes in this notebook view" });
          emptyBox.createDiv({
            cls: "nb-empty-body",
            text: "Every folder is currently excluded, or the vault has no Markdown notes yet. Open Folders in the toolbar to include sections.",
          });
        } else {
          emptyBox.createDiv({ cls: "nb-empty-title", text: "Facing page empty" });
          emptyBox.createDiv({
            cls: "nb-empty-body",
            text: "Include a folder or add notes to read two facing pages.",
          });
        }
      } else {
        emptyBox.createDiv({ cls: "nb-empty-title", text: "End of notebook" });
        emptyBox.createDiv({
          cls: "nb-empty-body",
          text: "You have reached the final note in the current sequence.",
        });
      }
      pane.footerMetaEl.setText("");
      pane.scrollEl.scrollTop = 0;
      return;
    }

    pane.paneEl.removeClass("is-empty");
    pane.paneEl.toggleClass("is-pinned", descriptor.isPinned);
    pane.paneEl.toggleClass("is-outside-filter", descriptor.isOutsideFilter);

    const roleLabel =
      descriptor.role === "held"
        ? "HELD"
        : descriptor.role === "current"
          ? "CURRENT"
          : "FACING";
    pane.roleBadgeEl.setText(roleLabel);
    pane.roleBadgeEl.toggleClass("is-held", descriptor.role === "held");
    pane.roleBadgeEl.toggleClass("is-current", descriptor.role === "current");

    pane.folderLabelEl.setText(
      descriptor.isOutsideFilter
        ? `${descriptor.entry.sectionLabel} · Outside current filter`
        : descriptor.entry.sectionLabel
    );
    pane.dateLabelEl.setText(descriptor.entry.dateLabel);

    pane.pinBtn.disabled = false;
    pane.pinBtn.setText(descriptor.isPinned ? "Pinned ✓" : side === "left" ? "Hold left" : "Hold right");
    pane.pinBtn.setAttr("aria-pressed", descriptor.isPinned ? "true" : "false");

    const prevRendered = this.renderedPanes[side];
    const invalidated = options.invalidatedPaths?.has(descriptor.entry.path) ?? false;
    const sameNoteAndMtime =
      !options.forcePaneRerender &&
      !invalidated &&
      prevRendered &&
      prevRendered.path === descriptor.entry.path &&
      prevRendered.mtime === descriptor.entry.mtime;

    if (sameNoteAndMtime) {
      // Keep existing rendered Markdown DOM intact, ensuring exact anchor remains applied
      this.applyPaneScrollRestore(side, pane.scrollEl, descriptor.anchor);
      return;
    }

    const renderSeq = ++this.renderCounter;
    const scrollEpochAtStart = this.paneScrollEpoch[side];
    this.unloadPaneComponent(side);
    const childComponent = new Component();
    this.addChild(childComponent);
    childComponent.load();
    this.renderedPanes[side] = {
      path: descriptor.entry.path,
      mtime: descriptor.entry.mtime,
      component: childComponent,
      renderSeq,
    };

    pane.titleEl.setText(descriptor.entry.title);
    pane.markdownEl.empty();
    pane.footerMetaEl.setText(descriptor.entry.path);

    const abstractFile = this.app.vault.getAbstractFileByPath(descriptor.entry.path);
    if (!(abstractFile instanceof TFile)) {
      pane.markdownEl.createDiv({
        cls: "nb-empty-body",
        text: "Note could not be found in vault.",
      });
      return;
    }

    const rawContent = await this.app.vault.cachedRead(abstractFile);
    if (this.isClosed || this.renderedPanes[side]?.renderSeq !== renderSeq) {
      return;
    }

    const cache = this.app.metadataCache.getFileCache(abstractFile);
    const body = extractMarkdownBody(rawContent, cache);

    await MarkdownRenderer.render(
      this.app,
      body,
      pane.markdownEl,
      abstractFile.path,
      childComponent
    );

    if (this.isClosed || this.renderedPanes[side]?.renderSeq !== renderSeq) {
      return;
    }

    this.applyPaneScrollRestore(side, pane.scrollEl, descriptor.anchor);
    if (
      (descriptor.anchor.scrollTop > 0 || descriptor.anchor.blockIndex > 0) &&
      typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(() => {
        if (
          !this.isClosed &&
          this.renderedPanes[side]?.renderSeq === renderSeq &&
          this.paneScrollEpoch[side] === scrollEpochAtStart
        ) {
          this.applyPaneScrollRestore(side, pane.scrollEl, descriptor.anchor);
        }
      });
    }
  }

  private applyPaneScrollRestore(side: PaneSide, scrollEl: HTMLElement, anchor: PassageAnchor): void {
    restoreScrollAnchor(scrollEl, anchor);
    this.lastRestoredScrollTop[side] = scrollEl.scrollTop;
  }
}

export function buildVaultSequence(
  app: { vault: { getMarkdownFiles(): TFile[] }; metadataCache: { getFileCache(f: TFile): CachedMetadata | null } },
  state: NotebookStateManager
): SequenceResult {
  const files = app.vault.getMarkdownFiles();
  const sources = files.map((file) => ({
    file,
    cache: app.metadataCache.getFileCache(file),
  }));
  return buildNotebookSequence(sources, {
    sortOrder: state.sortOrder,
    excludedFolders: state.excludedFolders,
    hideDailyNotes: state.hideDailyNotes,
  });
}
