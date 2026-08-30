import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createDecisionHistoryApiClient } from "../../features/decision-history/client/api.ts";

const input = {
  clientRequestId: "request-1",
  selected: { name: "라멘", emoji: "🍜", color: "#ef4938" },
  candidates: [
    { name: "라멘", emoji: "🍜", color: "#ef4938" },
    { name: "김밥", emoji: "🍙", color: "#2d7a57" },
  ],
  source: { type: "temporary" as const, menuSetId: null, menuSetName: null },
};
const success = {
  created: true,
  decision: {
    id: "decision-1",
    selected: input.selected,
    candidates: input.candidates,
    source: input.source,
    createdAt: 1000,
  },
};

describe("decision-history client API", () => {
  test("accepts 201 and idempotent 200 while sending the JSON POST contract", async () => {
    let captured: RequestInit | undefined;
    const api = createDecisionHistoryApiClient(async (_url, init) => {
      captured = init;
      return Response.json(success, { status: 201 });
    });
    assert.equal((await api.createDecision(input)).ok, true);
    const retry = createDecisionHistoryApiClient(async () =>
      Response.json({ ...success, created: false }),
    );
    assert.equal((await retry.createDecision(input)).ok, true);
    assert.equal(captured?.method, "POST");
    assert.equal(captured?.cache, "no-store");
    assert.equal(
      new Headers(captured?.headers).get("Content-Type"),
      "application/json",
    );
    assert.equal(captured?.body, JSON.stringify(input));
  });

  for (const [name, response] of [
    ["malformed", Response.json({ decision: { id: "", createdAt: 1 } })],
    ["non-json", new Response("bad", { status: 200 })],
  ] as const) {
    test(`returns parse failure for ${name} success`, async () => {
      const result = await createDecisionHistoryApiClient(
        async () => response,
      ).createDecision(input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure, "parse");
    });
  }
  for (const [name, body] of [
    [
      "empty decision ID",
      { ...success, decision: { ...success.decision, id: "" } },
    ],
    [
      "fractional timestamp",
      { ...success, decision: { ...success.decision, createdAt: 1.5 } },
    ],
    [
      "negative timestamp",
      { ...success, decision: { ...success.decision, createdAt: -1 } },
    ],
    [
      "too few candidates",
      {
        ...success,
        decision: { ...success.decision, candidates: [input.selected] },
      },
    ],
    [
      "broken candidate",
      {
        ...success,
        decision: {
          ...success.decision,
          candidates: [{ name: "x", emoji: "🍜" }, input.selected],
        },
      },
    ],
    [
      "invalid temporary source",
      {
        ...success,
        decision: {
          ...success.decision,
          source: { type: "temporary", menuSetId: "set", menuSetName: null },
        },
      },
    ],
    [
      "empty menu-set source",
      {
        ...success,
        decision: {
          ...success.decision,
          source: { type: "menu-set", menuSetId: "", menuSetName: "" },
        },
      },
    ],
  ] as const) {
    test(`rejects ${name} in an otherwise valid 2xx response`, async () => {
      const result = await createDecisionHistoryApiClient(async () =>
        Response.json(body),
      ).createDecision(input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure, "parse");
    });
  }
  test("separates HTTP, network, and abort failures", async () => {
    const http = await createDecisionHistoryApiClient(async () =>
      Response.json(
        { error: { code: "UNAUTHORIZED", message: "no" } },
        { status: 401 },
      ),
    ).createDecision(input);
    const network = await createDecisionHistoryApiClient(async () => {
      throw new TypeError("offline");
    }).createDecision(input);
    const controller = new AbortController();
    controller.abort();
    const abort = await createDecisionHistoryApiClient(async () => {
      throw new DOMException("abort", "AbortError");
    }).createDecision(input, controller.signal);
    assert.equal(!http.ok && http.failure, "http");
    assert.equal(!network.ok && network.failure, "network");
    assert.equal(!abort.ok && abort.failure, "aborted");
  });
});
