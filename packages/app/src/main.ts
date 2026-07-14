/**
 * Browser entry (roadmap M6): boots the sim worker, mirrors snapshots, drives
 * the PixiJS renderer at display rate with interpolation, and provides the
 * first HUD (fps / tick / calendar / speed controls) plus pan/zoom input.
 *
 * Layout of responsibilities (TDD §1): everything here is presentation — the
 * worker owns truth; this file only sends commands/pump and draws snapshots.
 */
import type { AvailableMod, BuildingRec, CampaignSettings, CatalogEvent, EntityRec, FromSimMessage, ModReport, PlayerPanels, TerrainSnapshot, ToSimMessage } from '@crowns/protocol';
import { PixiRenderer, TerrainView } from '@crowns/render';
import { BASE_TICKS_PER_SECOND, TIER2_REQUIREMENTS, type Speed } from '@crowns/sim';
import { NotificationQueue, PanelHost, TooltipController, UIStore, type Panel } from '@crowns/ui';
import { AudioDirector } from '@crowns/audio';
import { Locale, localeKey } from '@crowns/core';
import { EN_LOCALE } from './locale/en.js';
import { EN_XA_LOCALE } from './locale/en-XA.js';
import { DEFAULT_CAMPAIGN_SETTINGS } from './scenarios.js';

// M47.6 (doc 12 R1): seeds are player-chosen on the new-game screen now. These two
// remain the pinned QUICKSTART seeds — what `?quickstart=` boots is what CI verifies
// (golden scenarios 'terra-demo'-adjacent wanderers seed, and 'campaign-demo').
const TERRA_QUICKSTART_SEED = 0x5eed1;
const CAMPAIGN_QUICKSTART_SEED = 0xca47a1;

// ---------- sandbox mode (M40; GDD §17) ----------
// ?sandbox=1 pre-checks the new-game screen's sandbox toggle (and applies to
// quickstarts); ?ironman=1 additionally flags the save.
const bootParams = new URLSearchParams(window.location.search);
const SANDBOX = bootParams.has('sandbox');
const IRONMAN = SANDBOX && bootParams.has('ironman');
// roadmap M44 (doc 10 §6): ?locale=en-XA loads the pseudo-locale for CI screenshot diffing —
// content text resolves server-side (simPort.ts via the 'init' message below); UI-chrome text
// resolves here, picking between the two curated locale tables (locale/en.ts, locale/en-XA.ts).
const LOCALE = bootParams.get('locale') ?? 'en';
const appLocale = new Locale(LOCALE === 'en-XA' ? EN_XA_LOCALE : EN_LOCALE, LOCALE);

// ---------- worker ----------
const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
const send = (message: ToSimMessage): void => worker.postMessage(message);

// ---------- HUD ----------
const hud = {
  fps: document.getElementById('fps') as HTMLElement,
  tick: document.getElementById('tick') as HTMLElement,
  date: document.getElementById('date') as HTMLElement,
  entities: document.getElementById('entities') as HTMLElement,
  status: document.getElementById('status') as HTMLElement,
  villages: document.getElementById('village-stats') as HTMLElement,
};
const villageStats = new Map<number, { name: string; population: number; food: number; happiness: number; goods?: Record<string, number> }>();

/** One fixed-column chip per village (built via DOM, not string concat, so names
 * never need escaping and tabular-numeral values sit in stable slots). */
function renderVillageChips(): void {
  const host = hud.villages;
  host.replaceChildren();
  const field = (label: string, value: string | number): HTMLElement => {
    const span = document.createElement('span');
    span.className = 'f';
    const b = document.createElement('b');
    b.textContent = String(value);
    span.append(`${label} `, b);
    return span;
  };
  for (const s of villageStats.values()) {
    const chip = document.createElement('span');
    chip.className = 'vchip';
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = s.name;
    chip.append(name, field('pop', s.population), field('food', s.food), field('joy', s.happiness));
    for (const [good, amount] of Object.entries(s.goods ?? {})) chip.append(field(good, amount));
    host.append(chip);
  }
}
let speed: Speed = 1;
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-speed]'));
const setSpeed = (next: Speed): void => {
  speed = next;
  send({ kind: 'setSpeed', speed: next });
  for (const b of speedButtons) {
    const isNext = Number(b.dataset['speed']) === next;
    b.classList.toggle('active', isNext);
    b.setAttribute('aria-pressed', String(isNext));
  }
};
for (const b of speedButtons) b.addEventListener('click', () => setSpeed(Number(b.dataset['speed']) as Speed));

// ---------- save/load (M17): worker owns serialization + IndexedDB ----------
(document.getElementById('btn-save') as HTMLButtonElement).addEventListener('click', () => {
  send({ kind: 'save', slot: 'manual' });
});
(document.getElementById('btn-load') as HTMLButtonElement).addEventListener('click', () => {
  send({ kind: 'load', slot: 'manual' });
});
(document.getElementById('btn-export') as HTMLButtonElement).addEventListener('click', () => {
  send({ kind: 'exportSave' });
});
// ---------- audio (M41; doc 05 §8, GDD-adjacent doc 10 §3) ----------
// AudioContext construction itself needs no gesture (browsers just start it
// 'suspended'); only unlocking playback does — so the director is built
// eagerly and fed the catalog/events regardless, and `btn-audio`'s click is
// solely the gesture that unlocks + then doubles as mute toggle.
const audioDirector = new AudioDirector();
let audioEnabled = false;
let audioMuted = false;
const audioButton = document.getElementById('btn-audio') as HTMLButtonElement;
audioButton.addEventListener('click', () => {
  if (!audioEnabled) {
    void audioDirector.enable().then(() => {
      audioEnabled = true;
      audioButton.textContent = '🔊';
      audioButton.title = 'Mute audio';
      audioButton.setAttribute('aria-label', 'Mute audio');
      audioButton.setAttribute('aria-pressed', 'true');
    });
    return;
  }
  audioMuted = !audioMuted;
  audioDirector.setMuted(audioMuted);
  audioButton.textContent = audioMuted ? '🔇' : '🔊';
  audioButton.title = audioMuted ? 'Unmute audio' : 'Mute audio';
  audioButton.setAttribute('aria-label', audioMuted ? 'Unmute audio' : 'Mute audio');
  audioButton.setAttribute('aria-pressed', String(!audioMuted));
});

const importFile = document.getElementById('import-file') as HTMLInputElement;
(document.getElementById('btn-import') as HTMLButtonElement).addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  if (file === undefined) return;
  void file.text().then((payload) => send({ kind: 'importSave', payload }));
  importFile.value = '';
});

// ---------- player UI (M18): panel framework, store, notifications ----------
const PLAYER_ISSUER = 1;
const command = (type: string, payload: unknown): void =>
  send({ kind: 'submit', drafts: [{ type, issuer: PLAYER_ISSUER, payload }] });

// ---------- event-choice dialog (M43) — the first in this app; doc 05 §7's "Event dialogs" ----------
// A small FIFO queue: `event.fired` (live) and `pendingEvents` (recovered after a reload — a save
// mid-tutorial must not silently drop an unanswered step) both feed it the same way.
let eventCatalog = new Map<string, CatalogEvent>();
let playerKingdomId: number | null = null; // M47.6: our kingdom's entity id (snapshotFull)
const eventQueue: { eventId: string; choiceIds: readonly string[] }[] = [];
const eventDialog = {
  backdrop: document.getElementById('event-dialog-backdrop') as HTMLElement,
  title: document.getElementById('event-dialog-title') as HTMLElement,
  body: document.getElementById('event-dialog-body') as HTMLElement,
  choices: document.getElementById('event-dialog-choices') as HTMLElement,
};

function showNextEventDialog(): void {
  if (!eventDialog.backdrop.hidden) return; // one at a time — already showing something
  const next = eventQueue[0];
  if (next === undefined) return;
  const def = eventCatalog.get(next.eventId);
  if (def === undefined) {
    eventQueue.shift(); // unknown id (mod removed after a save) — drop, don't wedge the queue
    showNextEventDialog();
    return;
  }
  eventDialog.title.textContent = def.title;
  eventDialog.body.textContent = def.body;
  eventDialog.choices.replaceChildren();
  let firstButton: HTMLButtonElement | null = null;
  for (const choiceId of next.choiceIds) {
    const choice = def.choices.find((c) => c.id === choiceId);
    if (choice === undefined) continue;
    const button = document.createElement('button');
    button.append(choice.text);
    // every option states its outcome (from the event def's effects): what the player gains or
    // suffers, signed and colour-coded — a no-effect option (e.g. "Decline") says so explicitly
    const summary = document.createElement('span');
    summary.className = 'choice-outcomes';
    if (choice.outcomes !== undefined && choice.outcomes.length > 0) {
      for (const outcome of choice.outcomes) {
        const chip = document.createElement('span');
        chip.className = `outcome ${outcome.kind}`;
        chip.textContent = outcome.label;
        summary.append(chip);
      }
    } else {
      const chip = document.createElement('span');
      chip.className = 'outcome neutral';
      chip.textContent = 'No effect';
      summary.append(chip);
    }
    button.append(summary);
    button.addEventListener('click', () => {
      command('event.choose', { eventId: next.eventId, choiceId: choice.id });
      eventQueue.shift();
      eventDialog.backdrop.hidden = true;
      showNextEventDialog();
    });
    eventDialog.choices.append(button);
    firstButton ??= button;
  }
  eventDialog.backdrop.hidden = false;
  firstButton?.focus(); // keyboard-complete from the moment it appears (M42 precedent)
  setSpeed(0); // GDD §1's urgent-pause tier, same "never rushed" pillar (doc 01 §3) — a dialog is
  // meant to be read, not ticked past; the player resumes deliberately when ready
}

