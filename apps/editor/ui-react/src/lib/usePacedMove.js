// Leading+trailing throttle for a walk through a list.
//
// A held arrow key repeats faster than the slideshow can paint a new note. The
// first press moves immediately; presses that arrive inside the interval wait
// for the remaining time and then apply only the newest one. The result is at
// most one move per interval, with the last press never lost.
//
// `walking` stays true for a short while after the last applied move so
// callers can defer expensive work (large image scans). A single tap settles
// quickly; a burst of presses keeps it true for longer, because that is when
// the next key is likely to arrive and throw the work away.
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_INTERVAL_MS = 200;
const DEFAULT_SETTLE_MS = 300;
const DEFAULT_DISCRETE_SETTLE_MS = 120;
const DEFAULT_CONTINUOUS_WINDOW_MS = 250;

function usePacedMove({
  intervalMs = DEFAULT_INTERVAL_MS,
  settleMs = DEFAULT_SETTLE_MS,
  discreteSettleMs = DEFAULT_DISCRETE_SETTLE_MS,
  continuousWindowMs = DEFAULT_CONTINUOUS_WINDOW_MS,
} = {}) {
  const lastMoveAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastRequestAtRef = useRef(Number.NEGATIVE_INFINITY);
  const pendingMoveRef = useRef(null);
  const moveTimerRef = useRef(null);
  const settleTimerRef = useRef(null);
  const [walking, setWalking] = useState(false);

  const runMove = useCallback(
    (move, continuous) => {
      lastMoveAtRef.current = Date.now();
      move();
      setWalking(true);

      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
      }

      settleTimerRef.current = setTimeout(
        () => {
          settleTimerRef.current = null;
          setWalking(false);
        },
        continuous ? settleMs : discreteSettleMs,
      );
    },
    [discreteSettleMs, settleMs],
  );

  const requestMove = useCallback(
    (move) => {
      const now = Date.now();
      const continuous =
        now - lastRequestAtRef.current <= continuousWindowMs;
      const remaining = intervalMs - (now - lastMoveAtRef.current);

      lastRequestAtRef.current = now;

      if (remaining <= 0) {
        pendingMoveRef.current = null;

        if (moveTimerRef.current) {
          clearTimeout(moveTimerRef.current);
          moveTimerRef.current = null;
        }

        runMove(move, continuous);
        return;
      }

      // Only the newest press in this window matters; earlier ones would move
      // through notes the collector never sees.
      pendingMoveRef.current = { continuous, move };

      if (!moveTimerRef.current) {
        moveTimerRef.current = setTimeout(() => {
          moveTimerRef.current = null;
          const pending = pendingMoveRef.current;
          pendingMoveRef.current = null;

          if (pending) {
            runMove(pending.move, pending.continuous);
          }
        }, remaining);
      }
    },
    [continuousWindowMs, intervalMs, runMove],
  );

  const cancelPendingMove = useCallback(() => {
    pendingMoveRef.current = null;

    if (moveTimerRef.current) {
      clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (moveTimerRef.current) {
        clearTimeout(moveTimerRef.current);
      }

      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
      }
    },
    [],
  );

  return { cancelPendingMove, requestMove, walking };
}

export { usePacedMove };
