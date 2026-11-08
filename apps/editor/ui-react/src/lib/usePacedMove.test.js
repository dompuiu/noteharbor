import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { usePacedMove } from "./usePacedMove.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePacedMove", () => {
  test("the first press moves immediately and later presses wait", () => {
    const { result } = renderHook(() => usePacedMove());
    const moves = [];

    act(() => {
      result.current.requestMove(() => moves.push(1));
      result.current.requestMove(() => moves.push(2));
      result.current.requestMove(() => moves.push(3));
    });

    expect(moves).toEqual([1]);

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(moves).toEqual([1]);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // Only the newest press in the window survives.
    expect(moves).toEqual([1, 3]);
  });

  test("a press after the interval moves without waiting", () => {
    const { result } = renderHook(() => usePacedMove());
    const moves = [];

    act(() => {
      result.current.requestMove(() => moves.push(1));
    });

    act(() => {
      vi.advanceTimersByTime(200);
      result.current.requestMove(() => moves.push(2));
    });

    expect(moves).toEqual([1, 2]);
  });

  test("a single tap settles quickly", () => {
    const { result } = renderHook(() => usePacedMove());

    act(() => {
      result.current.requestMove(() => {});
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.walking).toBe(false);
  });

  test("taps inside the continuous window keep the longer settle", () => {
    const { result } = renderHook(() => usePacedMove());

    act(() => {
      result.current.requestMove(() => {});
    });
    act(() => {
      vi.advanceTimersByTime(200);
      result.current.requestMove(() => {});
    });

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.walking).toBe(false);
  });

  test("a tap just inside the interval still settles like a single tap", () => {
    const { result } = renderHook(() =>
      usePacedMove({
        intervalMs: 200,
        settleMs: 300,
        discreteSettleMs: 80,
        continuousWindowMs: 120,
      }),
    );

    act(() => {
      result.current.requestMove(() => {});
    });
    act(() => {
      vi.advanceTimersByTime(150);
      result.current.requestMove(() => {});
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(result.current.walking).toBe(false);
  });

  test("a burst keeps walking true for the longer settle window", () => {
    const { result } = renderHook(() =>
      usePacedMove({
        intervalMs: 200,
        settleMs: 300,
        discreteSettleMs: 80,
      }),
    );

    act(() => {
      result.current.requestMove(() => {});
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.requestMove(() => {});
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.walking).toBe(false);
  });

  test("walking stays true until the settle window ends", () => {
    const { result } = renderHook(() =>
      usePacedMove({
        intervalMs: 200,
        settleMs: 300,
        discreteSettleMs: 300,
      }),
    );

    act(() => {
      result.current.requestMove(() => {});
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.walking).toBe(false);
  });

  test("another move restarts the settle window", () => {
    const { result } = renderHook(() =>
      usePacedMove({
        intervalMs: 200,
        settleMs: 300,
        discreteSettleMs: 300,
      }),
    );

    act(() => {
      result.current.requestMove(() => {});
    });

    act(() => {
      vi.advanceTimersByTime(250);
      result.current.requestMove(() => {});
    });

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.walking).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.walking).toBe(false);
  });

  test("cancelling drops the pending move without disturbing the next press", () => {
    const { result } = renderHook(() => usePacedMove());
    const moves = [];

    act(() => {
      result.current.requestMove(() => moves.push(1));
      result.current.requestMove(() => moves.push(2));
      result.current.cancelPendingMove();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(moves).toEqual([1]);

    act(() => {
      result.current.requestMove(() => moves.push(3));
    });
    expect(moves).toEqual([1, 3]);
  });

  test("unmounting drops a pending move", () => {
    const { result, unmount } = renderHook(() => usePacedMove());
    const moves = [];

    act(() => {
      result.current.requestMove(() => moves.push(1));
      result.current.requestMove(() => moves.push(2));
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(moves).toEqual([1]);
  });
});
