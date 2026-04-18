// Dev-only OPFS wipe. Called from Settings → Advanced → "重置本地数据".
// Closes the SQLite worker (which is holding sync-access handles on
// the OPFS files — otherwise `removeEntry` throws "modifications are
// not allowed"), walks the origin's private file-system root, removes
// every entry recursively, and reloads so `boot()` reseeds.
//
// Safe to call from any surface; the caller owns the confirmation UX.

import { resetDb } from '@dayrail/db';

export async function resetLocalData(): Promise<void> {
  if (!('storage' in navigator) || typeof navigator.storage.getDirectory !== 'function') {
    throw new Error('OPFS 不可用 —— 换一个支持 OPFS 的浏览器或检查安全上下文。');
  }

  // 1. Close the SQLite worker so its sync-access handles release.
  //    Without this, sqlite-wasm's OPFS VFS holds exclusive locks on
  //    `dayrail.sqlite3` + its journal and `removeEntry` fails with
  //    "An attempt was made to modify an object where modifications are
  //    not allowed".
  try {
    await resetDb();
  } catch {
    /* best-effort — if it fails we still try to wipe below */
  }

  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  // @ts-expect-error — FileSystemDirectoryHandle.keys() is async-iterable
  // in Chrome 86+ / Safari 15.2+ but lib.dom.d.ts still lags behind.
  for await (const name of root.keys()) names.push(name as string);

  const failed: Array<{ name: string; err: unknown }> = [];
  for (const name of names) {
    try {
      await root.removeEntry(name, { recursive: true });
    } catch (err) {
      failed.push({ name, err });
    }
  }

  if (failed.length > 0) {
    // Usually means something still holds an access handle (an
    // unrelated tab with the same origin open, a stale worker, etc.).
    const detail = failed
      .map((f) => `${f.name}: ${(f.err as Error).message}`)
      .join('\n');
    throw new Error(
      `部分 OPFS 条目仍被占用：\n${detail}\n\n关掉其它同源 tab / 刷新再试。`,
    );
  }

  location.reload();
}
