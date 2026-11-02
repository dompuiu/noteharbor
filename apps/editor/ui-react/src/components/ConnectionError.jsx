import { useEffect, useRef } from "react";

// The shell-level failure state shown in place of the page whenever the editor
// server or its database can't be reached. Kept in one component so every
// route reports the same problem the same way, with the sidebar still around
// to navigate with.
const COPY = {
  server: {
    label: "Connection",
    heading: "Can't reach the editor server.",
    body: "Start the editor server, then try again.",
  },
  database: {
    label: "Database",
    heading: "Can't reach the database.",
    body: "The editor server is running, but its database isn't responding.",
  },
  generic: {
    label: "Connection",
    heading: "Can't check the connection.",
    body: "The editor server answered unexpectedly.",
  },
};

// The reassurance sits under a rule so the screen answers the question a
// local-first catalog has to answer at a failure: are my notes still here?
const REASSURANCE = "Your notes stay on this device and aren't affected.";

function ConnectionError({ checking = false, onRetry, reason }) {
  const headingRef = useRef(null);
  const { label, heading, body } = COPY[reason] ?? COPY.generic;

  // The message replaces the page, so move focus to it; otherwise a keyboard
  // or screen-reader user is left on an element that no longer exists.
  useEffect(() => {
    headingRef.current?.focus();
  }, [reason]);

  return (
    <section className="screen-stack narrow-stack connection-error">
      <div className="panel">
        <p className="connection-error-label">
          <span aria-hidden="true" className="connection-error-dot" />
          {label}
        </p>
        {/* The live region wraps the message only, so the Retry control is not
            inside an assertive alert. */}
        <div className="connection-error-message" role="alert">
          <h1 ref={headingRef} tabIndex={-1}>
            {heading}
          </h1>
          <p className="muted">{body}</p>
        </div>
        <p className="connection-error-reassurance">{REASSURANCE}</p>
        <div className="connection-error-actions">
          <button
            className="button button-primary"
            disabled={checking}
            onClick={onRetry}
            type="button"
          >
            {checking ? "Checking…" : "Try again"}
          </button>
          <span className="connection-error-progress" role="status">
            {checking ? "Checking the connection…" : ""}
          </span>
        </div>
      </div>
    </section>
  );
}

export { ConnectionError };
