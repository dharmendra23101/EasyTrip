import { useEffect, useRef } from 'react';

/**
 * Close-on-outside-click and close-on-Escape for a disclosure (dropdown, popover, share menu).
 *
 * Both the profile dropdown and the share menu needed exactly this, and neither had it — the
 * profile dropdown could only be closed by re-clicking the avatar or navigating away (IMP-077),
 * and the share menu had no open/close model at all because it was CSS `group-hover` (IMP-079).
 *
 * Returns a ref to attach to the container that wraps *both* the trigger and the panel. Wrapping
 * both matters: if the ref covered only the panel, clicking the trigger to close would register as
 * an outside click, the handler would close it, and the trigger's own onClick would immediately
 * reopen it.
 *
 * @param {Boolean} isOpen   whether the disclosure is currently open
 * @param {Function} onClose called when the user clicks outside or presses Escape
 */
export function useDismissable(isOpen, onClose) {
  const containerRef = useRef(null);
  // Held in a ref so the effect does not need to re-subscribe every time the caller passes a new
  // inline function — which is every render, for most callers.
  const onCloseRef = useRef(onClose);

  // **Written in an effect, not during render** (`BL-146`). `onCloseRef.current = onClose` used to
  // sit in the render body, which is the latest-ref pattern as it is usually written and as React's
  // own documentation warns against: a render can be started, thrown away and never committed, and
  // a render that mutates a ref has already changed something by then. It is correct today because
  // this project renders synchronously; it is correct *by accident*, and the accident is exactly
  // what `react-hooks/refs` is pointing at.
  //
  // No dependency array on purpose - this must run after **every** commit, since the whole point is
  // to track the newest `onClose`. `useRef(onClose)` above still seeds it for the first render, so
  // there is no window in which the ref is empty.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        onCloseRef.current();
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
      }
    };

    // `mousedown` rather than `click`: a click fires after the pointer is released, by which time
    // the element under the cursor may have moved or unmounted.
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return containerRef;
}

export default useDismissable;
