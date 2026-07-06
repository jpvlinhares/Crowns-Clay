/**
 * Browser Web Worker entry (TDD §1). Bundled as the worker script from M6 (Vite);
 * kept dependency-light — all logic lives in simPort.ts, shared with headless hosts.
 */
import type { TransportPort } from '@crowns/protocol';
import { connectKernelToPort } from './simPort.js';

// Minimal worker-global surface (full WebWorker lib types arrive with Vite in M6).
declare const self: {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
};

const port: TransportPort = {
  postMessage: (message) => self.postMessage(message),
  onMessage: (handler) => {
    self.onmessage = (event) => handler(event.data);
  },
};

connectKernelToPort(port, () => performance.now());
