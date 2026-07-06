/**
 * Headless kernel runner — the M3 "watch it tick" tool.
 *
 *   node packages/tools/dist/headless.js [days] [seed]
 *
 * Boots the same session composition the browser worker uses (via @crowns/app),
 * subscribes to calendar events, injects demo commands through the command bus,
 * and prints per-season progress plus the final determinism hash. Running it
 * twice with the same seed must print the same hash.
 */
import type { FromSimMessage, ToSimMessage, TransportPort } from '@crowns/protocol';
import { TICKS_PER_DAY, type SeasonStartedData, type GameEventLike } from './reexports.js';
import { connectKernelToPort } from '@crowns/app';

const days = Math.max(1, Number(process.argv[2] ?? 180) | 0);
const seed = Number(process.argv[3] ?? 12345) | 0;

// In-process transport: the same message protocol the browser worker speaks.
let toSim: ((message: unknown) => void) | null = null;
const port: TransportPort = {
  postMessage: (message) => handleFromSim(message as FromSimMessage),
  onMessage: (handler) => {
    toSim = handler;
  },
};
connectKernelToPort(port);
const send = (message: ToSimMessage): void => toSim?.(message);

let eventCount = 0;
let lastHash = 0;

function handleFromSim(message: FromSimMessage): void {
  switch (message.kind) {
    case 'ready':
      console.log(`sim ready · seed=${seed} · running ${days} in-game days\n`);
      return;
    case 'ticked':
      for (const event of message.events) {
        eventCount++;
        if (event.type === 'time.seasonStarted') {
          const { date } = (event as GameEventLike<SeasonStartedData>).data;
          console.log(`tick ${String(event.tick).padStart(6)} · year ${date.year} · ${date.seasonName} begins`);
        }
      }
      for (const command of message.executed) {
        console.log(`tick ${String(command.tick).padStart(6)} · executed ${command.type} (issuer ${command.issuer})`);
      }
      return;
    case 'hash':
      lastHash = message.hash;
      return;
    case 'rejected':
      console.error(`rejected: ${message.reason}`);
      return;
    case 'fatal':
      console.error(`FATAL: ${message.message}`);
      process.exitCode = 1;
      return;
  }
}

send({ kind: 'init', seed });
send({ kind: 'submit', drafts: [{ type: 'demo.hello', issuer: 1, payload: {} }] }); // exercises rejection path
send({ kind: 'step', ticks: days * TICKS_PER_DAY });
send({ kind: 'requestHash' });

console.log(`\n${days} days simulated · ${eventCount} events · state hash 0x${lastHash.toString(16).padStart(8, '0')}`);
console.log('re-run with the same seed: the hash must be identical (determinism contract, TDD §5)');
