// The drill navigation above the grid. Every grouping ancestor in the
// breadcrumb is a real control that jumps to that level; the Showcase segment
// returns to the top level and the current node is plain text. Category
// segments are plain text too: categories always render expanded at the root
// and never have their own level, so there is nowhere to jump to
// (presentation spec §6).
//
// `onNavigate(targetIndex)` takes the breadcrumb index of the level to open,
// with `-1` meaning the Showcase root.
function ShowcaseBreadcrumb({ showcaseName, path, onNavigate }) {
  return (
    <nav aria-label="Showcase breadcrumb" className="showcase-breadcrumb">
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

        {path.map((node, index) => {
          const isCurrent = index === path.length - 1;
          const isCategory = node?.node_type === "category";

          // Categories never have their own level, so they are plain text even
          // as ancestors. Grouping ancestors stay links; the current node is
          // the page.
          if (isCurrent) {
            return (
              <li className="showcase-breadcrumb-item" key={node.id}>
                <span aria-hidden="true" className="showcase-breadcrumb-sep">
                  ›
                </span>
                <span
                  aria-current="page"
                  className="showcase-breadcrumb-current"
                >
                  {node.name}
                </span>
              </li>
            );
          }

          if (isCategory) {
            return (
              <li className="showcase-breadcrumb-item" key={node.id}>
                <span aria-hidden="true" className="showcase-breadcrumb-sep">
                  ›
                </span>
                <span className="showcase-breadcrumb-text">{node.name}</span>
              </li>
            );
          }

          return (
            <li className="showcase-breadcrumb-item" key={node.id}>
              <span aria-hidden="true" className="showcase-breadcrumb-sep">
                ›
              </span>
              <button
                className="showcase-breadcrumb-link"
                onClick={() => onNavigate(index)}
                type="button"
              >
                {node.name}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { ShowcaseBreadcrumb };
