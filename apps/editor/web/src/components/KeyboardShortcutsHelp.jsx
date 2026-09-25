import { useEffect } from "react";

const shortcutGroups = [
  {
    title: "Table",
    items: [
      { keys: ["/"], description: "Focus the last-used filter field" },
      {
        keys: ["↑", "↓"],
        description: "Move focus between rows (↑ from the first row → filter field)",
      },
      {
        keys: ["j", "k"],
        description: "Move focus between rows (alternative; k from the first row → filter field)",
      },
      { keys: ["PgUp", "PgDn"], description: "Scroll one page and focus the first row in view" },
      { keys: ["Home", "End"], description: "Focus the first / last row" },
      {
        keys: ["←", "→"],
        description: "Pan the columns to reveal ones hidden by a narrow window",
      },
      {
        keys: ["Ctrl/Cmd", "←", "→"],
        description: "Jump to the first / last column",
      },
      { keys: ["Enter", "Space"], description: "Open the focused note" },
      { keys: ["e"], description: "Edit the focused note" },
      { keys: ["d"], description: "Delete the focused note" },
      { keys: ["c"], description: "Copy the focused note's details" },
      { keys: ["a"], description: "Add a new note before the focused note" },
      { keys: ["↓"], description: "Jump from a filter field to the first row" },
      { keys: ["Esc"], description: "Filters → first row → deselect → clear filters" },
    ],
  },
  {
    title: "Slideshow",
    items: [
      { keys: ["←", "→"], description: "Go to the previous / next note" },
      { keys: ["Enter", "↓"], description: "Open the image preview" },
      { keys: ["Esc"], description: "Close the slideshow" },
    ],
  },
  {
    title: "Image preview",
    items: [
      { keys: ["←", "→"], description: "Go to the previous / next image" },
      { keys: ["Esc"], description: "Back to the slideshow" },
    ],
  },
  {
    title: "Everywhere",
    items: [{ keys: ["?"], description: "Toggle this help" }],
  },
];

function KeyboardShortcutsHelp({ onClose }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="shortcuts-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-label="Keyboard shortcuts"
        aria-modal="true"
        className="shortcuts-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="shortcuts-panel-header">
          <p className="eyebrow">Keyboard shortcuts</p>
          <button
            aria-label="Close keyboard shortcuts"
            className="icon-link"
            data-shortcut="Esc"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="shortcuts-groups">
          {shortcutGroups.map((group) => (
            <div className="shortcuts-group" key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.description}>
                    <span className="shortcuts-keys">
                      {item.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                    <span>{item.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { KeyboardShortcutsHelp };
