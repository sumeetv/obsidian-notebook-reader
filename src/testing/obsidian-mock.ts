import { marked } from "marked";

export interface MockNoteSeed {
  path: string;
  content: string;
  ctime?: number;
  mtime?: number;
  frontmatter?: Record<string, unknown>;
}

export function installObsidianDomPolyfills(): void {
  if (typeof HTMLElement === "undefined") return;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

  if (!proto.empty) {
    proto.empty = function (this: HTMLElement) {
      this.innerHTML = "";
    };
  }
  if (!proto.addClass) {
    proto.addClass = function (this: HTMLElement, ...classes: string[]) {
      for (const cls of classes) {
        if (!cls) continue;
        for (const token of cls.split(/\s+/)) {
          if (token) this.classList.add(token);
        }
      }
    };
  }
  if (!proto.removeClass) {
    proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
      for (const cls of classes) {
        if (!cls) continue;
        for (const token of cls.split(/\s+/)) {
          if (token) this.classList.remove(token);
        }
      }
    };
  }
  if (!proto.toggleClass) {
    proto.toggleClass = function (this: HTMLElement, classes: string | string[], value: boolean) {
      const list = Array.isArray(classes) ? classes : classes.split(/\s+/);
      for (const cls of list) {
        if (cls) this.classList.toggle(cls, value);
      }
    };
  }
  if (!proto.setAttr) {
    proto.setAttr = function (
      this: HTMLElement,
      qualifiedName: string,
      value: string | number | boolean | null
    ) {
      if (value === null || value === false) {
        this.removeAttribute(qualifiedName);
      } else {
        this.setAttribute(qualifiedName, value === true ? "" : String(value));
      }
    };
  }
  if (!proto.setText) {
    proto.setText = function (this: HTMLElement, val: string) {
      this.textContent = val;
    };
  }
  if (!proto.createEl) {
    proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
      this: HTMLElement,
      tag: K,
      o?:
        | {
            cls?: string | string[];
            text?: string;
            attr?: Record<string, string | number | boolean | null>;
            title?: string;
            type?: string;
            href?: string;
            value?: string;
          }
        | string,
      callback?: (el: HTMLElementTagNameMap[K]) => void
    ): HTMLElementTagNameMap[K] {
      const el = document.createElement(tag);
      if (typeof o === "string") {
        el.addClass(o);
      } else if (o) {
        if (o.cls) {
          const classes = Array.isArray(o.cls) ? o.cls : [o.cls];
          el.addClass(...classes);
        }
        if (o.text !== undefined) {
          el.textContent = o.text;
        }
        if (o.title !== undefined) {
          el.title = o.title;
        }
        if (o.type !== undefined && "type" in el) {
          (el as HTMLButtonElement | HTMLInputElement).type = o.type;
        }
        if (o.href !== undefined && el instanceof HTMLAnchorElement) {
          el.href = o.href;
        }
        if (o.value !== undefined && "value" in el) {
          (el as HTMLInputElement).value = o.value;
        }
        if (o.attr) {
          for (const [k, v] of Object.entries(o.attr)) {
            if (v !== null && v !== false) {
              el.setAttribute(k, v === true ? "" : String(v));
            }
          }
        }
      }
      this.appendChild(el);
      callback?.(el);
      return el;
    };
  }
  if (!proto.createDiv) {
    proto.createDiv = function (this: HTMLElement, o?: any, callback?: (el: HTMLDivElement) => void) {
      return this.createEl("div", o, callback);
    };
  }
  if (!proto.createSpan) {
    proto.createSpan = function (this: HTMLElement, o?: any, callback?: (el: HTMLSpanElement) => void) {
      return this.createEl("span", o, callback);
    };
  }
}

installObsidianDomPolyfills();

export interface EventRef {
  readonly id: string;
  off: () => void;
}

export class TAbstractFile {
  vault!: MockVault;
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  stat = { ctime: 0, mtime: 0, size: 0 };
  basename = "";
  extension = "md";
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot(): boolean {
    return this.path === "" || this.path === "/";
  }
}

