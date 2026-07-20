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
import { NotificationQueue, PanelHost, TooltipController, UIStore, type Panel, type VillageInfo } from '@crowns/ui';
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
/** One delimited box per resource — e.g. [Wood 100]. Shared by the player's HUD bar and the
 * Realms panel so both read identically. */
function resourceBox(label: string, value: string | number): HTMLElement {
  const box = el('span', undefined, 'rbox');
  box.append(el('span', label, 'rl'));
  const b = document.createElement('b');
  b.textContent = String(value);
  box.append(b);
  return box;
}

/** Ordered, data-driven resource boxes for a village: pop, joy, food, then every OTHER good the
 * sim reports (base or modded), in the sim's stable order — nothing hardcoded per resource, so a
 * modded resource gets its own box automatically. Order per 1.x spec: pop · joy · food · goods. */
function villageResourceBoxes(s: VillageInfo): HTMLElement[] {
  const boxes = [resourceBox('pop', s.population), resourceBox('joy', s.happiness), resourceBox('food', s.food)];
  for (const [good, amount] of Object.entries(s.goods)) boxes.push(resourceBox(good, amount));
  return boxes;
}

/** The main-view HUD bar shows ONLY the player's own villages (1.x: rival kingdoms' goods moved
 * to the Realms panel). One fixed chip per owned village, resources in delimited boxes. */
function renderVillageChips(): void {
  const host = hud.villages;
  host.replaceChildren();
  for (const s of [...store.state.villages.values()].filter((v) => v.owned).sort((a, b) => a.id - b.id)) {
    const chip = el('span', undefined, 'vchip');
    chip.append(el('span', s.name, 'nm'), ...villageResourceBoxes(s));
    host.append(chip);
  }
}

/** Realms panel (1.x): every rival (non-owned) village and its stored goods — the same boxed,
 * data-driven rendering as the player's own bar, just relocated off the main view. */
