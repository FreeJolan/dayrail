// ERD §6.6.2 v0.8.2 — generic AI observation surface.
//
// Used by both Day (`DayReflectionAi`) and Cycle (`CycleReflectionAi`)
// wrappers; the wrappers prepare scope-specific messages + summary
// strings and hand them in. This component owns:
//   - The state machine (idle → confirm → loading → result | error)
//   - Reading aiBaseUrl / aiModel from `userProfile` + apiKey from
//     localStorage (per ERD §6.6 field-split policy)
//   - Calling `callChatCompletion`, extracting JSON, validating shape
//   - Rendering the result cards (observation / patterns / suggestions)
//   - Calling `onCommit` to cache the result
//
// Confirm step is inline (not a modal) — small footprint, reversible.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { clsx } from 'clsx';
import {
  AiClientError,
  callChatCompletion,
  extractJsonFromResponse,
  type AiObservation,
  type AiObservationJson,
  type ChatMessage,
  useStore,
} from '@dayrail/core';
import { getAiApiKey, subscribeAiApiKey } from '@/lib/aiApiKey';

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
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

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

  const handleAsk = useCallback(() => {
    setState({ kind: 'confirm', prepared: prepareCall() });
  }, [prepareCall]);

  const handleCancel = useCallback(() => {
    setState({ kind: 'idle' });
  }, []);

  const handleSend = useCallback(
    async (prepared: PreparedAiCall) => {
      setState({ kind: 'loading' });
      try {
        const text = await callChatCompletion({
          baseUrl,
          apiKey,
          model,
          messages: prepared.messages,
        });
        const parsed = extractJsonFromResponse(text);
        const validated = validateObservationJson(parsed);
        const observation: AiObservation = {
          generatedAt: Date.now(),
          model,
          json: validated,
        };
        onCommit(observation);
        setState({ kind: 'idle' });
      } catch (err) {
        const aiErr = err as AiClientError;
        const message =
          aiErr instanceof AiClientError
            ? `[${aiErr.kind}] ${aiErr.message}`
            : (err as Error).message ?? String(err);
        setState({ kind: 'error', message });
      }
    },
    [apiKey, baseUrl, model, onCommit],
  );

  const cachedView = useMemo(() => {
    if (!cached) return null;
    return cached;
  }, [cached]);

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
            {cachedView ? '再问一次' : '让 AI 帮我看看'}
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
        <p className="text-xs text-ink-tertiary">
          调用中… provider 在生成完整回复后一次性返回，可能需要数秒。
        </p>
      )}

      {state.kind === 'error' && (
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-warn">✗ {state.message}</p>
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

      {cachedView && state.kind !== 'confirm' && state.kind !== 'loading' && (
        <ObservationView observation={cachedView} />
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
          className="rounded-md bg-bronze-9 px-2.5 py-1 text-xs text-white transition hover:bg-bronze-10"
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
  const { json, generatedAt, model } = observation;
  const ts = new Date(generatedAt).toLocaleString();
  const handleCopyMarkdown = () => {
    const md = formatObservationAsMarkdown(json);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(md).catch(() => {
        // Ignore clipboard failures — user can re-read the cards.
      });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
        <h3 className="text-xs font-medium uppercase tracking-widest text-ink-tertiary">
          标题
        </h3>
        <p className="whitespace-pre-wrap text-sm text-ink-primary">
          {json.headline}
        </p>
      </div>

      {json.observations.length > 0 && (
        <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-3">
          <h3 className="text-xs font-medium uppercase tracking-widest text-ink-tertiary">
            观察 · 引用入参
          </h3>
          <ul className="flex flex-col gap-3">
            {json.observations.map((item, i) => (
              <li key={i} className="flex flex-col gap-1">
                <p className="text-sm text-ink-primary">{item.claim}</p>
                <p className="text-2xs text-ink-tertiary">
                  ↳ <span className="italic">「{item.from_data}」</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="text-2xs text-ink-tertiary">
            · 供参考 · 每条 claim 都附 from_data 引用，与 prompt 对不上的就别信
          </p>
        </div>
      )}

      {json.questions_to_sit_with.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
          <h3 className="text-xs font-medium uppercase tracking-widest text-ink-tertiary">
            可以放在心里慢慢想的问题
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-primary">
            {json.questions_to_sit_with.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

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

// ============ Helpers ============

/** Validate that the parsed JSON conforms to the v0.8.2 citation-bound
 *  observation schema. Throws AiClientError(parse-error) on mismatch.
 *  Soft on shape (defaults missing arrays to empty) — the AI sometimes
 *  omits empty arrays even when the schema says they're required. */
export function validateObservationJson(raw: unknown): AiObservationJson {
  if (!raw || typeof raw !== 'object') {
    throw new AiClientError(
      'parse-error',
      'AI response was not a JSON object.',
    );
  }
  const obj = raw as Record<string, unknown>;

  const headline = obj.headline;
  if (typeof headline !== 'string' || headline.trim().length === 0) {
    throw new AiClientError(
      'parse-error',
      'AI response missing non-empty string field "headline".',
    );
  }

  const rawObservations = obj.observations;
  let observations: Array<{ claim: string; from_data: string }>;
  if (rawObservations === undefined || rawObservations === null) {
    observations = [];
  } else if (!Array.isArray(rawObservations)) {
    throw new AiClientError(
      'parse-error',
      'AI response field "observations" must be an array.',
    );
  } else {
    observations = rawObservations.map((item, idx) => {
      if (!item || typeof item !== 'object') {
        throw new AiClientError(
          'parse-error',
          `AI response observations[${idx}] is not an object.`,
        );
      }
      const o = item as Record<string, unknown>;
      const claim = o.claim;
      const from_data = o.from_data;
      if (typeof claim !== 'string' || claim.trim().length === 0) {
        throw new AiClientError(
          'parse-error',
          `AI response observations[${idx}].claim must be a non-empty string.`,
        );
      }
      if (typeof from_data !== 'string') {
        throw new AiClientError(
          'parse-error',
          `AI response observations[${idx}].from_data must be a string (use "" if you genuinely cannot cite — but prefer omitting the observation entirely).`,
        );
      }
      return { claim, from_data };
    });
  }

  const rawQuestions = obj.questions_to_sit_with;
  let questions_to_sit_with: string[];
  if (rawQuestions === undefined || rawQuestions === null) {
    questions_to_sit_with = [];
  } else if (
    !Array.isArray(rawQuestions) ||
    !rawQuestions.every((q) => typeof q === 'string')
  ) {
    throw new AiClientError(
      'parse-error',
      'AI response field "questions_to_sit_with" must be string[].',
    );
  } else {
    questions_to_sit_with = rawQuestions;
  }

  return { headline, observations, questions_to_sit_with };
}

function formatObservationAsMarkdown(json: AiObservationJson): string {
  const parts: string[] = [];
  parts.push(`### ${json.headline}`);
  if (json.observations.length > 0) {
    const lines = json.observations.map(
      (o) => `- ${o.claim}\n  ↳ 引用：「${o.from_data}」`,
    );
    parts.push(`#### 观察 · 引用入参\n\n${lines.join('\n')}`);
  }
  if (json.questions_to_sit_with.length > 0) {
    parts.push(
      `#### 可以放在心里慢慢想的问题\n\n${json.questions_to_sit_with
        .map((q) => `- ${q}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}
