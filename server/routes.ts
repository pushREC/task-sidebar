import type { Request, Response, Router as ExpressRouter } from "express";
import { Router } from "express";
import { toggleTask } from "./writers/task-toggle.js";
import { addTask } from "./writers/task-add.js";
import { editTask } from "./writers/task-edit.js";
import { moveTask } from "./writers/task-move.js";
import { editTaskField } from "./writers/task-field-edit.js";
import { editTaskStatus } from "./writers/task-status-edit.js";
import { createEntityTask } from "./writers/task-create-entity.js";
import { promoteTask } from "./writers/task-promote.js";
import { promoteAndEditTask } from "./writers/task-promote-and-edit.js";
import { editProjectField } from "./writers/project-field-edit.js";
import { deleteEntityTask, deleteInlineTask } from "./writers/task-delete.js";
import { editTaskBody } from "./writers/task-body-edit.js";
import { cancelReconcile } from "./status-reconcile-queue.js";
import { resolveTasksPath, assertSafeTasksPath } from "./safety.js";
import type { SafetyError } from "./safety.js";

const router: ExpressRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

function isSafetyError(err: unknown): err is SafetyError {
  return (
    err instanceof Error &&
    typeof (err as SafetyError).statusCode === "number"
  );
}

function handleError(err: unknown, res: Response): void {
  if (isSafetyError(err)) {
    // Sprint H.2.1 — merge `extra` (e.g. currentModified on 409 mtime-mismatch)
    // into the JSON body alongside the existing {ok, error} envelope.
    const body: Record<string, unknown> = { ok: false, error: err.message };
    if (err.extra) Object.assign(body, err.extra);
    res.status(err.statusCode).json(body);
  } else {
    process.stderr.write(`[routes] unexpected error: ${err}\n`);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

// ─── POST /api/tasks/toggle ──────────────────────────────────────────────────

router.post("/tasks/toggle", async (req: Request, res: Response) => {
  const { tasksPath, line, done } = req.body as Record<string, unknown>;

  if (typeof tasksPath !== "string") {
    res.status(400).json({ ok: false, error: "tasksPath must be a string" });
    return;
  }
  if (typeof line !== "number") {
    res.status(400).json({ ok: false, error: "line must be a number" });
    return;
  }
  if (done !== true && done !== false && done !== "next") {
    res.status(400).json({ ok: false, error: 'done must be a boolean or "next"' });
    return;
  }

  try {
    const result = await toggleTask({ tasksPath, line, done: done as boolean | "next" });
    res.json({ ok: true, slug: result.slug, newCheckbox: result.newCheckbox });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/add ─────────────────────────────────────────────────────

router.post("/tasks/add", async (req: Request, res: Response) => {
  const { slug, text, section } = req.body as Record<string, unknown>;

  if (typeof slug !== "string") {
    res.status(400).json({ ok: false, error: "slug must be a string" });
    return;
  }
  if (typeof text !== "string") {
    res.status(400).json({ ok: false, error: "text must be a string" });
    return;
  }
  if (section !== undefined && section !== "open" && section !== "inbox") {
    res.status(400).json({ ok: false, error: 'section must be "open" or "inbox"' });
    return;
  }

  try {
    const result = await addTask({
      slug,
      text,
      section: (section as "open" | "inbox" | undefined) ?? "open",
    });
    res.json({ ok: true, slug: result.slug, line: result.line });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/edit ────────────────────────────────────────────────────

router.post("/tasks/edit", async (req: Request, res: Response) => {
  const { tasksPath, line, newText } = req.body as Record<string, unknown>;

  if (typeof tasksPath !== "string") {
    res.status(400).json({ ok: false, error: "tasksPath must be a string" });
    return;
  }
  if (typeof line !== "number") {
    res.status(400).json({ ok: false, error: "line must be a number" });
    return;
  }
  if (typeof newText !== "string") {
    res.status(400).json({ ok: false, error: "newText must be a string" });
    return;
  }

  try {
    const result = await editTask({ tasksPath, line, newText });
    res.json({ ok: true, slug: result.slug });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/move ────────────────────────────────────────────────────

router.post("/tasks/move", async (req: Request, res: Response) => {
  const { sourcePath, line, targetSlug } = req.body as Record<string, unknown>;

  if (typeof sourcePath !== "string") {
    res.status(400).json({ ok: false, error: "sourcePath must be a string" });
    return;
  }
  if (typeof line !== "number") {
    res.status(400).json({ ok: false, error: "line must be a number" });
    return;
  }
  if (typeof targetSlug !== "string") {
    res.status(400).json({ ok: false, error: "targetSlug must be a string" });
    return;
  }

  try {
    const result = await moveTask({ sourcePath, line, targetSlug });
    res.json({
      ok: true,
      sourceSlug: result.sourceSlug,
      targetSlug: result.targetSlug,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/field-edit ──────────────────────────────────────────────

router.post("/tasks/field-edit", async (req: Request, res: Response) => {
  const { entityPath, field, value } = req.body as Record<string, unknown>;

  if (typeof entityPath !== "string") {
    res.status(400).json({ ok: false, error: "entityPath must be a string" });
    return;
  }
  if (typeof field !== "string") {
    res.status(400).json({ ok: false, error: "field must be a string" });
    return;
  }
  if (value === undefined) {
    res.status(400).json({ ok: false, error: "value is required" });
    return;
  }

  try {
    const result = await editTaskField({ entityPath, field, value });
    res.json({ ok: true, entityPath: result.entityPath });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/status-edit ─────────────────────────────────────────────

router.post("/tasks/status-edit", async (req: Request, res: Response) => {
  const { entityPath, status } = req.body as Record<string, unknown>;

  if (typeof entityPath !== "string") {
    res.status(400).json({ ok: false, error: "entityPath must be a string" });
    return;
  }
  if (typeof status !== "string") {
    res.status(400).json({ ok: false, error: "status must be a string" });
    return;
  }

  try {
    const result = await editTaskStatus({ entityPath, status });
    res.json({ ok: true, entityPath: result.entityPath, reconcileFired: result.reconcileFired });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/create-entity ───────────────────────────────────────────

router.post("/tasks/create-entity", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const { slug, action } = body;

  if (typeof slug !== "string") {
    res.status(400).json({ ok: false, error: "slug must be a string" });
    return;
  }
  if (typeof action !== "string") {
    res.status(400).json({ ok: false, error: "action must be a string" });
    return;
  }

  try {
    const result = await createEntityTask({
      slug,
      action,
      impact: typeof body.impact === "string" ? body.impact : undefined,
      urgency: typeof body.urgency === "string" ? body.urgency : undefined,
      "energy-level": typeof body["energy-level"] === "string" ? body["energy-level"] : undefined,
      "estimated-duration": typeof body["estimated-duration"] === "number" ? body["estimated-duration"] : undefined,
      due: typeof body.due === "string" ? body.due : undefined,
      parentGoal: typeof body.parentGoal === "string" ? body.parentGoal : undefined,
      owner: typeof body.owner === "string" ? body.owner : undefined,
    });
    res.status(201).json({ ok: true, entityPath: result.entityPath, taskSlug: result.taskSlug });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/promote ─────────────────────────────────────────────────

router.post("/tasks/promote", async (req: Request, res: Response) => {
  const { sourcePath, line } = req.body as Record<string, unknown>;

  if (typeof sourcePath !== "string") {
    res.status(400).json({ ok: false, error: "sourcePath must be a string" });
    return;
  }
  if (typeof line !== "number") {
    res.status(400).json({ ok: false, error: "line must be a number" });
    return;
  }

  try {
    const result = await promoteTask({ sourcePath, line });
    res.json({ ok: true, entityPath: result.entityPath, taskSlug: result.taskSlug });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/promote-and-edit ───────────────────────────────────────

router.post("/tasks/promote-and-edit", async (req: Request, res: Response) => {
  const { tasksPath, line, field, value } = req.body as Record<string, unknown>;

  if (typeof tasksPath !== "string") {
    res.status(400).json({ ok: false, error: "tasksPath must be a string" });
    return;
  }
  if (typeof line !== "number") {
    res.status(400).json({ ok: false, error: "line must be a number" });
    return;
  }
  if (typeof field !== "string") {
    res.status(400).json({ ok: false, error: "field must be a string" });
    return;
  }
  if (value === undefined) {
    res.status(400).json({ ok: false, error: "value is required" });
    return;
  }

  try {
    const result = await promoteAndEditTask({ tasksPath, line, field, value });
    res.json({ ok: true, entityPath: result.entityPath, taskSlug: result.taskSlug });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/delete-entity ───────────────────────────────────────────

router.post("/tasks/delete-entity", async (req: Request, res: Response) => {
  const { entityPath } = req.body as Record<string, unknown>;

  if (typeof entityPath !== "string") {
    res.status(400).json({ ok: false, error: "entityPath must be a string" });
    return;
  }

  try {
    const result = await deleteEntityTask({ entityPath });
    res.json({ ok: true, entityPath: result.entityPath });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/delete-inline ───────────────────────────────────────────

router.post("/tasks/delete-inline", async (req: Request, res: Response) => {
  const { tasksPath, line, expectedAction } = req.body as Record<string, unknown>;

  if (typeof tasksPath !== "string") {
    res.status(400).json({ ok: false, error: "tasksPath must be a string" });
    return;
  }
  if (typeof line !== "number") {
    res.status(400).json({ ok: false, error: "line must be a number" });
    return;
  }
  if (typeof expectedAction !== "string") {
    res.status(400).json({ ok: false, error: "expectedAction must be a string" });
    return;
  }

  try {
    const result = await deleteInlineTask({ tasksPath, line, expectedAction });
    res.json({ ok: true, tasksPath: result.tasksPath, line: result.line });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/body-edit ───────────────────────────────────────────────

router.post("/tasks/body-edit", async (req: Request, res: Response) => {
  const { entityPath, body } = req.body as Record<string, unknown>;

  if (typeof entityPath !== "string") {
    res.status(400).json({ ok: false, error: "entityPath must be a string" });
    return;
  }
  if (typeof body !== "string") {
    res.status(400).json({ ok: false, error: "body must be a string" });
    return;
  }

  try {
    const result = await editTaskBody({ entityPath, body });
    res.json({ ok: true, entityPath: result.entityPath });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/tasks/cancel-reconcile ─────────────────────────────────────────
// Sprint G — client calls this after an Undo within the 5s pending window
// to cancel a queued status_reconcile.py fire. Safe to call for paths with
// no pending reconcile (returns { canceled: false }).

router.post("/tasks/cancel-reconcile", async (req: Request, res: Response) => {
  const { entityPath } = req.body as Record<string, unknown>;

  if (typeof entityPath !== "string") {
    res.status(400).json({ ok: false, error: "entityPath must be a string" });
    return;
  }

  try {
    const resolved = resolveTasksPath(entityPath);
    assertSafeTasksPath(resolved);
    const canceled = cancelReconcile(resolved);
    res.json({ ok: true, canceled });
  } catch (err) {
    handleError(err, res);
  }
});

// ─── POST /api/projects/field-edit ───────────────────────────────────────────

router.post("/projects/field-edit", async (req: Request, res: Response) => {
  const { slug, field, value } = req.body as Record<string, unknown>;

  if (typeof slug !== "string") {
    res.status(400).json({ ok: false, error: "slug must be a string" });
    return;
  }
  if (typeof field !== "string") {
    res.status(400).json({ ok: false, error: "field must be a string" });
    return;
  }
  if (value === undefined) {
    res.status(400).json({ ok: false, error: "value is required" });
    return;
  }

  try {
    const result = await editProjectField({ slug, field, value });
    res.json({ ok: true, readmePath: result.readmePath });
  } catch (err) {
    handleError(err, res);
  }
});

export { router as taskRoutes };
