import { writeFile, rename, unlink, open } from "fs/promises";
import { randomUUID } from "crypto";
import { safetyError } from "../safety.js";

/**
 * Atomically writes `contents` to `targetPath` using a tmp-file + fsync + rename pattern.
 * This prevents chokidar (or any other watcher) from seeing a half-written file.
 *
 * On the same filesystem, rename(2) is atomic on POSIX — the file either has
 * the old contents or the new contents, never a partial write.
 */
export async function writeFileAtomic(
  targetPath: string,
  contents: string
): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;

  try {
    // Write to the temp file
    await writeFile(tmpPath, contents, "utf8");

    // fsync to ensure the data reaches disk before we rename
    const fileHandle = await open(tmpPath, "r");
    try {
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    // Atomic rename over the target
    await rename(tmpPath, targetPath);
  } catch (err) {
    // Best-effort cleanup of the tmp file
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore — tmp file may not exist if writeFile itself failed
    }
    throw err;
  }
}

/**
 * Exclusively creates a file at `targetPath`. Fails with a 409 SafetyError
 * if the file already exists (O_EXCL guarantee — atomic check-and-create).
 * Use for create-entity where two parallel creates of the same slug must
 * not silently overwrite each other.
 */
export async function writeFileExclusive(
  targetPath: string,
  contents: string
): Promise<void> {
  let handle;
  try {
    // 'wx' = O_WRONLY | O_CREAT | O_EXCL — fails with EEXIST if path exists.
    handle = await open(targetPath, "wx");
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "EEXIST") {
      throw safetyError(`File already exists: ${targetPath}`, 409);
    }
    throw err;
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* ignore */ }
    }
  }
}
