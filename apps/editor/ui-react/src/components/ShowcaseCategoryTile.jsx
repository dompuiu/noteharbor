import { ShowcaseCreateTile } from "./ShowcaseCreateTile.jsx";

// The `+ New category` control. The field lists the label pool as combobox
// suggestions and a typed name creates a new label; `onAdd(name)` does the
// get-or-create then places the label. `centered` constrains the control (and
// its open form) inside the empty-state dashed box.
function ShowcaseCategoryTile({ categories, onAdd, centered = false }) {
  return (
    <ShowcaseCreateTile
      addLabel="Add category"
      centered={centered}
      combobox
      hint="Reuse a category from the pool or type a new name"
      inputLabel="Category name"
      noun="category"
      onAdd={onAdd}
      suggestions={categories}
    />
  );
}

export { ShowcaseCategoryTile };
