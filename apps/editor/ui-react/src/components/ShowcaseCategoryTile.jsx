import { ShowcaseGhostAdd } from "./ShowcaseGhostAdd.jsx";

// The `+ New category` control. It opens the shared name dialog, which offers
// the label pool as suggestions and creates a new label from a typed name.
// `centered` constrains the control inside the empty-state dashed box.
function ShowcaseCategoryTile({ centered = false, onOpen }) {
  return (
    <ShowcaseGhostAdd
      ariaLabel="New category"
      hint="Reuse a category from the pool or type a new name"
      label="New category"
      onClick={onOpen}
      variant={centered ? "centered" : "bar"}
    />
  );
}

export { ShowcaseCategoryTile };