type EventHandler = (...args: any[]) => void;

class SimpleEvents {
  private listeners = new Map<string, Set<EventHandler>>();

  on(name: string, cb: EventHandler): EventRef {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(cb);
    return {
      id: `${name}:${Math.random().toString(36).slice(2)}`,
      off: () => {
        set?.delete(cb);
      },
    };
  }

  trigger(name: string, ...args: any[]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const cb of Array.from(set)) {
      cb(...args);
    }
  }
}

function parseSimpleFrontmatter(raw: string): {
  frontmatter?: Record<string, unknown>;
  endOffset?: number;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) fm[key] = val;
  }
  return { frontmatter: fm, endOffset: match[0].length };
}

export class MockVault {
  private files = new Map<string, { file: TFile; content: string; frontmatter?: Record<string, unknown> }>();
  private events = new SimpleEvents();
  public vaultName: string;
  public readCount = 0;
  public cachedReadCount = 0;

  constructor(vaultName = "Fieldnotes") {
    this.vaultName = vaultName;
  }

  getName(): string {
    return this.vaultName;
  }

  addSeed(seed: MockNoteSeed): TFile {
    const cleanPath = seed.path.replace(/^\/+/, "");
    const parts = cleanPath.split("/");
    const name = parts[parts.length - 1];
    const dot = name.lastIndexOf(".");
    const basename = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot + 1) : "";

    const file = new TFile();
    file.vault = this;
    file.path = cleanPath;
    file.name = name;
    file.basename = basename;
    file.extension = extension;
    file.stat = {
      ctime: seed.ctime ?? Date.UTC(2026, 9, 1),
      mtime: seed.mtime ?? Date.UTC(2026, 9, 2),
      size: seed.content.length,
    };

    const existing = this.files.has(cleanPath);
    this.files.set(cleanPath, { file, content: seed.content, frontmatter: seed.frontmatter });
    if (existing) {
      this.events.trigger("modify", file);
    } else {
      this.events.trigger("create", file);
    }
    return file;
  }

  updateContent(path: string, content: string): void {
    const entry = this.files.get(path);
    if (!entry) return;
    entry.content = content;
    entry.file.stat.mtime += 1000;
    entry.file.stat.size = content.length;
    this.events.trigger("modify", entry.file);
  }

  renameFile(oldPath: string, newPath: string): void {
    const entry = this.files.get(oldPath);
    if (!entry) return;
    this.files.delete(oldPath);
    const parts = newPath.split("/");
    const name = parts[parts.length - 1];
    const dot = name.lastIndexOf(".");
    entry.file.path = newPath;
    entry.file.name = name;
    entry.file.basename = dot > 0 ? name.slice(0, dot) : name;
    this.files.set(newPath, entry);
    this.events.trigger("rename", entry.file, oldPath);
  }

  deleteFile(path: string): void {
    const entry = this.files.get(path);
    if (!entry) return;
    this.files.delete(path);
    this.events.trigger("delete", entry.file);
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.files.values())
      .map((x) => x.file)
      .filter((f) => f.extension === "md");
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return Array.from(this.files.values()).map((x) => x.file);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.get(path)?.file ?? null;
  }

  getRawEntry(path: string) {
    return this.files.get(path);
  }

  async read(file: TFile): Promise<string> {
    this.readCount += 1;
    return this.files.get(file.path)?.content ?? "";
  }

  async cachedRead(file: TFile): Promise<string> {
    this.cachedReadCount += 1;
    return this.files.get(file.path)?.content ?? "";
  }

  on(name: string, cb: EventHandler): EventRef {
    return this.events.on(name, cb);
  }
}

export class MockMetadataCache {
  private vault: MockVault;
  private events = new SimpleEvents();

  constructor(vault: MockVault) {
    this.vault = vault;
  }

