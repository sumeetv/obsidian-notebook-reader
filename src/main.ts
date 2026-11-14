import { Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import type { SequenceResult } from "./sequencer";
import { NotebookReaderSettingTab } from "./settings";
import { NotebookStateManager } from "./state";
import type { NotebookPersistedData } from "./types/notebook";
import { buildVaultSequence, NotebookReaderView, NOTEBOOK_VIEW_TYPE } from "./view";

export default class NotebookReaderPlugin extends Plugin {
  private stateManager = new NotebookStateManager();
  private refreshTimer: number | null = null;
  private pendingInvalidatedPaths = new Set<string>();

  async onload(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<NotebookPersistedData> | null;
    this.stateManager.hydrate(loaded);

    this.registerView(
      NOTEBOOK_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new NotebookReaderView(leaf, {
          getStateManager: () => this.stateManager,
          persistState: () => this.persistState(),
          getSequenceResult: () => this.getSequenceResult(),
        })
    );

    this.addRibbonIcon("book-open", "Open Notebook Reader", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-notebook-reader",
      name: "Open Notebook Reader",
      icon: "book-open",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "toggle-notebook-index",
      name: "Toggle Indexed Folio",
      callback: async () => {
        this.stateManager.toggleIndex();
        await this.persistState();
        await this.refreshOpenViews();
      },
    });

    this.addCommand({
      id: "swap-notebook-places",
      name: "Swap current and held reading places",
      callback: async () => {
        const seq = this.getSequenceResult();
        if (this.stateManager.swapHeldAndCurrent(seq.allEntriesByPath)) {
          await this.persistState();
          await this.refreshOpenViews();
        }
      },
    });

    this.addSettingTab(new NotebookReaderSettingTab(this.app, this));

    // Keep open views synchronized when notes are created, edited, renamed, or deleted
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.scheduleVaultRefresh();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.pendingInvalidatedPaths.add(file.path);
          this.scheduleVaultRefresh();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.stateManager.handleRename(oldPath, file.path);
          this.pendingInvalidatedPaths.add(file.path);
          void this.persistState();
          this.scheduleVaultRefresh();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          const nextSeq = this.getSequenceResult();
          this.stateManager.handleDelete(file.path, nextSeq.sequence);
          void this.persistState();
          this.scheduleVaultRefresh();
        }
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.scheduleVaultRefresh();
        }
      })
    );
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getStateManager(): NotebookStateManager {
    return this.stateManager;
  }

  getSequenceResult(): SequenceResult {
    return buildVaultSequence(this.app, this.stateManager);
  }

  async persistState(): Promise<void> {
    await this.saveData(this.stateManager.getData());
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(NOTEBOOK_VIEW_TYPE);
    const leaf = existing.length > 0 ? existing[0] : workspace.getLeaf(false);

    await leaf.setViewState({
      type: NOTEBOOK_VIEW_TYPE,
      active: true,
    });
    workspace.revealLeaf(leaf);
  }

  async refreshOpenViews(options: { forcePaneRerender?: boolean; invalidatedPaths?: Set<string> } = {}): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(NOTEBOOK_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof NotebookReaderView) {
        await leaf.view.refresh(options);
      }
    }
  }

  private scheduleVaultRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      const invalidated = new Set(this.pendingInvalidatedPaths);
      this.pendingInvalidatedPaths.clear();
      void this.refreshOpenViews({ invalidatedPaths: invalidated });
    }, 80);
  }
}
