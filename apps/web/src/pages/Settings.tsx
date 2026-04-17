import { useState } from 'react';
import { clsx } from 'clsx';
import {
  Cloud,
  Info,
  Palette,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import {
  AboutSection,
  AdvancedSection,
  AISection,
  AppearanceSection,
  SyncSection,
} from '@/components/SettingsSections';

// ERD §5.9 F5 — master-detail settings. Left 240 px nav + right content.
// Shares the master-detail vocabulary with §5.5 Projects — same grammar,
// different density. Mobile falls back to single-column push (v0.2).

type SectionKey = 'appearance' | 'sync' | 'ai' | 'advanced' | 'about';

interface NavItem {
  key: SectionKey;
  label: string;
  icon: typeof Cloud;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'sync', label: '同步', icon: Cloud },
  { key: 'ai', label: 'AI 辅助', icon: Sparkles },
  { key: 'advanced', label: '高级', icon: SettingsIcon },
  { key: 'about', label: '关于', icon: Info },
];

export function Settings() {
  const [active, setActive] = useState<SectionKey>('appearance');

  return (
    <div className="flex min-h-screen w-full">
      <SettingsNav active={active} onSelect={setActive} />
      <section className="flex min-w-0 flex-1 justify-start">
        <div className="w-full max-w-[720px] px-10 py-10 xl:pl-14">
          {active === 'appearance' && <AppearanceSection />}
          {active === 'sync' && <SyncSection />}
          {active === 'ai' && <AISection />}
          {active === 'advanced' && <AdvancedSection />}
          {active === 'about' && <AboutSection />}
        </div>
      </section>
    </div>
  );
}

function SettingsNav({
  active,
  onSelect,
}: {
  active: SectionKey;
  onSelect: (key: SectionKey) => void;
}) {
  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-transparent">
      <header className="px-4 pt-6">
        <h1 className="font-mono text-sm font-medium tracking-wide text-ink-primary">
          Settings
        </h1>
      </header>
      <nav className="mt-6 flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map((it) => (
          <NavBtn
            key={it.key}
            item={it}
            active={active === it.key}
            onClick={() => onSelect(it.key)}
          />
        ))}
      </nav>

      <div className="mt-auto px-4 pb-6">
        <p className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          §5.9
        </p>
      </div>
    </aside>
  );
}

function NavBtn({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'relative flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition',
        active
          ? 'bg-surface-2 text-ink-primary'
          : 'text-ink-secondary hover:bg-surface-1 hover:text-ink-primary',
      )}
    >
      <Icon
        className="h-3.5 w-3.5 text-ink-tertiary"
        strokeWidth={active ? 1.8 : 1.6}
      />
      <span className={active ? 'font-medium' : undefined}>{item.label}</span>
      {active && (
        <span
          aria-hidden
          className="absolute left-[-10px] h-4 w-[3px] rounded-r bg-ink-primary"
        />
      )}
    </button>
  );
}