  getFileCache(file: TFile) {
    const raw = this.vault.getRawEntry(file.path);
    if (!raw) return null;
    const parsed = parseSimpleFrontmatter(raw.content);
    const frontmatter = raw.frontmatter ?? parsed.frontmatter;
    return {
      frontmatter,
      frontmatterPosition: parsed.endOffset
        ? {
            start: { line: 0, col: 0, offset: 0 },
            end: { line: 0, col: 0, offset: parsed.endOffset },
          }
        : undefined,
    };
  }

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    const clean = linkpath.trim().toLowerCase();
    for (const file of this.vault.getMarkdownFiles()) {
      if (
        file.path.toLowerCase() === clean ||
        file.path.toLowerCase() === `${clean}.md` ||
        file.basename.toLowerCase() === clean
      ) {
        return file;
      }
    }
    return null;
  }

  on(name: string, cb: EventHandler): EventRef {
    return this.events.on(name, cb);
  }
}

export class MockWorkspace {
  private leaves: WorkspaceLeaf[] = [];
  private events = new SimpleEvents();
  public openedLinks: Array<{ linktext: string; sourcePath: string }> = [];
  public openedFiles: Array<{ path: string; leafMode?: boolean | string }> = [];
  public hoverLinkEvents: Array<{
    event: MouseEvent;
    source: string;
    hoverParent: any;
    targetEl: HTMLElement;
    linktext: string;
    sourcePath: string;
  }> = [];

  getLeaf(newLeaf?: boolean | "tab" | "split" | "window"): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf((file) => {
      this.openedFiles.push({ path: file.path, leafMode: newLeaf });
    });
    this.leaves.push(leaf);
    return leaf;
  }

  getLeavesOfType(viewType: string): WorkspaceLeaf[] {
    return this.leaves.filter((l) => l.view?.getViewType() === viewType);
  }

  revealLeaf(_leaf: WorkspaceLeaf): void {}

  async openLinkText(linktext: string, sourcePath: string): Promise<void> {
    this.openedLinks.push({ linktext, sourcePath });
  }

  getActiveFile(): TFile | null {
    return null;
  }

  onLayoutReady(cb: () => void): void {
    cb();
  }

  on(name: string, cb: EventHandler): EventRef {
    return this.events.on(name, cb);
  }

  trigger(name: string, ...args: any[]): void {
    if (name === "hover-link" && args[0]) {
      this.hoverLinkEvents.push(args[0]);
    }
    this.events.trigger(name, ...args);
  }
}

export class Component {
  private cleanups: Array<() => void> = [];
  private children: Component[] = [];
  private loaded = false;

  load(): void {
    this.loaded = true;
    for (const child of this.children) {
      child.load();
    }
  }

  unload(): void {
    this.loaded = false;
    for (const child of [...this.children]) {
      child.unload();
    }
    for (const fn of this.cleanups.splice(0)) {
      fn();
    }
  }

  register(cb: () => void): void {
    this.cleanups.push(cb);
  }

  registerEvent(ref: EventRef): void {
    this.cleanups.push(() => ref?.off?.());
  }

  registerDomEvent(
    el: HTMLElement | Window | Document,
    type: string,
    callback: (ev: any) => any,
    options?: boolean | AddEventListenerOptions
  ): void {
    el.addEventListener(type, callback, options);
    this.cleanups.push(() => el.removeEventListener(type, callback, options));
  }

  addChild<T extends Component>(component: T): T {
    this.children.push(component);
    if (this.loaded) component.load();
    return component;
  }

  removeChild<T extends Component>(component: T): T {
    const idx = this.children.indexOf(component);
    if (idx >= 0) this.children.splice(idx, 1);
    return component;
  }
}

export class HoverPopover extends Component {
  hoverEl: HTMLElement = document.createElement("div");
  constructor(_parent: any, _targetEl: HTMLElement | null, _waitTime?: number) {
    super();
  }
  hide(): void {}
}

