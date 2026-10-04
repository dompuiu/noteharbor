import { useEffect, useRef } from "react";

// The shell-level failure state shown in place of the page whenever the editor
// server or its database can't be reached. Kept in one component so every
// route reports the same problem the same way, with the sidebar still around
// to navigate with.
const COPY = {
  server: {
    heading: "Can't reach the editor server.",
    body: "Start the editor server, then try again.",
  },
  database: {
    heading: "Can't reach the database.",
    body:
      "The editor server is running, but its database isn't responding. " +
      "Try again.",
  },
  generic: {
    heading: "Can't check the connection.",
    body: "The editor server responded unexpectedly. Try again.",
  },
};

function ConnectionError({ checking = false, onRetry, reason }) {
  const headingRef = useRef(null);
  const { heading, body } = COPY[reason] ?? COPY.generic;

  // The message replaces the page, so move focus to it; otherwise a keyboard
  // or screen-reader user is left on an element that no longer exists.
  useEffect(() => {
    headingRef.current?.focus();
  }, [reason]);

  return (
    <section className="screen-stack narrow-stack connection-error" role="alert">
      <div className="panel">
        <h1 ref={headingRef} tabIndex={-1}>
          {heading}
        </h1>
        <p className="muted">{body}</p>
        <div className="inline-actions">
          <button
            className="button button-primary"
            disabled={checking}
            onClick={onRetry}
            type="button"
          >
            {checking ? "Checking..." : "Try again"}
          </button>
        </div>
      </div>
    </section>
  );
}

export { ConnectionError };
