import { clsx } from 'clsx';
import {
  Check,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  commitPlan,
  parseIntentsFromText,
  projectIntent,
  storeStagingWriters,
  useStagingStore,
  useStore,
  type ParseIntentsConfig,
  type ProposalShape,
  type StagingProposal,
  type UserProfile,
} from '@dayrail/core';
import { getAiApiKey, subscribeAiApiKey } from '@/lib/aiApiKey';
import { useIme } from '@/lib/ime';

// ERD §6.7 — the AI "待确认提案" staging tray. Mirrors the Backlog
// drawer (right-docked sticky aside, collapsed handle + `g a` shortcut;
// NO SideNav entry, same as Backlog — "drawer open" doesn't fit the
// route-based active grammar, see SideNav.tsx). Paste flow (§6.7.5):
// paste a DayRail-agnostic blob → internal AI parses it into proposals
// → review (edit params / switch shape) → confirm commits one Edit
// Session (one-click undo, §6.7.4) → discard drops it.

const AI_BASE_URL_DEFAULT = 'https://openrouter.ai/api/v1';
const COMMIT_TOAST_MS = 8000;

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

interface Props {
  open: boolean;
  onToggle: () => void;
}

export function StagingDrawer({ open, onToggle }: Props) {
  const navigate = useNavigate();
  // Subscribe to the raw map; derive the array via useMemo so Zustand's
  // reference check short-circuits (never return a fresh array inline).
  const proposalsMap = useStagingStore((s) => s.proposals);
  const proposals = useMemo(
    () => Object.values(proposalsMap).sort((a, b) => a.createdAt - b.createdAt),
    [proposalsMap],
  );
  const userProfile = useStore((s) => s.userProfile);
  // The API key lives in localStorage (not userProfile — it's local-only
  // by §6.6 policy), so subscribe to it directly; otherwise the config
  // memo never re-reads the key when it's set in Settings.
  const [apiKey, setApiKey] = useState(getAiApiKey);
  useEffect(() => subscribeAiApiKey(setApiKey), []);
  const aiConfig = useMemo(
    () => buildParseConfig(userProfile, apiKey),
    [userProfile, apiKey],
  );

  const ime = useIme();
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<{ message: string; bodyExcerpt?: string } | null>(null);
  const [lastCommit, setLastCommit] = useState<{ sessionId: string; label: string } | null>(
    null,
  );

  // Auto-dismiss the "已创建 · 撤销" affordance, same cadence as the
  // Reason toast (§5.2).
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
    <aside
      aria-label="AI staging drawer"
      className={clsx(
        'sticky top-0 mr-6 flex h-screen shrink-0 flex-col rounded-l-md bg-surface-1 transition-[width] duration-200',
        open ? 'w-[340px]' : 'w-[48px]',
      )}
    >
      <div className={clsx('flex h-[52px] items-center', open ? 'gap-2 px-4' : 'justify-center')}>
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'Collapse AI tray' : 'Expand AI tray'}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          {open ? (
            <PanelRightClose className="h-4 w-4" strokeWidth={1.6} />
          ) : (
            <PanelRightOpen className="h-4 w-4" strokeWidth={1.6} />
          )}
        </button>
        {open && (
          <>
            <Sparkles className="h-3.5 w-3.5 text-ink-secondary" strokeWidth={1.6} aria-hidden />
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
              AI 暂存区
            </span>
            <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
              {proposals.length}
            </span>
          </>
        )}
      </div>

      {!open && proposals.length > 0 && (
        <div className="flex justify-center pt-1">
          <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-cta px-1 font-mono text-[9px] text-cta-foreground">
            {proposals.length}
          </span>
        </div>
      )}

      {open && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="px-4 pb-3 pt-1">
            {aiConfig.ok ? (
              <>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  onCompositionStart={ime.onCompositionStart}
                  onCompositionEnd={ime.onCompositionEnd}
                  rows={3}
                  placeholder="把和 AI 聊出来的待办贴进来,我来拆成提案…"
                  className="w-full resize-y rounded-md border border-hairline/60 bg-surface-0 px-2.5 py-2 text-sm text-ink-primary outline-none transition placeholder:text-ink-tertiary focus:border-ink-secondary"
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
              </>
            ) : (
              <div className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-secondary">
                {aiConfig.reason} ——{' '}
                <button
                  type="button"
                  onClick={() => navigate('/settings/ai')}
                  className="text-ink-primary underline-offset-2 hover:underline"
                >
                  去 Settings → AI 配置
                </button>
                ,配好就能把聊出来的待办贴进来解析。
              </div>
            )}

            {error && (
              <div className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-ink-primary">
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
          </div>

          {lastCommit && (
            <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs">
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
            <div className="px-5 py-6 text-sm leading-relaxed text-ink-tertiary">
              没有待确认的提案。
              {aiConfig.ok ? '贴一段上面试试 —— 或者让 Claude Code 直接塞进来(MCP,稍后支持)。' : ''}
            </div>
          ) : (
            <ul className="flex flex-col gap-2 px-3 pb-4">
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
      )}
    </aside>
  );
}

function ShapeToggle({
  value,
  onChange,
}: {
  value: ProposalShape;
  onChange: (shape: ProposalShape) => void;
}) {
  const opts: Array<{ key: ProposalShape; label: string }> = [
    { key: 'habit', label: '习惯' },
    { key: 'task', label: '临时任务' },
  ];
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-sm border border-hairline/60">
      {opts.map((o, i) => {
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

function ProposalCard({
  proposal,
  onCommit,
  onDiscard,
}: {
  proposal: StagingProposal;
  onCommit: () => Promise<void>;
  onDiscard: () => void;
}) {
  // Plan / preview is DERIVED, never stored (§6.7.2) — re-projects on
  // any intent / shape change.
  const plan = useMemo(
    () => projectIntent(proposal.intent, proposal.shape),
    [proposal.intent, proposal.shape],
  );
  // Title rides local state and syncs to the store on blur, so typing
  // doesn't write to the store (and trigger an OPFS save) per keystroke.
  const [title, setTitle] = useState(proposal.intent.title);
  const [committing, setCommitting] = useState(false);
  const ime = useIme();

  const update = (patch: { intent?: StagingProposal['intent']; shape?: ProposalShape }) =>
    useStagingStore.getState().updateProposal(proposal.id, patch);

  const commitTitle = () => {
    const next = title.trim();
    if (next.length > 0 && next !== proposal.intent.title) {
      update({ intent: { ...proposal.intent, title: next } });
    } else {
      setTitle(proposal.intent.title);
    }
  };

  const setTimeStart = (idx: number, minutes: number) => {
    update({
      intent: {
        ...proposal.intent,
        times: proposal.intent.times.map((t, i) =>
          i === idx ? { ...t, startMinutes: minutes } : t,
        ),
      },
    });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-md bg-surface-0 p-3 ring-1 ring-hairline/40">
      <div className="flex items-center justify-between gap-2">
        <ShapeToggle value={proposal.shape} onChange={(shape) => update({ shape })} />
        {proposal.source === 'mcp' && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-tertiary">
            Claude Code
          </span>
        )}
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !ime.isComposing(e)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className="h-8 w-full rounded-md border border-hairline/60 bg-surface-1 px-2 text-sm font-medium text-ink-primary outline-none transition focus:border-ink-secondary"
      />

      {proposal.intent.times.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {proposal.intent.times.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 shrink-0 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                {t.label ?? `#${i + 1}`}
              </span>
              <input
                type="time"
                value={minutesToHHMM(t.startMinutes)}
                onChange={(e) => {
                  const m = hhmmToMinutes(e.target.value);
                  if (m != null) setTimeStart(i, m);
                }}
                className="rounded-sm border border-hairline/60 bg-surface-1 px-1.5 py-0.5 text-xs tabular-nums text-ink-primary outline-none transition focus:border-ink-secondary"
              />
            </div>
          ))}
        </div>
      )}

      <div className="rounded-sm bg-surface-1 px-2.5 py-2">
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
