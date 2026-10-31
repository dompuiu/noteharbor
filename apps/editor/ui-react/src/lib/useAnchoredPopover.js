import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

// Gap between the anchor button and the floating menu, and the margin the
// menu keeps from the viewport edges when it flips or slides into view.
const menuOffset = 6;
const viewportMargin = 12;

// Shared open state, positioning and dismissal for a button-anchored popover
// that is portalled into <body>. `align` chooses which button edge the menu
// lines up with; `closeOnRouteChange` closes it when navigation would leave it
// floating over a new screen.
export function useAnchoredPopover({
  align = "start",
  closeOnRouteChange = false,
} = {}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const location = useLocation();
  const locationKey = `${location.pathname}${location.search}${location.hash}`;

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

    function closeOnMove() {
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

  return { buttonRef, menuRef, open, position, setOpen };
}
