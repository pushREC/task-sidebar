import type { Request, Response } from "express";

/**
 * Broadcast payload shape. `slug` kept as a single identifier for backwards
 * compatibility when the coalesce window contained exactly one slug. When
 * multiple distinct slugs were invalidated within the window, `slugs` carries
 * the full set (sorted for deterministic wire output) so consumers retain
 * enough info to narrow their refetch scope if they ever need to.
 *
 * Current client (src/api.ts:subscribeVaultEvents) only uses the event as a
 * refetch trigger and does not read slug/slugs — so this field widening is a
 * forward-looking stability fix, not a behavior change.
 */
export interface VaultChangedEvent {
  type: "vault-changed";
  slug: string | "all";
  slugs?: string[];
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
//
// Sprint I.9 R1 — Opus P7 SSE-COALESCE-SLUG-LOSS (MEDIUM): the prior
// implementation kept only the LAST pendingEvent, discarding every earlier
// slug in the window. For clients that consume the slug (or diagnostic
// tooling reading the frame), multi-project invalidations collapsed to a
// single slug, dropping actionable context. Current src/api.ts only uses
// the event as a refetch trigger, but the server side now accumulates ALL
// distinct slugs in a Set:
//   - 0 slugs in window ⇒ no-op (impossible unless broadcast not called)
//   - 1 slug  in window ⇒ { slug: "foo" }  (backwards-compat shape)
//   - >1 slug in window ⇒ { slug: "all", slugs: [...] } (sorted, deterministic)
//
// T-I5 irreducible truth preserved: still exactly one SSE frame per quiet
// window, so 10 rapid writes within 150ms emit ≤ 2 SSE events.
const COALESCE_MS = 100;
const pendingSlugs = new Set<string>();
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  coalesceTimer = null;
  if (pendingSlugs.size === 0) return;
  const slugs = Array.from(pendingSlugs).sort();
  pendingSlugs.clear();
  if (activeClients.size === 0) return;
  const event: VaultChangedEvent =
    slugs.length === 1
      ? { type: "vault-changed", slug: slugs[0] }
      : { type: "vault-changed", slug: "all", slugs };
  const payload = `event: vault-changed\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of activeClients) {
    res.write(payload);
  }
}

export function broadcast(event: VaultChangedEvent): void {
  // Accumulate every slug observed in the window. The widened
  // `slugs` input is carried through intact; single-slug inputs
  // are added individually. Dedup is intrinsic to Set semantics.
  if (event.slugs !== undefined) {
    for (const s of event.slugs) pendingSlugs.add(s);
  } else {
    pendingSlugs.add(event.slug);
  }
  if (coalesceTimer !== null) return; // already scheduled; trailing edge will flush
  coalesceTimer = setTimeout(flush, COALESCE_MS);
  coalesceTimer.unref?.();
}
