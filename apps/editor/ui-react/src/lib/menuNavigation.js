// Roving focus for a menu panel: Arrow Down/Up move through the items and
// wrap at the ends, Home/End jump to the first and last. The menu is
// portalled, so the key would otherwise bubble through the component tree
// into the table's roving-cursor shortcuts; claiming it here keeps menu
// navigation self-contained.
//
// `itemSelector` is the menu's item role (`menuitem`, `menuitemradio`), so
// every menu caller shares one implementation of the traversal.
export function handleMenuNavigation(event, panel, itemSelector) {
  const items = Array.from(panel?.querySelectorAll(itemSelector) ?? []);

  if (!items.length) {
    return;
  }

  const currentIndex = items.indexOf(document.activeElement);
  let target;

  switch (event.key) {
    case "ArrowDown":
      target = currentIndex + 1;
      break;
    case "ArrowUp":
      target = currentIndex - 1;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = items.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  event.stopPropagation();
  items[(target + items.length) % items.length].focus();
}
