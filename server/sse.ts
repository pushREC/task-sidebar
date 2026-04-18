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

export function broadcast(event: VaultChangedEvent): void {
  if (activeClients.size === 0) return;

  const payload = `event: vault-changed\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of activeClients) {
    res.write(payload);
  }
}
