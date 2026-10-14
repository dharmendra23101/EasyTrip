import { act, renderHook } from '@testing-library/react';

import { useHomeCarousel } from '../src/hooks/useHomeCarousel';

/**
 * The hero carousel and `prefers-reduced-motion` (`PE-022`).
 *
 * **`IMP-082` handles reduced motion for CSS transitions and, through `<MotionConfig
 * reducedMotion="user">`, for framer-motion. Neither could reach this**, because the movement here
 * is not an animation — it is a `setInterval` swapping which slide exists. So a reader who had asked
 * the whole platform to stop moving things still got a hero that advanced every five seconds.
 *
 * That is WCAG 2.2.2: content that moves automatically for more than five seconds needs a way to
 * pause it, and a platform-level preference is the clearest way a reader can ask for one.
 *
 * **It was found by a symptom rather than by a rule.** `axe` cannot see it. What it could see was
 * `/` reporting 1, 8, 4 and 8 contrast violations across four identical scans, because each one
 * measured whichever slide happened to be on screen. Chasing that turned up two separate causes —
 * this one, and unsettled webfonts — and only one of them was a defect.
 */

jest.mock('../src/hooks/useWishlist', () => ({
  useWishlist: () => ({ savedIds: [], toggle: jest.fn(), isSaved: () => false })
}));

const PLACES = [
  { id: 1, name: 'Hampi' },
  { id: 2, name: 'Gokarna' },
  { id: 3, name: 'Badami' }
];

/** jsdom has no `matchMedia`; this is the smallest thing the hook can subscribe to. */
const mockMatchMedia = (matches) => {
  const listeners = new Set();
  const query = {
    matches,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn)
  };
  window.matchMedia = jest.fn(() => query);
  return {
    query,
    // Let a test flip the preference the way a system setting change would.
    change: (next) => {
      query.matches = next;
      listeners.forEach((fn) => fn(query));
    }
  };
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('by default the hero advances on its own', () => {
  test('the slide changes after the autoplay interval', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useHomeCarousel(PLACES, null));

    expect(result.current.currentPlaceIndex).toBe(0);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.currentPlaceIndex).toBe(1);
  });
});

describe('a reader who has asked for less movement gets none', () => {
  test('the carousel does not advance', () => {
    // The assertion the accessibility gate depends on: `/` cannot be scanned deterministically
    // while the slide under the scanner keeps changing.
    mockMatchMedia(true);
    const { result } = renderHook(() => useHomeCarousel(PLACES, null));

    act(() => {
      jest.advanceTimersByTime(20000);
    });

    expect(result.current.currentPlaceIndex).toBe(0);
  });

  test('but they can still move it themselves', () => {
    // Stopping the *automatic* movement is the request. Taking away the controls would be a
    // different and worse answer — the reader asked for less motion, not for less carousel.
    mockMatchMedia(true);
    const { result } = renderHook(() => useHomeCarousel(PLACES, null));

    act(() => {
      result.current.goToNextPlace();
    });

    expect(result.current.currentPlaceIndex).toBe(1);
  });

  test('changing the system setting stops a carousel that was already running', () => {
    // `matchMedia` is subscribed to rather than read once, so a reader who turns the preference on
    // while the page is open is obeyed without a reload.
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useHomeCarousel(PLACES, null));

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.currentPlaceIndex).toBe(1);

    act(() => {
      media.change(true);
    });
    act(() => {
      jest.advanceTimersByTime(20000);
    });

    expect(result.current.currentPlaceIndex).toBe(1);
  });

  test('and turning it back off starts it again', () => {
    const media = mockMatchMedia(true);
    const { result } = renderHook(() => useHomeCarousel(PLACES, null));

    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(result.current.currentPlaceIndex).toBe(0);

    act(() => {
      media.change(false);
    });
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.currentPlaceIndex).toBe(1);
  });
});
