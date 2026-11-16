import { PluginSettingTab, Setting, type App } from "obsidian";
import type NotebookReaderPlugin from "./main";

export class NotebookReaderSettingTab extends PluginSettingTab {
  private readonly readerPlugin: NotebookReaderPlugin;

  constructor(app: App, plugin: NotebookReaderPlugin) {
    super(app, plugin);
    this.readerPlugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const state = this.readerPlugin.getStateManager();
    const sequence = this.readerPlugin.getSequenceResult();

    new Setting(containerEl).setName("Notebook Reader").setHeading();

    new Setting(containerEl)
      .setName("Default note ordering")
      .setDesc("Choose alphabetical or oldest-first chronological order (within folders when sectioned, or across all files).")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("alpha", "Alphabetical (A–Z)")
          .addOption("date", "Chronological (Oldest first)")
          .setValue(state.sortOrder)
          .onChange(async (value) => {
            state.setSortOrder(value === "date" ? "date" : "alpha");
            await this.readerPlugin.persistState();
            await this.readerPlugin.refreshOpenViews();
          });
      });

    new Setting(containerEl)
      .setName("Section by folders")
      .setDesc("Group notes by folder section dividers and edge tabs. Turn off to sort all included notes in one continuous list.")
      .addToggle((toggle) => {
        toggle.setValue(state.groupByFolder).onChange(async (value) => {
          state.setGroupByFolder(value);
          await this.readerPlugin.persistState();
          await this.readerPlugin.refreshOpenViews();
        });
      });

    new Setting(containerEl)
      .setName("Hide daily-note folders")
      .setDesc("Automatically exclude folders detected as daily notes or journals from notebook browsing. Held notes remain preserved.")
      .addToggle((toggle) => {
        toggle.setValue(state.hideDailyNotes).onChange(async (value) => {
          state.setHideDailyNotes(value);
          await this.readerPlugin.persistState();
          await this.readerPlugin.refreshOpenViews();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Page navigation buttons")
      .setDesc("Choose whether Previous and Next page buttons appear on the bottom right or bottom left.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("right", "Bottom right (Default)")
          .addOption("left", "Bottom left (Left-handed)")
          .setValue(state.navButtonPosition)
          .onChange(async (value) => {
            state.setNavButtonPosition(value === "left" ? "left" : "right");
            await this.readerPlugin.persistState();
            await this.readerPlugin.refreshOpenViews();
          });
      });

    new Setting(containerEl).setName("Folder exclusions").setHeading();

    for (const folder of sequence.folders) {
      const disabledByDaily = state.hideDailyNotes && folder.isDailyFolder;
      const isExcludedExplicitly = state.excludedFolders.includes(folder.folderPath);

      new Setting(containerEl)
        .setName(folder.sectionLabel)
        .setDesc(
          `${folder.noteCount} ${folder.noteCount === 1 ? "note" : "notes"}${
            folder.isDailyFolder ? " · Detected as daily-note folder" : ""
          }${disabledByDaily ? " · Hidden by daily-note setting" : ""}`
        )
        .addToggle((toggle) => {
          toggle.setValue(isExcludedExplicitly || disabledByDaily).onChange(async (exclude) => {
            if (disabledByDaily) {
              return;
            }
            const currentlyExcluded = state.excludedFolders.includes(folder.folderPath);
            if (exclude !== currentlyExcluded) {
              state.toggleFolderExclusion(folder.folderPath);
              await this.readerPlugin.persistState();
              await this.readerPlugin.refreshOpenViews();
            }
          });
        });
    }

    new Setting(containerEl)
      .setName("Reset saved reading positions")
      .setDesc("Clear remembered scroll anchors, current page, and held page.")
      .addButton((button) => {
        button
          .setButtonText("Reset places")
          .setWarning()
          .onClick(async () => {
            const currentSettings = {
              sortOrder: state.sortOrder,
              groupByFolder: state.groupByFolder,
              excludedFolders: [...state.excludedFolders],
              hideDailyNotes: state.hideDailyNotes,
              navButtonPosition: state.navButtonPosition,
            };
            state.hydrate(currentSettings);
            await this.readerPlugin.persistState();
            await this.readerPlugin.refreshOpenViews({ forcePaneRerender: true });
          });
      });
  }
}
