import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createCategory,
  createShowcaseNode,
  deleteNode,
  getCategories,
  getShowcaseTree,
  renameCategory,
  reorderNodes,
  updateNode,
} from "./api.js";

function stubFetch(implementation) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("category API calls", () => {
  test("getCategories reads the label pool", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { categories: [] }));

    await expect(getCategories()).resolves.toEqual({ categories: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/categories");
  });

  test("createCategory posts the name", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(201, { category: { id: 1, name: "Themes" } }),
    );

    await createCategory("Themes");

    expect(fetchMock).toHaveBeenCalledWith("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Themes" }),
    });
  });

  test("renameCategory puts the new name", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { category: { id: 2, name: "Renamed" } }),
    );

    await renameCategory(2, "Renamed");

    expect(fetchMock).toHaveBeenCalledWith("/api/categories/2", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
  });
});

describe("showcase tree API calls", () => {
  test("getShowcaseTree reads one showcase's tree", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { showcase_id: 3, nodes: [] }),
    );

    await expect(getShowcaseTree(3)).resolves.toEqual({
      showcase_id: 3,
      nodes: [],
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/showcases/3/tree");
  });

  test("createShowcaseNode posts the node descriptor", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(201, { node: { id: 5 } }),
    );

    await createShowcaseNode(3, { type: "category", category_id: 1 });

    expect(fetchMock).toHaveBeenCalledWith("/api/showcases/3/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "category", category_id: 1 }),
    });
  });

  test("updateNode puts the rename", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { node: { id: 5 } }));

    await updateNode(5, { name: "New" });

    expect(fetchMock).toHaveBeenCalledWith("/api/nodes/5", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
  });

  test("deleteNode deletes the placement", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { success: true }));

    await expect(deleteNode(5)).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/nodes/5", { method: "DELETE" });
  });

  test("reorderNodes PUTs the parent and the full child order", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { nodes: [] }),
    );

    await reorderNodes(3, 7, [5, 9, 4]);

    expect(fetchMock).toHaveBeenCalledWith("/api/nodes/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        showcase_id: 3,
        parent_node_id: 7,
        node_ids: [5, 9, 4],
      }),
    });
  });

  test("reorderNodes sends a null parent for the top level", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { nodes: [] }),
    );

    await reorderNodes(3, null, [5, 4]);

    expect(fetchMock).toHaveBeenCalledWith("/api/nodes/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        showcase_id: 3,
        parent_node_id: null,
        node_ids: [5, 4],
      }),
    });
  });
});