const store = new UIStore();
const notifications = new NotificationQueue();
new TooltipController(); // M42: replaces native title= everywhere, keyboard + hover — self-registering
const panels = new PanelHost(
  document.getElementById('panel-dock') as HTMLElement,
  document.getElementById('ui-toolbar') as HTMLElement,
);
const villagePanel = panels.register('village', 'Village', '🏘');
const buildPanel = panels.register('build', 'Build', '🔨');
const buildingPanel = panels.register('building', 'Building', '🏛');
const kingdomPanel = panels.register('kingdom', 'Kingdom', '👑');
// M47.7 (doc 12 R1): the four "dark systems" get player surfaces — no action below
// requires the debug injector. Campaign-only; the village sandbox shows a hint instead.
const diplomacyPanel = panels.register('diplomacy', 'Diplomacy', '🤝');
const militaryPanel = panels.register('military', 'Military', '⚔');
const researchPanel = panels.register('research', 'Research', '📜');
const victoryPanel = panels.register('victory', 'Victory', '🏆');
const modsPanel = panels.register('mods', 'Mods', '🧩');
const helpPanel = panels.register('help', 'Keybinds', '⌨');
villagePanel.open();

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
};

// ---------- tooltips (M42; doc 01 §3 "legible depth" — no hidden modifiers) ----------
/** Attach a keyboard+hover tooltip (TooltipController, event-delegated — no per-element wiring). */
const tip = <T extends HTMLElement>(node: T, text: string): T => {
  node.dataset['tooltip'] = text;
  if (node.tabIndex < 0 && node.tagName === 'DIV') node.tabIndex = 0; // plain rows need a tab stop to be reachable
  return node;
};

const MODIFIER_TARGET_LABELS: Record<string, string> = {
  'village.happinessDrift': 'happiness drift',
  'village.productionEfficiency': 'production efficiency',
  'village.spoilage': 'spoilage rate',
  'kingdom.taxYield': 'tax yield',
  'kingdom.researchYield': 'research yield',
};
function describeModifier(m: { target: string; op: 'add' | 'mul'; value: number }): string {
  const label = MODIFIER_TARGET_LABELS[m.target] ?? m.target;
  const amount = m.op === 'mul' ? `×${m.value.toFixed(2)}` : `${m.value >= 0 ? '+' : ''}${m.value}`;
  return `${label} ${amount}`;
}

function renderVillagePanel(): void {
  const body = villagePanel.body;
  body.replaceChildren();
  const v = store.selectedVillage();
  if (v === null) {
    body.append(el('div', 'No village yet.', 'hint'));
    return;
  }
  body.append(tip(
    el('div', `${v.name} — tier ${v.tier}`, 'row'),
    'Tier gates which buildings can be placed and widens the build radius.',
  ));
  body.append(tip(
    el('div', `pop ${v.population} · joy ${v.happiness} · food ${v.food}`, 'row'),
    'Joy (happiness) drives tax yield and population growth — low joy risks unrest.\n' +
      'Food must stay positive daily, or the village starves.',
  ));
  const goods = Object.entries(v.goods).map(([name, amount]) => `${name} ${String(amount)}`).join(' · ');
  if (goods.length > 0) {
    body.append(tip(el('div', goods, 'row'), 'Stockpiled resources — spent on construction, upkeep, and edicts.'));
  }

  const taxRow = el('div', undefined, 'row');
  taxRow.append(el('span', 'tax'));
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Tax rate');
  tip(select, 'Higher rates raise gold income but bleed happiness daily — punitive rates are self-defeating (GDD §2).');
  ['none', 'low', 'normal', 'high', 'punitive'].forEach((name, rate) => {
    const option = document.createElement('option');
    option.value = String(rate);
    option.textContent = name;
    option.selected = rate === v.taxRate;
    select.append(option);
  });
  select.addEventListener('change', () => command('village.setTaxRate', { villageId: v.id, rate: Number(select.value) }));
  taxRow.append(select);
  const upgrade = document.createElement('button');
  upgrade.textContent = appLocale.resolve(localeKey('ui.village.upgrade-tier'));
  if (v.tier === 1) {
    tip(
      upgrade,
      `Tier 2 needs: pop ${TIER2_REQUIREMENTS.population} (have ${v.population}) · ` +
        `${TIER2_REQUIREMENTS.distinctBuildings} distinct completed buildings · ` +
        `${Object.entries(TIER2_REQUIREMENTS.materials).map(([id, amt]) => `${amt} ${id.split('.').pop()}`).join(' + ')} · ` +
        `happiness ${TIER2_REQUIREMENTS.happiness} (have ${v.happiness})`,
    );
  }
  upgrade.addEventListener('click', () => command('village.upgrade', { villageId: v.id }));
  taxRow.append(upgrade);
  body.append(taxRow);

  if (store.state.villages.size > 1) {
    const pick = el('div', undefined, 'row');
    for (const other of [...store.state.villages.values()].sort((a, b) => a.id - b.id)) {
      const b = document.createElement('button');
      b.textContent = other.name;
      if (other.id === v.id) b.classList.add('active');
      b.addEventListener('click', () => store.selectVillage(other.id));
      pick.append(b);
    }
    body.append(pick);
  }
}

function renderBuildPalette(): void {
  const body = buildPanel.body;
  body.replaceChildren();
  const catalog = store.state.catalog;
  const v = store.selectedVillage();
  if (catalog === null) {
    body.append(el('div', 'Waiting for the catalog…', 'hint'));
    return;
  }
  body.append(el('div', 'Pick a building, then click map tiles to place copies. Right-click or Esc exits.', 'hint'));
  for (const building of catalog.buildings) {
    const row = el('div', undefined, 'row');
    const b = document.createElement('button');
    const cost = building.cost.map(([n, a]) => `${a} ${n.toLowerCase()}`).join(', ');
    b.textContent = `${building.name} — ${cost}`;
    const locked = building.tier > (v?.tier ?? 1);
    const description = `${building.category} · footprint ${building.w}×${building.h} · requires tier ${building.tier}` +
      (locked ? `\nlocked — current village is tier ${v?.tier ?? 1}` : '');
    tip(b, description);
    // aria-disabled (not the native `disabled` attribute) keeps the button focusable/hoverable
    // so its "why locked" tooltip is actually reachable — a real `disabled` button suppresses
    // both mouse and focus events in most browsers, which would hide the explanation entirely.
    if (locked) b.setAttribute('aria-disabled', 'true');
    if (store.state.armedBuild === building.id) b.classList.add('armed');
    b.addEventListener('click', () => {
      if (locked) return;
      store.armBuild(store.state.armedBuild === building.id ? null : building.id);
    });
    row.append(b);
    body.append(row);
  }
}

// ---------- building inspector + demolish (click a building to act on it) ----------
let selectedBuildingId: number | null = null;
let demolishArmed = false; // two-click confirm, so a stray click never razes a building

/** True if this building sits on its village's centre tile — the sim refuses to
 * demolish a village centre, so the UI disables it up-front rather than by trial. */
function isVillageCenter(rec: BuildingRec): boolean {
  const v = [...store.state.villages.values()].find((x) => x.id === rec.village);
  if (v === undefined) return false;
  return v.cx >= rec.x && v.cx < rec.x + rec.w && v.cy >= rec.y && v.cy < rec.y + rec.h;
}

function selectBuilding(id: number | null): void {
  selectedBuildingId = id;
  demolishArmed = false;
  renderBuildingPanel();
}

