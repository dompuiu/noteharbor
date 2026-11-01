import { useEffect, useRef, useState } from "react";

const hiddenScroll = {
  bottom: 4,
  thumbHeight: 0,
  thumbTop: 0,
  top: 0,
  valueNow: 0,
  visible: false,
};

// The vertical scrollbar is custom-drawn so its track spans only the rows
// area below the sticky header (a native scrollbar would always run the full
// height of the scroll container, header included). It owns its metrics and
// thumb drag, so a scroll tick updates this component alone; the table only
// hears about a visibility change, which changes the gutter width.
export function TableScrollbar({
  loading,
  onFirstRow,
  onLastRow,
  onPage,
  onVisibleChange,
  rowCount,
  rowHeight,
  scrollRef,
}) {
  const [scroll, setScroll] = useState(hiddenScroll);
  const metricsRef = useRef({ max: 0, range: 0, thumbHeight: 0 });
  const thumbDragRef = useRef(null);

  useEffect(() => {
    const scroller = scrollRef.current;

    if (!scroller) {
      return undefined;
    }

    let frameId = 0;

    const update = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;

      if (max <= 1) {
        metricsRef.current = { max: 0, range: 0, thumbHeight: 0 };
        setScroll((current) =>
          current.visible ? { ...current, visible: false } : current,
        );
        return;
      }

      const headerHeight = scroller.querySelector("thead")?.offsetHeight ?? 0;
      // Both native scrollbars are hidden, so the custom track runs to the
      // bottom edge instead of stopping above a bar.
      const top = headerHeight + 4;
      const bottom = 4;
      const trackHeight = Math.max(0, scroller.clientHeight - top - bottom);

      if (trackHeight <= 40) {
        metricsRef.current = { max: 0, range: 0, thumbHeight: 0 };
        setScroll((current) =>
          current.visible ? { ...current, visible: false } : current,
        );
        return;
      }

      const thumbHeight = Math.max(
        24,
        Math.min(
          trackHeight,
          (scroller.clientHeight / scroller.scrollHeight) * trackHeight,
        ),
      );
      const range = Math.max(1, trackHeight - thumbHeight);
      const ratio = Math.min(1, Math.max(0, scroller.scrollTop / max));
      metricsRef.current = { max, range, thumbHeight };

      const next = {
        bottom,
        thumbHeight,
        thumbTop: ratio * range,
        top,
        valueNow: Math.round(ratio * 100),
        visible: true,
      };

      setScroll((current) =>
        current.visible === next.visible &&
        current.top === next.top &&
        current.bottom === next.bottom &&
        current.thumbHeight === next.thumbHeight &&
        current.thumbTop === next.thumbTop &&
        current.valueNow === next.valueNow
          ? current
          : next,
      );
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(update);
    };

    update();
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scroller);

    const header = scroller.querySelector("thead");

    if (header) {
      observer.observe(header);
    }

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      scroller.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [loading, rowCount, scrollRef]);

  const visible = scroll.visible;

  useEffect(() => {
    onVisibleChange(visible);
  }, [onVisibleChange, visible]);

  function handleThumbPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();

    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    thumbDragRef.current = {
      startScrollTop: scroller.scrollTop,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleThumbPointerMove(event) {
    const drag = thumbDragRef.current;
    const scroller = scrollRef.current;
    const metrics = metricsRef.current;

    if (
      !drag ||
      !scroller ||
      !metrics ||
      metrics.max <= 0 ||
      metrics.range <= 0
    ) {
      return;
    }

    scroller.scrollTop =
      drag.startScrollTop +
      ((event.clientY - drag.startY) * metrics.max) / metrics.range;
  }

  function handleThumbPointerEnd() {
    thumbDragRef.current = null;
  }

  function handleTrackPointerDown(event) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const scroller = scrollRef.current;
    const metrics = metricsRef.current;

    if (!scroller || !metrics || metrics.max <= 0 || metrics.range <= 0) {
      return;
    }

    const trackBounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(
        0,
        (event.clientY - trackBounds.top - metrics.thumbHeight / 2) /
          metrics.range,
      ),
    );
    scroller.scrollTop = ratio * metrics.max;
  }

  function handleThumbKeyDown(event) {
    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      scroller.scrollTop += rowHeight;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      scroller.scrollTop -= rowHeight;
    } else if (event.key === "PageDown") {
      event.preventDefault();
      // Stop the key from reaching the table's global handler, which would
      // page a second time.
      event.stopPropagation();
      onPage?.(1);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      event.stopPropagation();
      onPage?.(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      onFirstRow?.();
    } else if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      onLastRow?.();
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      className="table-vtrack"
      onPointerDown={handleTrackPointerDown}
      style={{ bottom: scroll.bottom, top: scroll.top }}
    >
      <button
        aria-label="Scroll notes table vertically"
        aria-orientation="vertical"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={scroll.valueNow}
        className="table-vthumb"
        onKeyDown={handleThumbKeyDown}
        onPointerCancel={handleThumbPointerEnd}
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerEnd}
        role="scrollbar"
        style={{
          height: scroll.thumbHeight,
          transform: `translateY(${scroll.thumbTop}px)`,
        }}
        type="button"
      />
    </div>
  );
}
