import { clsx } from 'clsx';
import { Check, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  commitDraft,
  parseIntentsFromText,
  storeStagingWriters,
  toggleDraftKind,
  useStagingStore,
  useStore,
  type HabitDraft,
  type HabitSlotDraft,
  type ParseIntentsConfig,
  type ProposalDraft,
  type ProposalShape,
  type Rail,
  type StagingProposal,
  type TaskDraft,
  type TaskPriority,
  type TaskScheduleDraft,
  type TaskStep,
  type Template,
  type UserProfile,
} from '@dayrail/core';
import { getAiApiKey, subscribeAiApiKey } from '@/lib/aiApiKey';
import { useIme } from '@/lib/ime';
import { MarkdownField } from './MarkdownField';
import { RailPicker } from './RailPicker';
import {
  EffectiveFromPicker,
  resolveEffectiveFromValue,
  type EffectiveFromValue,
} from './EffectiveFromPicker';

// ERD §6.7 — "Proposals": a small global TOOL (not a view). A SideNav
// button / `g a` opens this modal; you paste text → 解析 → review the
// parsed task/habit proposals with native fields → confirm each (creates
// it) or discard. It's a transient working session: re-parsing replaces
// the previous batch, the input text is kept across parses (so you can
// tweak a sentence and re-parse), and closing prompts before discarding
// any not-yet-created proposals. No persistence, no MCP, no inbox.

const AI_BASE_URL_DEFAULT = 'https://openrouter.ai/api/v1';
const COMMIT_TOAST_MS = 8000;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

type ParseConfigResult = { ok: true; config: ParseIntentsConfig } | { ok: false; reason: string };

function buildParseConfig(profile: UserProfile | null, apiKey: string): ParseConfigResult {
  if (profile?.aiEnabled !== true) return { ok: false, reason: 'AI 还没启用' };
  const key = apiKey.trim();
  const baseUrl = (profile.aiBaseUrl || AI_BASE_URL_DEFAULT).trim();
  const model = (profile.aiModel ?? '').trim();
  if (!key) return { ok: false, reason: '还没填 API key' };
  if (!model) return { ok: false, reason: '还没选模型' };
  return { ok: true, config: { baseUrl, apiKey: key, model } };
}

function draftLabel(draft: ProposalDraft): string {
  return draft.kind === 'task' ? draft.title : draft.name;
}

