import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NowView } from './features/now-view/NowView';
import { CyclePlanner } from './features/cycle-planner/CyclePlanner';
import { TemplateEditor } from './features/template-editor/TemplateEditor';
import { useStore } from './store';

type View = 'now' | 'planner' | 'template';

export default function App() {
  const { t } = useTranslation();
  const tick = useStore((s) => s.tick);
  const [view, setView] = useState<View>('now');

  useEffect(() => {
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [tick]);

  return (
    <main className="mx-auto flex min-h-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="font-mono text-sm uppercase tracking-widest text-slate-500">
          {t('appName')}
        </h1>
        <LocaleSwitcher />
      </header>

      <nav className="flex gap-1 self-start rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
        <TabButton label={t('view_now')} active={view === 'now'} onClick={() => setView('now')} />
        <TabButton
          label={t('view_planner')}
          active={view === 'planner'}
          onClick={() => setView('planner')}
        />
        <TabButton
          label={t('view_template')}
          active={view === 'template'}
          onClick={() => setView('template')}
        />
      </nav>

      {view === 'now' && (
        <div className="mx-auto w-full max-w-xl">
          <NowView />
          <p className="mt-6 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
            {t('first_launch_hint')}
          </p>
        </div>
      )}
      {view === 'planner' && <CyclePlanner />}
      {view === 'template' && (
        <div className="mx-auto w-full max-w-xl">
          <TemplateEditor />
        </div>
      )}
    </main>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1 font-mono text-xs uppercase tracking-widest transition ${
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function LocaleSwitcher() {
  const { i18n } = useTranslation();
  const other = i18n.language.startsWith('zh') ? 'en' : 'zh-CN';
  return (
    <button
      type="button"
      className="font-mono text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      onClick={() => {
        localStorage.setItem('dayrail.locale', other);
        void i18n.changeLanguage(other);
      }}
    >
      {other === 'zh-CN' ? '中文' : 'EN'}
    </button>
  );
}
