import {
  Component,
  ItemView,
  MarkdownRenderer,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
  type CachedMetadata,
  type HoverParent,
  type HoverPopover,
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
  fileLinkBtn: HTMLButtonElement;
  pinBtn: HTMLButtonElement;
  scrollEl: HTMLDivElement;
  articleEl: HTMLElement;
  titleEl: HTMLHeadingElement;
  markdownEl: HTMLDivElement;
  footerMetaEl: HTMLDivElement;
  footerFileBtn: HTMLButtonElement;
}

interface RenderedPaneState {
  path: string;
  mtime: number;
  role: PaneDescriptor["role"];
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

export class NotebookReaderView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private readonly host: NotebookPluginHost;

  private rootEl!: HTMLDivElement;
  private brandTitleEl!: HTMLSpanElement;
  private sortAlphaBtn!: HTMLButtonElement;
  private sortDateBtn!: HTMLButtonElement;
  private groupByFolderBtn!: HTMLButtonElement;
  private groupFlatBtn!: HTMLButtonElement;
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

  private bottomBarEl!: HTMLDivElement;
  private navGroupEl!: HTMLDivElement;
  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private holdLeftBtn!: HTMLButtonElement;
  private holdRightBtn!: HTMLButtonElement;
  private consecutiveBtn!: HTMLButtonElement;
  private swapBtn!: HTMLButtonElement;
  private compareBtn!: HTMLButtonElement;
  private heldWidgetEl!: HTMLDivElement;
  private heldStatusEl!: HTMLButtonElement;
  private clearHeldBtn!: HTMLButtonElement;
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
    this.contentEl.addClass("ignore-swipe");
    this.contentEl.setAttr("data-ignore-swipe", "true");

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

    if (this.hoverPopover) {
      this.hoverPopover.hide?.();
      this.hoverPopover.unload?.();
      this.hoverPopover = null;
    }

    this.thumbEdge?.destroy();
    this.thumbEdge = null;
    this.folioIndex?.destroy();
    this.folioIndex = null;

