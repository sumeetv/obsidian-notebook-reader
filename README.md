# Obsidian Notebook Reader

An iPad-first, mobile-compatible Obsidian plugin (`isDesktopOnly: false`) for browsing an existing vault like a physical notebook.

Implements the **Thumb-edge Notebook** primary experience with the optional **Indexed Folio** sidebar described in [docs/notebook-direction.md](docs/notebook-direction.md). Page Atlas is excluded.

## What's Included

- **Two-page open-book spread** ([`src/view.ts`](src/view.ts), [`styles.css`](styles.css)):
  - Equal-width facing panes (`grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr)`) separated by a central binding gutter, with `scrollbar-gutter: stable` on both independent vertical scroll containers so text widths match even when only one note overflows.
  - Real Obsidian Markdown rendering via `MarkdownRenderer.render()` with YAML frontmatter stripping, internal link navigation (`[[...]]`), and embed rendering (`![[...]]`).
  - Clickable note filename in each pane's header and footer path opens that note in a new Obsidian workspace tab (`workspace.getLeaf("tab")`) for quick viewing or editing.
  - Narrow-screen fallback (`< 740px` container width) via a slot switcher that preserves both reading locations and scroll anchors.
- **Thumb-edge navigation** ([`src/thumb-edge.ts`](src/thumb-edge.ts)):
  - Stacked fore-edge scrub rail and protruding folder section tabs allocated in a separate right rail outside the reading spread (tabs are hidden automatically when browsing in unsectioned `All files` mode).
  - Press-and-glide touch scrubbing (and desktop pointer hover) shows a floating preview card positioned above and to the left of the touch point with note title, folder, and page position.
  - Previewing reads only in-memory sequence metadata (no vault reads during pointer movement) and leaves the open spread untouched until release; `pointercancel` or `Escape` cancels cleanly.
  - Accessible `← Prev` / `Next →` buttons, keyboard arrow/`Home`/`End` support on the edge slider, and deliberate horizontal swipe navigation distinct from vertical/diagonal reading scroll.
- **Automatic sequence and folder sections** ([`src/sequencer.ts`](src/sequencer.ts)):
  - **By folder vs. All files grouping**: Choose **By folder** (default) to group notes under folder sections, or switch to **All files** (from the toolbar toggle, **Folders** popover, or plugin settings) to sort all included vault notes globally by `A–Z` or `Date` without folder sectioning.
  - **Root-level notes** (`""` folder path) are grouped first under the `"Root"` section when sectioning by folder.
  - **Nested folders** sort segment-by-segment using case-insensitive natural ordering so every parent folder appears immediately ahead of its nested subfolders (e.g., `Ideas`, then `Ideas/Drafts`, then `Ideas Archive`).
  - **Ordering**: Alphabetical (`alpha`, default) by frontmatter `title` (falling back to filename `basename`), or chronological (`date`, oldest first) resolved deterministically in priority order:
    1. Valid frontmatter `date`, `created`, `created_at`, or `date_created`
    2. Leading `YYYY-MM-DD` filename prefix
    3. `file.stat.ctime`
    4. `file.stat.mtime`
  - **Folder exclusions & daily notes**: Excluding a folder hides it and its nested subfolders and persists across sessions. Daily-note folders (segment names matching `Daily`, `Daily Notes`, `Dailies`, `Journal`, `Journals`, or folders where ≥ 50% of notes begin with `YYYY-MM-DD`) are excluded by default and toggleable from the **Folders** popover (updating checkboxes in-place without resetting the popover or reading scroll positions) or plugin settings.
- **Placekeeping and comparison** ([`src/state.ts`](src/state.ts)):
  - Distinct **Current** and **Held** positions with passage anchors (`scrollTop`, `scrollRatio`, visible `blockIndex`, `blockOffsetRatio`).
  - Hold either the left or right visible page in place while browsing the opposite pane independently, return explicitly to **Consecutive** browsing, **Swap** current and held passages (preserving scroll positions), or **Compare** held and current side by side.
  - Held notes in excluded folders remain preserved and are labeled `Outside current filter`.
  - Handles vault `create`, `modify`, `rename`, and `delete` events cleanly.
- **Optional Indexed Folio** ([`src/folio-index.ts`](src/folio-index.ts)):
  - Toggleable index (folder-grouped in **By folder** mode or flat list in **All files** mode) sharing the exact same sequence, exclusions, and Current/Held badges as the thumb-edge, without disturbing reading positions when opened or closed.

## Architecture

