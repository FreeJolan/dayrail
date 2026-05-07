// ERD §6.6.2 v0.8.2 — generic AI observation surface.
//
// Used by both Day (`DayReflectionAi`) and Cycle (`CycleReflectionAi`)
// wrappers; the wrappers prepare scope-specific messages + summary
// strings and hand them in. This component owns:
//   - The state machine (idle → confirm → loading → result | error)
//   - Reading aiBaseUrl / aiModel from `userProfile` + apiKey from
//     localStorage (per ERD §6.6 field-split policy)
//   - Calling `callChatCompletion` (Vercel AI SDK under the hood)
//   - Rendering the streamed Markdown reflection
//   - Calling `onCommit` to cache the result
//
// Confirm step is inline (not a modal) — small footprint, reversible.
//
// v0.8.2 dogfood reversal: the AI output is now free-form Markdown
// with inline 「verbatim」 citation brackets, not a JSON schema. The
// rendering uses the shared MarkdownView primitive (same as
// DailyReflection / Project notes). Schema validation is gone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import {
  AiClientError,
  callChatCompletion,
  type AiObservation,
  type ChatMessage,
  useStore,
} from '@dayrail/core';
import { getAiApiKey, subscribeAiApiKey } from '@/lib/aiApiKey';
import { MarkdownView } from '@/components/MarkdownField';

const AI_BASE_URL_DEFAULT = 'https://openrouter.ai/api/v1';
const AI_MODEL_DEFAULT = 'meta-llama/llama-3.1-8b-instruct:free';
const TOKEN_WARN_THRESHOLD = 8000;

export interface PreparedAiCall {
  /** OpenAI-style messages array, fully built. */
  messages: ChatMessage[];
  /** Rough token estimate; used for the >8k warning. */
  tokensEstimate: number;
  /** Single-line human-readable summary of payload contents shown in
   *  the confirm step. e.g. "含背景 · 当天 3 个任务 · 86 字 reflection". */
  promptDescription: string;
}

export interface AiObservationCardProps {
  /** Whether to render the surface at all. False = render nothing.
   *  Caller's UX gate (aiEnabled + scope-specific preconditions). */
  available: boolean;
  /** Most recent cached observation, if any. Drives the "show prior
   *  result" path. Undefined = first-time / never called. */
  cached: AiObservation | undefined;
  /** Lazy builder — invoked at the moment user clicks the AI button.
   *  Read whatever store state you need just-in-time so the prompt
   *  reflects the latest data, not a stale closure. */
  prepareCall: () => PreparedAiCall;
  /** Called with the validated observation when a call succeeds.
   *  Wire to the store action that writes `lastAiObservation`. */
  onCommit: (observation: AiObservation) => void;
  /** Used in copy ("AI 复盘 · {scopeLabel}"). e.g. "今日" / "Cycle". */
  scopeLabel: string;
}

type CallState =
  | { kind: 'idle' }
  | { kind: 'confirm'; prepared: PreparedAiCall }
  | { kind: 'loading'; streamingText: string }
  | { kind: 'error'; message: string; bodyExcerpt?: string };