function renderBuildingPanel(): void {
  const body = buildingPanel.body;
  body.replaceChildren();
  const rec = selectedBuildingId !== null && renderer !== null ? renderer.buildingRec(selectedBuildingId) : null;
  if (rec === null) {
    body.append(el('div', 'Click a building on the map to inspect it.', 'hint'));
    demolishArmed = false;
    return;
  }
  const village = [...store.state.villages.values()].find((v) => v.id === rec.village);
  body.append(el('div', rec.name, 'row'));
  body.append(tip(
    el('div', `${rec.category} · ${rec.w}×${rec.h}${village !== undefined ? ` · ${village.name}` : ''}`, 'row hint'),
    'Category and footprint. Buildings feed their village\'s economy while they stand.',
  ));
  if (rec.progress < 1) {
    body.append(el('div', `under construction — ${Math.round(rec.progress * 100)}%`, 'row hint'));
  }

  const actions = el('div', undefined, 'row');
  if (isVillageCenter(rec)) {
    const disabled = tip(el('button', '🧹 Demolish'), 'A village centre cannot be demolished — it anchors the settlement.');
    disabled.setAttribute('aria-disabled', 'true');
    actions.append(disabled);
  } else {
    const demolish = document.createElement('button');
    demolish.textContent = demolishArmed ? '🧹 Confirm — raze it?' : '🧹 Demolish';
    if (demolishArmed) demolish.classList.add('armed');
    tip(demolish, 'Tears the building down and frees its tiles. No refund. Click once to arm, again to confirm.');
    demolish.addEventListener('click', () => {
      if (!demolishArmed) {
        demolishArmed = true;
        renderBuildingPanel();
        return;
      }
      command('village.demolish', { buildingId: rec.id });
      demolishArmed = false;
      // the building despawns on the next snapshot delta; the panel re-renders then
      // (or shows the sim's "cannot demolish a village centre" refusal as a toast).
    });
    actions.append(demolish);
  }
  if (village !== undefined) {
    const toVillage = el('button', '🏘 Village');
    tip(toVillage, 'Open this building\'s village panel.');
    toVillage.addEventListener('click', () => {
      store.selectVillage(rec.village);
      villagePanel.open();
    });
    actions.append(toVillage);
  }
  body.append(actions);
}

// ---------- building footprint preview (placement mode) ----------
// While a building is armed in the Build panel, an outline of its footprint follows
// the cursor — green if the sim's placement rulebook accepts the tile, red if not.
let lastPointer: { sx: number; sy: number } | null = null;
let previewSeq = 0; // monotonic; the client ignores buildPreview replies older than this
let previewValid = true; // last authoritative verdict, shown instantly while the next reply is in flight
let lastPreviewKey: string | null = null; // `${def}:${x}:${y}` — dedupes per-pixel moves down to per-tile queries

function updateFootprintPreview(): void {
  const armed = store.state.armedBuild;
  if (renderer === null || armed === null || lastPointer === null) {
    renderer?.hideFootprintPreview();
    lastPreviewKey = null;
    return;
  }
  const def = store.state.catalog?.buildings.find((b) => b.id === armed);
  if (def === undefined) {
    renderer.hideFootprintPreview();
    lastPreviewKey = null;
    return;
  }
  const t = renderer.tileAt(lastPointer.sx, lastPointer.sy);
  const key = `${armed}:${t.x}:${t.y}`;
  if (key === lastPreviewKey) return; // same def + tile → the outstanding query still stands
  lastPreviewKey = key;
  // draw immediately at the cursor tile (real-time position) using the last known verdict;
  // the authoritative colour arrives via the buildPreview reply below, usually within a frame
  renderer.showFootprintPreview(t.x, t.y, def.w, def.h, previewValid);
  const target = store.villageNear(t.x, t.y);
  send({ kind: 'previewBuild', seq: ++previewSeq, villageId: target?.id ?? -1, def: armed, x: t.x, y: t.y });
}

function renderKingdomPanel(): void {
  const body = kingdomPanel.body;
  body.replaceChildren();
  const k = store.state.kingdom;
  body.append(tip(
    el('div', k === null ? 'Awaiting the first roll-up…' : `⛁ ${k.treasury.toFixed(0)} · net ${k.net >= 0 ? '+' : ''}${k.net.toFixed(1)}/day`, 'row'),
    'Net = today\'s tax income minus edict upkeep and advisor salaries — every entry is in the Ledger below.',
  ));
  const catalog = store.state.catalog;
  if (catalog === null) return;
  for (const edict of catalog.edicts) {
    const active = store.state.activeEdicts.has(edict.id);
    const row = el('div', undefined, 'row');
    const label = el('span', `${edict.name} (${edict.upkeep}/day)${active ? ' — active' : ''}`);
    const modifierText = edict.modifiers.length > 0 ? edict.modifiers.map(describeModifier).join('\n') : 'no ongoing modifiers';
    tip(label, `${modifierText}\nupkeep: ${edict.upkeep} gold/day`);
    row.append(label);
    const b = document.createElement('button');
    b.textContent = appLocale.resolve(localeKey(active ? 'ui.kingdom.edict.repeal' : 'ui.kingdom.edict.enact'));
    if (active) b.classList.add('active');
    b.addEventListener('click', () => command(active ? 'kingdom.repealEdict' : 'kingdom.enactEdict', { edict: edict.id }));
    row.append(b);
    body.append(row);
  }
  renderLedger(body);
}

const LEDGER_KIND_LABELS: Record<string, string> = {
  tax: appLocale.resolve(localeKey('ui.ledger.kind.tax')),
  'edict-upkeep': appLocale.resolve(localeKey('ui.ledger.kind.edict-upkeep')),
  'advisor-salary': appLocale.resolve(localeKey('ui.ledger.kind.advisor-salary')),
  'unit-recruit': appLocale.resolve(localeKey('ui.ledger.kind.unit-recruit')),
  'unit-upkeep': appLocale.resolve(localeKey('ui.ledger.kind.unit-upkeep')),
};

/** Itemized ledger (M42; GDD §2 "Read the Ledger: full income/expense breakdown"). */
function renderLedger(container: HTMLElement): void {
  container.append(el('h3', appLocale.resolve(localeKey('ui.kingdom.ledger.heading')), 'ledger-heading'));
  const rows = store.state.ledger;
  if (rows.length === 0) {
    container.append(el('div', 'No entries yet.', 'hint'));
    return;
  }
  const list = document.createElement('div');
  list.className = 'ledger-list';
  list.setAttribute('role', 'log');
  list.setAttribute('aria-label', 'Kingdom ledger, newest first');
  for (const row of [...rows].reverse().slice(0, 30)) {
    const sign = row.amount >= 0 ? '+' : '−';
    const line = el(
      'div',
      `${sign}${Math.abs(row.amount).toFixed(1)} · ${LEDGER_KIND_LABELS[row.kind] ?? row.kind} · ${row.detail}`,
      `ledger-row ${row.amount >= 0 ? 'income' : 'expense'}`,
    );
    list.append(line);
  }
  container.append(list);
}

// ---------- mods panel (M39): ordering UI + conflicts report, doc 09 §5/§6 ----------
let availableMods: readonly AvailableMod[] = [];
let modReport: ModReport | null = null;
// draft selection: what the player has ticked/ordered but not yet applied
let pendingOrder: string[] = [];
const pendingEnabled = new Set<string>();

function renderModsPanel(): void {
  const body = modsPanel.body;
  body.replaceChildren();
  if (availableMods.length === 0) {
    body.append(el('div', 'No bundled mods beyond the base game (Mod Zero).', 'hint'));
  } else {
    body.append(el('div', 'Check to enable, reorder with ↑↓, then Apply — this restarts the campaign at the same seed.', 'hint'));
    for (const id of pendingOrder) {
      const mod = availableMods.find((m) => m.id === id);
      if (mod === undefined) continue;
      const row = el('div', undefined, 'row');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = pendingEnabled.has(id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) pendingEnabled.add(id);
        else pendingEnabled.delete(id);
      });
      row.append(checkbox, el('span', `${mod.name} v${mod.version}`));
      const up = document.createElement('button');
      up.textContent = '↑';
      up.addEventListener('click', () => {
        const i = pendingOrder.indexOf(id);
        if (i > 0) {
          [pendingOrder[i - 1], pendingOrder[i]] = [pendingOrder[i] as string, pendingOrder[i - 1] as string];
          renderModsPanel();
        }
      });
      const down = document.createElement('button');
      down.textContent = '↓';
      down.addEventListener('click', () => {
        const i = pendingOrder.indexOf(id);
        if (i >= 0 && i < pendingOrder.length - 1) {
          [pendingOrder[i], pendingOrder[i + 1]] = [pendingOrder[i + 1] as string, pendingOrder[i] as string];
          renderModsPanel();
        }
      });
      row.append(up, down);
      body.append(row);
    }
    const apply = document.createElement('button');
    apply.textContent = appLocale.resolve(localeKey('ui.mods.apply'));
    apply.addEventListener('click', () => send({ kind: 'setMods', enabled: [...pendingEnabled], order: pendingOrder }));
    body.append(apply);
  }

  if (modReport !== null) {
    body.append(el('div', `Load order: ${modReport.order.join(' → ')}`, 'row'));
    for (const d of modReport.disabled) body.append(el('div', `DISABLED ${d.id}: ${d.reasons.join('; ')}`, 'row'));
    for (const o of modReport.overrides) body.append(el('div', `override ${o.defId}: ${o.layers.join(' → ')} (winner ${o.winner})`, 'row'));
    for (const p of modReport.patched) body.append(el('div', `patched ${p.defId} by ${p.by.join(', ')}`, 'row'));
  }
}

// ---------- player panels for the war/diplomacy/research/victory stack (M47.7) ----------
let panelsState: PlayerPanels | null = null;
let selectedArmyVillage: number | null = null; // recruit/create-army target village
/** Armed map action for an army: next map click resolves it (mirrors armedBuild). */
let armedArmyAction: { kind: 'move' | 'siege'; armyId: number } | null = null;
const battleLog: string[] = [];
const BATTLE_LOG_CAP = 30;
let endScreenShown = false;

