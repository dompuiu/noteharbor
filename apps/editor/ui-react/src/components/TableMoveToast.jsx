import { useEffect, useImperativeHandle, useRef, useState } from "react";

// The confirmation shown when a note is saved into another collection. It owns
// its message and the timer that clears it, so showing or dismissing it commits
// this component alone and never the table body behind it.
const moveToastDurationMs = 4000;

export function TableMoveToast({ toastRef }) {
  const [message, setMessage] = useState("");
  const timerRef = useRef(null);

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => clearTimer, []);

  useImperativeHandle(
    toastRef,
    () => ({
      show(nextMessage) {
        clearTimer();
        setMessage(nextMessage);
        timerRef.current = setTimeout(
          () => setMessage(""),
          moveToastDurationMs,
        );
      },
    }),
    [],
  );

  if (!message) {
    return null;
  }

  return (
    <div className="scrape-toast scrape-toast--success" role="status">
      {message}
    </div>
  );
}
