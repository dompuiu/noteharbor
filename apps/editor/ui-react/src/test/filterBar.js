import { screen, within } from "@testing-library/react";

export function filterFieldButton() {
  return screen.getByRole("button", { name: /^Filter field/ });
}

// Open the field menu and pick one of its options by its visible label.
export async function chooseFilterField(user, label) {
  await user.click(filterFieldButton());
  const menu = await screen.findByRole("menu", { name: "Filter field" });
  await user.click(within(menu).getByRole("menuitemradio", { name: label }));
}
