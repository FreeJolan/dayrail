// Empty-state hint shown by Today Track + Cycle View when the user
// hasn't created any templates yet. Replaces the v0.7-era sample seed
// (see boot.ts comment dated 2026-05-08 for the data-loss incident
// that motivated the change).

import { useNavigate } from 'react-router-dom';

export function EmptyTemplatesHint() {
  const navigate = useNavigate();
  return (
    <section className="flex flex-col items-start gap-3 rounded-md border border-hairline/60 bg-surface-1 px-5 py-6">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Empty
      </span>
      <h2 className="text-base font-medium text-ink-primary">还没有模板</h2>
      <p className="text-sm text-ink-secondary">
        DayRail 用模板描述不同形态的一天。
      </p>
      <button
        type="button"
        onClick={() => navigate('/templates')}
        className="mt-1 rounded-md bg-cta px-3 py-1.5 text-sm font-medium text-cta-foreground transition hover:bg-cta-hover"
      >
        新建第一个模板 →
      </button>
    </section>
  );
}
