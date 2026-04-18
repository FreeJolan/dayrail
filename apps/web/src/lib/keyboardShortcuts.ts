import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Vim-style bigraph shortcuts for page nav: press `g`, then a second
// key within 1.2s. Chosen over Cmd/Ctrl+digit because (a) zero browser
// conflicts, (b) doesn't steal keys from text inputs (we ignore when
// focus is on a control), (c) future page-local shortcuts can use bare
// keys without colliding.

export interface Shortcut {
  keys: string; // bigraph, e.g. "g t"
  label: string; // Chinese label for the cheatsheet
  path: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'g t', label: 'Today Track', path: '/' },
  { keys: 'g c', label: 'Cycle View', path: '/cycle' },
  { keys: 'g l', label: 'Tasks', path: '/tasks' },
  { keys: 'g k', label: 'Calendar', path: '/calendar' },
  { keys: 'g p', label: 'Pending', path: '/pending' },
  { keys: 'g r', label: 'Review', path: '/review' },
  { keys: 'g e', label: 'Template Editor', path: '/templates' },
  { keys: 'g s', label: 'Settings', path: '/settings' },
];

const LEADER_TIMEOUT_MS = 1200;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useGlobalShortcuts(onOpenCheatsheet: () => void): void {
  const navigate = useNavigate();

  useEffect(() => {
    let leader: 'g' | null = null;
    let leaderTimer: number | null = null;

    const clearLeader = () => {
      leader = null;
      if (leaderTimer !== null) {
        window.clearTimeout(leaderTimer);
        leaderTimer = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // `?` (Shift+/) opens the cheatsheet without a leader.
      if (e.key === '?') {
        e.preventDefault();
        onOpenCheatsheet();
        return;
      }

      if (leader === 'g') {
        const bigraph = `g ${e.key.toLowerCase()}`;
        const match = SHORTCUTS.find((s) => s.keys === bigraph);
        clearLeader();
        if (match) {
          e.preventDefault();
          navigate(match.path);
        }
        return;
      }

      if (e.key.toLowerCase() === 'g' && !e.shiftKey) {
        leader = 'g';
        leaderTimer = window.setTimeout(clearLeader, LEADER_TIMEOUT_MS);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearLeader();
    };
  }, [navigate, onOpenCheatsheet]);
}

export function useCheatsheetToggle(): {
  open: boolean;
  show: () => void;
  hide: () => void;
} {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return {
    open,
    show: () => setOpen(true),
    hide: () => setOpen(false),
  };
}