export function StagingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const proposalsMap = useStagingStore((s) => s.proposals);
  const proposals = useMemo(
    () => Object.values(proposalsMap).sort((a, b) => b.createdAt - a.createdAt),
    [proposalsMap],
  );
  const userProfile = useStore((s) => s.userProfile);
  const [apiKey, setApiKey] = useState(getAiApiKey);
  useEffect(() => subscribeAiApiKey(setApiKey), []);
  const aiConfig = useMemo(() => buildParseConfig(userProfile, apiKey), [userProfile, apiKey]);

  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<{ message: string; bodyExcerpt?: string } | null>(null);
  const [lastCommit, setLastCommit] = useState<{ sessionId: string; label: string } | null>(null);

  useEffect(() => {
    if (!lastCommit) return;
    const t = window.setTimeout(() => setLastCommit(null), COMMIT_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [lastCommit]);

  // Close = discard not-yet-created proposals (with a confirm) + reset.
  const doClose = () => {
    useStagingStore.getState().clear();
    setPasteText('');
    setError(null);
    setLastCommit(null);
    onClose();
  };
  const requestClose = () => {
    const pending = Object.keys(useStagingStore.getState().proposals).length;
    if (pending > 0 && !window.confirm(`退出会丢弃 ${pending} 条尚未创建的提案,确定退出?`)) {
      return;
    }
    doClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleParse = async () => {
    if (!aiConfig.ok) return;
    const text = pasteText.trim();
    if (!text) return;
    setParsing(true);
    setError(null);
    try {
      // §6.7.8 — ground the model in the user's current setup so it can
      // bind existing rails / place new ones in the right template.
      const s = useStore.getState();
      const context = {
        templates: Object.values(s.templates).map((t) => ({ key: t.key, name: t.name })),
        rails: Object.values(s.rails).map((r) => ({
          id: r.id,
          name: r.name,
          templateKey: r.templateKey,
          startMinutes: r.startMinutes,
          durationMinutes: r.durationMinutes,
        })),
      };
      const drafts = await parseIntentsFromText(text, aiConfig.config, context);
      const store = useStagingStore.getState();
      // Re-parse replaces the previous batch — paste is a scratch you
      // iterate on. The input text is intentionally NOT cleared.
      store.clear();
      for (const draft of drafts) store.addProposal({ draft, source: 'paste' });
      if (drafts.length === 0) {
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
    // §6.7.8 — allTemplateKeys lets a habit "every day" slot expand to a
    // rail in every template.
    const state = useStore.getState();
    const sessionId = await commitDraft(proposal.draft, storeStagingWriters(state), {
      allTemplateKeys: Object.keys(state.templates),
    });
    useStagingStore.getState().discardProposal(proposal.id);
    setLastCommit({ sessionId, label: draftLabel(proposal.draft) });
  };

  const handleUndoCommit = async () => {
    if (!lastCommit) return;
    await useStore.getState().undoEditSession(lastCommit.sessionId);
    setLastCommit(null);
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Proposals"
      onClick={requestClose}
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-ink-primary/40 px-6 py-10 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-md bg-surface-0 shadow-xl"
      >
        <div className="flex items-center gap-2 px-5 py-4">
          <Sparkles className="h-4 w-4 text-ink-secondary" strokeWidth={1.6} aria-hidden />
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
            Proposals
          </span>
          {proposals.length > 0 && (
            <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
              {proposals.length}
            </span>
          )}
          <button
            type="button"
            onClick={requestClose}
            aria-label="关闭"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-5">
          {aiConfig.ok ? (
            <div>
              <MarkdownField
                value={pasteText || undefined}
                onCommit={(v) => setPasteText(v ?? '')}
                placeholder="把和 AI 聊出来的待办贴进来 · 纯自然语言 / Markdown"
                dialogTitle="Proposals 输入"
                ariaLabel="Proposals 自然语言输入"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-2xs text-ink-tertiary">
                  贴完点一下别处再「解析」· 解析后文本保留,可改了再解析
                </span>
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
            <div className="rounded-md bg-surface-1 px-3 py-2.5 text-xs leading-relaxed text-ink-secondary">
              {aiConfig.reason} ——{' '}
              <button
                type="button"
                onClick={() => {
                  navigate('/settings/ai');
                  doClose();
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
            <div className="flex items-center justify-between gap-2 rounded-md bg-surface-1 px-3 py-2 text-xs">
              <span className="min-w-0 truncate text-ink-secondary">已创建「{lastCommit.label}」</span>
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
            <div className="py-8 text-center text-sm leading-relaxed text-ink-tertiary">
              {aiConfig.ok ? '贴一段文字,点「解析」试试。' : '配好 AI 后即可粘贴解析。'}
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
    </div>
  );
}

// ── small controls ─────────────────────────────────────────────────

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
      {set.size === 0 && <span className="ml-1 text-2xs text-ink-tertiary">不限(随 Rail)</span>}
    </div>
  );
}

const PRIORITY_OPTIONS: Array<{ key: TaskPriority | 'none'; label: string }> = [
  { key: 'none', label: '无' },
  { key: 'P0', label: 'P0' },
  { key: 'P1', label: 'P1' },
  { key: 'P2', label: 'P2' },
];

const SHAPE_OPTIONS: Array<{ key: ProposalShape; label: string }> = [
  { key: 'habit', label: '习惯' },
  { key: 'task', label: '任务' },
];

const fieldCls =
  'rounded-sm border border-hairline/60 bg-surface-1 px-1.5 py-0.5 text-xs text-ink-primary outline-none transition focus:border-ink-secondary';

// ── proposal card (native fields, shape-aware) ─────────────────────

function ProposalCard({
  proposal,
  onCommit,
  onDiscard,
}: {
  proposal: StagingProposal;
  onCommit: () => Promise<void>;
  onDiscard: () => void;
}) {
  const draft = proposal.draft;
  const [committing, setCommitting] = useState(false);
  const setDraft = (next: ProposalDraft) =>
    useStagingStore.getState().updateProposal(proposal.id, next);

  if (draft?.kind !== 'task' && draft?.kind !== 'habit') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md bg-surface-1 p-3 text-xs text-ink-tertiary ring-1 ring-hairline/40">
        <span>这条提案无法识别</span>
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
          丢弃
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-1 p-3 ring-1 ring-hairline/40">
      <div className="flex items-center justify-between gap-2">
        <SegToggle
          value={draft.kind}
          options={SHAPE_OPTIONS}
          onChange={(k) => {
            if (k !== draft.kind) setDraft(toggleDraftKind(draft));
          }}
        />
      </div>

      {draft.kind === 'task' ? (
        <TaskFields draft={draft} setDraft={setDraft} />
      ) : (
        <HabitFields draft={draft} setDraft={setDraft} />
      )}

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

function LabeledText({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}) {
  const ime = useIme();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = text.trim();
    if (next && next !== value) onCommit(next);
    else if (!next) setText(value);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">{label}</span>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !ime.isComposing(e)) e.currentTarget.blur();
        }}
        className="h-8 w-full rounded-md border border-hairline/60 bg-surface-0 px-2 text-sm font-medium text-ink-primary outline-none transition focus:border-ink-secondary"
      />
    </label>
  );
}

function NoteField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">备注</span>
      <MarkdownField
        value={value}
        onCommit={onChange}
        placeholder="+ 备注 · Markdown"
        dialogTitle="备注"
        ariaLabel="提案备注"
      />
    </div>
  );
}

function TaskFields({ draft, setDraft }: { draft: TaskDraft; setDraft: (d: ProposalDraft) => void }) {
  const linesMap = useStore((s) => s.lines);
  const railsMap = useStore((s) => s.rails);
  const templatesMap = useStore((s) => s.templates);
  const rails = useMemo(() => Object.values(railsMap), [railsMap]);
  const templateList = useMemo(
    () => Object.values(templatesMap).map((t) => ({ key: t.key, name: t.name })),
    [templatesMap],
  );
  const projectLines = useMemo(
    () =>
      Object.values(linesMap)
        .filter((l) => l.status === 'active' && (l.isDefault || l.kind === 'project'))
        .sort((a, b) => {
          if (a.isDefault && !b.isDefault) return -1;
          if (!a.isDefault && b.isDefault) return 1;
          return a.name.localeCompare(b.name);
        }),
    [linesMap],
  );

  const setStep = (idx: number, step: TaskStep) =>
    setDraft({ ...draft, steps: draft.steps.map((s, i) => (i === idx ? step : s)) });
  const removeStep = (idx: number) =>
    setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== idx) });

  return (
    <>
      <LabeledText label="标题" value={draft.title} onCommit={(t) => setDraft({ ...draft, title: t })} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">所属</span>
          <select
            value={draft.lineId}
            onChange={(e) => setDraft({ ...draft, lineId: e.target.value })}
            className={fieldCls}
          >
            {projectLines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">优先级</span>
          <SegToggle
            value={draft.priority ?? 'none'}
            options={PRIORITY_OPTIONS}
            onChange={(p) => setDraft(p === 'none' ? omitPriority(draft) : { ...draft, priority: p })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          切分(选填 · 可填里程碑 %)
        </span>
        {draft.steps.length === 0 && (
          <span className="text-2xs text-ink-tertiary">无切分 —— 作为单条任务创建</span>
        )}
        {draft.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              value={step.label}
              placeholder="步骤名"
              onChange={(e) => setStep(i, { ...step, label: e.target.value })}
              className={clsx(fieldCls, 'flex-1')}
            />
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                value={step.percent ?? ''}
                placeholder="里程碑"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setStep(i, { label: step.label });
                  } else {
                    const n = Number(v);
                    if (Number.isFinite(n)) {
                      setStep(i, { label: step.label, percent: Math.max(0, Math.min(100, n)) });
                    }
                  }
                }}
                className={clsx(fieldCls, 'w-16 tabular-nums')}
              />
              <span className="text-2xs text-ink-tertiary">%</span>
            </span>
            <button
              type="button"
              onClick={() => removeStep(i)}
              aria-label="删除步骤"
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.7} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDraft({ ...draft, steps: [...draft.steps, { label: '新步骤' }] })}
          className="inline-flex w-fit items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Plus className="h-3 w-3" strokeWidth={1.8} />
          添加切分
        </button>
      </div>

      <TaskScheduleField
        draft={draft}
        setDraft={setDraft}
        rails={rails}
        templatesMap={templatesMap}
        templateList={templateList}
      />

      <NoteField value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} />
    </>
  );
}

