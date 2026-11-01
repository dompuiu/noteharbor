import { useEffect, useReducer, useRef } from "react";

// Every call to the mocked hook is one Table screen commit. Budget tests reset
// this before an interaction to prove a scroll tick commits once.
export const virtualizerStats = { renders: 0, measureElementCalls: 0 };

function windowBounds(scroller, count, rowHeight, overscan, viewportHeight) {
  const scrollTop = scroller?.scrollTop ?? 0;
  const height = scroller?.clientHeight || viewportHeight;
  const first = Math.floor(scrollTop / rowHeight);
  const last = Math.ceil((scrollTop + height) / rowHeight) - 1;

  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count - 1, last + overscan),
  };
}

// A virtualizer stand-in that renders only the rows inside a real window and
// re-renders on the scroller's `scroll` event, like @tanstack/react-virtual.
// The suite's older mock renders every note, which hides both the row-render
// budget and the windowing under test.
//
// Usage:
//   vi.mock("@tanstack/react-virtual", async () => {
//     const { makeWindowedVirtualizer } = await import("../test/windowedVirtualizer.js");
//     return { useVirtualizer: makeWindowedVirtualizer({ rowHeight: 46 }) };
//   });
export function makeWindowedVirtualizer({
  viewportHeight = 600,
  rowHeight: fixedRowHeight = 46,
  overscan: fixedOverscan = 5,
} = {}) {
  return function useWindowedVirtualizer({
    count,
    estimateSize,
    getScrollElement,
    overscan,
  }) {
    const [, forceRender] = useReducer((value) => value + 1, 0);
    const stateRef = useRef(null);
    const apiRef = useRef(null);
    const scroller = getScrollElement?.() ?? null;
    const rowHeight = estimateSize?.() ?? fixedRowHeight;
    const overscanRows = overscan ?? fixedOverscan;

    virtualizerStats.renders += 1;

    useEffect(() => {
      // The ref is attached after the first render, so read the element here
      // rather than trusting the render-time snapshot.
      const element = getScrollElement?.();

      if (!element) {
        return undefined;
      }

      const onScroll = () => forceRender();
      element.addEventListener("scroll", onScroll);
      return () => element.removeEventListener("scroll", onScroll);
      // The scroller mounts only once the notes load, so re-attach when the
      // list size changes; the ref is read inside the effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count]);

    const { start, end } = windowBounds(
      scroller,
      count,
      rowHeight,
      overscanRows,
      viewportHeight,
    );
    const virtualItems = [];

    for (let index = start; index <= end; index += 1) {
      virtualItems.push({
        index,
        key: index,
        size: rowHeight,
        start: index * rowHeight,
        end: (index + 1) * rowHeight,
      });
    }

    stateRef.current = {
      count,
      rowHeight,
      scroller,
      virtualItems,
    };

    // The real virtualizer keeps one instance for the life of the screen.
    // Returning a fresh object each render would re-run the table's
    // `scrollToOffset(0)` effect on every commit and reset test scrolling.
    if (!apiRef.current) {
      apiRef.current = {
        getVirtualItems: () => stateRef.current.virtualItems,
        getTotalSize: () =>
          stateRef.current.count * stateRef.current.rowHeight,
        measureElement: () => {
          virtualizerStats.measureElementCalls += 1;
        },
        scrollToIndex: (index) => {
          const element = stateRef.current.scroller;

          if (element) {
            element.scrollTop = index * stateRef.current.rowHeight;
          }
        },
        scrollToOffset: (offset) => {
          const element = stateRef.current.scroller;

          if (element) {
            element.scrollTop = offset;
          }
        },
      };
    }

    return apiRef.current;
  };
}
