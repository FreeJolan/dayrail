import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { boot } from './boot';
import './index.css';

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
    console.error('[boot]', err);
    root.render(
      <React.StrictMode>
        <BootError message={(err as Error).message} />
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

function BootError({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-center">
      <span className="font-mono text-2xs uppercase tracking-widest text-warn">
        Boot failed
      </span>
      <p className="max-w-md text-sm text-ink-primary">{message}</p>
      <p className="max-w-md text-xs text-ink-tertiary">
        DayRail 目前依赖浏览器 OPFS（Chrome 102+ / Safari 15.2+）。可尝试在新隐私标签或升级浏览器后重试。
      </p>
    </div>
  );
}
