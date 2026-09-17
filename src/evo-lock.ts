import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";

const lockPath = ".evo/lock";

export interface LockHolder { pid: number; command: string; startedAt: string; }

/** Fail-fast advisory lock: one heavy evo command at a time. */
export async function acquireLock(command: string): Promise<void> {
  await mkdir(".evo", { recursive: true });
  const handle = await open(lockPath, "wx").catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    const holder = await readHolder();
    if (holder && isAlive(holder.pid))
      throw new Error(`Another evo command is running: '${holder.command}' (pid ${holder.pid}, started ${holder.startedAt}).\nWait for it to finish, or check 'evo status'.`);
    if (holder)
      throw new Error(`Stale lock from '${holder.command}' (pid ${holder.pid} is no longer running).\nDelete ${lockPath} to clear it, then retry.`);
    throw new Error(`An unreadable ${lockPath} exists. Delete it if no evo process is running.`);
  });
  const info: LockHolder = { pid: process.pid, command, startedAt: new Date().toISOString() };
  try { await writeFile(handle, `${JSON.stringify(info)}\n`); } finally { await handle.close(); }
}

export async function releaseLock(): Promise<void> {
  const holder = await readHolder();
  if (holder?.pid === process.pid) await unlink(lockPath).catch(() => undefined);
}

export async function readHolder(): Promise<LockHolder | undefined> {
  try { return JSON.parse(await readFile(lockPath, "utf8")) as LockHolder; } catch { return undefined; }
}

export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
