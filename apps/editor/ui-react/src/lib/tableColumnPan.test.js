import { afterEach, describe, expect, test } from "vitest";
import {
  COLUMN_PAN_THRESHOLD_PX,
  COLUMN_SCROLL_STEP,
  clampColumnScrollLeft,
  columnPanScrollLeft,
  isColumnPanTarget,
} from "./tableColumnPan.js";

const hosts = [];

function mount(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

afterEach(() => {
  while (hosts.length) {
    hosts.pop().remove();
  }
});

describe("isColumnPanTarget", () => {
  test("lets rows, sort buttons and links start a pan", () => {
    const host = mount(
      '<table><tbody><tr class="table-row-link"><td>note</td>' +
        '<td><button class="sort-button">sort</button></td>' +
        '<td><a href="#">link</a></td></tr></tbody></table>',
    );

    expect(isColumnPanTarget(host.querySelector("td"))).toBe(true);
    expect(isColumnPanTarget(host.querySelector(".sort-button"))).toBe(true);
    expect(isColumnPanTarget(host.querySelector("a"))).toBe(true);
  });

  test("keeps filter fields and the reorder handle out of the pan", () => {
    const host = mount(
      '<div><input class="filter-input" />' +
        "<textarea></textarea>" +
        '<button class="drag-handle" draggable="true"></button>' +
        '<span contenteditable="true"></span></div>',
    );

    expect(isColumnPanTarget(host.querySelector("input"))).toBe(false);
    expect(isColumnPanTarget(host.querySelector("textarea"))).toBe(false);
    expect(isColumnPanTarget(host.querySelector(".drag-handle"))).toBe(false);
    expect(isColumnPanTarget(host.querySelector("[contenteditable]"))).toBe(
      false,
    );
  });
});

describe("clampColumnScrollLeft", () => {
  test("pans within the scrollable range", () => {
    expect(clampColumnScrollLeft(100, 200, 1000)).toBe(300);
  });

  test("clamps at both ends", () => {
    expect(clampColumnScrollLeft(100, -500, 1000)).toBe(0);
    expect(clampColumnScrollLeft(900, 500, 1000)).toBe(1000);
  });

  test("treats a non-positive range as no movement", () => {
    expect(clampColumnScrollLeft(0, COLUMN_SCROLL_STEP, 0)).toBe(0);
    expect(clampColumnScrollLeft(0, -COLUMN_SCROLL_STEP, -20)).toBe(0);
  });
});

describe("columnPanScrollLeft", () => {
  test("dragging left advances the scroll offset", () => {
    expect(
      columnPanScrollLeft({
        startScrollLeft: 100,
        startX: 500,
        clientX: 400,
        max: 1000,
      }),
    ).toBe(200);
  });

  test("dragging right pulls the offset back and clamps at zero", () => {
    expect(
      columnPanScrollLeft({
        startScrollLeft: 100,
        startX: 500,
        clientX: 900,
        max: 1000,
      }),
    ).toBe(0);
  });

  test("never scrolls past the table's maximum", () => {
    expect(
      columnPanScrollLeft({
        startScrollLeft: 950,
        startX: 900,
        clientX: 0,
        max: 1000,
      }),
    ).toBe(1000);
  });
});

describe("table column pan constants", () => {
  test("match the Viewer's pan step and pointer slop", () => {
    expect(COLUMN_SCROLL_STEP).toBe(200);
    expect(COLUMN_PAN_THRESHOLD_PX).toBe(2);
  });
});