function renderRealmsPanel(): void {
  const body = realmsPanel.body;
  body.replaceChildren();
  const foreign = [...store.state.villages.values()].filter((v) => !v.owned).sort((a, b) => a.id - b.id);
  if (foreign.length === 0) {
    body.append(el('div', 'No rival settlements known yet.', 'hint'));
    return;
  }
  body.append(el('div', 'Stored goods of rival kingdoms’ settlements.', 'hint'));
  for (const s of foreign) {
    body.append(el('div', s.name, 'ledger-heading'));
    const row = el('div', undefined, 'goods-row');
    row.append(...villageResourceBoxes(s));
    body.append(row);
  }
}
let speed: Speed = 1;
// resuming from a pause: drop any pause-time placement ghosts on the first tick the sim runs,
// where the real (queued) buildings commit — see the snapshotDelta handler and renderer.addPlanned.
let clearGhostsOnResume = false;
// Buildings placed while paused are held HERE (not submitted to the sim) so they can be freely
// canceled while still paused — a real `village.build` can't commit until a tick runs (that would
// break determinism; see the driver's pause note). Keyed by "x,y" origin tile; submitted on resume.
const pausedPlacements = new Map<string, { villageId: number; def: string; x: number; y: number; w: number; h: number }>();
/** Key of the planned placement whose footprint covers tile (x, y), or null — for click-to-cancel. */
const pausedPlacementAt = (x: number, y: number): string | null => {
  for (const [key, p] of pausedPlacements) {
    if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return key;
  }
  return null;
};
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-speed]'));
const setSpeed = (next: Speed): void => {
  if (speed === 0 && next !== 0) {
    // resuming: now a tick can commit them, so submit everything still planned (uncanceled) while
    // paused, then let the first post-resume delta swap the ghosts for the sim's real buildings
    for (const p of pausedPlacements.values()) {
      command('village.build', { villageId: p.villageId, def: p.def, x: p.x, y: p.y });
    }
    pausedPlacements.clear();
    clearGhostsOnResume = true;
  }
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
  // Only genuinely BLOCKING events (crises/decisions, opt-in per def) halt the sim; everything
  // else stays answerable at leisure while the game runs (no more pausing on every message).
  if (def.blocking === true) setSpeed(0);
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
const joyPanel = panels.register('joy', 'Joy', '😊');
// M47.7 (doc 12 R1): the four "dark systems" get player surfaces — no action below
// requires the debug injector. Campaign-only; the village sandbox shows a hint instead.
const diplomacyPanel = panels.register('diplomacy', 'Diplomacy', '🤝');
const militaryPanel = panels.register('military', 'Military', '⚔');
const researchPanel = panels.register('research', 'Research', '📜');
const victoryPanel = panels.register('victory', 'Victory', '🏆');
// M50 (Phase 8): the capital's castle-defence layer — build palette + garrison posting
const castlePanel = panels.register('castle', 'Castle', '🏰');
// 1.x: rival kingdoms' stored goods live here, off the main view (dedicated window).
const realmsPanel = panels.register('realms', 'Realms', '🌐');
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

  // 1.x: tax rate and tier upgrade are OWNER-ONLY actions (the sim rejects them for foreign
  // villages regardless; hiding the controls avoids implying a settlement you don't rule is
  // editable). A foreign village shows its vitals above, read-only, and no tax/tier row.
  if (v.owned) {
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
  } else {
    body.append(el('div', 'A rival kingdom’s settlement — you can observe it, but not govern it.', 'hint'));
  }

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
  body.append(el('div', 'Pick a building, then click map tiles to place copies. Right-click or Esc exits. While paused, placements are planned as blueprints — click one to cancel it before resuming.', 'hint'));
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

/** A used/total gauge with a fill bar — the inspector's capacity readout. */
function capacityRow(label: string, used: number, total: number): HTMLElement {
  const row = el('div', undefined, 'cap-row');
  const head = el('div', undefined, 'cap-head');
  head.append(el('span', label, 'cap-label'), el('span', `${Math.floor(used)} / ${total}`, 'cap-val'));
  const track = el('div', undefined, 'cap-track');
  const fill = el('div', undefined, 'cap-fill');
  fill.style.width = `${(total > 0 ? Math.min(1, used / total) : 0) * 100}%`;
  if (used > total) fill.classList.add('over'); // e.g. occupants exceeding housing
  track.append(fill);
  row.append(head, track);
  return row;
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

  // Capacity (M-era): used/total for capacity-bearing buildings. Housing and storage
  // caps are POOLED per village, so pair the def's own contribution (from BuildingRec,
  // straight off the def) with the owning village's live totals. Generic over the def
  // fields, so modded buildings with capacity get this for free.
  const housingCap = rec.housingCapacity ?? 0;
  const storageCap = rec.storageCapacity ?? 0;
  if (village !== undefined && rec.progress >= 1 && (housingCap > 0 || storageCap > 0)) {
    body.append(el('div', 'Capacity', 'ledger-heading'));
    if (housingCap > 0) {
      body.append(tip(
        capacityRow('housing', village.population, village.housing),
        `Occupants across the village vs. total housing (Σ housing capacity).\nThis building provides ${housingCap} of those slots.`,
      ));
    }
    if (storageCap > 0) {
      // storage caps are shared across the village and applied PER resource, so surface
      // each stocked good's fill against the cap. Food is special: it has the small keep
      // buffer as its base (KEEP_FOOD_BUFFER), so it uses its own foodCap — surplus food
      // beyond it spoils without a granary. Every number comes from live state.
      body.append(capacityRow('food', village.food, village.foodCap));
      for (const [good, amount] of Object.entries(village.goods)) body.append(capacityRow(good, amount, village.stockCap));
      body.append(tip(
        el('div', `+${storageCap} storage per resource from this building`, 'row hint'),
        'Storage capacity is pooled across the village; food also draws on the keep\'s small larder, everything else on the base store.',
      ));
    }
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

/** One joy contribution as a signed value + bar (points on the 0–100 joy scale). */
function joyFactorRow(label: string, value: number): HTMLElement {
  const row = el('div', undefined, 'cap-row');
  const head = el('div', undefined, 'cap-head');
  head.append(el('span', label, 'cap-label'), el('span', `${value > 0 ? '+' : ''}${value.toFixed(1)}`, 'cap-val'));
  const track = el('div', undefined, 'cap-track');
  const fill = el('div', undefined, 'cap-fill');
  fill.style.width = `${Math.min(100, Math.abs(value))}%`;
  if (value < 0) fill.classList.add('over'); // a reduction (e.g. a punitive edict) shows amber
  track.append(fill);
  row.append(head, track);
  return row;
}

// Joy panel (M-era): explains the settlement's mood and how it drives population, all
// from live sim state (the projection reuses the sim's own joy helpers — no drift).
function renderJoyPanel(): void {
  const body = joyPanel.body;
  body.replaceChildren();
  const v = store.selectedVillage();
  if (v === null || v.joy === undefined) {
    body.append(el('div', 'Joy appears once a settlement is founded.', 'hint'));
    return;
  }
  const joy = v.joy;
  body.append(tip(
    el('div', `${v.name} — joy ${joy.level} / 100`, 'row'),
    'The settlement\'s mood (0–100). It drifts daily toward the target below.',
  ));
  body.append(el('div', `trending toward ${joy.target}`, 'row hint'));

  body.append(el('div', 'What drives joy', 'ledger-heading'));
  for (const f of joy.factors) body.append(joyFactorRow(f.label, f.value));

  body.append(el('div', 'Effect on population', 'ledger-heading'));
  const mig = joy.migrationPerDay;
  const migText = mig > 0.005
    ? `+${mig.toFixed(2)} settlers/day arriving`
    : mig < -0.005
      ? `${mig.toFixed(2)} people/day leaving`
      : 'no net migration';
  body.append(tip(
    el('div', migText, 'row'),
    `Joy above ${joy.neutral} draws newcomers into spare housing; below ${joy.neutral} people leave for better lands.`,
  ));
  body.append(tip(
    el('div', `births ×${joy.fertility.toFixed(2)}`, 'row'),
    'Joy\'s fertility multiplier — a happier village raises more children (×2 at full joy, ~0 when miserable).',
  ));
  body.append(el('div', `neutral point is ${joy.neutral} — ${joy.level >= joy.neutral ? 'growing' : 'shrinking'}`, 'row hint'));
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
let armedArmyAction: { kind: 'move' | 'siege' | 'target'; armyId: number } | null = null;
/** M51: the assault-origin picker's current choice ('auto' derives server-side). */
let assaultOrigin = 'auto';
const battleLog: string[] = [];
const BATTLE_LOG_CAP = 30;
/** M53: fallen enemy capitals whose court has offered homage to the PLAYER —
 * castle village index → capitulation deadline tick. Rendered as accept rows in the
 * Diplomacy panel; cleared when the siege resolves either way. */
const pendingHomage = new Map<number, number>();
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
  // M53: pending homage from fallen capitals the player felled — accept, or let it burn
  for (const [castle] of [...pendingHomage.entries()].sort((a, b) => a[0] - b[0])) {
    const row = el('div', undefined, 'row');
    row.append(el('span', '⚑ A fallen court offers homage — ', 'hint'));
    const accept = document.createElement('button');
    accept.textContent = '👑 Accept capitulation';
    tip(accept, 'The fallen lord survives as your vassal — tribute flows, the war ends.\nIgnore the offer and the city burns when the window closes.');
    accept.addEventListener('click', () => {
      command('siege.acceptCapitulation', { castle });
      send({ kind: 'requestPanels' });
    });
    row.append(accept);
    body.append(row);
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
      // M53 (ADR-4 §3 agency chain): submission is always on the table in a war — and it
      // is THE choice when your keep has fallen (vassalage-first, before the window closes)
      act('🏳 Submit', 'Offer to become their vassal — the run survives, diminished. A hopeless war (or a fallen keep) makes them accept.', () =>
        command('kingdom.proposeVassalage', { counterpart: k.index, asVassal: true }), k.playerIsVassal);
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
  // 1.0: tech-gated units (swordsman/crossbowman/knight/ram/trebuchet) show LOCKED with the
  // tech name until the player researches it. The real guard is server-side (the recruit
  // command rejects it either way); this is just so the palette reads honestly.
  const knownTechs = new Set(panelsState.research?.known ?? []);
  for (const unit of catalog?.units ?? []) {
    const locked = unit.requiresTech !== undefined && !knownTechs.has(unit.requiresTech);
    const row = el('div', undefined, 'row');
    const b = document.createElement('button');
    b.textContent = locked
      ? `🔒 ${unit.name} — needs ${unit.requiresTechName ?? 'a technology'}`
      : `${unit.name} — ${unit.popCost} adults, ${unit.costGold}⛁`;
    tip(b, `${unit.unitClass} · equipment: ${unit.cost.map(([n, a]) => `${a} ${n.toLowerCase()}`).join(', ') || 'none'} · ` +
      `upkeep ${unit.upkeepGold}⛁/season · trains ${Math.round(unit.recruitTicks / 24)} days` +
      (locked ? `\nLocked — research ${unit.requiresTechName ?? unit.requiresTech} to recruit.` : ''));
    if (locked) {
      b.setAttribute('aria-disabled', 'true');
    } else {
      b.addEventListener('click', () => {
        if (selectedArmyVillage !== null) command('army.recruitUnit', { villageId: selectedArmyVillage, unitDef: unit.id });
        send({ kind: 'requestPanels' });
      });
    }
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
      // M51: assault takes an origin — Auto derives it from where the army stands
      const originSelect = document.createElement('select');
      originSelect.setAttribute('aria-label', 'Assault origin');
      for (const [value, label] of [['auto', 'Auto origin'], ['left', 'From the west'], ['right', 'From the east'], ['top', 'From the north'], ['bottom', 'From the south']] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = assaultOrigin === value;
        originSelect.append(option);
      }
      originSelect.addEventListener('change', () => { assaultOrigin = originSelect.value; });
      tip(originSelect, 'Which side of the castle the column storms from (M51). Auto: wherever this army stands.');
      actions.append(originSelect);
      const assault = document.createElement('button');
      assault.textContent = '⚔ Assault';
      tip(assault, 'Storm the walls. A capital resolves on its defence layer — walls, towers, and garrison all fight (M51); elsewhere a breach makes it far cheaper (GDD §8).');
      assault.addEventListener('click', () => {
        command('siege.assault', { armyId: army.id, ...(assaultOrigin !== 'auto' ? { origin: assaultOrigin } : {}) });
        send({ kind: 'requestPanels' });
      });
      // M51 (the M47.7 gap): the bombard-target picker — armed click on the castle's walls
      const target = document.createElement('button');
      target.textContent = armedArmyAction?.kind === 'target' && armedArmyAction.armyId === army.id ? '🎯 click wall…' : '🎯 Target walls';
      tip(target, 'Then click one of the besieged castle\'s wall/gate/tower segments — daily bombardment pounds it toward a breach (M29). Esc cancels.');
      target.addEventListener('click', () => {
        if (store.state.armedBuild !== null) store.armBuild(null);
        armedArmyAction = { kind: 'target', armyId: army.id };
        renderMilitaryPanel();
      });
      const lift = document.createElement('button');
      lift.textContent = '🏳 Lift siege';
      lift.addEventListener('click', () => { command('siege.lift', { armyId: army.id }); send({ kind: 'requestPanels' }); });
      actions.append(assault, target, lift);
    }
    // M51 (the M47.7 gap): sorties — the defender's gambit against a besieger in range
    const sortie = document.createElement('button');
    sortie.textContent = '🗡 Sortie';
    tip(sortie, 'Sally out against an army besieging one of YOUR castles — this army must stand at the besieged castle (M29). Refused otherwise.');
    sortie.addEventListener('click', () => { command('siege.sortie', { armyId: army.id }); send({ kind: 'requestPanels' }); });
    actions.append(sortie);
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

// ---------- castle panel (M50; ADR-4; GDD §7 Phase 8 delta) ----------
// The defence layer draws on a plain 2D canvas INSIDE the panel — deliberately not a second
// PixiRenderer instance (doc 12 M50 scoping note): a 100×100 static grid redrawn only on
// `panels` messages needs no WebGL context, no chunk cache, and no per-frame work, so the
// doc 11 fps gates are untouched by having the view open.
type CastleAction =
  | { mode: 'build'; def: string; w: number; h: number }
  | { mode: 'demolish' }
  | { mode: 'post'; unitId: number };
let castleAction: CastleAction | null = null;
/** M51: the last assault fought on OUR walls — its trace overlays the map as the replay. */
let lastAssaultReport: {
  outcome: string;
  attackerLoss: number;
  defenderLoss: number;
  breaches: number;
  /** M54: the attacker's belief vs. the truth — the "believed ~40; met 85" line. */
  believedGarrison: number | null;
  actualGarrison: number | null;
  trace: { r: number; kind: string; x: number; y: number }[];
} | null = null;

const DEFENCE_TILE_COLORS = ['#232019', '#5a5348', '#3f7aa4'] as const; // open · rock · water
const DEFENCE_KIND_COLORS: Record<string, string> = { keep: '#e8c860', tower: '#c08048', gate: '#a08858', wall: '#8a7a52' };

function decodeRle(pairs: readonly number[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    out.fill(pairs[i] as number, at, at + (pairs[i + 1] as number));
    at += pairs[i + 1] as number;
  }
  return out;
}

function renderCastlePanel(): void {
  const body = castlePanel.body;
  body.replaceChildren();
  const st = panelsState?.defence;
  if (st === undefined || st === null) {
    body.append(el('div', CAMPAIGN_ONLY_HINT, 'hint'));
    return;
  }
  const tiles = decodeRle(st.tiles, st.size * st.size);
  const structureAt = (tx: number, ty: number) =>
    st.structures.find((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);

  body.append(el('h3', 'Castle defence', 'ledger-heading'));
  const status = el('div', undefined, 'hint');
  status.textContent =
    castleAction === null ? 'Pick a structure or unit below, then click the map. Esc cancels.'
    : castleAction.mode === 'build' ? `Placing ${castleAction.def.split('.').pop() ?? ''} — click open ground`
    : castleAction.mode === 'demolish' ? 'Demolishing — click one of your structures'
    : 'Posting garrison — click the tile to hold';
  body.append(status);

  // -- the map --
  const canvas = document.createElement('canvas');
  const scale = 2.7; // 100 tiles into the 300px dock (minus padding)
  canvas.width = Math.floor(st.size * scale);
  canvas.height = Math.floor(st.size * scale);
  canvas.style.cursor = castleAction === null ? 'default' : 'crosshair';
  canvas.setAttribute('aria-label', 'Castle defence map');
  const g = canvas.getContext('2d');
  if (g !== null) {
    for (let y = 0; y < st.size; y++) {
      for (let x = 0; x < st.size; x++) {
        g.fillStyle = DEFENCE_TILE_COLORS[tiles[y * st.size + x] as number] ?? DEFENCE_TILE_COLORS[0];
        g.fillRect(x * scale, y * scale, scale + 0.5, scale + 0.5);
      }
    }
    for (const r of st.structures) {
      g.fillStyle = DEFENCE_KIND_COLORS[r.kind] ?? DEFENCE_KIND_COLORS['wall'] as string;
      g.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      if (r.hp < r.maxHp) {
        g.fillStyle = '#c05050';
        g.fillRect(r.x * scale, r.y * scale, r.w * scale * (1 - r.hp / r.maxHp), 1.5);
      }
    }
    g.fillStyle = '#7ac07a';
    for (const p of st.posts) {
      g.beginPath();
      g.arc((p.x + 0.5) * scale, (p.y + 0.5) * scale, scale * 0.6, 0, Math.PI * 2);
      g.fill();
    }
    // M51: the last assault's replay — the column's walk in red, breaches crossed
    if (lastAssaultReport !== null) {
      const walk = lastAssaultReport.trace.filter((t) => t.kind === 'enter' || t.kind === 'advance' || t.kind === 'keep');
      if (walk.length > 1) {
        g.strokeStyle = '#d06060';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(((walk[0] as { x: number }).x + 0.5) * scale, ((walk[0] as { y: number }).y + 0.5) * scale);
        for (const t of walk.slice(1)) g.lineTo((t.x + 0.5) * scale, (t.y + 0.5) * scale);
        g.stroke();
      }
      g.strokeStyle = '#f0e2b0';
      for (const t of lastAssaultReport.trace.filter((x) => x.kind === 'breach')) {
        g.beginPath();
        g.moveTo(t.x * scale, t.y * scale);
        g.lineTo((t.x + 1) * scale, (t.y + 1) * scale);
        g.moveTo((t.x + 1) * scale, t.y * scale);
        g.lineTo(t.x * scale, (t.y + 1) * scale);
        g.stroke();
      }
    }
  }
  if (lastAssaultReport !== null) {
    const r = lastAssaultReport;
    // M54: the belief-error line — how wrong the attacker's scouts were (ADR-4 §4)
    const intelLine =
      r.actualGarrison === null
        ? ''
        : r.believedGarrison === null
          ? ` They attacked BLIND — met ${r.actualGarrison} defenders.`
          : ` They believed ~${r.believedGarrison} defenders; met ${r.actualGarrison}.`;
    const summary = el(
      'div',
      `Last assault: ${r.outcome === 'captured' ? '⚰ the keep FELL' : '🛡 REPELLED'} — attacker lost ${r.attackerLoss}, garrison lost ${r.defenderLoss}, ${r.breaches} breach(es).${intelLine} The red path replays the column's walk.`,
      'row',
    );
    const clear = document.createElement('button');
    clear.textContent = '× clear';
    clear.addEventListener('click', () => {
      lastAssaultReport = null;
      renderCastlePanel();
    });
    summary.append(clear);
    body.append(summary);
  }

  canvas.addEventListener('click', (e) => {
    if (castleAction === null) return;
    const rect = canvas.getBoundingClientRect();
    const tx = Math.floor(((e.clientX - rect.left) / rect.width) * st.size);
    const ty = Math.floor(((e.clientY - rect.top) / rect.height) * st.size);
    if (castleAction.mode === 'build') {
      command('defence.build', { def: castleAction.def, x: Math.min(tx, st.size - castleAction.w), y: Math.min(ty, st.size - castleAction.h) });
    } else if (castleAction.mode === 'demolish') {
      const target = structureAt(tx, ty);
      if (target === undefined) return;
      command('defence.demolish', { structureId: target.id });
    } else {
      command('defence.post', { unitId: castleAction.unitId, x: tx, y: ty });
      castleAction = null; // posting is one-shot; build/demolish stay armed for runs
    }
    send({ kind: 'requestPanels' });
  });
  body.append(canvas);

  // -- build palette --
  body.append(el('h3', 'Build', 'ledger-heading'));
  const palette = el('div', undefined, 'row');
  for (const b of st.buildable) {
    const btn = document.createElement('button');
    const armed = castleAction?.mode === 'build' && castleAction.def === b.defId;
    btn.textContent = `${armed ? '▶ ' : ''}${b.name}`;
    tip(btn, `${b.name} (${b.w}×${b.h}) — costs ${b.cost.map(([n, a]) => `${a} ${n}`).join(', ')} from the capital's stores`);
    btn.addEventListener('click', () => {
      castleAction = armed ? null : { mode: 'build', def: b.defId, w: b.w, h: b.h };
      renderCastlePanel();
    });
    palette.append(btn);
  }
  const demolishBtn = document.createElement('button');
  demolishBtn.textContent = castleAction?.mode === 'demolish' ? '▶ Demolish' : '⛏ Demolish';
  tip(demolishBtn, 'Then click one of your structures. The keep refuses.');
  demolishBtn.addEventListener('click', () => {
    castleAction = castleAction?.mode === 'demolish' ? null : { mode: 'demolish' };
    renderCastlePanel();
  });
  palette.append(demolishBtn);
  body.append(palette);

  // -- garrison --
  body.append(el('h3', 'Garrison', 'ledger-heading'));
  const postedIds = new Set(st.posts.map((p) => p.unitId));
  const idle = (panelsState?.units ?? []).filter((unit) => unit.complete && unit.armyId === 0 && !postedIds.has(unit.id));
  if (idle.length === 0 && st.posts.length === 0) {
    body.append(el('div', 'No idle units — recruit in the Military panel; garrison shares the same soldier pool.', 'hint'));
  }
  for (const unit of idle) {
    const row = el('div', undefined, 'row');
    row.append(el('span', `${unit.name} ×${unit.count}`));
    const postBtn = document.createElement('button');
    const armed = castleAction?.mode === 'post' && castleAction.unitId === unit.id;
    postBtn.textContent = armed ? '▶ click map…' : 'Post';
    tip(postBtn, 'Then click the defence-map tile this unit should hold.');
    postBtn.addEventListener('click', () => {
      castleAction = armed ? null : { mode: 'post', unitId: unit.id };
      renderCastlePanel();
    });
    row.append(postBtn);
    body.append(row);
  }
  for (const p of st.posts) {
    const unit = panelsState?.units.find((x) => x.id === p.unitId);
    const row = el('div', undefined, 'row');
    row.append(el('span', `⚑ ${unit?.name ?? 'Unit'} at (${p.x}, ${p.y})`));
    const unpostBtn = document.createElement('button');
    unpostBtn.textContent = 'Unpost';
    unpostBtn.addEventListener('click', () => {
      command('defence.unpost', { unitId: p.unitId });
      send({ kind: 'requestPanels' });
    });
    row.append(unpostBtn);
    body.append(row);
  }

  // -- enemy intel (M54, ADR-4 §4): the STALE snapshot — walls as last seen, garrison
  // as your scouts' noisy belief. Never live truth; the "as of" line is the warning. --
  const intel = panelsState?.enemyIntel ?? [];
  if (intel.length > 0) {
    body.append(el('h3', 'Enemy castles (intel)', 'ledger-heading'));
    for (const rec of intel) {
      const asOfDay = Math.floor(rec.asOfTick / 24);
      const garrison = rec.believedGarrison === null ? 'garrison unknown' : `garrison ~${rec.believedGarrison} (believed)`;
      const head = el('div', `${rec.name} — walls as of day ${asOfDay} · ${garrison}`, 'row');
      tip(head, 'A snapshot from your last scouting contact — the layout may have changed since.\nGarrison is a belief: contact-refreshed, decaying, never exact.');
      body.append(head);
      const c = document.createElement('canvas');
      const s = 1.6; // compact stale view
      c.width = Math.floor(rec.size * s);
      c.height = Math.floor(rec.size * s);
      c.setAttribute('aria-label', `${rec.name} castle intel`);
      const gg = c.getContext('2d');
      if (gg !== null) {
        const enemyTiles = decodeRle(rec.tiles, rec.size * rec.size);
        for (let y = 0; y < rec.size; y++) {
          for (let x = 0; x < rec.size; x++) {
            gg.fillStyle = DEFENCE_TILE_COLORS[enemyTiles[y * rec.size + x] as number] ?? DEFENCE_TILE_COLORS[0];
            gg.fillRect(x * s, y * s, s + 0.5, s + 0.5);
          }
        }
        for (const r of rec.structures) {
          gg.fillStyle = DEFENCE_KIND_COLORS[r.kind] ?? (DEFENCE_KIND_COLORS['wall'] as string);
          gg.fillRect(r.x * s, r.y * s, r.w * s, r.h * s);
        }
        // the sepia wash marks it as memory, not observation
        gg.fillStyle = 'rgba(120, 100, 60, 0.25)';
        gg.fillRect(0, 0, c.width, c.height);
      }
      body.append(c);
    }
  }
}

function renderWarPanels(): void {
  renderDiplomacyPanel();
  renderMilitaryPanel();
  renderResearchPanel();
  renderVictoryPanel();
  renderCastlePanel();
}
renderWarPanels(); // initial hint state before any campaign boots
renderRealmsPanel(); // 1.x: rival-goods window — initial "none known yet" hint

// A panel/toast surface is rebuilt wholesale (replaceChildren) on store/snapshot updates.
// That must NOT happen while the user is mid-interaction with it: replacing a live <select>
// snaps its open dropdown shut, and replacing a button between mousedown and mouseup means the
// `click` never fires. Both are the same defect — it only "worked while PAUSED" because pausing
// stops the updates. `isInteracting` reports either condition (an editable control inside holds
// focus, OR the pointer is hovering the surface); callers skip the rebuild then and redraw once
// the interaction ends. Root cause of: tax-select close, toast × dismiss, and building demolish.
const EDITABLE = new Set(['SELECT', 'INPUT', 'TEXTAREA']);
function isInteracting(el: HTMLElement): boolean {
  const active = document.activeElement;
  if (active !== null && EDITABLE.has(active.tagName) && el.contains(active)) return true;
  return el.matches(':hover');
}
function whenIdle(panel: Panel, render: () => void): () => void {
  return () => {
    if (!isInteracting(panel.body)) render();
  };
}
const renderVillagePanelIdle = whenIdle(villagePanel, renderVillagePanel);
const renderKingdomPanelIdle = whenIdle(kingdomPanel, renderKingdomPanel);

store.subscribe(() => {
  renderVillagePanelIdle();
  renderBuildPalette();
  renderKingdomPanelIdle();
  renderJoyPanel();
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
          hud.villages.textContent = '';
        } else {
          void bootRenderer(message.world.widthTiles, message.world.heightTiles, message.entities, message.terrain, message.buildings, message.roads, focus);
        }
      }
      return;
    case 'snapshotDelta': {
      renderer?.mirror.applyDelta(message);
      store.applyVillageStats((message.villageStats ?? []).map((s) => ({ ...s, goods: s.goods ?? {}, housing: s.housing ?? 0, stockCap: s.stockCap ?? 0, foodCap: s.foodCap ?? 0, owned: s.owned ?? true })));
      if ((message.villageStats?.length ?? 0) > 0) {
        renderVillageChips();
        renderRealmsPanel();
      }
      if (renderer !== null) {
        for (const rec of message.buildingsAdded ?? []) renderer.addBuilding(rec);
        if ((message.roadsAdded?.length ?? 0) > 0) renderer.addRoads(message.roadsAdded ?? []);
        const bp = message.buildingProgress ?? [];
        for (let i = 0; i + 1 < bp.length; i += 2) {
          renderer.updateBuildingProgress(bp[i] as number, bp[i + 1] as number);
        }
        for (const id of message.buildingsRemoved ?? []) renderer.removeBuilding(id);
        // first delta after a resume: the queued placements have now committed (they land in this
        // same delta's buildingsAdded, drawn above), so drop the pause-time ghosts. Any ghost with
        // no committed building was a placement the sim rejected (e.g. it outran the stockpile) and
        // is correctly removed too.
        if (clearGhostsOnResume) {
          renderer.clearPlanned();
          clearGhostsOnResume = false;
        }
      }
      // keep the building inspector live: reflect construction progress, and if the
      // selected building was demolished (here or by a siege) drop the stale selection
      if (buildingPanel.isOpen() && selectedBuildingId !== null) {
        if ((message.buildingsRemoved ?? []).includes(selectedBuildingId)) selectBuilding(null);
        // skip the live-stats rebuild while the pointer is on the panel, so the two-click
        // Demolish (and any button) isn't replaced mid-click — the "only works paused" fix.
        else if (!isInteracting(buildingPanel.body)) renderBuildingPanel();
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
    case 'ticked': {
      hud.tick.textContent = String(message.toTick);
      let toastSurfaced = false;
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
        } else if (gameEvent.type === 'siege.begun') {
          // M51 (ADR-4 §3): the warning chain — an enemy army encircling YOUR castle is a
          // blocking, auto-pausing notice that deep-links to the defence view.
          const { defender } = gameEvent.data as { defender?: number };
          if (playerKingdomId !== null && defender === playerKingdomId) {
            setSpeed(0);
            notifications.push({ type: 'siege.begunOnPlayer', tick: gameEvent.tick, data: gameEvent.data as Record<string, unknown> });
            castlePanel.open();
            toastSurfaced = true;
          }
        } else if (gameEvent.type === 'siege.capitalFallen') {
          // M53: YOUR keep fell — blocking, auto-pausing; the Diplomacy panel holds the
          // choice (submit within the window, or the realm burns)
          const { defender } = gameEvent.data as { defender?: number };
          if (playerKingdomId !== null && defender === playerKingdomId) {
            setSpeed(0);
            notifications.push({ type: 'siege.capitalFallenOnPlayer', tick: gameEvent.tick, data: gameEvent.data as Record<string, unknown> });
            diplomacyPanel.open();
            toastSurfaced = true;
          }
        } else if (gameEvent.type === 'siege.capitulationOffered') {
          // M53: the fallen court offers homage to YOU — pause and surface the accept row
          const d = gameEvent.data as { castle: number; lord: number; deadline: number };
          if (playerKingdomId !== null && d.lord === playerKingdomId) {
            setSpeed(0);
            pendingHomage.set(d.castle, d.deadline);
            diplomacyPanel.open();
            renderDiplomacyPanel();
          }
        } else if (gameEvent.type === 'siege.ended') {
          // M53: however a fallen siege resolved, its homage offer is dead
          const { castle } = gameEvent.data as { castle: number };
          if (pendingHomage.delete(castle)) renderDiplomacyPanel();
        } else if (gameEvent.type === 'siege.assaultResolved') {
          // M51: keep the trace for the Castle panel's replay overlay when OUR walls fought
          const d = gameEvent.data as { defender?: number; outcome?: string; attackerLoss?: number; defenderLoss?: number; breaches?: number; believedGarrison?: number | null; actualGarrison?: number; trace?: { r: number; kind: string; x: number; y: number }[] };
          if (playerKingdomId !== null && d.defender === playerKingdomId && Array.isArray(d.trace)) {
            lastAssaultReport = {
              outcome: String(d.outcome),
              attackerLoss: d.attackerLoss ?? 0,
              defenderLoss: d.defenderLoss ?? 0,
              breaches: d.breaches ?? 0,
              believedGarrison: d.believedGarrison ?? null,
              actualGarrison: d.actualGarrison ?? null,
              trace: d.trace,
            };
            renderCastlePanel();
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
        if (notifications.push(gameEvent) !== undefined) toastSurfaced = true;
        audioDirector.push(gameEvent);
      }
      audioDirector.advance(message.toTick); // tension decay even on ticks with no qualifying event
      // Rebuild toasts ONLY when a new one surfaced. Rebuilding every tick (replaceChildren)
      // destroyed a toast and its × button mid-click, so dismiss appeared to work only while
      // paused (no ticks → stable DOM). Notifications no longer pause the sim — only blocking
      // event dialogs do (issue 2).
      if (toastSurfaced) renderToasts();
      return;
    }
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
        } else if (action.kind === 'target') {
          // M51 (the M47.7 gap): pick the bombardment target — the sim validates it is a
          // wall/gate/tower/keep of the besieged castle and rejects anything else
          const picked = renderer.pickBuilding(sx, sy);
          if (picked !== null) command('siege.setTarget', { armyId: action.armyId, buildingId: picked });
          else notifications.push({ type: 'ui.hint', tick: 0, data: { summary: 'Click a wall/gate/tower segment of the besieged castle to bombard it.' } });
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
        const armedDef = store.state.armedBuild;
        if (speed === 0) {
          // paused: the sim is frozen so a real village.build can't commit until resume (a tick
          // would advance construction — see the driver's pause note). Plan the placement CLIENT-SIDE
          // as a blueprint ghost and submit it on resume; clicking an existing ghost cancels it, so
          // the whole layout stays editable while paused.
          const hit = pausedPlacementAt(t.x, t.y);
          if (hit !== null) {
            pausedPlacements.delete(hit);
            renderer.removePlanned(hit);
          } else if (previewValid) {
            const target = store.villageNear(t.x, t.y);
            const def = store.state.catalog?.buildings.find((b) => b.id === armedDef);
            if (target !== null && def !== undefined) {
              pausedPlacements.set(`${t.x},${t.y}`, { villageId: target.id, def: armedDef, x: t.x, y: t.y, w: def.w, h: def.h });
              renderer.addPlanned(t.x, t.y, def.w, def.h, def.category);
            }
          }
        } else {
          const target = store.villageNear(t.x, t.y);
          if (target !== null) command('village.build', { villageId: target.id, def: armedDef, x: t.x, y: t.y });
        }
        // continuous building mode: stay armed after every placement attempt (success OR fail), so
        // the player can drop copy after copy. Only an explicit cancel (Esc / right-click /
        // re-selecting in the palette / another tool) exits. Re-probe the tile just acted on so its
        // outline recolours immediately.
        lastPreviewKey = null;
        updateFootprintPreview();
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
        // paused with no tool armed: a click on a planned (blueprint) placement cancels it, so the
        // player can prune the layout without re-arming the Build tool
        const gt = renderer.tileAt(sx, sy);
        const ghostHit = speed === 0 ? pausedPlacementAt(gt.x, gt.y) : null;
        if (ghostHit !== null) {
          pausedPlacements.delete(ghostHit);
          renderer.removePlanned(ghostHit);
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
  { key: 'J', description: 'Toggle Joy panel', action: () => joyPanel.toggle() },
  { key: 'D', description: 'Toggle Diplomacy panel', action: () => diplomacyPanel.toggle() },
  { key: 'A', description: 'Toggle Military panel', action: () => militaryPanel.toggle() },
  { key: 'R', description: 'Toggle Research panel', action: () => researchPanel.toggle() },
  { key: 'Y', description: 'Toggle Victory panel', action: () => victoryPanel.toggle() },
  { key: 'M', description: 'Toggle Mods panel', action: () => modsPanel.toggle() },
  { key: '`', description: 'Toggle debug / sandbox editor panel', action: () => setDebugOpen(!debugOpen) },
  { key: 'Escape', description: 'Cancel armed build/army/castle order, or close keybind help', action: (): void => {
    if (armedArmyAction !== null) {
      armedArmyAction = null;
      renderMilitaryPanel();
    } else if (castleAction !== null) {
      castleAction = null;
      renderCastlePanel();
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
