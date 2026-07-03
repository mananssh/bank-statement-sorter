/**
 * Runs once per server start (dev and prod). Boots the autosave layer:
 * WAL checkpoints, rotating snapshots, and the shutdown snapshot hook.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutosave } = await import("@/lib/db/autosave");
    startAutosave();
  }
}
