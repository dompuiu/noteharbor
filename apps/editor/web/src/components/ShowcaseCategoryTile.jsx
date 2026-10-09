import { ShowcaseCreateTile } from "./ShowcaseCreateTile.jsx";

// The edit-only `+ create a category` tile. The field lists the label pool as
// combobox suggestions and a typed name creates a new label; `onAdd(name)` does
// the get-or-create then places the label.
function ShowcaseCategoryTile({ categories, onAdd }) {
  return (
    <ShowcaseCreateTile
      addLabel="Add category"
      combobox
      inputLabel="Category name"
      noun="category"
      onAdd={onAdd}
      suggestions={categories}
    />
  );
}

export { ShowcaseCategoryTile };
