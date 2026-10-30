import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  reconcileAgentBridge,
  setAgentConfirmation,
  useAgentBridge,
} from '@/lib/agentBridge';
import { isTauriRuntime } from '@/lib/versionUpdateContext';

/** Mounted after BootGate so CLI cannot bypass initial data reconciliation. */
export function AgentBridge() {
  const [candidate, setCandidate] = useState<{
    label: string;
    explanation: string;
  } | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const enabled = useAgentBridge((s) => s.enabled);
  useEffect(() => {
    if (candidate === null) return;
    const timer = setTimeout(() => settle(false), 100_000);
    return () => clearTimeout(timer);
  }, [candidate]);
  const settle = (answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setCandidate(null);
  };
  useEffect(() => {
    if (!isTauriRuntime()) return;
    setAgentConfirmation(
      (label, explanation) =>
        new Promise((resolve) => {
          resolver.current = resolve;
          setCandidate({ label, explanation });
        }),
    );
    void reconcileAgentBridge();
    return () => {
      setAgentConfirmation(undefined);
      resolver.current?.(false);
      resolver.current = null;
    };
  }, []);
  useEffect(() => {
    if (!enabled) settle(false);
  }, [enabled]);
  return (
    <Dialog.Root
      open={candidate !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/25" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-subtle bg-surface-0 p-6 shadow-xl">
          <Dialog.Title className="text-base font-medium text-ink-primary">
            确认删除？
          </Dialog.Title>
          <Dialog.Description className="mt-3 break-words text-sm text-ink-secondary">
            本地 Agent 请求删除「{candidate?.label}」。{candidate?.explanation}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-3">
            <button
              className="rounded-md bg-surface-2 px-4 py-2 text-sm text-ink-primary"
              onClick={() => settle(false)}
            >
              取消
            </button>
            <button
              className="rounded-md bg-warn px-4 py-2 text-sm text-surface-0"
              onClick={() => settle(true)}
            >
              确认删除
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