const CAMPAIGN_ONLY_HINT = 'Available in campaign mode — start a New Game with 2+ kingdoms.';

function renderDiplomacyPanel(): void {
  const body = diplomacyPanel.body;
  body.replaceChildren();
  if (panelsState === null) {
    body.append(el('div', CAMPAIGN_ONLY_HINT, 'hint'));
    return;
  }
  if (panelsState.kingdoms.length === 0) {
    body.append(el('div', 'No rival kingdoms in this campaign.', 'hint'));
    return;
  }
  for (const k of panelsState.kingdoms) {
    const row = el('div', undefined, 'row');
    if (!k.discovered) {
      row.append(el('span', `${k.name} — undiscovered`, 'hint'));
      body.append(row);
      continue;
    }
    const status = k.defeated
      ? 'DEFEATED'
      : k.atWar
        ? `AT WAR (exhaustion ${(k.warExhaustion * 100).toFixed(0)}%)`
        : k.pacts.length > 0
          ? k.pacts.join(' · ')
          : 'peace';
    const head = el('div', `${k.name} — opinion ${k.opinion >= 0 ? '+' : ''}${k.opinion.toFixed(0)} · ${status}` +
      (k.vassalOfPlayer ? ' · your vassal' : '') + (k.playerIsVassal ? ' · YOUR LIEGE' : ''));
    tip(head, `Reputation ${k.reputation.toFixed(0)} (public — oathbreaking taints every deal)` +
      (k.knownFor.length > 0 ? `\nKnown for: ${k.knownFor.join(', ')}` : ''));
    row.append(head);
    body.append(row);
    if (k.defeated) continue;
    const actions = el('div', undefined, 'row');
    const act = (label: string, tooltip: string, onClick: () => void, disabled = false): void => {
      const b = document.createElement('button');
      b.textContent = label;
      tip(b, tooltip);
      if (disabled) b.setAttribute('aria-disabled', 'true');
      else b.addEventListener('click', () => { onClick(); send({ kind: 'requestPanels' }); });
      actions.append(b);
    };
    act('🎁', 'Send a gift (25 gold) — improves opinion, anti-spam cooldown applies', () =>
      command('kingdom.sendGift', { targetKingdom: k.index, gold: 25 }));
    act('🗯', 'Send an insult — worsens opinion (why would you? personality reasons)', () =>
      command('kingdom.sendInsult', { targetKingdom: k.index }));
    act('🕊 NAP', 'Propose a non-aggression pact', () =>
      command('kingdom.proposePact', { targetKingdom: k.index, pactType: 'nonAggression' }), k.atWar);
    act('⚖ Trade', 'Propose a trade pact', () =>
      command('kingdom.proposePact', { targetKingdom: k.index, pactType: 'trade' }), k.atWar);
    act('🛡 Ally', 'Propose an alliance (drags both into joint wars — teeth, not paper)', () =>
      command('kingdom.proposePact', { targetKingdom: k.index, pactType: 'alliance' }), k.atWar);
    if (k.atWar) {
      act('🕊 Peace', 'Propose peace with a 25-gold tribute — acceptance depends on their war exhaustion', () =>
        command('kingdom.proposePeace', { targetKingdom: k.index, tribute: 25 }));
    } else {
      act('⚔ War', 'Declare war (no casus belli: reputation and happiness pay for it — GDD §10)', () =>
        command('kingdom.declareWar', { targetKingdom: k.index }));
    }
    body.append(actions);
  }
}

function renderMilitaryPanel(): void {
  const body = militaryPanel.body;
  body.replaceChildren();
  if (panelsState === null) {
    body.append(el('div', CAMPAIGN_ONLY_HINT, 'hint'));
    return;
  }
  const catalog = store.state.catalog;
  // v1: every mirrored village is listed — recruiting at a foreign one is rejected
  // server-side ("not your village") and surfaces as a toast; ownership tags on
  // villageStats are a natural follow-up, not load-bearing for the walkthrough.
  const playerVillages = [...store.state.villages.values()].sort((a, b) => a.id - b.id);
  if (selectedArmyVillage === null && playerVillages.length > 0) selectedArmyVillage = (playerVillages[0] as { id: number }).id;

  // -- recruit --
  body.append(el('h3', 'Recruit', 'ledger-heading'));
  const villageRow = el('div', undefined, 'row');
  villageRow.append(el('span', 'village'));
  const villageSelect = document.createElement('select');
  villageSelect.setAttribute('aria-label', 'Recruiting village');
  for (const v of playerVillages) {
    const option = document.createElement('option');
    option.value = String(v.id);
    option.textContent = v.name;
    option.selected = v.id === selectedArmyVillage;
    villageSelect.append(option);
  }
  villageSelect.addEventListener('change', () => { selectedArmyVillage = Number(villageSelect.value); });
  tip(villageSelect, 'Recruits draw population from this village permanently (a real trade-off, GDD §6) — it needs a barracks.');
  villageRow.append(villageSelect);
  body.append(villageRow);
  for (const unit of catalog?.units ?? []) {
    const row = el('div', undefined, 'row');
    const b = document.createElement('button');
    b.textContent = `${unit.name} — ${unit.popCost} adults, ${unit.costGold}⛁`;
    tip(b, `${unit.unitClass} · equipment: ${unit.cost.map(([n, a]) => `${a} ${n.toLowerCase()}`).join(', ') || 'none'} · ` +
      `upkeep ${unit.upkeepGold}⛁/season · trains ${Math.round(unit.recruitTicks / 24)} days`);
    b.addEventListener('click', () => {
      if (selectedArmyVillage !== null) command('army.recruitUnit', { villageId: selectedArmyVillage, unitDef: unit.id });
      send({ kind: 'requestPanels' });
    });
    row.append(b);
    body.append(row);
  }

  // -- units --
  body.append(el('h3', 'Units', 'ledger-heading'));
  if (panelsState.units.length === 0) body.append(el('div', 'No units — recruit at a village with a barracks.', 'hint'));
  for (const unit of panelsState.units) {
    const row = el('div', undefined, 'row');
    row.append(el('span', `${unit.name} ×${unit.count}${unit.complete ? '' : ' (training…)'}`));
    if (unit.complete && unit.armyId === 0 && panelsState.armies.length > 0) {
      for (const army of panelsState.armies) {
        const b = document.createElement('button');
        b.textContent = `→ ${army.name}`;
        tip(b, 'Assign this unit to the army');
        b.addEventListener('click', () => { command('army.assignUnit', { unitId: unit.id, armyId: army.id }); send({ kind: 'requestPanels' }); });
        row.append(b);
      }
    } else if (unit.armyId !== 0) {
      row.append(el('span', '· assigned', 'hint'));
    }
    body.append(row);
  }

  // -- armies --
  body.append(el('h3', 'Armies', 'ledger-heading'));
  const createRow = el('div', undefined, 'row');
  const createButton = document.createElement('button');
  createButton.textContent = '⚑ Muster new army';
  tip(createButton, 'Creates an empty army at the selected village — assign completed units to it above.');
  createButton.addEventListener('click', () => {
    if (selectedArmyVillage !== null) {
      command('army.createArmy', { name: `${(playerVillages.find((v) => v.id === selectedArmyVillage)?.name ?? 'Army')} Host`, villageId: selectedArmyVillage });
    }
    send({ kind: 'requestPanels' });
  });
  createRow.append(createButton);
  body.append(createRow);
  for (const army of panelsState.armies) {
    const row = el('div', undefined, 'row');
    const label = el('span', `${army.name} — ${army.strength}⚔ @(${army.x},${army.y}) · ${army.stance}` +
      (army.inBattle ? ' · IN BATTLE' : '') + (army.siegeOf !== null ? ' · BESIEGING' : ''));
    tip(label, 'Armies consume food from their home village and lose morale unsupplied (M26).');
    row.append(label);
    body.append(row);
    const actions = el('div', undefined, 'row');
    const move = document.createElement('button');
    move.textContent = armedArmyAction?.kind === 'move' && armedArmyAction.armyId === army.id ? '🚶 click map…' : '🚶 March';
    tip(move, 'Then click a map tile — the army paths there (HPA*, M26). Esc cancels.');
    move.addEventListener('click', () => {
      if (store.state.armedBuild !== null) store.armBuild(null); // switching tools exits build mode
      armedArmyAction = { kind: 'move', armyId: army.id };
      renderMilitaryPanel();
    });
    actions.append(move);
    if (army.siegeOf === null) {
      const besiege = document.createElement('button');
      besiege.textContent = armedArmyAction?.kind === 'siege' && armedArmyAction.armyId === army.id ? '🏰 click castle…' : '🏰 Besiege';
      tip(besiege, 'Then click an enemy CASTLE\'s buildings — the army must already stand at its gates (M29). Esc cancels.');
      besiege.addEventListener('click', () => {
        if (store.state.armedBuild !== null) store.armBuild(null); // switching tools exits build mode
        armedArmyAction = { kind: 'siege', armyId: army.id };
        renderMilitaryPanel();
      });
      actions.append(besiege);
    } else {
      const assault = document.createElement('button');
      assault.textContent = '⚔ Assault';
      tip(assault, 'Storm the walls — bloody, but a breach makes it far cheaper (GDD §8).');
      assault.addEventListener('click', () => { command('siege.assault', { armyId: army.id }); send({ kind: 'requestPanels' }); });
      const lift = document.createElement('button');
      lift.textContent = '🏳 Lift siege';
      lift.addEventListener('click', () => { command('siege.lift', { armyId: army.id }); send({ kind: 'requestPanels' }); });
      actions.append(assault, lift);
    }
    body.append(actions);
  }

  // -- battle log --
  body.append(el('h3', 'War report', 'ledger-heading'));
  if (battleLog.length === 0) body.append(el('div', 'No engagements yet.', 'hint'));
  for (const line of battleLog.slice(-8).reverse()) body.append(el('div', line, 'row'));
}

