/**
 * Tiny fuzzy scorer for small lists (projects, tasks, tabs).
 *
 * Scoring (higher is better):
 *   - Exact prefix match → 1000 bonus
 *   - All query chars appear in order → base 100 + consecutive-run bonus
 *   - Consecutive matches stack: each contiguous run doubles its weight
 *   - Case-insensitive throughout
 *
 * Returns `null` when the query has chars that don't appear in order.
 * Caller sorts by score desc and picks a top-N window.
 *
 * Intentionally zero-dependency and ~30 lines; we don't need fzf-grade
 * tricks at vault scale (<50 projects, ~2k tasks).
 */
export function fuzzyScore(haystack: string, query: string): number | null {
  if (!query) return 0;
  const hay = haystack.toLowerCase();
  const q = query.toLowerCase();

  // Fast path: exact prefix match is the winner.
  if (hay.startsWith(q)) return 1000 + q.length;

  // Substring match (non-prefix): strong but less than prefix.
  const subIdx = hay.indexOf(q);
  if (subIdx !== -1) return 500 + q.length - subIdx;

  // Char-by-char in-order match with consecutive-run bonus.
  let score = 100;
  let hi = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = hay.indexOf(ch, hi);
    if (found === -1) return null;
    if (found === hi) {
      run += 1;
      score += run * 2;
    } else {
      run = 1;
    }
    hi = found + 1;
  }
  return score;
}

export interface FuzzyResult<T> {
  item: T;
  score: number;
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  limit = 20
): FuzzyResult<T>[] {
  if (!query) return items.slice(0, limit).map((item) => ({ item, score: 0 }));
  const out: FuzzyResult<T>[] = [];
  for (const item of items) {
    const score = fuzzyScore(getText(item), query);
    if (score !== null) out.push({ item, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
