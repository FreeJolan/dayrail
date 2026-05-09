// Always-visible "DEV BUILD" strip rendered when running off the
// Vite dev server (i.e. `pnpm dev` or `pnpm desktop:dev`). Returns
// null in production. Goal: keep me from accidentally treating a
// dev-server window as my daily DayRail and writing real data into a
// container that's intentionally isolated from prod (via WKWebView's
// per-bundle-id storage scheme — dev and prod must NOT share data,
// since dev is where I run destructive tests).

export function DevModeIndicator() {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      role="presentation"
      className="fixed inset-x-0 top-0 z-[300] flex h-3 items-center justify-center bg-cta/80 text-cta-foreground shadow-sm"
    >
      <span className="font-mono text-[9px] uppercase leading-none tracking-[0.18em]">
        Dev build · 数据与正式版隔离
      </span>
    </div>
  );
}