function renderResearchPanel(): void {
  const body = researchPanel.body;
  body.replaceChildren();
  if (panelsState === null || panelsState.research === null) {
    body.append(el('div', CAMPAIGN_ONLY_HINT, 'hint'));
    return;
  }
  const r = panelsState.research;
  body.append(tip(
    el('div', `Known: ${r.knownCount}/${r.totalCount} technologies`, 'row'),
    'Scholars (scribe\'s hut → library) generate points daily; the Scholar advisor multiplies them.',
  ));
  if (r.active !== null) {
    body.append(el('div', `Researching: ${r.active.name} — ${r.active.progress.toFixed(0)}/${r.active.cost.toFixed(0)}`, 'row'));
  } else {
    body.append(el('div', 'No active research — pick one below.', 'hint'));
  }
  for (const t of r.available) {
    const row = el('div', undefined, 'row');
    const b = document.createElement('button');
    b.textContent = `${t.name} (${t.cost.toFixed(0)})`;
    tip(b, `Branch: ${t.branch}. Switching abandons current progress (v1). Neighbours knowing it cheapens it (diffusion, GDD §9).`);
    if (r.active?.techId === t.techId) b.classList.add('active');
    b.addEventListener('click', () => { command('kingdom.setActiveResearch', { techId: t.techId }); send({ kind: 'requestPanels' }); });
    row.append(b);
    body.append(row);
  }
}

const VICTORY_LABELS: Record<string, string> = {
  conquest: 'Conquest — control the settled world',
  hegemony: 'Hegemony — every rival allied or vassal',
  legacy: 'Legacy — complete the Grand Wonders',
  prosperity: 'Prosperity — sustained realm-wide happiness',
  chronicle: 'Chronicle — highest prestige at the year cap',
};

function renderVictoryPanel(): void {
  const body = victoryPanel.body;
  body.replaceChildren();
  if (panelsState === null || panelsState.victory === null) {
    body.append(el('div', CAMPAIGN_ONLY_HINT, 'hint'));
    return;
  }
  const v = panelsState.victory;
  body.append(tip(el('div', `Prestige ${v.prestige.toFixed(0)}`, 'row'),
    'Population + buildings + techs + wonders (GDD §15) — the Chronicle tiebreaker.'));
  for (const track of v.tracks) {
    const row = el('div', `${VICTORY_LABELS[track.type] ?? track.type}: ${(track.progress * 100).toFixed(0)}%`, 'row');
    tip(row, 'Crossing 80% broadcasts to every kingdom — victories are contestable (GDD §16).');
    body.append(row);
  }
  if (v.winner !== null || v.playerDefeated) showEndScreen(v);
}

/** Campaign end screen (M47.7): victory or defeat, once, with keep-playing. */
function showEndScreen(v: NonNullable<PlayerPanels['victory']>): void {
  if (endScreenShown) return;
  endScreenShown = true;
  const backdrop = document.getElementById('end-screen-backdrop') as HTMLElement;
  const title = document.getElementById('end-screen-title') as HTMLElement;
  const bodyEl = document.getElementById('end-screen-body') as HTMLElement;
  const isPlayerWin = v.winner !== null && v.winner.kingdomIndex === 0;
  if (isPlayerWin) {
    title.textContent = `👑 Victory — ${v.winner?.type ?? ''}`;
    bodyEl.textContent = 'Your dynasty\'s name is carved into the chronicle. The realm is yours.';
  } else if (v.playerDefeated) {
    title.textContent = '⚰ Defeat';
    bodyEl.textContent = 'Your last village has fallen. The chronicle closes on your line.';
  } else {
    const rival = panelsState?.kingdoms.find((k) => k.index === v.winner?.kingdomIndex);
    title.textContent = `📜 The age belongs to ${rival?.name ?? 'a rival'}`;
    bodyEl.textContent = `They achieved a ${v.winner?.type ?? ''} victory. You may keep playing in the world they now shape.`;
  }
  backdrop.hidden = false;
  setSpeed(0);
  (document.getElementById('end-screen-continue') as HTMLButtonElement).focus();
}
(document.getElementById('end-screen-continue') as HTMLButtonElement).addEventListener('click', () => {
  (document.getElementById('end-screen-backdrop') as HTMLElement).hidden = true;
});

function renderWarPanels(): void {
  renderDiplomacyPanel();
  renderMilitaryPanel();
  renderResearchPanel();
  renderVictoryPanel();
}
renderWarPanels(); // initial hint state before any campaign boots

// A panel body is rebuilt wholesale (replaceChildren) on every store change, which
// fires on every snapshot delta. That must NOT happen while the user is mid-interaction
// with a control inside the panel — replacing a live <select> snaps its open dropdown
// shut. This was the "tax selector closes the instant it opens" bug: it only survived
// while PAUSED (no deltas → no re-render). Skip the rebuild while focus is inside the
// panel; the next delta after the control blurs redraws it with fresh data.
const EDITABLE = new Set(['SELECT', 'INPUT', 'TEXTAREA']);
function whenIdle(panel: Panel, render: () => void): () => void {
  return () => {
    const active = document.activeElement;
    // only an *editable* control mid-interaction is worth protecting (a focused
    // button re-renders fine and wants the fresh state); a live <select> does not.
    if (active !== null && EDITABLE.has(active.tagName) && panel.body.contains(active)) return;
    render();
  };
}
const renderVillagePanelIdle = whenIdle(villagePanel, renderVillagePanel);
const renderKingdomPanelIdle = whenIdle(kingdomPanel, renderKingdomPanel);

store.subscribe(() => {
  renderVillagePanelIdle();
  renderBuildPalette();
  renderKingdomPanelIdle();
  updateFootprintPreview(); // arming/disarming a building shows/hides the placement outline
});
renderBuildingPanel(); // seed the inspector's "click a building" hint before any selection

const toastHost = document.getElementById('toasts') as HTMLElement;
function renderToasts(): void {
  toastHost.replaceChildren();
  for (const n of notifications.visible()) {
    const toast = el('div', undefined, `toast ${n.severity}`);
    toast.append(el('span', n.text, 'toast-text'));
    // every notification is manually dismissible (× button) — auto-timeout behaviour is unchanged,
    // this just gives the player an immediate opt-out for any warning/error/info toast
    const close = el('button', '×', 'toast-close') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.addEventListener('click', () => {
      notifications.dismiss(n.id);
      renderToasts();
    });
    toast.append(close);
    // urgent (pause-triggering) toasts get their own assertive announcement, overriding the
    // container's `aria-live="polite"` — everything else queues politely (M42 accessibility)
    if (n.severity === 'urgent') toast.setAttribute('role', 'alert');
    toastHost.append(toast);
  }
}

// ---------- boot ----------
let renderer: PixiRenderer | null = null;
let lastDeltaTick = 0;
let lastDeltaAtMs = 0;

// ---------- debug panel (M9 — later the sandbox editor shell, GDD §17) ----------
const dbg = {
  panel: document.getElementById('debug') as HTMLElement,
  sandboxBadge: document.getElementById('dbg-sandbox-badge') as HTMLElement,
  systems: document.querySelector('#dbg-systems tbody') as HTMLElement,
  tickms: document.getElementById('dbg-tickms') as HTMLElement,
  entities: document.getElementById('dbg-entities') as HTMLElement,
  chunks: document.getElementById('dbg-chunks') as HTMLElement,
  inspect: document.getElementById('dbg-inspect') as HTMLElement,
  injType: document.getElementById('inj-type') as HTMLSelectElement,
  injPayload: document.getElementById('inj-payload') as HTMLTextAreaElement,
  injIssuer: document.getElementById('inj-issuer') as HTMLInputElement,
  injSend: document.getElementById('inj-send') as HTMLButtonElement,
  injResult: document.getElementById('inj-result') as HTMLElement,
};
let debugOpen = false;
let selectedEntity: number | null = null;
let inspectTimer = 0;

function setDebugOpen(open: boolean): void {
  debugOpen = open;
  dbg.panel.classList.toggle('open', open);
  send({ kind: 'debug', op: 'telemetry', enabled: open, everyTicks: 10 });
  if (open) send({ kind: 'debug', op: 'commands' });
}

