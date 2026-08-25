import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  createMenuSetApiClient,
  isMenuSetListResponse,
  isMenuSetResponse,
} from "../../features/menu-sets/client/api.ts";

const validMenuSet = {
  id: "set-1",
  name: "회사 점심",
  version: 1,
  isDefault: true,
  createdAt: 1000,
  updatedAt: 1000,
  items: [
    { id: "item-1", name: "한식", emoji: "🍚", color: "#ef4938" },
    { id: "item-2", name: "일식", emoji: "🍣", color: "#2d7a57" },
  ],
};

describe("menu-set client API", () => {
  test("parses nested menu-set and list responses", () => {
    assert.equal(isMenuSetResponse(validMenuSet), true);
    assert.equal(isMenuSetListResponse({ menuSets: [validMenuSet] }), true);
    assert.equal(
      isMenuSetResponse({ ...validMenuSet, items: [{ id: "broken" }] }),
      false,
    );
    assert.equal(
      isMenuSetResponse({ ...validMenuSet, version: 1.5 }),
      false,
    );
  });

  test("returns a controlled parse failure for malformed success JSON", async () => {
    const api = createMenuSetApiClient(async () =>
      Response.json({ menuSets: [{ id: "broken" }] })
    );
    const result = await api.fetchMenuSets();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "parse");
  });

  test("returns a controlled parse failure for non-JSON responses", async () => {
    const api = createMenuSetApiClient(async () =>
      new Response("<html>bad gateway</html>", { status: 200 })
    );
    const result = await api.fetchMenuSets();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "parse");
  });

  test("maps network rejection without throwing", async () => {
    const api = createMenuSetApiClient(async () => {
      throw new TypeError("network down");
    });
    const result = await api.updateMenuSet("set-1", {
      version: 1,
      name: "draft",
      items: validMenuSet.items,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "network");
  });

  test("maps an aborted request separately", async () => {
    const controller = new AbortController();
    controller.abort();
    const api = createMenuSetApiClient(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const result = await api.fetchMenuSets(controller.signal);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "aborted");
  });

  test("default mutation sends a JSON object and encodes the id", async () => {
    let capturedInput = "";
    let capturedInit: RequestInit | undefined;
    const api = createMenuSetApiClient(async (input, init) => {
      capturedInput = String(input);
      capturedInit = init;
      return Response.json(validMenuSet);
    });
    const result = await api.setDefaultMenuSet("set/with space");
    assert.equal(result.ok, true);
    assert.equal(capturedInput, "/api/menu-sets/set%2Fwith%20space/default");
    assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.body, "{}");
    assert.equal(
      new Headers(capturedInit?.headers).get("Content-Type"),
      "application/json",
    );
  });
});
