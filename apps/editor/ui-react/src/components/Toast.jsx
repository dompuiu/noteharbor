import {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// A transient message lives for four seconds, then clears itself. The host
// owns both the message and the timer, so showing or dismissing a toast
// commits the toast alone and never the screen behind it.
export const TOAST_DURATION_MS = 4000;

// One shape for every transient confirmation and failure: a floating card in
// the bottom-right corner, ruled by its tone's semantic edge. Success and
// information stay polite; a failure is assertive so it is announced at once.
// It portals to the body so no panel's overflow or stacking context can clip
// it, whichever screen raised the message.
export function Toast({ tone = "success", children }) {
  return createPortal(
    <div
      className={`toast toast--${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span aria-hidden="true" className="toast-mark" />
      <span className="toast-message">{children}</span>
    </div>,
    document.body,
  );
}

export function ToastHost({ toastRef }) {
  const [toast, setToast] = useState(null);
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
      show(message, tone = "success") {
        clearTimer();
        setToast({ message, tone });
        timerRef.current = setTimeout(
          () => setToast(null),
          TOAST_DURATION_MS,
        );
      },
    }),
    [],
  );

  if (!toast) {
    return null;
  }

  return <Toast tone={toast.tone}>{toast.message}</Toast>;
}

const ToastContext = createContext(null);

// The shell owns the one host every screen and chrome surface raises its
// messages through. The host sits beside `children` and holds its own state,
// so showing or dismissing a toast never commits the page behind it.
export function ToastProvider({ children }) {
  const toastRef = useRef(null);

  return (
    <ToastContext.Provider value={toastRef}>
      {children}
      <ToastHost toastRef={toastRef} />
    </ToastContext.Provider>
  );
}

// The shell's host, or null when the calling surface renders on its own (a
// test or an isolated preview). A surface uses this host when there is one,
// and mounts its own otherwise, so the app never renders two at once.
export function useToastHost() {
  return useContext(ToastContext);
}
