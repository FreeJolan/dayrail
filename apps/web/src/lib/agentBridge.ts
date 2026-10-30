// Device-local opt-in. No agent state or token enters the Y.Doc.
import { createAgentDispatcher, type AgentRequest } from '@dayrail/core';
import { isTauriRuntime } from './versionUpdateContext';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';

const PREF = 'dayrail.agent.enabled';
export const useAgentBridge = create<{
  enabled: boolean;
  running: boolean;
  error: string | null;
}>(() => ({
  enabled: localStorage.getItem(PREF) === 'true',
  running: false,
  error: null,
}));
let dispatcher: ReturnType<typeof createAgentDispatcher> | null = null;
let unlisten: UnlistenFn | null = null;
let transition: Promise<void> = Promise.resolve();
let confirmDelete:
  | ((label: string, explanation: string) => Promise<boolean>)
  | undefined;

export function setAgentConfirmation(handler: typeof confirmDelete) {
  confirmDelete = handler;
}
export function setAgentEnabled(enabled: boolean): Promise<void> {
  localStorage.setItem(PREF, String(enabled));
  useAgentBridge.setState({ enabled });
  return reconcileAgentBridge();
}
export function reconcileAgentBridge(): Promise<void> {
  transition = transition
    .catch(() => undefined)
    .then(async () => {
      if (!isTauriRuntime()) return;
      const enabled = useAgentBridge.getState().enabled;
      if (!enabled) {
        await invoke('agent_stop');
        unlisten?.();
        unlisten = null;
        dispatcher?.dispose();
        dispatcher = null;
        useAgentBridge.setState({ running: false, error: null });
        return;
      }
      if (dispatcher) return;
      const next = createAgentDispatcher({
        confirmDelete: (label, explanation) =>
          confirmDelete
            ? confirmDelete(label, explanation)
            : Promise.resolve(false),
      });
      try {
        unlisten = await listen<AgentRequest & { channelId: string }>(
          'dayrail:agent-request',
          async ({ payload }) => {
            const response = await next.dispatch(payload);
            await invoke('agent_respond', {
              channelId: payload.channelId,
              response,
            });
          },
        );
        await invoke('agent_start', { devMode: import.meta.env.DEV });
        dispatcher = next;
        useAgentBridge.setState({ running: true, error: null });
      } catch (error) {
        unlisten?.();
        unlisten = null;
        next.dispose();
        useAgentBridge.setState({ running: false, error: String(error) });
      }
    });
  return transition;
}
// A full page reload creates a new runtime; do not keep a stale discovery endpoint.
if (isTauriRuntime())
  window.addEventListener('pagehide', () => {
    void invoke('agent_stop');
  });
