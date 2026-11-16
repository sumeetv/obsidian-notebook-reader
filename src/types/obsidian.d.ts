export interface App {
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
}

export interface EventRef {
  readonly id?: string;
}

export interface FileStats {
  ctime: number;
  mtime: number;
  size: number;
}

export abstract class TAbstractFile {
  vault!: Vault;
  path!: string;
  name!: string;
  parent!: TFolder | null;
}

export class TFile extends TAbstractFile {
  stat!: FileStats;
  basename!: string;
  extension!: string;
}

export class TFolder extends TAbstractFile {
  children!: TAbstractFile[];
  isRoot(): boolean {
    return this.path === "" || this.path === "/";
  }
}

export interface FrontMatterCache {
  [key: string]: unknown;
}

export interface Pos {
  start: { line: number; col: number; offset: number };
  end: { line: number; col: number; offset: number };
}

export interface HeadingCache {
  heading: string;
  level: number;
  position: Pos;
}

export interface CachedMetadata {
  frontmatter?: FrontMatterCache;
  frontmatterPosition?: Pos;
  headings?: HeadingCache[];
}

export interface MetadataCache {
  getFileCache(file: TFile): CachedMetadata | null;
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
  on(name: "changed" | "resolved", callback: (...args: any[]) => any): EventRef;
}

export interface Vault {
  getMarkdownFiles(): TFile[];
  getAllLoadedFiles(): TAbstractFile[];
  getAbstractFileByPath(path: string): TAbstractFile | null;
  read(file: TFile): Promise<string>;
  cachedRead(file: TFile): Promise<string>;
  on(name: "create" | "modify" | "delete" | "rename", callback: (...args: any[]) => any): EventRef;
  getName(): string;
}

export interface Workspace {
  getLeaf(newLeaf?: boolean | "tab" | "split" | "window"): WorkspaceLeaf;
  getLeavesOfType(viewType: string): WorkspaceLeaf[];
  revealLeaf(leaf: WorkspaceLeaf): void;
  openLinkText(linktext: string, sourcePath: string, newLeaf?: boolean): Promise<void>;
  getActiveFile(): TFile | null;
  onLayoutReady(callback: () => any): void;
  trigger(name: string, ...data: any[]): void;
}

export interface ViewState {
  type: string;
  state?: Record<string, unknown>;
  active?: boolean;
}

export interface ViewStateResult {
  history?: boolean;
}

export class WorkspaceLeaf {
  view!: View;
  setViewState(viewState: ViewState, pushHistory?: boolean): Promise<void> {
    return Promise.resolve();
  }
  openFile(file: TFile): Promise<void> {
    return Promise.resolve();
  }
}

export class Component {
  load(): void {}
  unload(): void {}
  register(cb: () => any): void {}
  registerEvent(eventRef: EventRef): void {}
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Window | Document,
    type: K,
    callback: (ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  registerDomEvent(
    el: HTMLElement | Window | Document,
    type: string,
    callback: (ev: Event) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  registerDomEvent(
    _el: HTMLElement | Window | Document,
    _type: string,
    _callback: (ev: any) => any,
    _options?: boolean | AddEventListenerOptions
  ): void {}
  addChild<T extends Component>(component: T): T {
    return component;
  }
  removeChild<T extends Component>(component: T): T {
    return component;
  }
}

export interface HoverLinkSource {
  display: string;
  defaultMod: boolean;
}

export interface HoverParent {
  hoverPopover: HoverPopover | null;
}

export class HoverPopover extends Component {
  hoverEl!: HTMLElement;
  constructor(_parent: HoverParent, _targetEl: HTMLElement | null, _waitTime?: number) {
    super();
  }
  hide(): void {}
}

export abstract class View extends Component {
  app!: App;
  leaf!: WorkspaceLeaf;
  containerEl!: HTMLElement;
  icon = "document";

  abstract getViewType(): string;
  abstract getDisplayText(): string;

  getIcon(): string {
    return this.icon;
  }

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}

  getState(): Record<string, unknown> {
    return {};
  }

  async setState(_state: unknown, _result: ViewStateResult): Promise<void> {}
}

export abstract class ItemView extends View {
  contentEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
  }
}

export type ViewCreator = (leaf: WorkspaceLeaf) => View;

export interface Command {
  id: string;
  name: string;
  icon?: string;
  callback?: () => any;
  checkCallback?: (checking: boolean) => boolean | void;
}

export class Plugin extends Component {
  app: App;
  manifest: PluginManifest;

  constructor(app: App, manifest: PluginManifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  onload(): Promise<void> | void {}
  onunload(): void {}
  async loadData(): Promise<any> {
    return null;
  }
  async saveData(_data: any): Promise<void> {}
  registerView(_type: string, _viewCreator: ViewCreator): void {}
  registerHoverLinkSource(_source: string, _info: HoverLinkSource): void {}
  addRibbonIcon(_icon: string, _title: string, _callback: (evt: MouseEvent) => any): HTMLElement {
    return document.createElement("div");
  }
  addCommand(command: Command): Command {
    return command;
  }
  addSettingTab(_settingTab: PluginSettingTab): void {}
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl!: HTMLElement;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {}
  hide(): void {}
}

export class ToggleComponent {
  setValue(_on: boolean): this {
    return this;
  }
  onChange(_callback: (value: boolean) => any): this {
    return this;
  }
}

export class DropdownComponent {
  addOption(_value: string, _display: string): this {
    return this;
  }
  setValue(_value: string): this {
    return this;
  }
  onChange(_callback: (value: string) => any): this {
    return this;
  }
}

export class ButtonComponent {
  setButtonText(_name: string): this {
    return this;
  }
  setWarning(): this {
    return this;
  }
  onClick(_cb: (evt: MouseEvent) => any): this {
    return this;
  }
}

export class Setting {
  settingEl!: HTMLElement;
  infoEl!: HTMLElement;
  nameEl!: HTMLElement;
  descEl!: HTMLElement;
  controlEl!: HTMLElement;

  constructor(_containerEl: HTMLElement) {}
  setName(_name: string): this {
    return this;
  }
  setDesc(_desc: string): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  addToggle(_cb: (component: ToggleComponent) => any): this {
    return this;
  }
  addDropdown(_cb: (component: DropdownComponent) => any): this {
    return this;
  }
  addButton(_cb: (component: ButtonComponent) => any): this {
    return this;
  }
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

export class MarkdownRenderer {
  static render(
    _app: App,
    _markdown: string,
    _el: HTMLElement,
    _sourcePath: string,
    _component: Component
  ): Promise<void> {
    return Promise.resolve();
  }
}

export const Platform = {
  isMobile: false,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isDesktop: true,
};

export function setIcon(_parent: HTMLElement, _iconId: string): void {}

export interface DomElementInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  type?: string;
  href?: string;
  value?: string;
}

declare global {
  interface HTMLElement {
    empty(): void;
    addClass(...classes: string[]): void;
    removeClass(...classes: string[]): void;
    toggleClass(classes: string | string[], value: boolean): void;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElementTagNameMap[K]) => void
    ): HTMLElementTagNameMap[K];
    createDiv(
      o?: DomElementInfo | string,
      callback?: (el: HTMLDivElement) => void
    ): HTMLDivElement;
    createSpan(
      o?: DomElementInfo | string,
      callback?: (el: HTMLSpanElement) => void
    ): HTMLSpanElement;
    setAttr(qualifiedName: string, value: string | number | boolean | null): void;
    setText(val: string): void;
  }
}
