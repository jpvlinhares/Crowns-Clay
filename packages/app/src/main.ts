/**
 * Browser entry (roadmap M6): boots the sim worker, mirrors snapshots, drives
 * the PixiJS renderer at display rate with interpolation, and provides the
 * first HUD (fps / tick / calendar / speed controls) plus pan/zoom input.
 *
 * Layout of responsibilities (TDD §1): everything here is presentation — the
 * worker owns truth; this file only sends commands/pump and draws snapshots.
 */
import type { BuildingRec, EntityRec, FromSimMessage, TerrainSnapshot, ToSimMessage } from '@crowns/protocol';
import { PixiRenderer, TerrainView } from '@crowns/render';
import { BASE_TICKS_PER_SECOND, type Speed } from '@crowns/sim';
import { NotificationQueue, PanelHost, UIStore } from '@crowns/ui';

const SEED = 0x5eed1; // the golden-fixture wanderers seed — what you see is what CI verifies

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
  kingdom: document.getElementById('kingdom-stats') as HTMLElement,
};
const villageStats = new Map<number, { name: string; population: number; food: number; happiness: number; goods?: Record<string, number> }>();
let speed: Speed = 1;
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-speed]'));
const setSpeed = (next: Speed): void => {
  speed = next;
  send({ kind: 'setSpeed', speed: next });
  for (const b of speedButtons) b.classList.toggle('active', Number(b.dataset['speed']) === next);
};
for (const b of speedButtons) b.addEventListener('click', () => setSpeed(Number(b.dataset['speed']) as Speed));
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') setSpeed(speed === 0 ? 1 : 0);
  if (e.key >= '1' && e.key <= '4') setSpeed(([1, 2, 4, 8] as const)[Number(e.key) - 1] as Speed);
});

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

const store = new UIStore();
const notifications = new NotificationQueue();
const panels = new PanelHost(
  document.getElementById('panel-dock') as HTMLElement,
  document.getElementById('ui-toolbar') as HTMLElement,
);
const villagePanel = panels.register('village', 'Village', '🏘');
const buildPanel = panels.register('build', 'Build', '🔨');
const kingdomPanel = panels.register('kingdom', 'Kingdom', '👑');
villagePanel.open();

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
};

function renderVillagePanel(): void {
  const body = villagePanel.body;
  body.replaceChildren();
  const v = store.selectedVillage();
  if (v === null) {
    body.append(el('div', 'No village yet.', 'hint'));
    return;
  }
  body.append(el('div', `${v.name} — tier ${v.tier}`, 'row'));
  body.append(el('div', `pop ${v.population} · joy ${v.happiness} · food ${v.food}`, 'row'));
  const goods = Object.entries(v.goods).map(([name, amount]) => `${name} ${String(amount)}`).join(' · ');
  if (goods.length > 0) body.append(el('div', goods, 'row'));

  const taxRow = el('div', undefined, 'row');
  taxRow.append(el('span', 'tax'));
  const select = document.createElement('select');
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
  upgrade.textContent = 'Upgrade tier';
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
  body.append(el('div', 'Click a building, then a map tile. Shift-click keeps placing; Esc cancels.', 'hint'));
  for (const building of catalog.buildings) {
    const row = el('div', undefined, 'row');
    const b = document.createElement('button');
    const cost = building.cost.map(([n, a]) => `${a} ${n.toLowerCase()}`).join(', ');
    b.textContent = `${building.name} — ${cost}`;
    if (building.tier > (v?.tier ?? 1)) {
      b.disabled = true;
      b.title = `requires village tier ${building.tier}`;
    }
    if (store.state.armedBuild === building.id) b.classList.add('armed');
    b.addEventListener('click', () => store.armBuild(store.state.armedBuild === building.id ? null : building.id));
    row.append(b);
    body.append(row);
  }
}

function renderKingdomPanel(): void {
  const body = kingdomPanel.body;
  body.replaceChildren();
  const k = store.state.kingdom;
  body.append(el('div', k === null ? 'Awaiting the first roll-up…' : `⛁ ${k.treasury.toFixed(0)} · net ${k.net >= 0 ? '+' : ''}${k.net.toFixed(1)}/day`, 'row'));
  const catalog = store.state.catalog;
  if (catalog === null) return;
  for (const edict of catalog.edicts) {
    const active = store.state.activeEdicts.has(edict.id);
    const row = el('div', undefined, 'row');
    row.append(el('span', `${edict.name} (${edict.upkeep}/day)${active ? ' — active' : ''}`));
    const b = document.createElement('button');
    b.textContent = active ? 'Repeal' : 'Enact';
    if (active) b.classList.add('active');
    b.addEventListener('click', () => command(active ? 'kingdom.repealEdict' : 'kingdom.enactEdict', { edict: edict.id }));
    row.append(b);
    body.append(row);
  }
}

