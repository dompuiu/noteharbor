import { ShowcaseGhostAdd } from "./ShowcaseGhostAdd.jsx";

// The one add card at the end of a level. It opens the merged add dialog
// (notes, catalog shells, or a grouping) and names the three modes up front so
// the card reads as an action rather than an empty placeholder.
function ShowcaseAddCard({ onAdd }) {
  return (
    <ShowcaseGhostAdd
      ariaLabel="Add to this level"
      hint="Note · Placeholder · Grouping"
      label="Add to this level"
      onClick={onAdd}
    />
  );
}

export { ShowcaseAddCard };
