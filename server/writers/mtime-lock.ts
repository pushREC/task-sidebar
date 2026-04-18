import { stat } from "fs/promises";
import { safetyError } from "../safety.js";

/**
 * Sprint H.2.1 — optimistic concurrency control for writers.
 *
 * If the caller passes `expectedModified`, we `fs.stat` the target path
 * and compare `stat.mtime.toISOString()` byte-for-byte against it. On
 * mismatch we throw a `safetyError(..., 409, {currentModified})`. The
 * router's `handleError` merges the `extra` object into the JSON response,
 * so the client sees `{ok:false, error:"mtime-mismatch", currentModified:"..."}`
 * and can refetch before overwriting.
 *
 * If `expectedModified` is `undefined`, this function is a no-op —
 * backward-compatible with callers that don't yet pass the flag.
 *
 * Design notes (first-principles / Plan II §0.2 T-H2):
 *   - Server-side clock only. We never trust client-supplied wall time.
 *     The expected value originated from a prior `fs.stat` on this server,
 *     so comparing ISO strings is exact.
 *   - ENOENT propagates. Caller (task-body-edit etc.) typically calls
 *     `existsSync` BEFORE this helper and surfaces 404 from its own path.
 *   - Atomic-rename drift: `writeFileAtomic` uses `tmp + fsync + rename`;
 *     the post-rename mtime is the tmp file's mtime (new). A client that
 *     previously read the file under its old mtime will see 409 on next
 *     edit — correct.
 */
export async function assertMtimeMatch(
  absPath: string,
  expectedModified: string | undefined,
): Promise<void> {
  if (expectedModified === undefined) return;

  const st = await stat(absPath);
  const currentModified = st.mtime.toISOString();
  if (currentModified !== expectedModified) {
    throw safetyError("mtime-mismatch", 409, { currentModified });
  }
}