dbg.injSend.addEventListener('click', () => {
  try {
    const payload: unknown = JSON.parse(dbg.injPayload.value || '{}');
    const issuer = Number(dbg.injIssuer.value) | 0;
    send({ kind: 'submit', drafts: [{ type: dbg.injType.value, issuer, payload }] });
    dbg.injResult.textContent = `submitted ${dbg.injType.value} (issuer ${issuer}) — executes next tick`;
    dbg.injResult.classList.remove('err');
  } catch (error) {
    dbg.injResult.textContent = `payload JSON error: ${error instanceof Error ? error.message : String(error)}`;
    dbg.injResult.classList.add('err');
  }
});

function renderTelemetry(m: Extract<FromSimMessage, { kind: 'debugTelemetry' }>): void {
  const maxAvg = Math.max(0.001, ...m.systems.map((s) => s.avgMs));
  dbg.systems.innerHTML = m.systems
    .map(
      (s) => `<tr><td>${s.name}</td><td class="num">${s.avgMs.toFixed(3)}</td>` +
        `<td class="num">${s.calls}</td>` +
        `<td style="width:70px"><div class="bar" style="width:${Math.round((s.avgMs / maxAvg) * 100)}%"></div></td></tr>`,
    )
    .join('');
  dbg.tickms.textContent = m.tickMsAvg.toFixed(3);
  dbg.entities.textContent = String(m.entityCount);
  dbg.chunks.textContent = String(renderer?.stats().chunksCached ?? 0);
}

function renderInspection(m: Extract<FromSimMessage, { kind: 'debugEntity' }>): void {
  const i = m.inspection;
  if (!i.alive) {
    dbg.inspect.textContent = `entity ${i.id}: not alive`;
    if (selectedEntity === i.id) selectedEntity = null;
    return;
  }
  const lines = [
    `entity ${i.id} (index ${i.index})`,
    ...i.components.map((c) => `${c.name}: ${JSON.stringify(c.data)}`),
  ];
  dbg.inspect.textContent = lines.join('\n');
}

