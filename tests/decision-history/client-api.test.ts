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
  test("lists bounded decisions and sends private GET headers", async () => {
    let captured: RequestInit | undefined;
    const api = createDecisionHistoryApiClient(async (_url, init) => {
      captured = init;
      return Response.json({ decisions: [success.decision] });
    });
    assert.equal((await api.listDecisions()).ok, true);
    assert.equal(captured?.method, "GET");
    assert.equal(captured?.cache, "no-store");
    assert.equal(
      new Headers(captured?.headers).get("Accept"),
      "application/json",
    );
  });

  test("rejects malformed decisions and lists over ten", async () => {
    for (const body of [
      { decisions: [{ ...success.decision, createdAt: 8_640_000_000_000_001 }] },
      { decisions: [{ ...success.decision, createdAt: 1.5 }] },
      {
        decisions: [
          {
            ...success.decision,
            candidates: [success.decision.selected],
          },
        ],
      },
      {
        decisions: [
          {
            ...success.decision,
            source: {
              type: "temporary",
              menuSetId: "set-1",
              menuSetName: null,
            },
          },
        ],
      },
      { decisions: Array.from({ length: 11 }, () => success.decision) },
    ]) {
      const result = await createDecisionHistoryApiClient(async () =>
        Response.json(body),
      ).listDecisions();
      assert.equal(!result.ok && result.failure, "parse");
    }
  });

  test("sends encoded individual and collection DELETE requests", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const api = createDecisionHistoryApiClient(async (path, init) => {
      requests.push({ path: String(path), init });
      return Response.json(
        String(path).endsWith("history") ? { deletedCount: 2 } : { ok: true },
      );
    });
    assert.equal((await api.deleteDecision("a/b ?")).ok, true);
    assert.equal((await api.deleteAllDecisions()).ok, true);
    assert.deepEqual(
      requests.map(({ path, init }) => [path, init?.method]),
      [
        ["/api/decision-history/a%2Fb%20%3F", "DELETE"],
        ["/api/decision-history", "DELETE"],
      ],
    );
  });

  test("rejects malformed individual and collection DELETE responses", async () => {
    const invalidOne = await createDecisionHistoryApiClient(async () =>
      Response.json({ ok: false }),
    ).deleteDecision("id");
    assert.equal(!invalidOne.ok && invalidOne.failure, "parse");

    for (const deletedCount of [-1, 1.5, "1"]) {
      const invalidAll = await createDecisionHistoryApiClient(async () =>
        Response.json({ deletedCount }),
      ).deleteAllDecisions();
      assert.equal(!invalidAll.ok && invalidAll.failure, "parse");
    }
  });

  test("list and delete methods preserve HTTP, network, and abort failures", async () => {
    const http = await createDecisionHistoryApiClient(async () =>
      Response.json(
        { error: { code: "RATE_LIMITED", message: "slow down" } },
        { status: 429 },
      ),
    ).listDecisions();
    const network = await createDecisionHistoryApiClient(async () => {
      throw new TypeError("offline");
    }).deleteAllDecisions();
    const controller = new AbortController();
    controller.abort();
    const abort = await createDecisionHistoryApiClient(async () => {
      throw new DOMException("abort", "AbortError");
    }).deleteDecision("id", controller.signal);

    assert.equal(!http.ok && http.failure, "http");
    assert.equal(!network.ok && network.failure, "network");
    assert.equal(!abort.ok && abort.failure, "aborted");
  });
});