    this.contentEl.empty();
  }

  private buildShell(): void {
    this.rootEl = this.contentEl.createDiv({
      cls: "nb-root ignore-swipe",
      attr: { "data-ignore-swipe": "true" },
    });

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

    const groupModeBar = topControls.createDiv({
      cls: "nb-segmented",
      attr: { role: "group", "aria-label": "Notebook grouping" },
    });
    this.groupByFolderBtn = groupModeBar.createEl("button", {
      cls: "nb-seg-btn",
      type: "button",
      text: "By folder",
      attr: { "data-group-mode": "folders", "aria-pressed": "true" },
    });
    this.groupFlatBtn = groupModeBar.createEl("button", {
      cls: "nb-seg-btn",
      type: "button",
      text: "All files",
      attr: { "data-group-mode": "all", "aria-pressed": "false" },
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
    this.spreadEl = bookFrameEl.createDiv({
      cls: "nb-book-spread ignore-swipe",
      attr: { "data-ignore-swipe": "true" },
    });

    this.leftPane = this.createPaneElements(this.spreadEl, "left");
    this.spreadEl.createDiv({ cls: "nb-gutter", attr: { "aria-hidden": "true" } });
    this.rightPane = this.createPaneElements(this.spreadEl, "right");

    this.rightRailEl = stageEl.createDiv({ cls: "nb-right-rail" });

    // 3. Bottom Action & Placekeeping Bar
    this.bottomBarEl = this.rootEl.createDiv({
      cls: "nb-bottombar is-nav-right",
      attr: { "data-nav-position": "right" },
    });

    const actionGroup = this.bottomBarEl.createDiv({ cls: "nb-bottom-actions" });
    this.holdLeftBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn nb-hold-left-btn",
      type: "button",
      text: "Hold left page",
    });
    this.holdRightBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn nb-hold-right-btn",
      type: "button",
      text: "Hold right page",
    });
    this.consecutiveBtn = actionGroup.createEl("button", {
      cls: "nb-action-btn nb-consecutive-btn",
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

    const statusGroup = this.bottomBarEl.createDiv({ cls: "nb-bottom-status" });
    this.heldWidgetEl = statusGroup.createDiv({ cls: "nb-held-widget" });
    this.heldStatusEl = this.heldWidgetEl.createEl("button", {
      cls: "nb-held-summary nb-held-jump-btn",
      type: "button",
    });
    this.clearHeldBtn = this.heldWidgetEl.createEl("button", {
      cls: "nb-clear-held-btn",
      type: "button",
      text: "✕",
      attr: {
        "aria-label": "Clear held page",
        title: "Clear held page bookmark",
        hidden: "true",
      },
    });
    this.pageCounterEl = statusGroup.createSpan({ cls: "nb-page-counter" });

    this.navGroupEl = this.bottomBarEl.createDiv({ cls: "nb-bottom-nav" });
    this.prevBtn = this.navGroupEl.createEl("button", {
      cls: "nb-action-btn nb-nav-btn",
      type: "button",
      text: "← Prev",
      attr: { "aria-label": "Previous page" },
    });
    this.nextBtn = this.navGroupEl.createEl("button", {
      cls: "nb-action-btn nb-nav-btn",
      type: "button",
      text: "Next →",
      attr: { "aria-label": "Next page" },
    });

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

    const headerActions = headerEl.createDiv({ cls: "nb-page-header-actions" });
    const fileLinkBtn = headerActions.createEl("button", {
      cls: "nb-page-file-link",
      type: "button",
      text: "",
      attr: { title: "Open note in a new tab to view or edit" },
    });
    const pinBtn = headerActions.createEl("button", {
      cls: "nb-pane-pin-btn",
      type: "button",
      text: side === "left" ? "Hold left" : "Hold right",
      attr: { "aria-pressed": "false" },
    });

    const scrollEl = paneEl.createDiv({
      cls: "nb-page-scroll",
      attr: { "data-pane-scroll": side, "data-ignore-swipe": "true", tabindex: "0" },
    });
    const articleEl = scrollEl.createEl("article", { cls: "nb-page-article" });
    const titleEl = articleEl.createEl("h1", { cls: "nb-page-title" });
    const markdownEl = articleEl.createDiv({ cls: "nb-page-markdown markdown-rendered" });
    const footerMetaEl = articleEl.createDiv({ cls: "nb-page-footer-meta" });
    const footerFileBtn = footerMetaEl.createEl("button", {
      cls: "nb-page-footer-file-link",
      type: "button",
      text: "",
      attr: { title: "Open note in a new tab to view or edit" },
    });

    return {
      paneEl,
      headerEl,
      roleBadgeEl,
      folderLabelEl,
      dateLabelEl,
      fileLinkBtn,
      pinBtn,
      scrollEl,
      articleEl,
      titleEl,
      markdownEl,
      footerMetaEl,
      footerFileBtn,
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
        onClearHeld: () => void this.clearHeldNote(),
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
        onClearHeld: () => void this.clearHeldNote(),
      });
    }
  }

  private bindInteractions(): void {
    this.registerDomEvent(this.sortAlphaBtn, "click", () => void this.setSortOrder("alpha"));
    this.registerDomEvent(this.sortDateBtn, "click", () => void this.setSortOrder("date"));
    this.registerDomEvent(this.groupByFolderBtn, "click", () => void this.setGroupByFolder(true));
    this.registerDomEvent(this.groupFlatBtn, "click", () => void this.setGroupByFolder(false));

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
    this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
      if (this.isClosed || !this.contentEl.isConnected) return;
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      const rawTarget = e.target as Node | null;
      const target =
        rawTarget instanceof Element ? rawTarget : rawTarget instanceof Node ? rawTarget.parentElement : null;
      if (
        target &&
        (target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") ||
          (target as HTMLElement).isContentEditable)
      ) {
        return;
      }
      if (document.querySelector(".modal-container, .prompt")) {
        return;
      }

      e.preventDefault();
      void this.stepSpread(e.key === "ArrowLeft" ? -1 : 1);
    });
    this.registerDomEvent(this.holdLeftBtn, "click", () => void this.holdSide("left"));
    this.registerDomEvent(this.holdRightBtn, "click", () => void this.holdSide("right"));
    this.registerDomEvent(this.leftPane.pinBtn, "click", () => void this.holdSide("left"));
    this.registerDomEvent(this.rightPane.pinBtn, "click", () => void this.holdSide("right"));
    this.registerDomEvent(this.leftPane.fileLinkBtn, "click", () => void this.openNoteInNewTab("left"));
    this.registerDomEvent(this.rightPane.fileLinkBtn, "click", () => void this.openNoteInNewTab("right"));
    this.registerDomEvent(this.leftPane.footerFileBtn, "click", () => void this.openNoteInNewTab("left"));
    this.registerDomEvent(this.rightPane.footerFileBtn, "click", () => void this.openNoteInNewTab("right"));
    this.registerDomEvent(this.consecutiveBtn, "click", () => void this.returnToConsecutive());
    this.registerDomEvent(this.swapBtn, "click", () => void this.swapHeldAndCurrent());
    this.registerDomEvent(this.compareBtn, "click", () => void this.toggleCompare());
    this.registerDomEvent(this.heldStatusEl, "click", () => void this.activateHeldNote());
    this.registerDomEvent(this.clearHeldBtn, "click", () => void this.clearHeldNote());
    this.registerDomEvent(this.heldStatusEl, "mouseover", (e: MouseEvent) => {
      const related = e.relatedTarget as Node | null;
      if (related && this.heldStatusEl.contains(related)) return;
      const notePath = this.heldStatusEl.getAttribute("data-note-path");
      if (!notePath) return;
      this.app.workspace.trigger("hover-link", {
        event: e,
        source: NOTEBOOK_VIEW_TYPE,
        hoverParent: this,
        targetEl: this.heldStatusEl,
        linktext: notePath,
        sourcePath: "",
      });
    });

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

      this.registerDomEvent(markdownEl, "mouseover", (e: MouseEvent) => {
        const targetEl = e.target as HTMLElement | null;
        const link = targetEl?.closest("a.internal-link") as HTMLAnchorElement | null;
        if (!link) return;
        const related = e.relatedTarget as Node | null;
        if (related && link.contains(related)) return;
        const href = link.getAttribute("data-href") || link.getAttribute("href");
        if (!href) return;
        const desc = this.currentDescriptors[side];
        const sourcePath = desc?.entry.path ?? "";
        this.app.workspace.trigger("hover-link", {
          event: e,
          source: NOTEBOOK_VIEW_TYPE,
          hoverParent: this,
          targetEl: link,
          linktext: href,
          sourcePath,
        });
      });
    };
    bindLinkHandler("left", this.leftPane.markdownEl);
    bindLinkHandler("right", this.rightPane.markdownEl);

    this.registerDomEvent(this.rightRailEl, "mouseover", (e: MouseEvent) => {
      const targetEl = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement ?? null;
      const hoverTarget = targetEl?.closest(
        ".nb-folio-item[data-note-path], .nb-edge-held-marker[data-note-path]"
      ) as HTMLElement | null;
      if (!hoverTarget) return;
      const related = e.relatedTarget as Node | null;
      if (related && hoverTarget.contains(related)) return;
      const notePath = hoverTarget.getAttribute("data-note-path");
      if (!notePath) return;
      this.app.workspace.trigger("hover-link", {
        event: e,
        source: NOTEBOOK_VIEW_TYPE,
        hoverParent: this,
        targetEl: hoverTarget,
        linktext: notePath,
        sourcePath: "",
      });
    });

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

    // Isolate touch gestures inside the reading spread from Obsidian Mobile's workspace pull-down handler
    const touchStarts = new Map<number, { x: number; y: number }>();
    const readTouches = (list: TouchList | undefined): Touch[] => {
      if (!list) return [];
      const result: Touch[] = [];
      for (let i = 0; i < list.length; i++) {
        const touch = typeof list.item === "function" ? list.item(i) : list[i];
        if (touch) result.push(touch);
      }
      return result;
    };
    const clearTouchStarts = (e: TouchEvent) => {
      e.stopPropagation();
      for (const touch of readTouches(e.changedTouches)) {
        touchStarts.delete(touch.identifier);
      }
    };

    this.registerDomEvent(
      this.spreadEl,
      "touchstart",
      (e: TouchEvent) => {
        e.stopPropagation();
        for (const touch of readTouches(e.changedTouches)) {
          touchStarts.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        }
      },
      { passive: true }
    );
    this.registerDomEvent(
      this.spreadEl,
      "touchmove",
      (e: TouchEvent) => {
        e.stopPropagation();
        if (!e.cancelable) return;
        const rawTarget = e.target as Node | null;
        const targetEl = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement ?? null;
        const scrollEl = targetEl?.closest(".nb-page-scroll") as HTMLElement | null;
        if (!scrollEl || scrollEl.scrollTop > 0) return;

        for (const touch of readTouches(e.changedTouches)) {
          const start = touchStarts.get(touch.identifier);
          if (!start) continue;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
            e.preventDefault();
            break;
          }
        }
      },
      { passive: false }
    );
    this.registerDomEvent(this.spreadEl, "touchend", clearTouchStarts, { passive: true });
    this.registerDomEvent(this.spreadEl, "touchcancel", clearTouchStarts, { passive: true });
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

  private async setGroupByFolder(groupByFolder: boolean): Promise<void> {
    const state = this.host.getStateManager();
    if (state.groupByFolder === groupByFolder) return;
    this.snapshotLiveAnchors();
    state.setGroupByFolder(groupByFolder);
    await this.refresh({ forcePaneRerender: false });
    if (this.folderPopoverOpen && this.lastSequence) {
      this.syncFolderPopoverState(this.lastSequence.folders);
    }
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
    const prevListEl = this.folderPopoverEl.querySelector(".nb-popover-folder-list") as HTMLElement | null;
    const prevScrollTop = prevListEl ? prevListEl.scrollTop : 0;

    this.folderPopoverEl.empty();

    const header = this.folderPopoverEl.createDiv({ cls: "nb-popover-header" });
    header.createSpan({ cls: "nb-popover-title", text: "Sections & exclusions" });

    const groupToggleLabel = this.folderPopoverEl.createEl("label", {
      cls: "nb-popover-row is-group-toggle",
    });
    const groupCheckbox = groupToggleLabel.createEl("input", {
      type: "checkbox",
      attr: { "data-popover-role": "group-by-folder" },
    });
    groupCheckbox.checked = state.groupByFolder;
    groupToggleLabel.createSpan({ text: "Section by folders" });
    groupCheckbox.addEventListener("change", () => {
      void this.setGroupByFolder(groupCheckbox.checked);
    });

    const dailyToggleLabel = this.folderPopoverEl.createEl("label", { cls: "nb-popover-row is-daily-toggle" });
    const dailyCheckbox = dailyToggleLabel.createEl("input", {
      type: "checkbox",
      attr: { "data-popover-role": "include-daily" },
    });
    dailyCheckbox.checked = !state.hideDailyNotes;
    dailyToggleLabel.createSpan({ text: "Include daily-note folders" });
    dailyCheckbox.addEventListener("change", () => {
      void this.toggleIncludeDailyNotes(dailyCheckbox.checked);
    });

    const listEl = this.folderPopoverEl.createDiv({ cls: "nb-popover-folder-list" });
    for (const folder of folders) {
      const row = listEl.createEl("label", { cls: "nb-popover-row" });
      const checkbox = row.createEl("input", {
        type: "checkbox",
        attr: { "data-popover-folder": folder.folderPath },
      });
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

    if (prevScrollTop > 0) {
      listEl.scrollTop = prevScrollTop;
    }
  }

  private syncFolderPopoverState(folders: readonly FolderSummary[]): void {
    const state = this.host.getStateManager();
    const existingRows = this.folderPopoverEl.querySelectorAll<HTMLInputElement>("input[data-popover-folder]");
    if (existingRows.length !== folders.length) {
      this.renderFolderPopover(folders);
      return;
    }

    const groupCheckbox = this.folderPopoverEl.querySelector<HTMLInputElement>(
      'input[data-popover-role="group-by-folder"]'
    );
    if (groupCheckbox) {
      groupCheckbox.checked = state.groupByFolder;
    }

    const dailyCheckbox = this.folderPopoverEl.querySelector<HTMLInputElement>(
      'input[data-popover-role="include-daily"]'
    );
    if (dailyCheckbox) {
      dailyCheckbox.checked = !state.hideDailyNotes;
    }

    existingRows.forEach((checkbox, idx) => {
      const folder = folders[idx];
      if (!folder) return;
      const isExcludedExplicitly = state.excludedFolders.includes(folder.folderPath);
      const disabledByDaily = state.hideDailyNotes && folder.isDailyFolder;
      checkbox.checked = !isExcludedExplicitly && !disabledByDaily;
      checkbox.disabled = disabledByDaily;
    });
  }

  private async toggleIncludeDailyNotes(includeDaily: boolean): Promise<void> {
    this.snapshotLiveAnchors();
    this.host.getStateManager().setHideDailyNotes(!includeDaily);
    await this.refresh({ forcePaneRerender: false });
    if (this.folderPopoverOpen && this.lastSequence) {
      this.syncFolderPopoverState(this.lastSequence.folders);
    }
    await this.host.persistState();
  }

  private async toggleFolderInclusion(folderPath: string): Promise<void> {
    this.snapshotLiveAnchors();
    this.host.getStateManager().toggleFolderExclusion(folderPath);
    await this.refresh({ forcePaneRerender: false });
    if (this.folderPopoverOpen && this.lastSequence) {
      this.syncFolderPopoverState(this.lastSequence.folders);
    }
    await this.host.persistState();
  }

  private async openNoteInNewTab(side: PaneSide): Promise<void> {
    const desc = this.currentDescriptors[side];
    if (!desc) return;

    const abstractFile = this.app.vault.getAbstractFileByPath(desc.entry.path);
    if (!(abstractFile instanceof TFile)) {
      new Notice("Note file could not be found in vault.");
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(abstractFile);
    this.app.workspace.revealLeaf(leaf);
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

  private async clearHeldNote(): Promise<void> {
    this.snapshotLiveAnchors();
    const seq = this.lastSequence ?? this.host.getSequenceResult();
    this.host.getStateManager().clearHeld(seq.sequence);
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

    this.groupByFolderBtn.toggleClass("is-active", state.groupByFolder);
    this.groupByFolderBtn.setAttr("aria-pressed", state.groupByFolder ? "true" : "false");
    this.groupFlatBtn.toggleClass("is-active", !state.groupByFolder);
    this.groupFlatBtn.setAttr("aria-pressed", !state.groupByFolder ? "true" : "false");

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
      this.folioIndex.render({
        sequence: seqResult.sequence,
        sections: seqResult.sections,
        groupByFolder: state.groupByFolder,
        spread,
      });
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
      const heldIdx = seqResult.sequence.findIndex((e) => e.path === spread.heldEntry?.path);
      const locationPart = spread.isHeldOutsideFilter
        ? "Outside current filter"
        : heldIdx >= 0
          ? `${spread.heldEntry.sectionLabel} · p. ${heldIdx + 1}`
          : spread.heldEntry.sectionLabel;
      const headingPart = spread.heldRef?.anchor.headingText ? ` · § ${spread.heldRef.anchor.headingText}` : "";
      this.heldStatusEl.setText(`Held: ${spread.heldEntry.title} (${locationPart}${headingPart})`);
      this.heldStatusEl.disabled = false;
      this.heldStatusEl.setAttr("data-note-path", spread.heldEntry.path);
      this.heldStatusEl.setAttr("title", "Click to jump to or compare held page · Clear with ✕");
      this.heldStatusEl.toggleClass("is-outside-filter", spread.isHeldOutsideFilter);
      this.heldWidgetEl.addClass("has-held");
      this.clearHeldBtn.removeAttribute("hidden");
      this.clearHeldBtn.disabled = false;
    } else {
      this.heldStatusEl.setText("No held page");
      this.heldStatusEl.disabled = true;
      this.heldStatusEl.removeAttribute("data-note-path");
      this.heldStatusEl.removeAttribute("title");
      this.heldStatusEl.removeClass("is-outside-filter");
      this.heldWidgetEl.removeClass("has-held");
      this.clearHeldBtn.setAttr("hidden", "true");
      this.clearHeldBtn.disabled = true;
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

    const navPos = state.navButtonPosition;
    this.bottomBarEl.toggleClass("is-nav-right", navPos === "right");
    this.bottomBarEl.toggleClass("is-nav-left", navPos === "left");
    this.bottomBarEl.setAttr("data-nav-position", navPos);

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
      pane.fileLinkBtn.setText("");
      pane.fileLinkBtn.disabled = true;
      pane.fileLinkBtn.setAttr("hidden", "true");
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
      pane.footerFileBtn.setText("");
      pane.footerFileBtn.disabled = true;
      pane.footerFileBtn.setAttr("hidden", "true");
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

    pane.fileLinkBtn.removeAttribute("hidden");
    pane.fileLinkBtn.disabled = false;
    pane.fileLinkBtn.setText(`${descriptor.entry.basename}.md ↗`);
    pane.fileLinkBtn.setAttr("data-open-file", descriptor.entry.path);
    pane.fileLinkBtn.setAttr(
      "title",
      `Open ${descriptor.entry.path} in a new tab to view or edit`
    );

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
      const roleChanged = prevRendered.role !== descriptor.role;
      prevRendered.role = descriptor.role;
      if (roleChanged) {
        this.applyPaneScrollRestore(side, pane.scrollEl, descriptor.anchor);
      }
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
      role: descriptor.role,
      component: childComponent,
      renderSeq,
    };

    pane.titleEl.setText(descriptor.entry.title);
    pane.markdownEl.empty();
    pane.footerFileBtn.removeAttribute("hidden");
    pane.footerFileBtn.disabled = false;
    pane.footerFileBtn.setText(`${descriptor.entry.path} ↗`);
    pane.footerFileBtn.setAttr("data-open-file", descriptor.entry.path);

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
    groupByFolder: state.groupByFolder,
    excludedFolders: state.excludedFolders,
    hideDailyNotes: state.hideDailyNotes,
  });
}
