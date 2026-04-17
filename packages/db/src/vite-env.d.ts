// Vite's `?worker` / `?worker&inline` import suffixes build a
// module as a separate Web Worker bundle and return a constructor.
// packages/db doesn't depend on Vite directly (it's consumed by
// apps/web which does), so we declare the types locally.

declare module '*?worker' {
  const WorkerCtor: new (options?: { name?: string }) => Worker;
  export default WorkerCtor;
}

declare module '*?worker&inline' {
  const WorkerCtor: new (options?: { name?: string }) => Worker;
  export default WorkerCtor;
}
