import { stat } from "fs/promises";
import { safetyError } from "../safety.js";

/**
 * Sprint H.2.1 — optimistic concurrency control for writers.
 * Sprint H R1 (Opus + Gemini) — upgraded to nanosecond precision.
 *
 * Protocol:
 *   - Client sends `expectedModified` as a string. Two formats are
 *     accepted for back-compat:
 *       (a) BigInt-string of nanoseconds (e.g. "1776552269646123456") — preferred
 *       (b) ISO8601 millisecond string (e.g. "2026-04-18T22:32:06.183Z") — legacy
 *   - Server stats the file and produces BOTH representations from
 *     `stat.mtimeNs` (BigInt nanoseconds). If the client value looks
 *     like a digits-only string, compare as BigInt; else compare as ISO.
 *   - Mismatch → 409 with `currentModified` (ISO) AND `currentModifiedNs`
 *     (BigInt string) for forward-compat.
 *
 * Why nanosecond: macOS APFS + Linux ext4 store nanosecond mtime. Two
 * writes within the same millisecond produce identical ISO strings —
 * an optimistic lock comparing ISO would let the second write clobber
 * the first silently. BigInt ns comparison is exact.
 *
 * API response carries `currentModified` (ISO, for display) AND
 * `currentModifiedNs` (source-of-truth, for next-edit handshake).
 */

function toNsString(nsBigint: bigint): string {
  return nsBigint.toString();
}

export async function assertMtimeMatch(
  absPath: string,
  expectedModified: string | undefined,
): Promise<void> {
  if (expectedModified === undefined) return;

  // BigIntStats surfaces mtimeNs (BigInt nanoseconds) on node ≥ 18. The
  // non-BigInt variant rounds to mtimeMs (ms precision) which produces
  // ISO collisions between writes in the same millisecond.
  const st = await stat(absPath, { bigint: true });
  const currentNs: bigint = st.mtimeNs;
  // ISO string for display + legacy comparison. Build from ms since
  // epoch (derived from ns) — Date() only accepts number, so divide.
  const currentMs = Number(currentNs / 1_000_000n);
  const currentModified = new Date(currentMs).toISOString();
  const currentModifiedNs = toNsString(currentNs);

  // Digit-only string → BigInt ns comparison (high precision, preferred).
  // Anything else → ISO string fallback (millisecond precision, legacy).
  const isDigits = /^\d+$/.test(expectedModified);
  const match = isDigits
    ? expectedModified === currentModifiedNs
    : expectedModified === currentModified;

  if (!match) {
    throw safetyError("mtime-mismatch", 409, {
      currentModified,
      currentModifiedNs,
    });
  }
}
