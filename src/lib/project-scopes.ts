/**
 * Shared project-status allowlist used by AgendaView AND App.tsx's tab-count
 * derivation. C-8 fix — prevents Agenda badge from undercounting when legacy
 * entity-schemas.md status values are in play.
 *
 * Exported as a frozen Set for fast membership checks.
 */
export const AGENDA_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "backlog",
  "blocked",
  "paused",
  // Compatibility with the older entity-schemas.md enum that some README
  // files still use. Resolved in a future spec-level decision.
  "on-track",
  "at-risk",
  "off-track",
  "overdue",
  "not-started",
]);
