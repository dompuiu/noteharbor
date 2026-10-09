// The drill navigation above the grid. The Up button and every ancestor in the
// breadcrumb are real controls that jump to that level; the Showcase segment
// returns to the top level and the current node is plain text. One level is
// shown at a time, so this is the only way back (presentation spec §6).
//
// `onNavigate(targetIndex)` takes the breadcrumb index of the level to open,
// with `-1` meaning the Showcase root. Up is the level just above the current.
function ShowcaseBreadcrumb({ showcaseName, path, onNavigate }) {
  return (
    <nav aria-label="Showcase breadcrumb" className="showcase-breadcrumb">
      <button
        className="button showcase-breadcrumb-up"
        onClick={() => onNavigate(path.length - 2)}
        type="button"
      >
        Up
      </button>

      <ol className="showcase-breadcrumb-list">
        <li className="showcase-breadcrumb-item">
          <button
            className="showcase-breadcrumb-link"
            onClick={() => onNavigate(-1)}
            type="button"
          >
            {showcaseName}
          </button>
        </li>

        {path.map((node, index) => (
          <li className="showcase-breadcrumb-item" key={node.id}>
            <span aria-hidden="true" className="showcase-breadcrumb-sep">
              ›
            </span>
            {index === path.length - 1 ? (
              <span
                aria-current="page"
                className="showcase-breadcrumb-current"
              >
                {node.name}
              </span>
            ) : (
              <button
                className="showcase-breadcrumb-link"
                onClick={() => onNavigate(index)}
                type="button"
              >
                {node.name}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export { ShowcaseBreadcrumb };
