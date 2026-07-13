/**
 * Panel framework (roadmap M18; doc 05 §7 panel taxonomy). Deliberately
 * tiny: a PanelHost owns a dock (right side) and a toolbar; panels register
 * with an id/title/icon and get a body element plus open/close/toggle. No
 * virtual DOM — panels re-render their body on store changes (villages are
 * small; legibility beats cleverness until the M42 UX pass).
 */

export interface Panel {
  readonly id: string;
  readonly body: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

export class PanelHost {
  private readonly panels = new Map<string, Panel>();

  constructor(
    private readonly dock: HTMLElement,
    private readonly toolbar: HTMLElement,
  ) {}

  register(id: string, title: string, icon: string): Panel {
    if (this.panels.has(id)) throw new Error(`panel '${id}' already registered`);
    const root = document.createElement('section');
    root.className = 'panel';
    root.dataset['panel'] = id;
    root.setAttribute('role', 'region'); // M42 accessibility: named landmark per panel
    root.setAttribute('aria-label', title);
    const heading = document.createElement('header');
    const label = document.createElement('span');
    label.textContent = title;
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.title = 'close';
    closeButton.setAttribute('aria-label', `Close ${title} panel`);
    heading.append(label, closeButton);
    const body = document.createElement('div');
    body.className = 'panel-body';
    root.append(heading, body);
    this.dock.append(root);

    const toolbarButton = document.createElement('button');
    toolbarButton.textContent = icon;
    toolbarButton.title = title;
    toolbarButton.setAttribute('aria-label', title); // icon-only glyph has no accessible name otherwise
    toolbarButton.setAttribute('aria-pressed', 'false');
    this.toolbar.append(toolbarButton);

    const panel: Panel = {
      id,
      body,
      open: () => {
        root.classList.add('open');
        toolbarButton.classList.add('active');
        toolbarButton.setAttribute('aria-pressed', 'true');
      },
      close: () => {
        root.classList.remove('open');
        toolbarButton.classList.remove('active');
        toolbarButton.setAttribute('aria-pressed', 'false');
      },
      toggle: () => (root.classList.contains('open') ? panel.close() : panel.open()),
      isOpen: () => root.classList.contains('open'),
    };
    closeButton.addEventListener('click', () => panel.close());
    toolbarButton.addEventListener('click', () => panel.toggle());
    this.panels.set(id, panel);
    return panel;
  }

  get(id: string): Panel | undefined {
    return this.panels.get(id);
  }
}
