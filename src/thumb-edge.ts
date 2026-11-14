import type { FolderSection, NoteEntry, SpreadSnapshot } from "./types/notebook";

export interface ThumbEdgeCallbacks {
  onCommitNote: (path: string) => void;
  onSelectFolder: (folderPath: string) => void;
  onStep: (delta: number) => void;
  onActivateHeld: () => void;
}

export interface ThumbEdgeRenderModel {
  sequence: readonly NoteEntry[];
  sections: readonly FolderSection[];
  spread: SpreadSnapshot;
}

export class ThumbEdgeController {
  private readonly hostEl: HTMLElement;
  private readonly callbacks: ThumbEdgeCallbacks;

  private rootEl: HTMLDivElement | null = null;
  private trackEl: HTMLDivElement | null = null;
  private thumbEl: HTMLDivElement | null = null;
  private currentMarkerEl: HTMLDivElement | null = null;
  private heldMarkerBtn: HTMLButtonElement | null = null;
  private previewEl: HTMLDivElement | null = null;
  private previewTitleEl: HTMLDivElement | null = null;
  private previewMetaEl: HTMLDivElement | null = null;
  private tabsEl: HTMLDivElement | null = null;
  private tabTooltipEl: HTMLDivElement | null = null;

  private model: ThumbEdgeRenderModel = {
    sequence: [],
    sections: [],
    spread: {
      mode: "consecutive",
      left: null,
      right: null,
      currentIndex: -1,
      totalNotes: 0,
      heldRef: null,
      heldEntry: null,
      isHeldOutsideFilter: false,
    },
  };

  private activePointerId: number | null = null;
  private isHovering = false;
  private previewIndex: number | null = null;
  private longPressTimer: number | null = null;
  private longPressTriggered = false;
  private cleanups: Array<() => void> = [];

  constructor(hostEl: HTMLElement, callbacks: ThumbEdgeCallbacks) {
    this.hostEl = hostEl;
    this.callbacks = callbacks;
    this.mount();
  }

  private mount(): void {
    this.hostEl.empty();

    this.rootEl = this.hostEl.createDiv({ cls: "nb-edge-shell" });

    const edgeBody = this.rootEl.createDiv({ cls: "nb-edge-body" });

    this.trackEl = edgeBody.createDiv({
      cls: "nb-edge-track",
      attr: {
        role: "slider",
        tabindex: "0",
        "aria-label": "Notebook fore-edge page navigator",
        "aria-orientation": "vertical",
        "aria-valuemin": "1",
        "aria-valuemax": "1",
        "aria-valuenow": "1",
      },
    });

    // Visual stacked-pages ridges layer
    this.trackEl.createDiv({ cls: "nb-edge-pages-texture", attr: { "aria-hidden": "true" } });

    this.currentMarkerEl = this.trackEl.createDiv({
      cls: "nb-edge-current-marker",
      attr: { "aria-hidden": "true" },
    });
    this.currentMarkerEl.createSpan({ cls: "nb-edge-current-label", text: "Current" });

    this.heldMarkerBtn = this.trackEl.createEl("button", {
      cls: "nb-edge-held-marker",
      type: "button",
      attr: { "aria-label": "Jump to or compare held note" },
    });

    this.thumbEl = this.trackEl.createDiv({
      cls: "nb-edge-thumb",
      attr: { "aria-hidden": "true" },
    });

    this.previewEl = this.rootEl.createDiv({
      cls: "nb-edge-preview",
      attr: { role: "status", "aria-live": "polite", hidden: "true" },
    });
    this.previewEl.createDiv({ cls: "nb-edge-preview-eyebrow", text: "PREVIEW" });
    this.previewTitleEl = this.previewEl.createDiv({ cls: "nb-edge-preview-title" });
    this.previewMetaEl = this.previewEl.createDiv({ cls: "nb-edge-preview-meta" });
    this.previewEl.createDiv({
      cls: "nb-edge-preview-hint",
      text: "Release to open · Esc to cancel",
    });

    this.tabsEl = this.rootEl.createDiv({
      cls: "nb-edge-tabs",
      attr: { role: "navigation", "aria-label": "Folder sections" },
    });

    this.tabTooltipEl = this.rootEl.createDiv({
      cls: "nb-folder-tab-tooltip",
      attr: { role: "tooltip", hidden: "true" },
    });

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.trackEl || !this.heldMarkerBtn) return;

    const onTabsScroll = () => {
      this.hideTabTooltip();
    };
    this.tabsEl?.addEventListener("scroll", onTabsScroll, { passive: true });
    this.cleanups.push(() => {
      this.tabsEl?.removeEventListener("scroll", onTabsScroll);
    });

