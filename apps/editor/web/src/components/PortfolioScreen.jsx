// The Portfolio placeholder pages. Categories and Groupings have no data model
// yet, so both render the same "coming soon" empty state under the standard
// panel layout. They exist so every sidebar destination resolves.
function PortfolioScreen({ description, title }) {
  return (
    <section className="screen-stack narrow-stack portfolio-screen">
      <div className="panel">
        <div className="panel-heading">
          <div className="panel-heading-copy">
            <p className="eyebrow">Portfolio</p>
            <h1>{title}</h1>
          </div>
        </div>

        <div className="portfolio-stub">
          <h2>{title} are coming soon</h2>
          <p className="muted">{description}</p>
        </div>
      </div>
    </section>
  );
}

export { PortfolioScreen };
