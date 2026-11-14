import NotebookReaderPlugin from "../src/main";
import { createMockApp, type MockNoteSeed, WorkspaceLeaf } from "../src/testing/obsidian-mock";
import { NotebookReaderView, NOTEBOOK_VIEW_TYPE } from "../src/view";

function buildRichSeeds(): MockNoteSeed[] {
  const longText = (topic: string) =>
    Array.from({ length: 18 }, (_, i) => {
      const idx = i + 1;
      return `## Passage ${idx}: ${topic}\n\nParagraph ${idx} explores how physical notebooks encourage rereading without losing context. You can reference [[Constraints make room]] or [[Gardens and paths]] while continuing smoothly down the page.\n\n> Attention settles differently when two facing pages stay legible side by side.`;
    }).join("\n\n");

  return [
    {
      path: "Welcome.md",
      content: "---\ntitle: Notebook Guide\ndate: 2026-10-01\n---\n\nA root-level introductory page. Open **Folders** to filter sections, glide along the stacked fore-edge to preview titles, or **Hold** either page to compare passages.",
    },
    {
      path: "Ideas/Attention is a material.md",
      content: `---\ntitle: Attention is a material\ndate: 2026-10-12\n---\n\n*What we notice shapes what we can make.*\n\nAttention isn't just a mental state. It's a kind of material, limited and workable. See also [[Constraints make room]].\n\n${longText("Attention")}`,
    },
    {
      path: "Ideas/Constraints make room.md",
      content: "---\ntitle: Constraints make room\ndate: 2026-09-23\n---\n\n*A small constraint gives the next move a shape.*\n\nConstraints aren't only limits; they create structure. By narrowing the field, they make a space where a decision can feel natural.\n\nA short note fits without overflow.",
    },
    {
      path: "Ideas/Slow knowledge.md",
      content: `---\ntitle: Slow knowledge\ndate: 2026-11-02\n---\n\nSome ideas become useful only after we forget where we put them. Rediscovery creates a second context.\n\n![[Gardens and paths]]\n\n${longText("Slow Knowledge")}`,
    },
    {
      path: "Ideas/Drafts/Margins and gutters.md",
      content: "---\ntitle: Margins and gutters\ndate: 2026-10-20\n---\n\nNested folder example: `Ideas/Drafts` stays grouped directly after `Ideas`.",
    },
    {
      path: "Reading/Gardens and paths.md",
      content: `---\ntitle: Gardens and paths\ndate: 2026-08-14\n---\n\nA garden is organized, but it keeps growing beyond the organization. Paths make it possible to return without fixing every destination.\n\n${longText("Gardens")}`,
    },
    {
      path: "Reading/The art of noticing.md",
      content: "---\ntitle: The art of noticing\ndate: 2026-10-30\n---\n\nLook for what repeats. Then look for the exception. The value of a page can change depending on the page you read just before it.",
    },
    {
      path: "Walks/Courtyard observations.md",
      content: "---\ntitle: Courtyard observations\ndate: 2026-10-08\n---\n\nMoss growing in the gaps between stones. The gaps were probably an afterthought, yet that is where life settled.",
    },
    {
      path: "Journal/2026-11-10.md",
      content: "# 2026-11-10\n\nMorning walk before writing. Hidden when daily notes are excluded.",
    },
    {
      path: "Journal/2026-11-11.md",
      content: "# 2026-11-11\n\nSecond daily note entry.",
    },
  ];
}

function buildLargeSeeds(): MockNoteSeed[] {
  const seeds: MockNoteSeed[] = [];
  const folders = [
    "Architecture",
    "Craft",
    "Essays",
    "Fieldnotes",
    "History",
    "Ideas",
    "Letters",
    "Naturalism",
    "Reading",
    "Sketches",
    "Typography",
    "Walks",
  ];
  for (let i = 1; i <= 120; i++) {
    const folder = folders[(i - 1) % folders.length];
    const num = String(i).padStart(3, "0");
    seeds.push({
      path: `${folder}/Note ${num}.md`,
      content: `---\ntitle: ${folder} Note ${num}\ndate: 2026-${String(((i - 1) % 12) + 1).padStart(2, "0")}-${String(((i - 1) % 28) + 1).padStart(2, "0")}\n---\n\nSection **${folder}** entry #${num}.\n\n` +
        (i % 2 === 1
          ? Array.from({ length: 12 }, (_, p) => `Paragraph ${p + 1} for ${folder} Note ${num} showing smooth scrolling inside a 120-note vault.`).join("\n\n")
          : "Concise facing note for asymmetric length comparison."),
    });
  }
  return seeds;
}

function buildEmptySeeds(): MockNoteSeed[] {
  return [
    {
      path: "Journal/2026-11-10.md",
      content: "# 2026-11-10\n\nOnly daily notes exist, and daily notes are hidden by default.",
    },
  ];
}

let activeView: NotebookReaderView | null = null;
let activePlugin: NotebookReaderPlugin | null = null;

async function mountScenario(scenario: "rich" | "large" | "empty"): Promise<void> {
  const mount = document.getElementById("obsidian-mount");
  if (!mount) return;

  if (activeView) {
    await activeView.onClose();
    activeView = null;
  }
  activePlugin?.unload();
  mount.innerHTML = "";

  const seeds =
    scenario === "large"
      ? buildLargeSeeds()
      : scenario === "empty"
        ? buildEmptySeeds()
        : buildRichSeeds();

  const app = createMockApp(seeds, "Fieldnotes");
  const plugin = new NotebookReaderPlugin(app as any, {
    id: "obsidian-notebook-reader",
    name: "Notebook Reader",
    version: "0.1.0",
    minAppVersion: "1.5.0",
    description: "",
    author: "",
  });

  if (scenario === "rich") {
    // Start directly on "Attention is a material" so the default view showcases unequal note lengths
    await plugin.saveData({
      sortOrder: "alpha",
      excludedFolders: [],
      hideDailyNotes: true,
      indexOpen: false,
      spreadMode: "consecutive",
      narrowActiveSlot: "left",
      current: {
        path: "Ideas/Attention is a material.md",
        anchor: { scrollTop: 0, scrollRatio: 0, blockIndex: 0, blockOffsetRatio: 0 },
      },
      held: {
        path: "Reading/Gardens and paths.md",
        anchor: { scrollTop: 0, scrollRatio: 0, blockIndex: 0, blockOffsetRatio: 0 },
      },
      positionsByPath: {},
    });
  }

  await plugin.onload();
  const leaf = new WorkspaceLeaf();
  const view = (
    plugin as unknown as {
      createViewInstance: (type: string, leaf: WorkspaceLeaf) => NotebookReaderView;
    }
  ).createViewInstance(NOTEBOOK_VIEW_TYPE, leaf);

  view.containerEl.addClass("view-container");
  mount.appendChild(view.containerEl);
  await view.onOpen();

  activePlugin = plugin;
  activeView = view;

  document.querySelectorAll<HTMLButtonElement>("[data-scenario]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.scenario === scenario ? "true" : "false");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll<HTMLButtonElement>("[data-scenario]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const scenario = (btn.dataset.scenario as "rich" | "large" | "empty") ?? "rich";
      void mountScenario(scenario);
    });
  });

  const themeBtn = document.getElementById("toggle-theme");
  themeBtn?.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("theme-dark");
    themeBtn.textContent = isDark ? "Light Mode" : "Dark Mode";
  });

  const params = new URLSearchParams(window.location.search);
  const initialScenario =
    params.get("scenario") === "large"
      ? "large"
      : params.get("scenario") === "empty"
        ? "empty"
        : "rich";
  void mountScenario(initialScenario);
});