function omitPriority(draft: TaskDraft): TaskDraft {
  const { priority: _priority, ...rest } = draft;
  return rest;
}

function HabitFields({ draft, setDraft }: { draft: HabitDraft; setDraft: (d: ProposalDraft) => void }) {
  const railsMap = useStore((s) => s.rails);
  const templatesMap = useStore((s) => s.templates);
  const rails = useMemo(() => Object.values(railsMap), [railsMap]);
  const templateList = useMemo(
    () => Object.values(templatesMap).map((t) => ({ key: t.key, name: t.name })),
    [templatesMap],
  );
  const [effValue, setEffValue] = useState<EffectiveFromValue>({ mode: 'today' });

  const setSlots = (slots: HabitSlotDraft[]) => setDraft({ ...draft, slots });
  const patchSlot = (idx: number, slot: HabitSlotDraft) =>
    setSlots(draft.slots.map((s, i) => (i === idx ? slot : s)));
  const removeSlot = (idx: number) => setSlots(draft.slots.filter((_, i) => i !== idx));

  return (
    <>
      <LabeledText label="习惯名" value={draft.name} onCommit={(n) => setDraft({ ...draft, name: n })} />

      <div className="flex flex-col gap-2">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">时段</span>
        {draft.slots.length === 0 && (
          <span className="text-2xs text-ink-tertiary">还没有时段 —— 加一个</span>
        )}
        {draft.slots.map((slot, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-sm bg-surface-0 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <SegToggle
                value={slot.mode}
                options={[
                  { key: 'new', label: '新建' },
                  { key: 'existing', label: '选已有' },
                ]}
                onChange={(mode) => {
                  if (mode === slot.mode) return;
                  if (mode === 'existing') {
                    patchSlot(i, {
                      mode: 'existing',
                      railId: rails[0]?.id ?? '',
                      ...(slot.weekdays ? { weekdays: slot.weekdays } : {}),
                    });
                  } else {
                    patchSlot(i, {
                      mode: 'new',
                      startMinutes: 9 * 60,
                      ...(slot.weekdays ? { weekdays: slot.weekdays } : {}),
                    });
                  }
                }}
              />
              {slot.mode === 'new' ? (
                <>
                  <input
                    type="time"
                    value={minutesToHHMM(slot.startMinutes)}
                    onChange={(e) => {
                      const m = hhmmToMinutes(e.target.value);
                      if (m != null) patchSlot(i, { ...slot, startMinutes: m });
                    }}
                    className={clsx(fieldCls, 'tabular-nums')}
                  />
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      value={slot.durationMinutes ?? 30}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v > 0) patchSlot(i, { ...slot, durationMinutes: v });
                      }}
                      className={clsx(fieldCls, 'w-14 tabular-nums')}
                    />
                    <span className="text-2xs text-ink-tertiary">分钟</span>
                  </span>
                </>
              ) : (
                <div className="min-w-[160px] flex-1">
                  <RailPicker
                    rails={rails}
                    templates={templatesMap}
                    value={slot.railId}
                    onChange={(railId) => patchSlot(i, { ...slot, railId })}
                    placeholder="选一条 Rail…"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeSlot(i)}
                aria-label="删除时段"
                className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.7} />
              </button>
            </div>
            {slot.mode === 'new' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">适用</span>
                <TemplateScopePicker
                  templates={templateList}
                  value={slot.templateKeys}
                  onChange={(keys) =>
                    patchSlot(
                      i,
                      keys && keys.length > 0
                        ? { ...slot, templateKeys: keys }
                        : stripTemplateKeys(slot),
                    )
                  }
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">星期</span>
              <WeekdayPicker
                value={slot.weekdays}
                onChange={(wd) => patchSlot(i, wd ? { ...slot, weekdays: wd } : stripWeekdays(slot))}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setSlots([...draft.slots, { mode: 'new', startMinutes: 9 * 60 }])}
          className="inline-flex w-fit items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Plus className="h-3 w-3" strokeWidth={1.8} />
          添加时段
        </button>
      </div>

      <EffectiveFromPicker
        value={effValue}
        onChange={(v) => {
          setEffValue(v);
          const iso = resolveEffectiveFromValue(v);
          setDraft({ ...draft, ...(iso ? { effectiveFrom: iso } : {}) });
        }}
      />

      <NoteField value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} />
    </>
  );
}