- [`src/main.ts`](src/main.ts): `NotebookReaderPlugin` entry point registering the `ItemView`, ribbon icon, commands (`Open Notebook Reader`, `Toggle Indexed Folio`, `Swap current and held reading places`), settings tab, and vault/metadata event listeners.
- [`src/sequencer.ts`](src/sequencer.ts): Pure deterministic sorting, folder grouping, daily-note detection, and exclusion filtering.
- [`src/state.ts`](src/state.ts): Pure `NotebookStateManager` owning spread modes (`consecutive`, `pinned-left`, `pinned-right`, `compare`), independent passage anchors, swap/hold/compare transitions, and rename/delete reconciliation.
- [`src/thumb-edge.ts`](src/thumb-edge.ts): `ThumbEdgeController` managing fore-edge pointer/touch/keyboard scrubbing, floating preview placement, and protruding folder tabs.
- [`src/folio-index.ts`](src/folio-index.ts): `FolioIndexPanel` rendering the optional Indexed Folio sidebar.
- [`src/view.ts`](src/view.ts): `NotebookReaderView` (`ItemView`) wiring Obsidian `MarkdownRenderer.render`, per-pane `Component` lifecycles, scroll anchor capture/restoration, gesture separation, and responsive width handling.
- [`src/settings.ts`](src/settings.ts): `NotebookReaderSettingTab` for persisted ordering and folder exclusion preferences.
- [`src/types/obsidian.d.ts`](src/types/obsidian.d.ts) & [`src/types/notebook.ts`](src/types/notebook.ts): TypeScript API declarations and domain types (zero Node/Electron runtime dependencies).

## Development & Build

```sh
npm install
npm run typecheck
npm run test
npm run build
```

- `npm run dev` watches `src/` and rebuilds `main.js` with inline sourcemaps.
- `npm run build` runs `tsc --noEmit` and compiles a production CommonJS `main.js` via `esbuild`.
- `npm test` runs the Vitest + jsdom test suite (`tests/sequencer.test.ts`, `tests/state.test.ts`, `tests/view-dom.test.ts`) against `src/testing/obsidian-mock.ts`.

## Installing in Obsidian (Desktop or iPad via Sync/Files)

1. Build the plugin (`npm run build`), which outputs `main.js` alongside `manifest.json` and `styles.css`.
2. Create `<YourVault>/.obsidian/plugins/obsidian-notebook-reader/`.
3. Copy `manifest.json`, `main.js`, and `styles.css` into that folder.
4. In Obsidian, open **Settings → Community plugins**, enable community plugins if needed, reload plugins, and enable **Notebook Reader**.
5. Open the reader from the left ribbon book icon or Command Palette (`Open Notebook Reader`).
6. On iPad/iOS, sync the `.obsidian/plugins/obsidian-notebook-reader/` directory via Obsidian Sync, iCloud Drive, or Working Copy / Files, then enable **Notebook Reader** on the iPad device.

## Manual Testing

### Browser Preview Harness (Simulated Vault)

A standalone browser harness is provided under `preview/` using the same `NotebookReaderPlugin` and `NotebookReaderView` code with a simulated vault (`marked` + `src/testing/obsidian-mock.ts`):

```sh
npm run build:preview
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/preview/` at an iPad landscape viewport (`1180×820`) to test rich unequal-length notes, a 120-note vault, an empty browsing set, dark mode, thumb-edge previews, hold/swap/compare, and Indexed Folio.

### Actual Obsidian & iPad Checklist

1. Open a vault containing short notes, long multi-heading notes, embedded images/notes (`![[...]]`), internal links (`[[...]]`), nested folders, root notes, and a `Daily Notes` / `Journal` folder.
2. Verify both panes remain equal in width even when only one pane displays a scrollbar.
3. Scroll both panes independently, hold one page, browse the other, open/close Index, tap Swap and Compare, and close/reopen the Notebook Reader tab to verify both scroll positions restore.
4. Test touch gliding along the fore-edge on iPadOS to confirm preview placement stays clear of your finger, cancellation restores the original spread, and vertical reading scroll never triggers accidental page turns.

## Remaining Limitations & Design Decisions

- **One note per book page**: Per the v1 brief, each note occupies one independently scrollable book page rather than automatically paginating long notes into synthetic sub-pages.
- **Simulated preview vs. live Obsidian**: Automated tests and the `preview/` harness use `src/testing/obsidian-mock.ts` and `marked` rather than Obsidian's runtime Electron/WebKit `MarkdownRenderer` (such as live canvas/callout/transclusion CSS from Obsidian themes) and real iPadOS touch inertia. Live verification inside Obsidian on macOS/iPadOS is recommended before wide release.
- **Chronological date heuristic**: Notes without frontmatter `date`/`created` or a `YYYY-MM-DD` filename prefix fall back to `file.stat.ctime` (which can vary across file sync tools if creation timestamps aren't preserved).
- **Daily-note detection heuristic**: Folders named `Daily`, `Daily Notes`, `Dailies`, `Journal`, or `Journals` (case-insensitive), or folders where ≥ 50% of notes start with `YYYY-MM-DD`, are classified as daily-note folders; any folder can be overridden explicitly in **Folders** or plugin settings.

## Design History

- [Current design brief](docs/notebook-direction.md)
- [Design artifact guide](docs/README.md)
- [Latest open-book mock](docs/imagegen/thumb-edge-open-book.png)
- [Indexed Folio mock](docs/imagegen/indexed-folio.png)
