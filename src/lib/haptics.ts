/**
 * Sprint J.2.11 — Haptics feedback.
 *
 * Tiny tactile reinforcement on key user actions (task toggle, bulk
 * success, delete confirm). Feature-detected against `navigator.vibrate`
 * and gated by `prefers-reduced-motion: reduce` — silent no-op on
 * unsupported devices and for vestibular-sensitive users (matches T-J5
 * irreducible truth from the plan).
 *
 * Why a dedicated module: keeps the feature-detect + reduced-motion
 * guard in one place so call sites stay one-line. Adding this once vs
 * inlining the guard at every call site avoids drift if the policy
 * changes (e.g. adding an iOS Web Vibration shim later).
 *
 * Architecture Lock #1 (Darkroom-Minimal aesthetic) is unaffected — no
 * visual surface, no role-color, no font.
 */

/**
 * Trigger a brief haptic pulse if supported AND the user has not
 * requested reduced motion. Default duration is 10ms — short enough to
 * register as "tap-confirmed" without being a buzz.
 *
 * Safe to call from any event handler. Never throws. Never blocks.
 */
export function pulse(ms: number = 10): void {
  // Server-side / SSR guard — `window` is undefined under Node/SSR.
  if (typeof window === "undefined") return;

  // Feature detection — `navigator.vibrate` is unsupported on Safari
  // desktop, iOS Safari, and many embedded WebViews. Treat absence as
  // a silent no-op rather than a console warning (which would itself
  // be an AI-tell and Architecture Lock #3 violation).
  const nav = window.navigator;
  if (!nav || typeof nav.vibrate !== "function") return;

  // Reduced-motion guard. Vestibular sensitivity covers vibration too,
  // not just visual motion. The user's prefers-reduced-motion signal
  // is the canonical "no incidental motion please" channel — respect
  // it for haptics symmetrically with the keyframe suppressions in
  // styles.css.
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    // matchMedia can throw in extremely sandboxed contexts (rare).
    // Bail out conservatively rather than calling vibrate.
    return;
  }

  // Vibrate may throw in some browser security contexts (e.g. iframes
  // without user activation). Swallow — haptics is decorative; never
  // surface an error from a non-essential effect.
  try {
    nav.vibrate(ms);
  } catch {
    /* silent no-op */
  }
}