function stripWeekdays(slot: HabitSlotDraft): HabitSlotDraft {
  const { weekdays: _w, ...rest } = slot;
  return rest;
}

function stripTemplateKeys(slot: Extract<HabitSlotDraft, { mode: 'new' }>): HabitSlotDraft {
  const { templateKeys: _t, ...rest } = slot;
  return rest;
}

// Habit new-rail template scope (§6.7.8). No selection = every day (a rail
// in every template); selecting templates narrows it. Shown with native
// template names, so it reads as a day-scope rather than raw keys.
function TemplateScopePicker({
  templates,
  value,
  onChange,
}: {
  templates: { key: string; name: string }[];
  value: string[] | undefined;
  onChange: (keys: string[] | undefined) => void;
}) {
  const selected = new Set(value ?? []);
  const everyday = selected.size === 0;
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next.size === 0 ? undefined : [...next]);
  };
  const chip = (active: boolean) =>
    clsx(
      'rounded-sm px-2 py-0.5 text-2xs transition',
      active ? 'bg-cta text-cta-foreground' : 'bg-surface-2 text-ink-secondary hover:text-ink-primary',
    );
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" onClick={() => onChange(undefined)} className={chip(everyday)}>
        每天
      </button>
      {templates.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => toggle(t.key)}
          className={chip(selected.has(t.key))}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}