    const onHeldClick = (e: MouseEvent) => {
      e.stopPropagation();
      this.callbacks.onActivateHeld();
    };
    const onHeldPointerDown = (e: PointerEvent) => {
      // Prevent starting a fore-edge scrub when tapping the held ribbon flag directly.
      e.stopPropagation();
    };
    this.heldMarkerBtn.addEventListener("click", onHeldClick);
    this.heldMarkerBtn.addEventListener("pointerdown", onHeldPointerDown);
    this.cleanups.push(() => {
      this.heldMarkerBtn?.removeEventListener("click", onHeldClick);
      this.heldMarkerBtn?.removeEventListener("pointerdown", onHeldPointerDown);
    });

    const onPointerDown = (e: PointerEvent) => {
      if (this.model.sequence.length === 0) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      this.activePointerId = e.pointerId;
      this.isHovering = false;
      try {
        this.trackEl?.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events in jsdom may not register an active pointer id
      }
      this.rootEl?.addClass("is-scrubbing");
      this.updatePreviewFromClientY(e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (this.model.sequence.length === 0) return;
      if (this.activePointerId !== null) {
        if (e.pointerId !== this.activePointerId) return;
        e.preventDefault();
        this.updatePreviewFromClientY(e.clientY);
        return;
      }

      if (e.pointerType === "mouse") {
        this.isHovering = true;
        this.updatePreviewFromClientY(e.clientY);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (this.activePointerId === null || e.pointerId !== this.activePointerId) return;
      e.preventDefault();
      const targetIndex = this.computeIndexFromClientY(e.clientY);
      const targetEntry =
        targetIndex !== null ? this.model.sequence[targetIndex] ?? null : null;

      this.releasePointer(e.pointerId);
      this.clearPreview();

      if (targetEntry) {
        this.callbacks.onCommitNote(targetEntry.path);
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (this.activePointerId === null || e.pointerId !== this.activePointerId) return;
      this.releasePointer(e.pointerId);
      this.clearPreview();
    };

    const onPointerLeave = (e: PointerEvent) => {
      if (this.activePointerId === null && e.pointerType === "mouse" && this.isHovering) {
        this.isHovering = false;
        this.clearPreview();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (this.activePointerId !== null) {
          this.releasePointer(this.activePointerId);
        }
        this.isHovering = false;
        this.clearPreview();
        return;
      }

      if (this.model.sequence.length === 0) return;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        this.callbacks.onStep(-1);
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        this.callbacks.onStep(1);
      } else if (e.key === "Home") {
        e.preventDefault();
        this.callbacks.onCommitNote(this.model.sequence[0].path);
      } else if (e.key === "End") {
        e.preventDefault();
        this.callbacks.onCommitNote(this.model.sequence[this.model.sequence.length - 1].path);
      }
    };

    this.trackEl.addEventListener("pointerdown", onPointerDown);
    this.trackEl.addEventListener("pointermove", onPointerMove);
    this.trackEl.addEventListener("pointerup", onPointerUp);
    this.trackEl.addEventListener("pointercancel", onPointerCancel);
    this.trackEl.addEventListener("pointerleave", onPointerLeave);
    this.trackEl.addEventListener("keydown", onKeyDown);

    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (this.activePointerId !== null || this.isHovering)) {
        if (this.activePointerId !== null) {
          this.releasePointer(this.activePointerId);
        }
        this.isHovering = false;
        this.clearPreview();
      }
    };
    window.addEventListener("keydown", onWindowKeyDown);

