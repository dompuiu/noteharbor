import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

// Gap between the anchor button and the floating menu, and the margin the
// menu keeps from the viewport edges when it flips or slides into view.
const menuOffset = 6;
const viewportMargin = 12;

// Scrolls an off-screen anchor into view and returns the scroll targets that
// actually moved. Their scroll events arrive after this call, so while the
// menu opens they record the reveal rather than the collector panning away
// from it.
function moveAnchorIntoView(anchor) {
  const targets = new Set();

  if (!anchor?.scrollIntoView) {
    return targets;
  }

  const ancestors = [];
  for (let node = anchor.parentElement; node; node = node.parentElement) {
    ancestors.push(node);
  }

  const before = ancestors.map((node) => [node.scrollLeft, node.scrollTop]);
  anchor.scrollIntoView({ block: "nearest", inline: "nearest" });

  ancestors.forEach((node, index) => {
    if (
      node.scrollLeft !== before[index][0] ||
      node.scrollTop !== before[index][1]
    ) {
      targets.add(node);

      // A document scroll dispatches its event with the document as target,
      // not its scrolling element.
      if (node === document.scrollingElement) {
        targets.add(document);
      }
    }
  });

  return targets;
}

// Shared open state, positioning and dismissal for a button-anchored popover
// that is portalled into <body>. `align` chooses which button edge the menu
// lines up with; `closeOnRouteChange` closes it when navigation would leave it
// floating over a new screen; `revealOnOpen` scrolls the anchor into view
// first, for anchors that can sit outside the viewport when it opens.
export function useAnchoredPopover({
  align = "start",
  closeOnRouteChange = false,
  revealOnOpen = false,
} = {}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const revealScrollTargetsRef = useRef(new Set());
  const location = useLocation();
  const locationKey = `${location.pathname}${location.search}${location.hash}`;

  // Every open path goes through here so the anchor is in view before the
  // menu measures and positions itself against it.
  const openPopover = useCallback(() => {
    revealScrollTargetsRef.current = revealOnOpen
      ? moveAnchorIntoView(buttonRef.current)
      : new Set();
    setOpen(true);
  }, [revealOnOpen]);

  useEffect(() => {
    if (closeOnRouteChange) {
      setOpen(false);
    }
  }, [closeOnRouteChange, locationKey]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    function closeOnOutsidePress(event) {
      if (menuRef.current?.contains(event.target)) {
        return;
      }

      if (buttonRef.current?.contains(event.target)) {
        return;
      }

      setOpen(false);
    }

    function closeOnMove(event) {
      // The reveal that opened this menu moved these targets; ignore their
      // scroll events so the menu is not dismissed the moment it appears.
      // Each target is dropped on its first event, so a later scroll by the
      // collector still closes the menu.
      if (revealScrollTargetsRef.current.has(event.target)) {
        revealScrollTargetsRef.current.delete(event.target);
        return;
      }

      setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsidePress);
    document.addEventListener("touchstart", closeOnOutsidePress);
    window.addEventListener("scroll", closeOnMove, true);
    window.addEventListener("resize", closeOnMove);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      document.removeEventListener("touchstart", closeOnOutsidePress);
      window.removeEventListener("scroll", closeOnMove, true);
      window.removeEventListener("resize", closeOnMove);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const button = buttonRef.current;
    const menu = menuRef.current;

    if (!button || !menu) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let top = buttonRect.bottom + menuOffset;

    if (top + menuRect.height > window.innerHeight - viewportMargin) {
      top = Math.max(
        viewportMargin,
        buttonRect.top - menuRect.height - menuOffset,
      );
    }

    const desiredLeft =
      align === "end" ? buttonRect.right - menuRect.width : buttonRect.left;
    const left = Math.min(
      Math.max(viewportMargin, desiredLeft),
      Math.max(
        viewportMargin,
        window.innerWidth - menuRect.width - viewportMargin,
      ),
    );

    setPosition({ left, top });
  }, [align, open]);

  return { buttonRef, menuRef, open, openPopover, position, setOpen };
}
