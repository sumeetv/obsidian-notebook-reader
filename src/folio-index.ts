import type { FolderSection, NoteEntry, SpreadSnapshot } from "./types/notebook";

export interface FolioIndexCallbacks {
  onSelectNote: (path: string) => void;
  onActivateHeld: () => void;
  onClearHeld?: () => void;
  onCloseIndex: () => void;
}

export interface FolioIndexModel {
  sequence: readonly NoteEntry[];
  sections: readonly FolderSection[];
  groupByFolder: boolean;
  spread: SpreadSnapshot;
}

export class FolioIndexPanel {
  private readonly hostEl: HTMLElement;
  private readonly callbacks: FolioIndexCallbacks;

  constructor(hostEl: HTMLElement, callbacks: FolioIndexCallbacks) {
    this.hostEl = hostEl;
    this.callbacks = callbacks;
  }

  render(model: FolioIndexModel): void {
    this.hostEl.empty();

    const container = this.hostEl.createDiv({
      cls: "nb-folio-index",
      attr: { role: "navigation", "aria-label": "Indexed Folio" },
    });

    const header = container.createDiv({ cls: "nb-folio-header" });
    const titleGroup = header.createDiv({ cls: "nb-folio-header-text" });
    titleGroup.createDiv({ cls: "nb-folio-title", text: "Indexed Folio" });
    titleGroup.createDiv({
      cls: "nb-folio-subtitle",
      text: `${model.spread.totalNotes} ${model.spread.totalNotes === 1 ? "note" : "notes"} in sequence`,
    });

    const headerActions = header.createDiv({ cls: "nb-folio-header-actions" });
    if (model.spread.heldEntry) {
      const clearHeldBtn = headerActions.createEl("button", {
        cls: "nb-folio-clear-held-btn",
        type: "button",
        text: "Clear held",
        attr: { "aria-label": "Clear held page" },
      });
      clearHeldBtn.addEventListener("click", () => this.callbacks.onClearHeld?.());
    }

    const closeBtn = headerActions.createEl("button", {
      cls: "nb-folio-close-btn",
      type: "button",
      text: "Close index",
      attr: { "aria-label": "Close Indexed Folio" },
    });
    closeBtn.addEventListener("click", () => this.callbacks.onCloseIndex());

    const listEl = container.createDiv({ cls: "nb-folio-list" });

    if (model.spread.heldEntry && model.spread.isHeldOutsideFilter) {
      const outsideGroup = listEl.createDiv({ cls: "nb-folio-section is-outside-filter" });
      outsideGroup.createDiv({
        cls: "nb-folio-section-header",
        text: "Held · Outside current filter",
      });
      const heldItem = outsideGroup.createEl("button", {
        cls: "nb-folio-item is-held",
        type: "button",
        attr: { "data-note-path": model.spread.heldEntry.path },
      });
      const labelWrap = heldItem.createDiv({ cls: "nb-folio-item-main" });
      labelWrap.createDiv({ cls: "nb-folio-item-title", text: model.spread.heldEntry.title });
      labelWrap.createDiv({
        cls: "nb-folio-item-sub",
        text: `${model.spread.heldEntry.sectionLabel} · Outside current filter`,
      });
      heldItem.createSpan({ cls: "nb-folio-badge is-held", text: "Held" });
      heldItem.addEventListener("click", () => this.callbacks.onActivateHeld());
    }

    if (model.sequence.length === 0) {
      const empty = listEl.createDiv({ cls: "nb-folio-empty" });
      empty.createDiv({ cls: "nb-folio-empty-title", text: "No notes in sequence" });
      empty.createDiv({
        cls: "nb-folio-empty-body",
        text: "Adjust folder filters in the toolbar to include notes in the notebook.",
      });
      return;
    }

    const currentPath =
      model.spread.left?.role === "current"
        ? model.spread.left.entry.path
        : model.spread.right?.role === "current"
          ? model.spread.right.entry.path
          : null;
    const heldPath = model.spread.heldEntry?.path ?? null;

    const appendNoteRow = (parent: HTMLElement, note: NoteEntry, pageNumber: number, showFolder: boolean) => {
      const isCurrent = currentPath === note.path;
      const isHeld = heldPath === note.path;

      const btn = parent.createEl("button", {
        cls: "nb-folio-item",
        type: "button",
        attr: {
          "data-note-path": note.path,
          "aria-current": isCurrent ? "page" : "false",
        },
      });
      btn.toggleClass("is-current", isCurrent);
      btn.toggleClass("is-held", isHeld);

      const itemMain = btn.createDiv({ cls: "nb-folio-item-main" });
      itemMain.createDiv({ cls: "nb-folio-item-title", text: note.title });
      itemMain.createDiv({
        cls: "nb-folio-item-sub",
        text: showFolder
          ? `${note.sectionLabel} · ${note.dateLabel} · p. ${pageNumber}`
          : `${note.dateLabel} · p. ${pageNumber}`,
      });

      const badges = btn.createDiv({ cls: "nb-folio-badges" });
      if (isCurrent) {
        badges.createSpan({ cls: "nb-folio-badge is-current", text: "Current" });
      }
      if (isHeld) {
        badges.createSpan({ cls: "nb-folio-badge is-held", text: "Held" });
      }

      btn.addEventListener("click", () => {
        this.callbacks.onSelectNote(note.path);
      });
    };

    if (!model.groupByFolder) {
      const flatGroup = listEl.createDiv({ cls: "nb-folio-section is-flat" });
      model.sequence.forEach((note, index) => {
        appendNoteRow(flatGroup, note, index + 1, true);
      });
      return;
    }

    let runningNumber = 0;
    for (const section of model.sections) {
      const groupEl = listEl.createDiv({ cls: "nb-folio-section" });
      const secHeader = groupEl.createDiv({ cls: "nb-folio-section-header" });
      secHeader.createSpan({ cls: "nb-folio-section-name", text: section.sectionLabel });
      secHeader.createSpan({
        cls: "nb-folio-section-count",
        text: String(section.notes.length),
      });

      for (const note of section.notes) {
        runningNumber += 1;
        appendNoteRow(groupEl, note, runningNumber, false);
      }
    }
  }

  destroy(): void {
    this.hostEl.empty();
  }
}