function omitSchedule(draft: TaskDraft): TaskDraft {
  const { schedule: _s, ...rest } = draft;
  return rest;
}

// Task scheduling onto a Rail (§6.7.8). Default unscheduled; usually bind
// an existing rail; new-rail is the rare path. A task is one date.
function TaskScheduleField({
  draft,
  setDraft,
  rails,
  templatesMap,
  templateList,
}: {
  draft: TaskDraft;
  setDraft: (d: ProposalDraft) => void;
  rails: Rail[];
  templatesMap: Record<string, Template>;
  templateList: { key: string; name: string }[];
}) {
  const sched = draft.schedule;
  const mode: 'none' | 'existing' | 'new' = sched?.mode ?? 'none';
  const setSchedule = (schedule: TaskScheduleDraft | undefined) =>
    setDraft(schedule ? { ...draft, schedule } : omitSchedule(draft));

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">排期(选填)</span>
      <SegToggle
        value={mode}
        options={[
          { key: 'none', label: '不排期' },
          { key: 'existing', label: '绑 Rail' },
          { key: 'new', label: '新建 Rail' },
        ]}
        onChange={(m) => {
          if (m === mode) return;
          if (m === 'none') setSchedule(undefined);
          else if (m === 'existing') setSchedule({ mode: 'existing', railId: rails[0]?.id ?? '' });
          else setSchedule({ mode: 'new', startMinutes: 9 * 60 });
        }}
      />
      {sched?.mode === 'existing' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="min-w-[160px] flex-1">
            <RailPicker
              rails={rails}
              templates={templatesMap}
              value={sched.railId}
              onChange={(railId) => setSchedule({ ...sched, railId })}
              placeholder="选一条 Rail…"
            />
          </div>
          <input
            type="date"
            value={sched.date ?? ''}
            onChange={(e) => setSchedule({ ...sched, date: e.target.value || undefined })}
            className={clsx(fieldCls, 'tabular-nums')}
          />
        </div>
      )}
      {sched?.mode === 'new' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="time"
            value={minutesToHHMM(sched.startMinutes)}
            onChange={(e) => {
              const m = hhmmToMinutes(e.target.value);
              if (m != null) setSchedule({ ...sched, startMinutes: m });
            }}
            className={clsx(fieldCls, 'tabular-nums')}
          />
          <select
            value={sched.templateKey ?? templateList[0]?.key ?? ''}
            onChange={(e) => setSchedule({ ...sched, templateKey: e.target.value })}
            className={fieldCls}
          >
            {templateList.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={sched.date ?? ''}
            onChange={(e) => setSchedule({ ...sched, date: e.target.value || undefined })}
            className={clsx(fieldCls, 'tabular-nums')}
          />
        </div>
      )}
    </div>
  );
}
