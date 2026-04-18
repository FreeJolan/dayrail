// Theme preference + DOM class toggle. `applyTheme` is the canonical
// writer: call it on boot to restore saved pref, and from any UI
// control that lets the user switch. Also wires a `prefers-color-
// scheme` listener so `system` mode follows OS-level changes live.

export type ThemePref = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'dayrail.theme';

function readSavedPref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function effectiveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function setHtmlClass(mode: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (mode === 'dark') html.classList.add('dark');
  else html.classList.remove('dark');
  html.style.colorScheme = mode;
}

let systemListenerBound = false;
let currentPref: ThemePref = 'system';

/** Apply a theme preference: writes to localStorage, updates the
 *  `.dark` class on `<html>`, and rebinds the system-preference
 *  listener so `system` mode tracks OS changes live. */
export function applyTheme(pref: ThemePref): void {
  currentPref = pref;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, pref);
  }
  setHtmlClass(effectiveTheme(pref));

  if (typeof window !== 'undefined' && !systemListenerBound) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => {
      if (currentPref === 'system') {
        setHtmlClass(systemPrefersDark() ? 'dark' : 'light');
      }
    });
    systemListenerBound = true;
  }
}

/** Initial boot hook: read saved pref + apply it. Call before React
 *  mounts so the first paint doesn't flash light → dark. */
export function initTheme(): ThemePref {
  const pref = readSavedPref();
  applyTheme(pref);
  return pref;
}

export function getThemePref(): ThemePref {
  return currentPref;
}
