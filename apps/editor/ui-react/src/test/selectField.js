import { screen, within } from "@testing-library/react";

// Open the Editor's select combobox and return its portalled option list.
export async function openSelect(user, label) {
  await user.click(screen.getByRole("combobox", { name: label }));
  return screen.findByRole("listbox", { name: `${label} options` });
}

// Pick one of a select's listed options by its visible label. The combobox
// never accepts a typed value that is not in this list.
export async function chooseSelectOption(user, label, optionLabel) {
  const listbox = await openSelect(user, label);
  await user.click(within(listbox).getByRole("option", { name: optionLabel }));
}
