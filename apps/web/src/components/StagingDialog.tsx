import { clsx } from 'clsx';
import { Check, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  commitPlan,
  parseIntentsFromText,
  projectIntent,
  storeStagingWriters,
  useStagingStore,
  useStore,
  type IntentFrequency,
  type IntentSpec,
  type IntentTime,
  type ParseIntentsConfig,
  type ProposalShape,
  type StagingProposal,
  type UserProfile,
} from '@dayrail/core';
import { getAiApiKey, subscribeAiApiKey } from '@/lib/aiApiKey';
import { useIme } from '@/lib/ime';

// ERD §6.7 — the AI "待确认提案" review surface. A modal (NOT a docked
// drawer): the flow is transient — paste → review → confirm/discard →
// clear — so it's invoked on demand (`g a`) and shows zero chrome when
// idle; a quiet count pill (StagingIndicator) appears only while
// proposals are pending. Per §6.7 + the "model isn't reliable, expose
// every knob" principle, each card lets the user edit ALL of the
// intent's parameters (shape-aware), so a wrong AI guess is a one-edit
// fix rather than a re-prompt.

const AI_BASE_URL_DEFAULT = 'https://openrouter.ai/api/v1';
const COMMIT_TOAST_MS = 8000;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function hhmmToMinutes(s: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!match) return null;
  const h = Number(match[1]);
  const mm = Number(match[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

type ParseConfigResult =
  | { ok: true; config: ParseIntentsConfig }
  | { ok: false; reason: string };

function buildParseConfig(profile: UserProfile | null, apiKey: string): ParseConfigResult {
  if (profile?.aiEnabled !== true) return { ok: false, reason: 'AI 还没启用' };
  const key = apiKey.trim();
  const baseUrl = (profile.aiBaseUrl || AI_BASE_URL_DEFAULT).trim();
  const model = (profile.aiModel ?? '').trim();
  if (!key) return { ok: false, reason: '还没填 API key' };
  if (!model) return { ok: false, reason: '还没选模型' };
  return { ok: true, config: { baseUrl, apiKey: key, model } };
}

// ── Quiet entry point: a count pill, shown only when proposals wait ──

export function StagingIndicator({ onOpen }: { onOpen: () => void }) {
  // Subscribe to a primitive (count), never a fresh object.
  const count = useStagingStore((s) => Object.keys(s.proposals).length);
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 rounded-full bg-cta px-3.5 py-2 text-sm text-cta-foreground shadow-lg transition hover:bg-cta-hover"
      title="按 g a 也能打开"
    >
      <Sparkles className="h-4 w-4" strokeWidth={1.8} aria-hidden />
      {count} 条 AI 提案待确认
    </button>
  );
}

// ── The modal ──────────────────────────────────────────────────────

export function StagingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="AI 提案"
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-ink-primary/40 px-6 py-10 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-md bg-surface-0 shadow-xl"
      >
        <StagingContent onClose={onClose} />
      </div>
    </div>
  );
}