export class View extends Component {
  app: any;
  leaf!: WorkspaceLeaf;
  containerEl: HTMLElement = document.createElement("div");
  icon = "document";

  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  getIcon(): string {
    return this.icon;
  }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
  getState(): Record<string, unknown> {
    return {};
  }
  async setState(_state: unknown, _result: any): Promise<void> {}
}

export class ItemView extends View {
  contentEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.containerEl = document.createElement("div");
    this.containerEl.createDiv("view-header");
    this.contentEl = this.containerEl.createDiv("view-content");
  }
}

export class WorkspaceLeaf {
  view!: View;
  private onOpenFile?: (file: TFile) => void;

  constructor(onOpenFile?: (file: TFile) => void) {
    this.onOpenFile = onOpenFile;
  }

  async setViewState(): Promise<void> {}
  async openFile(file: TFile): Promise<void> {
    this.onOpenFile?.(file);
  }
}

export class Plugin extends Component {
  app: any;
  manifest: any;
  private storage: any = null;
  private views = new Map<string, (leaf: WorkspaceLeaf) => View>();
  public hoverLinkSources = new Map<string, { display: string; defaultMod: boolean }>();

  constructor(app: any, manifest: any) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<any> {
    return this.storage ? JSON.parse(JSON.stringify(this.storage)) : null;
  }

  async saveData(data: any): Promise<void> {
    this.storage = JSON.parse(JSON.stringify(data));
  }

  registerView(type: string, creator: (leaf: WorkspaceLeaf) => View): void {
    this.views.set(type, creator);
  }

  registerHoverLinkSource(source: string, info: { display: string; defaultMod: boolean }): void {
    this.hoverLinkSources.set(source, info);
  }

  createViewInstance(type: string, leaf: WorkspaceLeaf): View | null {
    const creator = this.views.get(type);
    if (!creator) return null;
    const view = creator(leaf);
    view.app = this.app;
    leaf.view = view;
    return view;
  }

  addRibbonIcon(): HTMLElement {
    return document.createElement("div");
  }
  addCommand(cmd: any): any {
    return cmd;
  }
  addSettingTab(): void {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl = document.createElement("div");
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
  hide(): void {}
}

export class Setting {
  constructor(_el: HTMLElement) {}
  setName() { return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
}

export class Notice {
  constructor(_msg: string) {}
}

export const Platform = {
  isMobile: false,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isDesktop: true,
};

export function setIcon(parent: HTMLElement, iconId: string): void {
  if (iconId === "book-open") {
    parent.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';
  }
}

export class MarkdownRenderer {
  static async render(
    app: any,
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    _component: Component
  ): Promise<void> {
    // Transform Obsidian embeds ![[Target]] and internal wikilinks [[Target|Alias]] before passing to marked
    const withEmbeds = markdown.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
      const target = inner.split("|")[0].trim();
      const targetFile = app?.metadataCache?.getFirstLinkpathDest?.(target, sourcePath);
      const embedTitle = targetFile ? targetFile.basename : target;
      return `<div class="internal-embed is-loaded" src="${target}"><div class="markdown-embed"><div class="markdown-embed-title">${embedTitle}</div><p class="nb-embed-note">Embedded from [[${target}]]</p></div></div>`;
    });

    const withLinks = withEmbeds.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
      const [rawTarget, rawAlias] = inner.split("|");
      const href = rawTarget.trim();
      const label = (rawAlias || rawTarget).trim();
      return `<a class="internal-link" data-href="${href}" href="${href}">${label}</a>`;
    });

    const html = await marked.parse(withLinks, { async: true });
    el.innerHTML = html;
  }
}

export function createMockApp(seeds: MockNoteSeed[], vaultName = "Fieldnotes") {
  const vault = new MockVault(vaultName);
  for (const seed of seeds) {
    vault.addSeed(seed);
  }
  const metadataCache = new MockMetadataCache(vault);
  const workspace = new MockWorkspace();
  return { vault, metadataCache, workspace };
}