worker.onmessage = (event: MessageEvent) => {
  const message = event.data as FromSimMessage;
  switch (message.kind) {
    case 'ready':
      hud.status.textContent = `seed 0x${message.seed.toString(16)}`;
      dbg.sandboxBadge.textContent = message.sandbox
        ? `🧪 SANDBOX EDITOR${IRONMAN ? ' · ironman' : ''} — privileged sandbox.* commands below act for free`
        : '';
      availableMods = message.availableMods;
      modReport = message.modReport;
      // reflect the ACTUAL composed state, not a stale draft (base is implicit, never listed)
      pendingOrder = message.modReport.order.filter((id) => id !== 'base');
      pendingEnabled.clear();
      for (const id of pendingOrder) pendingEnabled.add(id);
      for (const mod of availableMods) if (!pendingOrder.includes(mod.id)) pendingOrder.push(mod.id);
      renderModsPanel();
      return;
    case 'snapshotFull':
      playerKingdomId = message.kingdom?.id ?? null; // M47.6: claim only our own event dialogs
      // M47.7: a full snapshot = a (re)started or loaded session — reset per-session panel state
      panelsState = null;
      armedArmyAction = null;
      selectedArmyVillage = null;
      selectBuilding(null);
      battleLog.length = 0;
      endScreenShown = false;
      (document.getElementById('end-screen-backdrop') as HTMLElement).hidden = true;
      renderWarPanels();
      store.applyFull(message.catalog, message.kingdom);
      audioDirector.setCatalog(message.audio ?? { cues: [], playlists: [] });
      eventCatalog = new Map((message.catalog?.events ?? []).map((e) => [e.id, e]));
      eventQueue.length = 0;
      eventDialog.backdrop.hidden = true;
      for (const pending of message.kingdom?.pendingEvents ?? []) eventQueue.push({ ...pending });
      showNextEventDialog(); // recovers a dialog left unanswered across a save/reload
      {
        // Open (or re-open, on load) the camera over the player's own village
        // rather than the geometric map centre. The sim reports the player kingdom's
        // home tile directly; fall back to the buildings' centroid, then map centre.
        const focus =
          message.kingdom?.home ??
          centroidBuildings(message.buildings) ??
          { x: message.world.widthTiles / 2, y: message.world.heightTiles / 2 };
        if (renderer !== null) {
          // a loaded save replaces the whole world state (M17): re-mirror it
          renderer.mirror.applyFull(message.entities);
          renderer.setBuildings(message.buildings ?? []);
          renderer.setRoads(message.roads ?? []);
          renderer.centerOnTile(focus.x, focus.y);
          villageStats.clear();
          hud.villages.textContent = '';
        } else {
          void bootRenderer(message.world.widthTiles, message.world.heightTiles, message.entities, message.terrain, message.buildings, message.roads, focus);
        }
      }
      return;
    case 'snapshotDelta': {
      renderer?.mirror.applyDelta(message);
      for (const stat of message.villageStats ?? []) {
        villageStats.set(stat.id, stat);
      }
      store.applyVillageStats((message.villageStats ?? []).map((s) => ({ ...s, goods: s.goods ?? {} })));
      if ((message.villageStats?.length ?? 0) > 0) {
        renderVillageChips();
      }
      if (renderer !== null) {
        for (const rec of message.buildingsAdded ?? []) renderer.addBuilding(rec);
        if ((message.roadsAdded?.length ?? 0) > 0) renderer.addRoads(message.roadsAdded ?? []);
        const bp = message.buildingProgress ?? [];
        for (let i = 0; i + 1 < bp.length; i += 2) {
          renderer.updateBuildingProgress(bp[i] as number, bp[i + 1] as number);
        }
        for (const id of message.buildingsRemoved ?? []) renderer.removeBuilding(id);
      }
      // keep the building inspector live: reflect construction progress, and if the
      // selected building was demolished (here or by a siege) drop the stale selection
      if (buildingPanel.isOpen() && selectedBuildingId !== null) {
        if ((message.buildingsRemoved ?? []).includes(selectedBuildingId)) selectBuilding(null);
        else renderBuildingPanel();
      }
      // buildings changed under the cursor → re-probe the footprint preview so a just-placed
      // (or removed) tile flips colour without waiting for the next mouse move
      if (store.state.armedBuild !== null && ((message.buildingsAdded?.length ?? 0) > 0 || (message.buildingsRemoved?.length ?? 0) > 0)) {
        lastPreviewKey = null;
        updateFootprintPreview();
      }
      lastDeltaTick = message.tick;
      lastDeltaAtMs = performance.now();
      return;
    }
    case 'ticked':
      hud.tick.textContent = String(message.toTick);
      for (const gameEvent of message.events) {
        if (gameEvent.type === 'time.dayStarted') {
          const { date } = gameEvent.data as { date: { year: number; seasonName: string; day: number } };
          hud.date.textContent = `Year ${date.year} · ${date.seasonName} · day ${date.day + 1}`;
        } else if (gameEvent.type === 'kingdom.rollup') {
          // the ledger UI, v1 (M16): treasury and yesterday's net, to the coin.
          // M47.6: multi-kingdom campaigns roll up every kingdom — the HUD is the
          // PLAYER's (kingdomIndex 0; absent on old single-kingdom compositions).
          const r = gameEvent.data as {
            kingdomIndex?: number;
            treasury: number; taxes: number; upkeep: number; salaries: number; net: number;
            ledger?: { tick: number; kind: string; amount: number; detail: string }[];
          };
          if ((r.kingdomIndex ?? 0) === 0) {
            // kingdom resources are no longer always-on HUD text — the on-demand
            // Kingdom panel (👑) renders treasury/net/ledger from this same rollup.
            store.applyRollup(r);
            store.appendLedger(r.ledger ?? []); // M42: itemized breakdown, "full income/expense" (GDD §2)
          }
        } else if (gameEvent.type === 'kingdom.edictEnacted' || gameEvent.type === 'kingdom.edictRepealed' || gameEvent.type === 'kingdom.edictLapsed') {
          const { edict } = gameEvent.data as { edict: string };
          store.applyEdictChange(edict, gameEvent.type === 'kingdom.edictEnacted');
        } else if (gameEvent.type === 'event.fired') {
          // M43 single-kingdom: every fired event was the player's. M47.6 multi-kingdom:
          // AI kingdoms fire (and auto-answer) their own — only claim OUR dialogs.
          const { kingdom, eventId, choiceIds } = gameEvent.data as { kingdom: number; eventId: string; choiceIds: string[] };
          if (playerKingdomId === null || kingdom === playerKingdomId) {
            eventQueue.push({ eventId, choiceIds });
            showNextEventDialog();
          }
        }
        // M47.7: the Military panel's war report — human-readable battle/siege lines
        if (
          gameEvent.type.startsWith('battle.') || gameEvent.type.startsWith('siege.') ||
          gameEvent.type === 'diplomacy.warDeclared' || gameEvent.type === 'diplomacy.peace'
        ) {
          const detail = JSON.stringify(gameEvent.data).slice(0, 80);
          battleLog.push(`t${gameEvent.tick} ${gameEvent.type.replace(/^(battle|siege|diplomacy)\./, '')} ${detail}`);
          if (battleLog.length > BATTLE_LOG_CAP) battleLog.splice(0, battleLog.length - BATTLE_LOG_CAP);
        }
        notifications.push(gameEvent);
        audioDirector.push(gameEvent);
      }
      audioDirector.advance(message.toTick); // tension decay even on ticks with no qualifying event
      renderToasts();
      if (notifications.takePauseRequest()) setSpeed(0); // GDD §1 urgent-pause tier
      return;
    case 'saveResult':
      hud.status.textContent = message.ok
        ? `saved '${message.slot}' (${(message.bytes / 1024).toFixed(0)} KB)`
        : `save failed: ${message.error ?? 'unknown'}`;
      return;
    case 'loadResult':
      hud.status.textContent = message.ok
        ? `loaded · tick ${message.tick}${(message.migrations?.length ?? 0) > 0 ? ` · ${message.migrations?.length} migrations` : ''}`
        : `load failed: ${message.error ?? 'unknown'}`;
      // OQ-4 best-effort reconciliation: surface differences, never block the load
      if (message.ok && message.modReport !== undefined) {
        const r = message.modReport;
        const bits = [
          ...r.missing.map((m) => `missing ${m.modId}`),
          ...r.versionChanged.map((c) => `${c.modId} ${c.saved} → ${c.installed}`),
          ...r.contentChanged.map((c) => `${c.modId} rebalanced`),
        ];
        if (bits.length > 0) {
          notifications.push({ type: 'mods.reconciled', tick: message.tick, data: { summary: `Save's mods differ: ${bits.join(', ')} — a backup was exported` } });
          renderToasts();
        }
      }
      return;
    case 'exportResult': {
      // .crown file download (TDD §8 export path)
      const blob = new Blob([message.payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crowns-and-clay-${Date.now()}.crown`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    case 'fatal':
      hud.status.textContent = `SIM FATAL: ${message.message}`;
      hud.status.classList.add('error');
      return;
    case 'debugTelemetry':
      renderTelemetry(message);
      return;
    case 'debugEntity':
      renderInspection(message);
      return;
    case 'debugCommands':
      dbg.injType.innerHTML = message.types.map((t) => `<option>${t}</option>`).join('');
      return;
    case 'storageAdvisory': {
      // roadmap M44 (doc 11 §3/§4; Risk R6): the worker already narrowed the autosave ring —
      // this is the player-facing half, pointing at the export button (⇩) already on the toolbar.
      const usedMb = (message.usageBytes / (1024 * 1024)).toFixed(0);
      const quotaMb = (message.quotaBytes / (1024 * 1024)).toFixed(0);
      const summary =
        `Storage running low (${usedMb} MB of ${quotaMb} MB) — autosaves trimmed. ` +
        `Export a save (⇩) to keep it safe from browser cleanup.`;
      notifications.push({ type: 'storage.quotaTight', tick: 0, data: { summary } });
      renderToasts();
      return;
    }
    case 'panels':
      panelsState = message.panels; // M47.7: the war/diplomacy/research/victory projection
      renderWarPanels();
      return;
    case 'buildPreview':
      // authoritative placement verdict — apply only if it's the newest query and we're
      // still in placement mode (the cursor hasn't disarmed/moved past it)
      if (message.seq === previewSeq && store.state.armedBuild !== null && renderer !== null) {
        previewValid = message.ok;
        renderer.showFootprintPreview(message.x, message.y, message.w, message.h, message.ok);
      }
      return;
    case 'hash':
    case 'rejected':
      return;
  }
};

/** Centroid of building footprint centres, or null if there are none. */
function centroidBuildings(buildings: readonly BuildingRec[] | undefined): { x: number; y: number } | null {
  if (buildings === undefined || buildings.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const b of buildings) {
    sx += b.x + b.w / 2;
    sy += b.y + b.h / 2;
  }
  return { x: sx / buildings.length, y: sy / buildings.length };
}

async function bootRenderer(
  widthTiles: number,
  heightTiles: number,
  entities: EntityRec[],
  terrain?: TerrainSnapshot,
  buildings?: BuildingRec[],
  roads?: number[],
  focus?: { x: number; y: number },
): Promise<void> {
  if (renderer !== null) return;
  const host = document.getElementById('game') as HTMLElement;
  renderer = new PixiRenderer(
    widthTiles,
    heightTiles,
    host.clientWidth,
    host.clientHeight,
    terrain !== undefined ? new TerrainView(terrain) : null,
  );
  const canvas = await renderer.init(host);
  host.appendChild(canvas);
  renderer.mirror.applyFull(entities);
  if (buildings !== undefined) renderer.setBuildings(buildings);
  if (roads !== undefined) renderer.setRoads(roads);
  if (focus !== undefined) renderer.centerOnTile(focus.x, focus.y);
  // dev inspection hook (Vite injects import.meta.env; typed loosely to avoid a vite/client dep)
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
    (window as unknown as { __renderer?: unknown }).__renderer = renderer;
  }
  wireInput(canvas);

  // frame loop: pump sim with real dt, render with interpolation alpha
  let lastFrame = performance.now();
  renderer.app.ticker.add(() => {
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    send({ kind: 'pump', dtMs: dt });
    const r = renderer as PixiRenderer;
    const tickMs = 1000 / (BASE_TICKS_PER_SECOND * Math.max(1, speed));
    const alpha = speed === 0 ? 1 : (now - lastDeltaAtMs) / tickMs;
    r.render(alpha);
    hud.fps.textContent = r.app.ticker.FPS.toFixed(0);
    hud.entities.textContent = String(r.mirror.size);
    // live refresh of the selected entity (~4 Hz)
    if (debugOpen && selectedEntity !== null && now - inspectTimer > 250) {
      inspectTimer = now;
      send({ kind: 'debug', op: 'inspect', entityId: selectedEntity });
    }
  });
  new ResizeObserver(() => renderer?.resize(host.clientWidth, host.clientHeight)).observe(host);
  hud.status.textContent += ` · tick ${lastDeltaTick}`;
}

function wireInput(canvas: HTMLCanvasElement): void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (renderer === null) return;
    if (dragging) {
      renderer.camera.pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    }
    // track the cursor for the footprint preview (also updates while panning, so the
    // outline stays glued to the tile under the pointer as the map moves beneath it)
    const rect = canvas.getBoundingClientRect();
    lastPointer = { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    if (store.state.armedBuild !== null) updateFootprintPreview();
  });
  canvas.addEventListener('pointerleave', () => {
    lastPointer = null;
    renderer?.hideFootprintPreview();
    lastPreviewKey = null;
  });
  let downAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  // right-click cancels an armed build or army order (and suppresses the browser menu) — the
  // familiar RTS "right-click to deselect the tool" gesture
  canvas.addEventListener('contextmenu', (e) => {
    if (store.state.armedBuild !== null || armedArmyAction !== null) {
      e.preventDefault();
      armedArmyAction = null;
      if (store.state.armedBuild !== null) store.armBuild(null);
      else renderer?.hideFootprintPreview();
      renderMilitaryPanel();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    // only the primary (left) button acts — right/middle are reserved for cancel/pan, and must
    // never place a building or trigger inspection
    if (e.button !== 0) {
      downAt = null;
      return;
    }
    // click (not drag) → inspect: entity, or shift for the tile under cursor
    if (downAt !== null && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4 && renderer !== null) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // armed army order (M47.7): march to the clicked tile, or besiege the clicked castle
      if (armedArmyAction !== null) {
        const action = armedArmyAction;
        armedArmyAction = null;
        if (action.kind === 'move') {
          const t = renderer.tileAt(sx, sy);
          command('army.moveTo', { armyId: action.armyId, x: t.x, y: t.y });
        } else {
          const picked = renderer.pickBuilding(sx, sy);
          const rec = picked !== null ? renderer.buildingRec(picked) : null;
          if (rec !== null) command('siege.begin', { armyId: action.armyId, villageId: rec.village });
          else notifications.push({ type: 'ui.hint', tick: 0, data: { summary: 'Click one of the target castle\'s buildings to besiege it.' } });
        }
        send({ kind: 'requestPanels' });
        renderMilitaryPanel();
        renderToasts();
      } else if (store.state.armedBuild !== null) {
        const t = renderer.tileAt(sx, sy);
        const target = store.villageNear(t.x, t.y);
        if (target !== null) {
          command('village.build', { villageId: target.id, def: store.state.armedBuild, x: t.x, y: t.y });
          // continuous building mode: stay armed after every placement attempt (success OR fail),
          // so the player can drop copy after copy. Only an explicit cancel (Esc / right-click /
          // re-selecting in the palette / another tool) exits. Re-probe the tile just placed on so
          // its outline flips red immediately.
          lastPreviewKey = null;
          updateFootprintPreview();
        }
      } else if (e.shiftKey) {
        const t = renderer.tileAt(sx, sy);
        const name = renderer.terrainNameAt(t.x, t.y);
        dbg.inspect.textContent = name !== null ? `tile (${t.x}, ${t.y}) · ${name}` : `tile (${t.x}, ${t.y}) · out of bounds`;
        selectedEntity = null;
        if (!debugOpen) setDebugOpen(true);
      } else if (debugOpen) {
        // debug panel open → M9 inspector behaviour, unchanged
        const picked = renderer.pickEntity(sx, sy) ?? renderer.pickBuilding(sx, sy);
        if (picked !== null) {
          selectedEntity = picked;
          send({ kind: 'debug', op: 'inspect', entityId: picked });
        }
      } else {
        // player selection (M18): a building click opens its inspector (name, category,
        // demolish) and syncs the village selection so the Village panel tracks it too
        const picked = renderer.pickBuilding(sx, sy);
        const rec = picked !== null ? renderer.buildingRec(picked) : null;
        if (rec !== null) {
          store.selectVillage(rec.village);
          selectBuilding(rec.id);
          buildingPanel.open();
        }
      }
    }
    downAt = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    renderer?.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
}

// ---------- keybinds (M42; doc 05 §9 "accessibility hooks: full keyboard operability") ----------
// A single source of truth replacing the 3 scattered, ungated keydown listeners this file used
// to have — those never checked for text-entry focus outside the backtick case, so e.g. typing
// digits into the debug injector's JSON textarea also changed game speed. Centralizing fixed that
// for every bind at once, and doubles as the '?' help overlay's content (discoverability IS
// legibility, doc 01 §3).
interface Keybind {
  readonly key: string;
  readonly description: string;
  readonly action: () => void;
}
const KEYBINDS: readonly Keybind[] = [
  { key: 'Space', description: 'Pause / resume', action: () => setSpeed(speed === 0 ? 1 : 0) },
  { key: '1', description: 'Speed 1×', action: () => setSpeed(1) },
  { key: '2', description: 'Speed 2×', action: () => setSpeed(2) },
  { key: '3', description: 'Speed 4×', action: () => setSpeed(4) },
  { key: '4', description: 'Speed 8×', action: () => setSpeed(8) },
  { key: 'V', description: 'Toggle Village panel', action: () => villagePanel.toggle() },
  { key: 'B', description: 'Toggle Build panel', action: () => buildPanel.toggle() },
  { key: 'K', description: 'Toggle Kingdom panel', action: () => kingdomPanel.toggle() },
  { key: 'D', description: 'Toggle Diplomacy panel', action: () => diplomacyPanel.toggle() },
  { key: 'A', description: 'Toggle Military panel', action: () => militaryPanel.toggle() },
  { key: 'R', description: 'Toggle Research panel', action: () => researchPanel.toggle() },
  { key: 'Y', description: 'Toggle Victory panel', action: () => victoryPanel.toggle() },
  { key: 'M', description: 'Toggle Mods panel', action: () => modsPanel.toggle() },
  { key: '`', description: 'Toggle debug / sandbox editor panel', action: () => setDebugOpen(!debugOpen) },
  { key: 'Escape', description: 'Cancel armed build/army order, or close keybind help', action: (): void => {
    if (armedArmyAction !== null) {
      armedArmyAction = null;
      renderMilitaryPanel();
    } else if (store.state.armedBuild !== null) store.armBuild(null);
    else if (demolishArmed) { demolishArmed = false; renderBuildingPanel(); }
    else if (helpPanel.isOpen()) helpPanel.close();
  } },
  { key: '?', description: 'Show/hide this keybind list', action: () => helpPanel.toggle() },
];
const KEY_LABEL = (raw: string): string => (raw === ' ' ? 'Space' : raw);

function renderKeybindHelp(): void {
  helpPanel.body.replaceChildren();
  const table = document.createElement('table');
  table.setAttribute('aria-label', 'Keyboard shortcuts');
  for (const bind of KEYBINDS) {
    const row = document.createElement('tr');
    const keyCell = el('td', KEY_LABEL(bind.key));
    keyCell.className = 'num';
    row.append(keyCell, el('td', bind.description));
    table.append(row);
  }
  helpPanel.body.append(table);
  helpPanel.body.append(el('div', 'Map placement (Build panel → click a tile) is pointer-only today.', 'hint'));
}
renderKeybindHelp();

window.addEventListener('keydown', (e) => {
  // never hijack real typing — the debug injector's textarea/input, or any future text entry
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  // Space activates a focused button and opens a focused <select> natively — don't steal it
  if (key === 'Space' && (e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement)) return;
  const bind = KEYBINDS.find((b) => b.key.toUpperCase() === key.toUpperCase());
  if (bind === undefined) return;
  e.preventDefault();
  bind.action();
});

// ---------- new-game screen (M47.6; doc 12 R1) ----------
// The first real world-creation surface: seed, map size, kingdoms, difficulty,
// victory toggles, sandbox. `?quickstart=terra|campaign` skips it with the pinned
// seeds (dev loops, CI); `?sandbox=1` pre-checks the sandbox toggle either way.
const ng = {
  backdrop: document.getElementById('newgame-backdrop') as HTMLElement,
  seed: document.getElementById('ng-seed') as HTMLInputElement,
  reroll: document.getElementById('ng-reroll') as HTMLButtonElement,
  mapSize: document.getElementById('ng-mapsize') as HTMLSelectElement,
  kingdoms: document.getElementById('ng-kingdoms') as HTMLInputElement,
  years: document.getElementById('ng-years') as HTMLInputElement,
  difficulty: document.getElementById('ng-difficulty') as HTMLSelectElement,
  victory: document.getElementById('ng-victory') as HTMLElement,
  sandbox: document.getElementById('ng-sandbox') as HTMLInputElement,
  beginCampaign: document.getElementById('btn-begin-campaign') as HTMLButtonElement,
  beginTerra: document.getElementById('btn-begin-terra') as HTMLButtonElement,
};
ng.sandbox.checked = SANDBOX;

const randomSeed = (): number => (Math.random() * 0xffffffff) >>> 0; // presentation-side only — the sim never draws from Math.random
const parseSeed = (raw: string): number => {
  const text = raw.trim();
  if (text.length === 0) return randomSeed();
  const n = text.startsWith('0x') ? Number.parseInt(text.slice(2), 16) : Number.parseInt(text, 10);
  return Number.isFinite(n) ? n >>> 0 : randomSeed();
};
ng.reroll.addEventListener('click', () => {
  ng.seed.value = `0x${randomSeed().toString(16)}`;
});

const boot = (seed: number, campaign?: CampaignSettings): void => {
  ng.backdrop.hidden = true;
  send({
    kind: 'init',
    seed,
    locale: LOCALE,
    ...(ng.sandbox.checked ? { sandbox: { ironman: IRONMAN } } : {}),
    ...(campaign !== undefined ? { campaign } : {}),
  });
  setSpeed(1);
};

ng.beginCampaign.addEventListener('click', () => {
  const victory = [...ng.victory.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .filter((c) => c.checked)
    .map((c) => c.value);
  const years = Number(ng.years.value) | 0;
  boot(parseSeed(ng.seed.value), {
    mapSize: ng.mapSize.value as CampaignSettings['mapSize'],
    kingdomCount: Math.max(1, Math.min(8, Number(ng.kingdoms.value) | 0 || 4)),
    difficulty: ng.difficulty.value as NonNullable<CampaignSettings['difficulty']>,
    victory,
    defeatEnabled: !ng.sandbox.checked, // GDD §17: sandbox disables defeat
    ...(years > 0 ? { yearLimit: Math.min(200, years) } : {}),
  });
});
ng.beginTerra.addEventListener('click', () => boot(parseSeed(ng.seed.value)));

const QUICKSTART = bootParams.get('quickstart');
if (QUICKSTART === 'terra') {
  boot(TERRA_QUICKSTART_SEED);
} else if (QUICKSTART === 'campaign') {
  boot(CAMPAIGN_QUICKSTART_SEED, DEFAULT_CAMPAIGN_SETTINGS);
}

// Dev/CI driving handle (M47.7): background tabs suspend requestAnimationFrame — the pump
// stops with it — so automated walkthroughs (and anyone poking at the console) can advance
// the sim deterministically via explicit steps. Same 'step' message headless.ts uses.
(window as unknown as { __crowns?: unknown }).__crowns = {
  send,
  step: (ticks: number): void => send({ kind: 'step', ticks: Math.max(1, ticks | 0) }),
};

// ---------- PWA offline shell (roadmap M44; doc 03 §9) ----------
// Registered post-load so it never competes with the sim boot for the main thread; a failed
// registration (unsupported browser, dev server quirk) is silently non-fatal — offline caching
// is a progressive enhancement, not a load-bearing dependency for the game to run.
//
// DEV: never register — a cache-first SW serving stale JS is the classic "my change didn't show
// up" trap under `npm run dev`. Instead, actively tear down any SW + caches a previous build left
// behind, so a dev session always runs the live code without a manual unregister.
const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
if ('serviceWorker' in navigator) {
  if (isDev) {
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
    if ('caches' in window) void caches.keys().then((keys) => keys.forEach((k) => void caches.delete(k)));
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}
