// The glyphs stay in one place so every menu item's icon shares the same
// 24-unit box, stroke weight and cap style. Items name one through `name`.
const MENU_ICONS = {
  open: (
    <>
      <path
        d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        fill="none"
        r="3"
        stroke="currentColor"
        strokeWidth="2"
      />
    </>
  ),
  edit: (
    <>
      <path
        d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M13.5 6.5l3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </>
  ),
  copy: (
    <>
      <rect
        fill="none"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        width="11"
        x="9"
        y="9"
      />
      <path
        d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  insert: (
    <>
      <path
        d="M12 4v10M7 9h10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M5 19h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </>
  ),
  source: (
    <>
      <path
        d="M14 4h6v6M20 4l-9 9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  move: (
    <>
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M12 16v-5m0 0-2.5 2.5M12 11l2.5 2.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  "arrow-up": (
    <path
      d="M12 19V5m0 0-6 6m6-6 6 6"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  ),
  "arrow-down": (
    <path
      d="M12 5v14m0 0-6-6m6 6 6-6"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  ),
  delete: (
    <>
      <path
        d="M5 7h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M9 7V5h6v2"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M8 7l1 12h6l1-12"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  "note-add": (
    <>
      <path
        d="M6 3h8l4 4v6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M14 3v4h4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M18 14v6m-3-3h6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </>
  ),
  "group-add": (
    <>
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M3 7v10a2 2 0 0 0 2 2h7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M18 14v6m-3-3h6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </>
  ),
  "shell-add": (
    <>
      <rect
        fill="none"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="2"
        width="8"
        x="3"
        y="3"
      />
      <rect
        fill="none"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="2"
        width="8"
        x="3"
        y="13"
      />
      <path
        d="M17 14v6m-3-3h6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </>
  ),
  replace: (
    <>
      <path
        d="M4 8h13m0 0-3-3m3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M20 16H7m0 0 3-3m-3 3 3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  details: (
    <>
      <path
        d="M4 7h9M17 7h3M4 17h3M11 17h9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle
        cx="15"
        cy="7"
        fill="none"
        r="2.5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="9"
        cy="17"
        fill="none"
        r="2.5"
        stroke="currentColor"
        strokeWidth="2"
      />
    </>
  ),
  cover: (
    <>
      <rect
        fill="none"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        width="18"
        x="3"
        y="4"
      />
      <path
        d="m4 17 5-5 3 3 3-3 5 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle cx="9" cy="9" fill="currentColor" r="1.6" />
    </>
  ),
  "clear-cover": (
    <>
      <path
        d="m4 16 4-4 2.5 2.5M14 13l2-2 4 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M4 6h16M6 6l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 3h4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  "check-circle": (
    <>
      <circle
        cx="12"
        cy="12"
        fill="none"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="m8 12 2.5 2.5L16 9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  circle: (
    <circle
      cx="12"
      cy="12"
      fill="none"
      r="9"
      stroke="currentColor"
      strokeWidth="2"
    />
  ),
};

function MenuIcon({ className = "row-actions-menu-icon", name }) {
  const glyph = MENU_ICONS[name];

  if (!glyph) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      {glyph}
    </svg>
  );
}

export { MenuIcon };