store.subscribe(() => {
  renderVillagePanel();
  renderBuildPalette();
  renderKingdomPanel();
});

const toastHost = document.getElementById('toasts') as HTMLElement;
function renderToasts(): void {
  toastHost.replaceChildren();
  for (const n of notifications.visible()) {
    toastHost.append(el('div', n.text, `toast ${n.severity}`));
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && store.state.armedBuild !== null) store.armBuild(null);
});

// ---------- boot ----------
let renderer: PixiRenderer | null = null;
let lastDeltaTick = 0;
let lastDeltaAtMs = 0;

// ---------- debug panel (M9 — later the sandbox editor shell, GDD §17) ----------
const dbg = {
  panel: document.getElementById('debug') as HTMLElement,
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
window.addEventListener('keydown', (e) => {
  if (e.key === '`' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    setDebugOpen(!debugOpen);
  }
});

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
      return;
    case 'snapshotFull':
      store.applyFull(message.catalog, message.kingdom);
      if (renderer !== null) {
        // a loaded save replaces the whole world state (M17): re-mirror it
        renderer.mirror.applyFull(message.entities);
        renderer.setBuildings(message.buildings ?? []);
        renderer.setRoads(message.roads ?? []);
        villageStats.clear();
        hud.villages.textContent = '';
        hud.kingdom.textContent = '';
      } else {
        void bootRenderer(message.world.widthTiles, message.world.heightTiles, message.entities, message.terrain, message.buildings, message.roads);
      }
      return;
    case 'snapshotDelta': {
      renderer?.mirror.applyDelta(message);
      for (const stat of message.villageStats ?? []) {
        villageStats.set(stat.id, stat);
      }
      store.applyVillageStats((message.villageStats ?? []).map((s) => ({ ...s, goods: s.goods ?? {} })));
      if ((message.villageStats?.length ?? 0) > 0) {
        hud.villages.textContent = [...villageStats.values()]
          .map((s) => {
            const goods = Object.entries(s.goods ?? {})
              .map(([name, amount]) => ` · ${name} ${amount}`)
              .join('');
            return `${s.name}: pop ${s.population} · food ${s.food} · joy ${s.happiness}${goods}`;
          })
          .join('  |  ');
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
          // the ledger UI, v1 (M16): treasury and yesterday's net, to the coin
          const r = gameEvent.data as { treasury: number; taxes: number; upkeep: number; salaries: number; net: number };
          const sign = r.net >= 0 ? '+' : '−';
          hud.kingdom.textContent =
            `⛁ ${r.treasury.toFixed(0)} (${sign}${Math.abs(r.net).toFixed(1)}/day · tax ${r.taxes.toFixed(1)} − upkeep ${(r.upkeep + r.salaries).toFixed(1)})`;
          store.applyRollup(r);
        } else if (gameEvent.type === 'kingdom.edictEnacted' || gameEvent.type === 'kingdom.edictRepealed' || gameEvent.type === 'kingdom.edictLapsed') {
          const { edict } = gameEvent.data as { edict: string };
          store.applyEdictChange(edict, gameEvent.type === 'kingdom.edictEnacted');
        }
        notifications.push(gameEvent);
      }
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
    case 'hash':
    case 'rejected':
      return;
  }
};

async function bootRenderer(
  widthTiles: number,
  heightTiles: number,
  entities: EntityRec[],
  terrain?: TerrainSnapshot,
  buildings?: BuildingRec[],
  roads?: number[],
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
    if (!dragging || renderer === null) return;
    renderer.camera.pan(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  let downAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    // click (not drag) → inspect: entity, or shift for the tile under cursor
    if (downAt !== null && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4 && renderer !== null) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // build placement mode (M18): an armed palette entry claims the click
      if (store.state.armedBuild !== null) {
        const t = renderer.tileAt(sx, sy);
        const target = store.villageNear(t.x, t.y);
        if (target !== null) {
          command('village.build', { villageId: target.id, def: store.state.armedBuild, x: t.x, y: t.y });
          if (!e.shiftKey) store.armBuild(null); // shift keeps placing
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
        // player selection (M18): a building click focuses its village panel
        const picked = renderer.pickBuilding(sx, sy);
        const rec = picked !== null ? renderer.buildingRec(picked) : null;
        if (rec !== null) {
          store.selectVillage(rec.village);
          villagePanel.open();
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

send({ kind: 'init', seed: SEED });
setSpeed(1);
