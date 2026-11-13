# Selected notebook direction

Primary: Thumb-edge Notebook.
Secondary: Indexed Folio, available as an optional index for the same notebook.
Page Atlas is excluded from the selected product direction.

## Reading and navigation

- Open directly to a two-page spread, like an open notebook, with a central gutter and stacked page edges exposed on the right. The two reading panes must have equal width. Allocate the outer book-edge control separately so it does not reduce only the right page's reading width. Resume the last spread and reading locations.
- For the first version, treat each note as one book page with independently scrollable content. By default show two consecutive notes; the sequence remains automatic. Automatic splitting of long notes across multiple book pages is a possible later refinement.
- While the user glides along the page edge, show a floating preview with the target note title, folder, and position in the notebook. Update the title continuously as the target changes. Position the preview above or to the side of the touch point so a finger does not cover the title.
- On iPad, press and glide along the edge; with a pointer, hovering may also preview. Release after an edge drag to open the target spread. During the drag, keep the actual spread unchanged until release. Cancellation returns to the original spread.
- Provide previous/next controls and page swipes for deliberate movement. Avoid requiring precise gestures for essential actions.
- Folders become section dividers and edge tabs. Use alphabetical folder and note order by default, with a chronological-within-folder alternative. Folder exclusions are remembered, including the choice to hide daily notes.
- Give each page its own vertical scroll container and overflow scrollbar. Scrolling one page leaves the other page at its existing position. Reserve matching scrollbar space in both panes to keep their text areas equal in width even when only one note overflows. Allow short notes to fit without unnecessary scrolling.
- Keep vertical scrolling within page content distinct from gliding along the book edge. A vertical or diagonal reading gesture must not unexpectedly turn pages. Preserve embedded images, code blocks, and other note content inside the scrolling page.
- The optional Folio index replaces the exposed edge while open, providing a folder-grouped list and precise jumps. It uses the same sequence, exclusions, current location, and held location. Closing it restores edge navigation without moving the reader.

## Placekeeping

- Distinguish the current location and a held location on the book edge and in the index.
- Hold here anchors the current passage. Skimming and ordinary browsing do not replace it.
- Allow holding either visible page. A held page can remain on the left while the user browses independently on the right, making comparison part of the open-book experience. Show the pinned state clearly and provide an explicit return to consecutive-page browsing.
- Swap exchanges the current and held passages so repeated tapping toggles predictably.
- Preserve each page's independent scroll location when holding, swapping, opening or closing the index, and returning to a note. A held reference includes the passage reached within a long note, rather than only the note title.
- Store positions by note and passage anchor rather than relying only on displayed page numbers, which can change with type size or orientation.
- Compare brings the held passage and current passage into the two-page spread. Keep the two-page layout as the default on an iPad in landscape; on narrow portrait layouts, retain both positions and allow a single-page view for legibility.
- Excluding a folder affects browsing, not source notes. Preserve an existing held reference outside the browsing set and label it appropriately.

## First prototype scope

Validate equal-width pages with asymmetric amounts of content, independent overflow scrolling, restoration of both scroll locations, title previews during edge gliding, preview placement relative to touch, gesture separation, cancellation, folder jumps, exact-place swapping, holding one page while browsing the other, and the optional index on an iPad-sized surface. Use representative short notes, very long notes, and daily notes. This remains a design concept and is not connected to a vault.

