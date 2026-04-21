import { spawn } from "child_process";

/**
 * Optional integration: path to life-os priority_infer.py.
 * Leave PRIORITY_SCRIPT_PATH unset to run without priority inference
 * (tasks will surface as `priority: null` and the UI renders an unranked
 * chip). Set to an absolute path to enable the subprocess-pooled call.
 * See docs/LIFE-OS.md for wiring details.
 */
// Sprint I deferred D-02 — whitespace-only env var collapses to null so
// the graceful-degradation path (priority: null) fires, not the literal
// whitespace string being passed to spawn.
const PRIORITY_SCRIPT: string | null = process.env.PRIORITY_SCRIPT_PATH?.trim() || null;
const POOL_SIZE = 4;
const TIMEOUT_MS = 500;
const LRU_CAP = 500;

export interface PriorityInput {
  impact?: string;
  urgency?: string;
  due?: string;
  parentGoalTimeframe?: string;
}

export interface PriorityResult {
  score: number;
  rank: "critical" | "high" | "medium" | "low";
  breakdown: Record<string, number | string>;
}

// Simple LRU cache: insertion-ordered Map with cap enforcement
const lruCache = new Map<string, PriorityResult>();

function cacheKey(input: PriorityInput): string {
  return JSON.stringify({
    impact: input.impact ?? null,
    urgency: input.urgency ?? null,
    due: input.due ?? null,
    parentGoalTimeframe: input.parentGoalTimeframe ?? null,
  });
}

function cacheGet(key: string): PriorityResult | undefined {
  if (!lruCache.has(key)) return undefined;
  // Move to end (most recently used)
  const value = lruCache.get(key)!;
  lruCache.delete(key);
  lruCache.set(key, value);
  return value;
}

function cacheSet(key: string, value: PriorityResult): void {
  if (lruCache.has(key)) lruCache.delete(key);
  lruCache.set(key, value);
  // Evict oldest if over cap
  if (lruCache.size > LRU_CAP) {
    const firstKey = lruCache.keys().next().value;
    if (firstKey !== undefined) lruCache.delete(firstKey);
  }
}

// Worker pool: semaphore-style concurrency limiting via promise queue
let activeWorkers = 0;
const workerQueue: Array<() => void> = [];

function acquireWorker(): Promise<void> {
  return new Promise((resolve) => {
    if (activeWorkers < POOL_SIZE) {
      activeWorkers++;
      resolve();
    } else {
      workerQueue.push(() => {
        activeWorkers++;
        resolve();
      });
    }
  });
}

function releaseWorker(): void {
  activeWorkers--;
  const next = workerQueue.shift();
  if (next) next();
}

/** Check if python3 is available (cached after first check). */
let pythonAvailable: boolean | null = null;

async function checkPythonAvailable(): Promise<boolean> {
  if (pythonAvailable !== null) return pythonAvailable;
  return new Promise((resolve) => {
    const proc = spawn("python3", ["--version"], { timeout: 2000 });
    proc.on("close", (code) => {
      pythonAvailable = code === 0;
      resolve(pythonAvailable);
    });
    proc.on("error", () => {
      pythonAvailable = false;
      resolve(false);
    });
  });
}

/**
 * Compute priority for a task by shelling out to priority_infer.py.
 *
 * Returns null when:
 * - All inputs are empty (no signal to compute from)
 * - python3 is not available
 * - Subprocess times out (500ms)
 * - Any subprocess error
 *
 * Uses LRU cache (cap 500) to avoid repeated subprocess calls for identical inputs.
 * Pool size of 4 concurrent workers prevents subprocess storm on cold start.
 */
export async function computePriority(input: PriorityInput): Promise<PriorityResult | null> {
  // If all inputs are empty, skip
  if (!input.impact && !input.urgency && !input.due && !input.parentGoalTimeframe) {
    return null;
  }

  // Graceful degradation: PRIORITY_SCRIPT_PATH not configured (public
  // release default). UI handles `priority: null` via the unranked chip.
  if (PRIORITY_SCRIPT === null) return null;

  const key = cacheKey(input);
  const cached = cacheGet(key);
  if (cached) return cached;

  // Graceful degradation: python3 not found
  const hasPython = await checkPythonAvailable();
  if (!hasPython) return null;

  await acquireWorker();

  try {
    const result = await runPriorityScript(input);
    if (result) cacheSet(key, result);
    return result;
  } finally {
    releaseWorker();
  }
}

function runPriorityScript(input: PriorityInput): Promise<PriorityResult | null> {
  return new Promise((resolve) => {
    // computePriority already guards PRIORITY_SCRIPT !== null before calling
    // us, but TS can't narrow across the function boundary. Re-assert here.
    if (PRIORITY_SCRIPT === null) {
      resolve(null);
      return;
    }
    const scriptPath: string = PRIORITY_SCRIPT;
    const args = ["--json"];
    if (input.impact) args.push("--impact", input.impact);
    if (input.urgency) args.push("--urgency", input.urgency);
    if (input.due) args.push("--due", input.due);
    if (input.parentGoalTimeframe) args.push("--goal-timeframe", input.parentGoalTimeframe);

    const proc = spawn("python3", [scriptPath, ...args], {
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let timedOut = false;

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[priority] stderr: ${chunk.toString()}`);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        process.stderr.write(`[priority] subprocess timed out for input: ${JSON.stringify(input)}\n`);
        resolve(null);
        return;
      }
      if (code !== 0) {
        process.stderr.write(`[priority] subprocess exited ${code} for input: ${JSON.stringify(input)}\n`);
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as PriorityResult;
        resolve(parsed);
      } catch {
        process.stderr.write(`[priority] failed to parse output: ${stdout.slice(0, 200)}\n`);
        resolve(null);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      process.stderr.write(`[priority] spawn error: ${err}\n`);
      resolve(null);
    });
  });
}

/** Flush the priority cache (call on vault-changed events). */
export function flushPriorityCache(): void {
  lruCache.clear();
}
