import type { Request, Response } from "express";

export interface VaultChangedEvent {
  type: "vault-changed";
  slug: string | "all";
}

const activeClients = new Set<Response>();

const KEEPALIVE_INTERVAL_MS = 25_000;

let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function ensureKeepalive(): void {
  if (keepaliveTimer !== null) return;
  keepaliveTimer = setInterval(() => {
    for (const res of activeClients) {
      res.write(":\n\n");
    }
    if (activeClients.size === 0) {
      // Stop timer when no clients connected
      if (keepaliveTimer !== null) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    }
  }, KEEPALIVE_INTERVAL_MS);
  // Allow process to exit even when timer is active
  keepaliveTimer.unref();
}

export function sseHandler(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if present
  res.flushHeaders();

  // Send an immediate comment so the client knows the connection is live
  res.write(":\n\n");

  activeClients.add(res);
  ensureKeepalive();

  req.on("close", () => {
    activeClients.delete(res);
  });
}

// Sprint I.5 — coalesce rapid broadcasts into one SSE frame.
//
// Problem: a bulk action (e.g. bulk-done on 50 tasks) fires 50 writer
// invalidations → 50 broadcast calls → 50 SSE frames → 50 client-side
// fetchVault calls. The seq-paired fetchVault correctly drops stale
// responses (Sprint H R2 D3), but the network + server work of 50
// parallel requests is wasteful.
//
// Fix: debounce broadcast by COALESCE_MS. Multiple rapid broadcasts
// emit exactly one frame at the trailing edge of the quiet window.
// Slug choice: the LAST triggering slug wins (most-recent-slug semantic).
// Clients don't use the slug for anything besides logging anyway —
// the fetchVault refetches the whole vault regardless.
//
// T-I5 irreducible truth: 10 rapid writes within 150ms emit ≤ 2 SSE events.
const COALESCE_MS = 100;
let pendingEvent: VaultChangedEvent | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  coalesceTimer = null;
  if (pendingEvent === null) return;
  const event = pendingEvent;
  pendingEvent = null;
  if (activeClients.size === 0) return;
  const payload = `event: vault-changed\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of activeClients) {
    res.write(payload);
  }
}

export function broadcast(event: VaultChangedEvent): void {
  pendingEvent = event;
  if (coalesceTimer !== null) return; // already scheduled; trailing edge will flush
  coalesceTimer = setTimeout(flush, COALESCE_MS);
  coalesceTimer.unref?.();
}
