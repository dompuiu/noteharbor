import { useEffect, useId, useRef } from "react";

// A small modal shell for the showcase's one-off forms (rename, catalog shell
// details). The Add dialog has its own richer shell; this one is the plain
// headed dialog both share the backdrop and Escape behaviour with.
function ShowcaseDialog({
  children,
  className = "",
  onClose,
  subtitle = "",
  title,
}) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusables = Array.from(
        panelRef.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (!focusables.length) {
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="showcase-manager-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={`showcase-manager showcase-dialog${className ? ` ${className}` : ""}`}
        onClick={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
      >
        <div className="showcase-manager-head">
          <h2 className="showcase-manager-title" id={titleId}>
            {title}
          </h2>
          {subtitle ? (
            <p className="showcase-manager-subtitle">{subtitle}</p>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export { ShowcaseDialog };
