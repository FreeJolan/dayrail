import { useCallback, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// IME composition guard for Chinese / Japanese / Korean input.
//
// Why this can't just be `!e.nativeEvent.isComposing`:
//
// macOS WKWebView (Tauri's runtime) fires `compositionend` BEFORE the
// keydown for the Enter that confirms a pinyin candidate. By the time
// our keydown handler runs, `e.isComposing` has already flipped to
// false — the single-flag guard fails, the form submits, and we lose
// the candidate selection.
//
// Chromium (Vite dev server, PWA) gets the event order right:
// `keydown(Enter, isComposing=true)` → `compositionend` → `keyup`. So
// the bare `!e.nativeEvent.isComposing` guard works there. The Tauri
// desktop build is where it falls down.
//
// This hook tracks composition state explicitly via the two
// composition events, and **delays the "end" reset by one event-loop
// tick** (setTimeout 0) so the WKWebView confirming-Enter keydown
// still sees `composing=true`. The native `e.isComposing` is also
// checked as a fast path; together the two-flag predicate covers both
// engines.
//
// Usage:
//
//   const ime = useIme();
//   <input
//     onCompositionStart={ime.onCompositionStart}
//     onCompositionEnd={ime.onCompositionEnd}
//     onKeyDown={(e) => {
//       if (e.key === 'Enter' && !ime.isComposing(e)) submit();
//     }}
//   />

export interface ImeHandlers {
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  /**
   * `true` if an IME composition is currently active and the given
   * keyboard event should be treated as a candidate-selection key
   * (NOT a form-submit Enter). Accepts both React synthetic and
   * native keyboard events.
   */
  isComposing(event?: ReactKeyboardEvent | KeyboardEvent): boolean;
}

export function useIme(): ImeHandlers {
  const composingRef = useRef(false);
  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);
  const onCompositionEnd = useCallback(() => {
    // Delay the reset · WKWebView fires `compositionend` BEFORE the
    // confirming Enter keydown, so a synchronous reset would let the
    // keydown see `composing=false`. setTimeout 0 pushes the reset to
    // the next event-loop tick — keydown finishes first.
    setTimeout(() => {
      composingRef.current = false;
    }, 0);
  }, []);
  const isComposing = useCallback(
    (event?: ReactKeyboardEvent | KeyboardEvent): boolean => {
      if (composingRef.current) return true;
      if (!event) return false;
      const native =
        'nativeEvent' in event ? event.nativeEvent : (event as KeyboardEvent);
      return native.isComposing === true;
    },
    [],
  );
  return { onCompositionStart, onCompositionEnd, isComposing };
}