function StagingContent({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const proposalsMap = useStagingStore((s) => s.proposals);
  const proposals = useMemo(
    () => Object.values(proposalsMap).sort((a, b) => a.createdAt - b.createdAt),
    [proposalsMap],
  );
  const userProfile = useStore((s) => s.userProfile);
  const [apiKey, setApiKey] = useState(getAiApiKey);
  useEffect(() => subscribeAiApiKey(setApiKey), []);
  const aiConfig = useMemo(() => buildParseConfig(userProfile, apiKey), [userProfile, apiKey]);

  const ime = useIme();
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<{ message: string; bodyExcerpt?: string } | null>(null);
  const [lastCommit, setLastCommit] = useState<{ sessionId: string; label: string } | null>(
    null,
  );

  useEffect(() => {
    if (!lastCommit) return;
    const t = window.setTimeout(() => setLastCommit(null), COMMIT_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [lastCommit]);

  const handleParse = async () => {
    if (!aiConfig.ok) return;
    const text = pasteText.trim();
    if (!text) return;
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseIntentsFromText(text, aiConfig.config);
      const add = useStagingStore.getState().addProposal;
      for (const p of parsed) add({ intent: p.intent, shape: p.shape, source: 'paste' });
      setPasteText('');
      if (parsed.length === 0) {
        setError({ message: 'AI 没从这段文字里读出可建的待办 —— 换种说法试试?' });
      }
    } catch (err) {
      const e = err as { message?: string; bodyExcerpt?: string };
      setError({
        message: e.message ?? '解析失败',
        ...(e.bodyExcerpt ? { bodyExcerpt: e.bodyExcerpt } : {}),
      });
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async (proposal: StagingProposal) => {
    const plan = projectIntent(proposal.intent, proposal.shape);
    const sessionId = await commitPlan(plan, storeStagingWriters(useStore.getState()));
    useStagingStore.getState().discardProposal(proposal.id);
    setLastCommit({ sessionId, label: proposal.intent.title });
  };

  const handleUndoCommit = async () => {
    if (!lastCommit) return;
    await useStore.getState().undoEditSession(lastCommit.sessionId);
    setLastCommit(null);
  };

  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="flex items-center gap-2 px-5 py-4">
        <Sparkles className="h-4 w-4 text-ink-secondary" strokeWidth={1.6} aria-hidden />
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
          AI 提案
        </span>
        {proposals.length > 0 && (
          <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
            {proposals.length}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <X className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-5">
        {aiConfig.ok ? (
          <div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              rows={3}
              placeholder="把和 AI 聊出来的待办贴进来,我来拆成提案…"
              className="w-full resize-y rounded-md border border-hairline/60 bg-surface-1 px-2.5 py-2 text-sm text-ink-primary outline-none transition placeholder:text-ink-tertiary focus:border-ink-secondary"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-2xs text-ink-tertiary">纯自然语言即可,无需任何格式</span>
              <button
                type="button"
                onClick={handleParse}
                disabled={parsing || pasteText.trim().length === 0}
                className="inline-flex items-center gap-1 rounded-md bg-cta px-2.5 py-1 text-xs text-cta-foreground transition enabled:hover:bg-cta-hover disabled:opacity-40"
              >
                <Sparkles className="h-3 w-3" strokeWidth={1.8} />
                {parsing ? '解析中…' : '解析'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-secondary">
            {aiConfig.reason} ——{' '}
            <button
              type="button"
              onClick={() => {
                navigate('/settings/ai');
                onClose();
              }}
              className="text-ink-primary underline-offset-2 hover:underline"
            >
              去 Settings → AI 配置
            </button>
            ,配好就能把聊出来的待办贴进来解析。
          </div>
        )}

        {error && (
          <div className="rounded-md bg-warn-soft px-3 py-2 text-xs text-ink-primary">
            {error.message}
            {error.bodyExcerpt && (
              <details className="mt-1">
                <summary className="cursor-pointer text-2xs text-ink-tertiary">
                  看看具体怎么了 ⌄
                </summary>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-snug text-ink-tertiary">
                  {error.bodyExcerpt}
                </pre>
              </details>
            )}
          </div>
        )}

        {lastCommit && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs">
            <span className="min-w-0 truncate text-ink-secondary">
              已创建「{lastCommit.label}」
            </span>
            <button
              type="button"
              onClick={handleUndoCommit}
              className="inline-flex shrink-0 items-center gap-1 text-ink-primary transition hover:text-cta"
            >
              <RotateCcw className="h-3 w-3" strokeWidth={1.8} />
              撤销
            </button>
          </div>
        )}

        {proposals.length === 0 ? (
          <div className="py-6 text-center text-sm leading-relaxed text-ink-tertiary">
            {aiConfig.ok
              ? '还没有提案 —— 贴一段上面解析,或者让 Claude Code 直接塞进来(MCP,稍后支持)。'
              : '配好 AI 后,把聊出来的待办贴进来就能在这里 review。'}
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {proposals.map((p) => (
              <li key={p.id}>
                <ProposalCard
                  proposal={p}
                  onCommit={() => handleCommit(p)}
                  onDiscard={() => useStagingStore.getState().discardProposal(p.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Small editable controls ────────────────────────────────────────

function SegToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-sm border border-hairline/60">
      {options.map((o, i) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={clsx(
              'px-2 py-0.5 text-2xs transition',
              i > 0 && 'border-l border-hairline/60',
              active
                ? 'bg-surface-2 text-ink-primary'
                : 'text-ink-tertiary hover:bg-surface-2/70 hover:text-ink-primary',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[] | undefined;
  onChange: (next: number[] | undefined) => void;
}) {
  const set = new Set(value ?? []);
  const toggle = (day: number) => {
    const next = new Set(set);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    const arr = [...next].sort((a, b) => a - b);
    onChange(arr.length > 0 ? arr : undefined);
  };
  return (
    <div className="flex items-center gap-1">
      {WEEKDAY_LABELS.map((label, day) => {
        const active = set.has(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            className={clsx(
              'h-5 w-5 rounded-sm text-2xs transition',
              active
                ? 'bg-cta text-cta-foreground'
                : 'bg-surface-1 text-ink-tertiary hover:bg-surface-2 hover:text-ink-primary',
            )}
          >
            {label}
          </button>
        );
      })}
      {set.size === 0 && <span className="ml-1 text-2xs text-ink-tertiary">每天</span>}
    </div>
  );
}

const FREQ_OPTIONS: Array<{ key: IntentFrequency; label: string }> = [
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'once', label: '一次' },
];

const SHAPE_OPTIONS: Array<{ key: ProposalShape; label: string }> = [
  { key: 'habit', label: '习惯' },
  { key: 'task', label: '临时任务' },
];

// ── The full-parameter, shape-aware proposal card ──────────────────

function ProposalCard({
  proposal,
  onCommit,
  onDiscard,
}: {
  proposal: StagingProposal;
  onCommit: () => Promise<void>;
  onDiscard: () => void;
}) {
  const { intent, shape } = proposal;
  const plan = useMemo(() => projectIntent(intent, shape), [intent, shape]);
  const [committing, setCommitting] = useState(false);
  const ime = useIme();

  const update = (patch: { intent?: IntentSpec; shape?: ProposalShape }) =>
    useStagingStore.getState().updateProposal(proposal.id, patch);
  const setIntent = (next: IntentSpec) => update({ intent: next });
  const setTimes = (times: IntentTime[]) => setIntent({ ...intent, times });
  const patchTime = (idx: number, patch: Partial<IntentTime>) =>
    setTimes(intent.times.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const removeTime = (idx: number) => setTimes(intent.times.filter((_, i) => i !== idx));

  // Title + note ride local state, synced to the store on blur (typing
  // shouldn't write to the store / trigger an OPFS save per keystroke).
  const [title, setTitle] = useState(intent.title);
  const [note, setNote] = useState(intent.note ?? '');
  const commitTitle = () => {
    const next = title.trim();
    if (next.length > 0 && next !== intent.title) setIntent({ ...intent, title: next });
    else setTitle(intent.title);
  };
  const commitNote = () => {
    const next = note.trim();
    if (next !== (intent.note ?? '')) {
      setIntent({ ...intent, ...(next ? { note: next } : { note: undefined }) });
    }
  };

  const fieldCls =
    'rounded-sm border border-hairline/60 bg-surface-1 px-1.5 py-0.5 text-xs text-ink-primary outline-none transition focus:border-ink-secondary';

  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-1 p-3 ring-1 ring-hairline/40">
      <div className="flex items-center justify-between gap-2">
        <SegToggle value={shape} options={SHAPE_OPTIONS} onChange={(s) => update({ shape: s })} />
        {proposal.source === 'mcp' && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-tertiary">
            Claude Code
          </span>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">标题</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !ime.isComposing(e)) e.currentTarget.blur();
          }}
          className="h-8 w-full rounded-md border border-hairline/60 bg-surface-0 px-2 text-sm font-medium text-ink-primary outline-none transition focus:border-ink-secondary"
        />
      </label>

      {shape === 'habit' ? (
        <>
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              频率
            </span>
            <SegToggle
              value={intent.frequency}
              options={FREQ_OPTIONS}
              onChange={(f) => setIntent({ ...intent, frequency: f })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              时间点
            </span>
            {intent.times.length === 0 && (
              <span className="text-2xs text-ink-tertiary">还没有时间点 —— 加一个</span>
            )}
            {intent.times.map((t, i) => {
              const duration = t.durationMinutes ?? intent.perOccurrenceDurationMinutes ?? 30;
              return (
                <div key={i} className="flex flex-col gap-1.5 rounded-sm bg-surface-0 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="text"
                      value={t.label ?? ''}
                      placeholder="小标题(选填)"
                      onChange={(e) =>
                        patchTime(i, e.target.value ? { label: e.target.value } : { label: undefined })
                      }
                      className={clsx(fieldCls, 'w-24')}
                    />
                    <input
                      type="time"
                      value={minutesToHHMM(t.startMinutes)}
                      onChange={(e) => {
                        const m = hhmmToMinutes(e.target.value);
                        if (m != null) patchTime(i, { startMinutes: m });
                      }}
                      className={clsx(fieldCls, 'tabular-nums')}
                    />
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={duration}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v > 0) patchTime(i, { durationMinutes: v });
                        }}
                        className={clsx(fieldCls, 'w-14 tabular-nums')}
                      />
                      <span className="text-2xs text-ink-tertiary">分钟</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeTime(i)}
                      aria-label="删除这个时间点"
                      className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                  {intent.frequency === 'weekly' && (
                    <WeekdayPicker
                      value={t.weekdays}
                      onChange={(wd) => patchTime(i, wd ? { weekdays: wd } : { weekdays: undefined })}
                    />
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setTimes([...intent.times, { startMinutes: 9 * 60 }])}
              className="inline-flex w-fit items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              <Plus className="h-3 w-3" strokeWidth={1.8} />
              添加时间点
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            切分步骤(选填)
          </span>
          {intent.times.filter((t) => t.label !== undefined).length === 0 && (
            <span className="text-2xs text-ink-tertiary">无切分 —— 作为单条任务创建</span>
          )}
          {intent.times.map((t, i) =>
            t.label !== undefined ? (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={t.label}
                  placeholder="步骤名"
                  onChange={(e) => patchTime(i, { label: e.target.value })}
                  className={clsx(fieldCls, 'flex-1')}
                />
                <button
                  type="button"
                  onClick={() => removeTime(i)}
                  aria-label="删除这个步骤"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.7} />
                </button>
              </div>
            ) : null,
          )}
          <button
            type="button"
            onClick={() => setTimes([...intent.times, { startMinutes: 0, label: '新步骤' }])}
            className="inline-flex w-fit items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <Plus className="h-3 w-3" strokeWidth={1.8} />
            添加步骤
          </button>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">备注</span>
        <textarea
          value={note}
          rows={2}
          placeholder="选填"
          onChange={(e) => setNote(e.target.value)}
          onBlur={commitNote}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          className="w-full resize-y rounded-md border border-hairline/60 bg-surface-0 px-2 py-1.5 text-xs text-ink-primary outline-none transition placeholder:text-ink-tertiary focus:border-ink-secondary"
        />
      </label>

      <div className="rounded-sm bg-surface-0 px-2.5 py-2">
        <p className="mb-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          将创建
        </p>
        <ul className="flex flex-col gap-0.5">
          {plan.summary.map((line, i) => (
            <li key={i} className="text-xs leading-snug text-ink-secondary">
              · {line}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-2xs text-ink-tertiary">从今天起生效 · 确认后可一键撤销</p>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
          丢弃
        </button>
        <button
          type="button"
          disabled={committing}
          onClick={async () => {
            setCommitting(true);
            try {
              await onCommit();
            } finally {
              setCommitting(false);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md bg-cta px-2.5 py-1 text-xs text-cta-foreground transition enabled:hover:bg-cta-hover disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
          {committing ? '创建中…' : '确认创建'}
        </button>
      </div>
    </div>
  );
}
