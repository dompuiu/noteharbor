import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const tableTagClass = "tag table-tag";

// The popover's size and its hover delays. They size the box the position
// maths works against and pace opening so a pointer passing over the chip
// does not flash a tag list.
const tagsPopoverWidth = 280;
const tagsPopoverMaxHeight = 320;
const tagsPopoverOpenDelay = 300;
const tagsPopoverCloseDelay = 150;

// Anchors the popover under `bounds` (the trigger's rect), flipping above it
// when there isn't room below, given the popover's (real or estimated) height.
function computePopoverTop(bounds, height) {
  const spaceBelow = window.innerHeight - bounds.bottom - 6;
  const spaceAbove = bounds.top - 6;

  return spaceBelow >= height || spaceBelow >= spaceAbove
    ? Math.min(bounds.bottom + 6, window.innerHeight - height - 8)
    : Math.max(8, bounds.top - height - 6);
}

export function TagsCell({ onApplyFilter, tagPlan, tags }) {
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const openTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const popoverHeightRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setPopoverPosition(null);
      popoverHeightRef.current = null;
      return undefined;
    }

    function updatePosition() {
      const trigger = triggerRef.current;

      if (!trigger) {
        setIsOpen(false);
        return;
      }

      const bounds = trigger.getBoundingClientRect();
      const maxLeft = window.innerWidth - tagsPopoverWidth - 8;
      const left = Math.max(8, Math.min(bounds.left, maxLeft));

      // Before the popover has mounted (and given us a real height to
      // measure), fall back to its max possible height so the first paint
      // still avoids running off-screen; the layout effect below corrects
      // `top` using the real height as soon as it's known.
      const height =
        popoverHeightRef.current ??
        Math.min(tagsPopoverMaxHeight, window.innerHeight - 16);
      const top = computePopoverTop(bounds, height);

      setPopoverPosition({ top, left });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  // The first pass above has to guess the popover's height, since it hasn't
  // rendered yet. Once it has, re-derive `top` from its actual height so a
  // short tag list doesn't get positioned as if it were the max height.
  useLayoutEffect(() => {
    if (!isOpen || !popoverPosition || !popoverRef.current) {
      return;
    }

    const measuredHeight = popoverRef.current.getBoundingClientRect().height;

    if (popoverHeightRef.current === measuredHeight) {
      return;
    }

    popoverHeightRef.current = measuredHeight;

    const trigger = triggerRef.current;

    if (!trigger) {
      return;
    }

    const bounds = trigger.getBoundingClientRect();
    const top = computePopoverTop(bounds, measuredHeight);

    setPopoverPosition((current) => (current ? { ...current, top } : current));
  }, [isOpen, popoverPosition]);

  useEffect(() => {
    return () => {
      if (openTimeoutRef.current) {
        clearTimeout(openTimeoutRef.current);
      }

      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  function cancelScheduledOpen() {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
  }

  function cancelScheduledClose() {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function handleTriggerMouseEnter() {
    cancelScheduledClose();
    cancelScheduledOpen();
    openTimeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, tagsPopoverOpenDelay);
  }

  function handleMouseLeave() {
    cancelScheduledOpen();
    cancelScheduledClose();
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, tagsPopoverCloseDelay);
  }

  function handleMouseEnterAgain() {
    cancelScheduledClose();
  }

  function handleTriggerFocus() {
    cancelScheduledOpen();
    cancelScheduledClose();
    setIsOpen(true);
  }

  function handleTriggerMouseDown(event) {
    // Clicking an unfocused button fires a native focus event before click.
    // Without this, handleTriggerFocus's setIsOpen(true) and this same
    // click's toggle in handleTriggerClick cancel each other out.
    event.preventDefault();
  }

  function handleTriggerClick(event) {
    event.stopPropagation();
    cancelScheduledOpen();
    cancelScheduledClose();
    setIsOpen((current) => !current);
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "Tab" && !event.shiftKey && isOpen) {
      const firstButton = popoverRef.current?.querySelector("button");

      if (firstButton) {
        event.preventDefault();
        firstButton.focus();
      }
    }
  }

  function handlePopoverFocus() {
    cancelScheduledClose();
  }

  function handlePopoverKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === "Tab") {
      const buttons = Array.from(
        popoverRef.current?.querySelectorAll("button") ?? [],
      );
      const atLast =
        !event.shiftKey &&
        document.activeElement === buttons[buttons.length - 1];
      const atFirst = event.shiftKey && document.activeElement === buttons[0];

      if (atLast || atFirst) {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
  }

  const { visibleTags, hiddenTags } = tagPlan ?? {
    visibleTags: tags,
    hiddenTags: [],
  };

  return (
    <div className="tag-list tag-list-clip" ref={containerRef}>
      {!tags.length ? <span className="muted">-</span> : null}
      {visibleTags.map((tag) => (
        <button
          className={tableTagClass}
          key={tag.id || tag.name}
          onClick={(event) => {
            event.stopPropagation();
            onApplyFilter(tag.name, { replace: event.shiftKey });
          }}
          title={tag.name}
          type="button"
        >
          {tag.name}
        </button>
      ))}
      {hiddenTags.length ? (
        <span className="tag-more-wrap">
          <button
            aria-label={`${hiddenTags.length} more tags`}
            className={`${tableTagClass} table-tag--more`}
            onBlur={handleMouseLeave}
            onClick={handleTriggerClick}
            onFocus={handleTriggerFocus}
            onKeyDown={handleTriggerKeyDown}
            onMouseDown={handleTriggerMouseDown}
            onMouseEnter={handleTriggerMouseEnter}
            onMouseLeave={handleMouseLeave}
            ref={triggerRef}
            type="button"
          >
            +{hiddenTags.length}
          </button>
          {isOpen && popoverPosition
            ? createPortal(
                <div
                  className="tag-popover"
                  onBlur={handleMouseLeave}
                  onFocus={handlePopoverFocus}
                  onKeyDown={handlePopoverKeyDown}
                  onMouseEnter={handleMouseEnterAgain}
                  onMouseLeave={handleMouseLeave}
                  ref={popoverRef}
                  style={{
                    top: popoverPosition.top,
                    left: popoverPosition.left,
                  }}
                >
                  {hiddenTags.map((tag) => (
                    <button
                      className={tableTagClass}
                      key={tag.id || tag.name}
                      onClick={(event) => {
                        event.stopPropagation();
                        onApplyFilter(tag.name, { replace: event.shiftKey });
                        setIsOpen(false);
                      }}
                      title={tag.name}
                      type="button"
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>,
                document.body,
              )
            : null}
        </span>
      ) : null}
    </div>
  );
}
