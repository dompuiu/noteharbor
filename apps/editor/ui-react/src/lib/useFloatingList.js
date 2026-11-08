import { useEffect, useState } from "react";
import { floatingListLayout } from "./floatingList.js";

// Keeps a portalled option list attached to its field. `contentHeight` is the
// list's natural height, so a menu that would run off the bottom flips above
// the field instead of being cropped by the viewport.
export function useFloatingList(isOpen, anchorRef, contentHeight) {
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return undefined;
    }
    const update = () => {
      const element = anchorRef.current;
      if (!element) {
        return;
      }
      setPosition(floatingListLayout(element, contentHeight));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef, contentHeight, isOpen]);

  return position;
}