    this.cleanups.push(() => {
      this.trackEl?.removeEventListener("pointerdown", onPointerDown);
      this.trackEl?.removeEventListener("pointermove", onPointerMove);
      this.trackEl?.removeEventListener("pointerup", onPointerUp);
      this.trackEl?.removeEventListener("pointercancel", onPointerCancel);
      this.trackEl?.removeEventListener("pointerleave", onPointerLeave);
      this.trackEl?.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keydown", onWindowKeyDown);
    });
  }

  private releasePointer(pointerId: number): void {
    try {
      if (this.trackEl?.hasPointerCapture?.(pointerId)) {
        this.trackEl.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore synthetic capture cleanup errors
    }
    this.activePointerId = null;
    this.rootEl?.removeClass("is-scrubbing");
  }

  private computeTrackGeometry(): { top: number; height: number } {
    if (!this.trackEl) return { top: 0, height: 1 };
    const rect = this.trackEl.getBoundingClientRect();
    const height = rect.height > 0 ? rect.height : 480;
    return { top: rect.top, height };
  }

  private computeIndexFromClientY(clientY: number): number | null {
    const len = this.model.sequence.length;
    if (len === 0) return null;
    if (len === 1) return 0;

    const { top, height } = this.computeTrackGeometry();
    const padding = 14;
    const usable = Math.max(1, height - padding * 2);
    const ratio = Math.min(1, Math.max(0, (clientY - top - padding) / usable));
    return Math.min(len - 1, Math.max(0, Math.round(ratio * (len - 1))));
  }

  private indexToFraction(index: number, total: number): number {
    if (total <= 1 || index <= 0) return 0;
    return Math.min(1, Math.max(0, index / (total - 1)));
  }

  private updatePreviewFromClientY(clientY: number): void {
    const idx = this.computeIndexFromClientY(clientY);
    if (idx === null) return;

    const entry = this.model.sequence[idx];
    if (!entry) return;

    this.previewIndex = idx;

    const { top, height } = this.computeTrackGeometry();
    const relY = Math.min(height, Math.max(0, clientY - top));
    // Place the preview card above and to the left of the finger/pointer touch point
    const previewHeight = 98;
    const previewTop = Math.max(8, Math.min(height - previewHeight - 8, relY - previewHeight - 12));

    if (this.previewEl && this.previewTitleEl && this.previewMetaEl) {
      this.previewEl.removeAttribute("hidden");
      this.previewEl.setAttr("data-preview-path", entry.path);
      this.previewEl.setAttr("data-preview-index", String(idx));
      this.previewEl.style.top = `${Math.round(previewTop)}px`;
      this.previewTitleEl.setText(entry.title);
      this.previewMetaEl.setText(
        `${entry.sectionLabel} · Page ${idx + 1} of ${this.model.sequence.length}`
      );
    }

    if (this.thumbEl) {
      const frac = this.indexToFraction(idx, this.model.sequence.length);
      this.thumbEl.style.top = `calc(14px + ${frac * 100}% * 0.92)`;
      this.thumbEl.addClass("is-active");
    }
  }

  private clearPreview(): void {
    this.previewIndex = null;
    if (this.previewEl) {
      this.previewEl.setAttr("hidden", "true");
      this.previewEl.removeAttribute("data-preview-path");
      this.previewEl.removeAttribute("data-preview-index");
    }
    this.thumbEl?.removeClass("is-active");
    this.syncMarkers();
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private showTabTooltip(section: FolderSection, tabBtn: HTMLElement): void {
    if (!this.tabTooltipEl || !this.rootEl) return;

    this.tabTooltipEl.setText(section.sectionLabel);
    this.tabTooltipEl.setAttr("data-tooltip-folder", section.folderPath);
    this.tabTooltipEl.removeAttribute("hidden");

    const shellRect = this.rootEl.getBoundingClientRect();
    const tabRect = tabBtn.getBoundingClientRect();
    let centerTop = 24;
    if (shellRect.height > 0 && tabRect.height > 0) {
      centerTop = tabRect.top - shellRect.top + tabRect.height / 2;
      centerTop = Math.max(20, Math.min(shellRect.height - 20, centerTop));
    } else if (tabBtn.offsetHeight > 0) {
      centerTop = tabBtn.offsetTop + tabBtn.offsetHeight / 2;
    }
    this.tabTooltipEl.style.top = `${Math.round(centerTop)}px`;
  }

  private hideTabTooltip(): void {
    this.clearLongPressTimer();
    if (!this.tabTooltipEl) return;
    this.tabTooltipEl.setAttr("hidden", "true");
    this.tabTooltipEl.removeAttribute("data-tooltip-folder");
  }

  update(model: ThumbEdgeRenderModel): void {
    this.model = model;
    this.renderTabs();
    this.syncMarkers();

    if (this.trackEl) {
      const max = Math.max(1, model.sequence.length);
      const now = model.spread.currentIndex >= 0 ? model.spread.currentIndex + 1 : 1;
      this.trackEl.setAttr("aria-valuemax", String(max));
      this.trackEl.setAttr("aria-valuenow", String(now));
      this.trackEl.toggleClass("is-empty", model.sequence.length === 0);
    }
  }

  private syncMarkers(): void {
    const { sequence, spread } = this.model;
    const total = sequence.length;

    if (this.currentMarkerEl) {
      if (total > 0 && spread.currentIndex >= 0) {
        const frac = this.indexToFraction(spread.currentIndex, total);
        this.currentMarkerEl.style.top = `calc(14px + ${frac * 100}% * 0.92)`;
        this.currentMarkerEl.removeAttribute("hidden");
      } else {
        this.currentMarkerEl.setAttr("hidden", "true");
      }
    }

    if (this.thumbEl && this.previewIndex === null) {
      if (total > 0 && spread.currentIndex >= 0) {
        const frac = this.indexToFraction(spread.currentIndex, total);
        this.thumbEl.style.top = `calc(14px + ${frac * 100}% * 0.92)`;
        this.thumbEl.removeAttribute("hidden");
      } else {
        this.thumbEl.setAttr("hidden", "true");
      }
    }

    if (this.heldMarkerBtn) {
      if (spread.heldEntry) {
        const heldIdx = sequence.findIndex((e) => e.path === spread.heldEntry?.path);
        const heldFrac = heldIdx >= 0 ? this.indexToFraction(heldIdx, total) : 1;
        this.heldMarkerBtn.style.top =
          heldIdx >= 0 ? `calc(14px + ${heldFrac * 100}% * 0.92)` : "calc(100% - 34px)";
        this.heldMarkerBtn.empty();
        this.heldMarkerBtn.createSpan({
          cls: "nb-edge-held-title",
          text: `Held: ${spread.heldEntry.title}`,
        });
        if (spread.isHeldOutsideFilter) {
          this.heldMarkerBtn.createSpan({
            cls: "nb-edge-held-filter-note",
            text: "Outside filter",
          });
        }
        this.heldMarkerBtn.toggleClass("is-outside-filter", spread.isHeldOutsideFilter);
        this.heldMarkerBtn.removeAttribute("hidden");
      } else {
        this.heldMarkerBtn.setAttr("hidden", "true");
      }
    }
  }

  private renderTabs(): void {
    if (!this.tabsEl) return;
    this.hideTabTooltip();
    this.tabsEl.empty();

    const activeFolder = this.model.spread.left?.role === "current"
      ? this.model.spread.left.entry.folderPath
      : this.model.spread.right?.role === "current"
        ? this.model.spread.right.entry.folderPath
        : null;

    if (this.model.sections.length === 0) {
      this.tabsEl.setAttr("hidden", "true");
      return;
    }

    this.tabsEl.removeAttribute("hidden");

    for (const section of this.model.sections) {
      const isCurrentFolder = activeFolder === section.folderPath;
      const tabBtn = this.tabsEl.createEl("button", {
        cls: "nb-folder-tab",
        type: "button",
        attr: {
          "data-folder-path": section.folderPath,
          "aria-pressed": isCurrentFolder ? "true" : "false",
          "aria-label": `${section.sectionLabel} (${section.notes.length})`,
          title: section.sectionLabel,
        },
      });
      tabBtn.toggleClass("is-active", isCurrentFolder);
      tabBtn.createSpan({ cls: "nb-folder-tab-label", text: section.tabLabel });
      tabBtn.createSpan({ cls: "nb-folder-tab-count", text: String(section.notes.length) });

      let pressStartX = 0;
      let pressStartY = 0;

      tabBtn.addEventListener("mouseenter", () => {
        this.showTabTooltip(section, tabBtn);
      });
      tabBtn.addEventListener("focus", () => {
        this.showTabTooltip(section, tabBtn);
      });
      tabBtn.addEventListener("mouseleave", () => {
        this.hideTabTooltip();
      });
      tabBtn.addEventListener("blur", () => {
        this.hideTabTooltip();
      });

      tabBtn.addEventListener("pointerdown", (e: PointerEvent) => {
        this.longPressTriggered = false;
        if (e.pointerType === "mouse") return;
        pressStartX = e.clientX;
        pressStartY = e.clientY;
        this.clearLongPressTimer();
        this.longPressTimer = window.setTimeout(() => {
          this.longPressTimer = null;
          this.longPressTriggered = true;
          this.showTabTooltip(section, tabBtn);
        }, 420);
      });

      tabBtn.addEventListener("pointermove", (e: PointerEvent) => {
        if (this.longPressTimer === null) return;
        if (Math.hypot(e.clientX - pressStartX, e.clientY - pressStartY) > 10) {
          this.clearLongPressTimer();
        }
      });

      tabBtn.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        this.longPressTriggered = true;
        this.showTabTooltip(section, tabBtn);
      });

      tabBtn.addEventListener("pointerup", (e: PointerEvent) => {
        this.clearLongPressTimer();
        if (e.pointerType !== "mouse") {
          this.hideTabTooltip();
        }
      });

      tabBtn.addEventListener("pointercancel", (e: PointerEvent) => {
        this.clearLongPressTimer();
        if (e.pointerType !== "mouse") {
          this.hideTabTooltip();
        }
      });

      tabBtn.addEventListener("click", (e: MouseEvent) => {
        if (this.longPressTriggered) {
          this.longPressTriggered = false;
          e.preventDefault();
          return;
        }
        this.hideTabTooltip();
        this.callbacks.onSelectFolder(section.folderPath);
      });
    }
  }

  destroy(): void {
    this.hideTabTooltip();
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
    this.hostEl.empty();
  }
}