export function AiObservationCard({
  available,
  cached,
  prepareCall,
  onCommit,
  scopeLabel,
}: AiObservationCardProps) {
  const userProfile = useStore((s) => s.userProfile);
  const baseUrl = (userProfile?.aiBaseUrl ?? '').trim() || AI_BASE_URL_DEFAULT;
  const model = (userProfile?.aiModel ?? '').trim() || AI_MODEL_DEFAULT;

  const [apiKey, setApiKey] = useState<string>(() => getAiApiKey());
  useEffect(() => {
    const unsub = subscribeAiApiKey(setApiKey);
    return unsub;
  }, []);

  const [state, setState] = useState<CallState>({ kind: 'idle' });

  // Streaming text accumulator — held in a ref so the SSE callback
  // can mutate without re-creating the closure on every state tick,
  // and so post-error fallback (validate-failure → bodyExcerpt) can
  // read whatever text we managed to collect before the failure.
  const streamRef = useRef('');

  const handleAsk = useCallback(() => {
    setState({ kind: 'confirm', prepared: prepareCall() });
  }, [prepareCall]);

  const handleCancel = useCallback(() => {
    setState({ kind: 'idle' });
  }, []);

  const handleSend = useCallback(
    async (prepared: PreparedAiCall) => {
      streamRef.current = '';
      setState({ kind: 'loading', streamingText: '' });
      try {
        const markdown = await callChatCompletion({
          baseUrl,
          apiKey,
          model,
          messages: prepared.messages,
          onChunk: (delta) => {
            streamRef.current += delta;
            setState({ kind: 'loading', streamingText: streamRef.current });
          },
        });
        const trimmed = markdown.trim();
        if (trimmed.length === 0) {
          throw new AiClientError(
            'parse-error',
            'Provider returned an empty response. Try again or pick a different model.',
          );
        }
        const observation: AiObservation = {
          generatedAt: Date.now(),
          model,
          markdown: trimmed,
        };
        onCommit(observation);
        setState({ kind: 'idle' });
      } catch (err) {
        // Fallback: if the AiClientError carries no bodyExcerpt of
        // its own, surface whatever text the model managed to stream
        // before the failure. Lets the user see the truncated /
        // unexpected response and judge what went wrong.
        const fallbackExcerpt =
          streamRef.current.length > 0
            ? streamRef.current.slice(-2000)
            : undefined;
        if (err instanceof AiClientError) {
          const excerpt =
            err.bodyExcerpt && err.bodyExcerpt.trim().length > 0
              ? err.bodyExcerpt
              : fallbackExcerpt;
          setState({
            kind: 'error',
            message: `[${err.kind}] ${err.message}`,
            ...(excerpt ? { bodyExcerpt: excerpt } : {}),
          });
        } else {
          setState({
            kind: 'error',
            message: (err as Error).message ?? String(err),
            ...(fallbackExcerpt ? { bodyExcerpt: fallbackExcerpt } : {}),
          });
        }
      }
    },
    [apiKey, baseUrl, model, onCommit],
  );

  if (!available) return null;

  const callMissingApiKey = apiKey.trim().length === 0;

  return (
    <section
      aria-label={`AI 复盘 · ${scopeLabel}`}
      className="flex flex-col gap-3 rounded-md border border-ink-tertiary/20 bg-surface-1 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-ink-tertiary">
          <Sparkles className="h-3 w-3" strokeWidth={1.8} />
          AI 复盘 · {scopeLabel}
        </span>
        {state.kind === 'idle' && (
          <button
            type="button"
            onClick={handleAsk}
            disabled={callMissingApiKey}
            title={callMissingApiKey ? '请先在 Settings → AI 填 API key' : undefined}
            className={clsx(
              'rounded-md border px-2.5 py-1 text-xs transition',
              callMissingApiKey
                ? 'cursor-not-allowed border-ink-tertiary/30 text-ink-tertiary/60'
                : 'border-ink-tertiary/60 text-ink-primary hover:bg-surface-2',
            )}
          >
            {cached ? '再问一次' : '让 AI 帮我看看'}
          </button>
        )}
      </header>

      {state.kind === 'confirm' && (
        <ConfirmPanel
          prepared={state.prepared}
          baseUrl={baseUrl}
          model={model}
          onCancel={handleCancel}
          onSend={() => void handleSend(state.prepared)}
        />
      )}

      {state.kind === 'loading' && (
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-ink-tertiary">
            调用中…{' '}
            {state.streamingText.length > 0
              ? `已收到 ${state.streamingText.length} 字`
              : '等待第一段返回'}
          </p>
          {state.streamingText.length > 0 && (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-2 p-2 font-mono text-2xs text-ink-secondary">
              {state.streamingText}
            </pre>
          )}
        </div>
      )}

      {state.kind === 'error' && (
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-warn">✗ {state.message}</p>
          {state.bodyExcerpt && (
            <details className="text-2xs text-ink-tertiary">
              <summary className="cursor-pointer hover:text-ink-secondary">
                provider 回的 body（前 500 字）
              </summary>
              <pre className="mt-1 whitespace-pre-wrap break-words rounded-sm bg-surface-2 p-2 font-mono text-ink-secondary">
                {state.bodyExcerpt}
              </pre>
            </details>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-ink-tertiary/60 px-2.5 py-1 text-xs text-ink-primary transition hover:bg-surface-2"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={handleAsk}
              className="rounded-md border border-ink-tertiary/60 px-2.5 py-1 text-xs text-ink-primary transition hover:bg-surface-2"
            >
              再试一次
            </button>
          </div>
        </div>
      )}

      {cached && state.kind !== 'confirm' && state.kind !== 'loading' && (
        <ObservationView observation={cached} />
      )}
    </section>
  );
}

// ============ Confirm panel (§6.5 privacy gate) ============

interface ConfirmPanelProps {
  prepared: PreparedAiCall;
  baseUrl: string;
  model: string;
  onCancel: () => void;
  onSend: () => void;
}

function ConfirmPanel({
  prepared,
  baseUrl,
  model,
  onCancel,
  onSend,
}: ConfirmPanelProps) {
  const overWarn = prepared.tokensEstimate > TOKEN_WARN_THRESHOLD;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3 text-xs">
      <p className="text-ink-secondary">
        即将发送 ~{prepared.tokensEstimate.toLocaleString()} token · {prepared.promptDescription}
      </p>
      <p className="text-2xs text-ink-tertiary">
        目标 · <code className="font-mono">{baseUrl}</code> · model <code className="font-mono">{model}</code>
      </p>
      {overWarn && (
        <p className="text-2xs text-warn">
          ⚠ 数据较多 · 部分 provider 可能拒绝（context limit）。
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-ink-tertiary/60 px-2.5 py-1 text-xs text-ink-primary transition hover:bg-surface-1"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onSend}
          className="rounded-md bg-cta px-3 py-1 text-xs font-medium text-cta-foreground transition hover:bg-cta-hover"
        >
          发送
        </button>
      </div>
    </div>
  );
}

// ============ Observation view ============

interface ObservationViewProps {
  observation: AiObservation;
}

function ObservationView({ observation }: ObservationViewProps) {
  const { markdown, generatedAt, model } = observation;
  const ts = new Date(generatedAt).toLocaleString();
  const handleCopyMarkdown = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(markdown).catch(() => {
        // Ignore clipboard failures — user can re-read the markdown
        // directly in the surface.
      });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md bg-surface-2 p-3">
        <MarkdownView source={markdown} />
      </div>

      <p className="text-2xs text-ink-tertiary">
        · 供参考 · 「方括号」内是引用 prompt 入参的原文，与数据对不上就别信
      </p>

      <footer className="flex items-center justify-between gap-2 text-2xs text-ink-tertiary">
        <span>
          {ts} · <code className="font-mono">{model}</code>
        </span>
        <button
          type="button"
          onClick={handleCopyMarkdown}
          className="rounded-sm border border-ink-tertiary/40 px-2 py-0.5 text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          复制为 Markdown
        </button>
      </footer>
    </div>
  );
}
