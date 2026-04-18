import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { boot } from './boot';
import { injectThemeTokens } from './lib/themeTokens';
import { initTheme } from './lib/theme';
import { resetLocalData } from './lib/resetLocalData';
import './index.css';

// Theme setup runs before React mounts so the loading veil + first
// paint already wear the right mode — no flash of light theme when
// the user has `dark` saved.
injectThemeTokens();
initTheme();

// Boot the data layer before React takes over. OPFS init + event-log
// replay typically finishes in <50 ms on a warm cache; first-ever
// load may take ~150-200 ms while the WASM module compiles.
const container = document.getElementById('root')!;
const root = ReactDOM.createRoot(container);

root.render(
  <React.StrictMode>
    <LoadingVeil />
  </React.StrictMode>,
);

boot()
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((err) => {
    const error = err as Error;
    // Log the full object so the stack + cause are inspectable in
    // DevTools regardless of what the UI shows.
    console.error('[boot] failed:', error);
    console.error('[boot] stack:', error.stack);
    root.render(
      <React.StrictMode>
        <BootError error={error} />
      </React.StrictMode>,
    );
  });

function LoadingVeil() {
  return (
    <div className="flex h-full items-center justify-center bg-surface-0">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Opening DayRail…
      </span>
    </div>
  );
}

function BootError({ error }: { error: Error }) {
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const copy = async () => {
    const text = `${error.name}: ${error.message}\n\n${error.stack ?? ''}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };
  const looksCorrupt = /SQLITE_CORRUPT|malformed|SQLITE_NOTADB/i.test(
    `${error.name} ${error.message}`,
  );
  const wipeAndReload = async () => {
    if (
      !window.confirm(
        '清空本地 OPFS 里的事件 / 快照 / 缓存，然后刷新页面？\n此操作不可撤销。',
      )
    ) {
      return;
    }
    setResetting(true);
    setResetError(null);
    try {
      await resetLocalData();
    } catch (e) {
      setResetting(false);
      setResetError((e as Error).message);
    }
  };
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-start justify-center gap-4 bg-surface-0 px-10 py-16">
      <span className="font-mono text-2xs uppercase tracking-widest text-warn">
        Boot failed
      </span>
      <h1 className="text-xl font-medium text-ink-primary">DayRail 启动失败</h1>

      <section className="w-full rounded-md bg-surface-1 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Error
            </span>
            <p className="break-words text-sm text-ink-primary">
              <span className="font-mono text-ink-secondary">{error.name}: </span>
              {error.message}
            </p>
          </div>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-sm bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
          >
            复制
          </button>
        </div>
        {error.stack && (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Stack
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-sm bg-surface-0 px-3 py-2 font-mono text-2xs leading-relaxed text-ink-secondary">
              {error.stack}
            </pre>
          </details>
        )}
      </section>

      <div className="flex flex-col gap-1 text-xs text-ink-tertiary">
        <p>常见原因：</p>
        <ul className="ml-4 list-disc space-y-0.5">
          <li>非安全上下文（需要 https 或 localhost）</li>
          <li>浏览器版本过低（Chrome 86+ / Safari 15.2+ / Firefox 可能受限）</li>
          <li>隐私窗口 / 扩展拦截了 OPFS 存储</li>
          <li>WASM 模块未能加载（查看 Network 面板是否有 404）</li>
          {looksCorrupt && (
            <li>
              <strong className="text-ink-secondary">SQLite 数据损坏</strong>
              —— OPFS 里的数据库文件被截断 / 写坏。需要清空本地数据重启。
            </li>
          )}
        </ul>
        <p className="mt-2">
          完整 stack 在浏览器 DevTools Console 里（标签{' '}
          <code className="font-mono">[boot]</code>）。复制粘给我定位。
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Recovery
        </span>
        <button
          type="button"
          onClick={wipeAndReload}
          disabled={resetting}
          className="self-start rounded-md bg-warn px-3 py-2 text-sm font-medium text-surface-0 transition hover:brightness-95 disabled:opacity-50"
        >
          {resetting ? '正在清空…' : '清空本地数据并重新启动'}
        </button>
        <p className="text-2xs text-ink-tertiary">
          会清掉 OPFS 里所有 DayRail 的事件 / 快照，刷新后按初始种子重跑。
        </p>
        {resetError && (
          <p className="rounded-sm bg-surface-1 px-3 py-2 text-xs text-warn">
            清空失败：{resetError}
            <br />
            <span className="text-ink-tertiary">
              最常见：还有另一个同源 tab 没关。先关掉再试；或在 DevTools
              Console 跑：
            </span>
            <code className="mt-1 block font-mono text-2xs text-ink-secondary">
              {
                "const r = await navigator.storage.getDirectory(); for await (const n of r.keys()) await r.removeEntry(n, {recursive: true}); location.reload();"
              }
            </code>
          </p>
        )}
      </section>
    </div>
  );
}
