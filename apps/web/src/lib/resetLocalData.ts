// Dev-only OPFS wipe. Called from Settings → Advanced → "重置本地数据".
// Walks the origin's private file system root, removes every entry
// (recursively), and reloads the page so `boot()` reseeds from scratch.
//
// Safe to call from any surface; the caller is responsible for any
// confirmation UX — this helper just does the work.

export async function resetLocalData(): Promise<void> {
  if (!('storage' in navigator) || typeof navigator.storage.getDirectory !== 'function') {
    throw new Error('OPFS 不可用 —— 换一个支持 OPFS 的浏览器或检查安全上下文。');
  }
  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  // @ts-expect-error — FileSystemDirectoryHandle.keys() is async-iterable
  // in Chrome 86+ / Safari 15.2+ but lib.dom.d.ts still lags behind.
  for await (const name of root.keys()) names.push(name as string);
  for (const name of names) {
    await root.removeEntry(name, { recursive: true });
  }
  location.reload();
}
