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
};
const villageStats = new Map<number, { name: string; population: number; food: number; happiness: number }>();
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
      void bootRenderer(message.world.widthTiles, message.world.heightTiles, message.entities, message.terrain, message.buildings);
      return;
    case 'snapshotDelta': {
      renderer?.mirror.applyDelta(message);
      for (const stat of message.villageStats ?? []) {
        villageStats.set(stat.id, stat);
      }
      if ((message.villageStats?.length ?? 0) > 0) {
        hud.villages.textContent = [...villageStats.values()]
          .map((s) => `${s.name}: pop ${s.population} · food ${s.food} · joy ${s.happiness}`)
          .join('  |  ');
      }
      if (renderer !== null) {
        for (const rec of message.buildingsAdded ?? []) renderer.addBuilding(rec);
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
        }
      }
      return;
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
      if (e.shiftKey) {
        const t = renderer.tileAt(sx, sy);
        const name = renderer.terrainNameAt(t.x, t.y);
        dbg.inspect.textContent = name !== null ? `tile (${t.x}, ${t.y}) · ${name}` : `tile (${t.x}, ${t.y}) · out of bounds`;
        selectedEntity = null;
        if (!debugOpen) setDebugOpen(true);
      } else {
        const picked = renderer.pickEntity(sx, sy) ?? renderer.pickBuilding(sx, sy);
        if (picked !== null) {
          selectedEntity = picked;
          send({ kind: 'debug', op: 'inspect', entityId: picked });
          if (!debugOpen) setDebugOpen(true);
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
