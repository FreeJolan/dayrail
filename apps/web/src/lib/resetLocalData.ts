// Dev-only OPFS wipe. Called from Settings → Advanced → "重置本地数据".
// Walks the origin's private file-system root, removes every entry
// recursively, and reloads so `boot()` reseeds.
//
// v0.7: removed the SQLite-worker close step — there is no SQL worker
// anymore; the only OPFS file we manage is `dayrail-state.dryj` which
// is written via createWritable + close (releases handles each call),
// so removeEntry is free to delete it.
//
// Safe to call from any surface; the caller owns the confirmation UX.

export async function resetLocalData(): Promise<void> {
  if (!('storage' in navigator) || typeof navigator.storage.getDirectory !== 'function') {
    throw new Error('OPFS 不可用 —— 换一个支持 OPFS 的浏览器或检查安全上下文。');
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
