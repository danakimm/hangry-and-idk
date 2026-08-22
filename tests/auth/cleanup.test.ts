import assert from "node:assert/strict";
import test from "node:test";
import { runCleanupCallbacks, createCleanupRegistry } from "../../features/auth/client/cleanup.ts";

test("runs all registered cleanup callbacks", () => {
  const calls: string[] = [];
  const callbacks = new Set<() => void>([
    () => calls.push("a"),
    () => calls.push("b"),
    () => calls.push("c"),
  ]);

  runCleanupCallbacks(callbacks);

  assert.deepStrictEqual(calls, ["a", "b", "c"]);
});

test("continues running remaining callbacks when one throws", () => {
  const calls: string[] = [];
  const callbacks = new Set<() => void>([
    () => calls.push("before"),
    () => {
      throw new Error("boom");
    },
    () => calls.push("after"),
  ]);

  runCleanupCallbacks(callbacks);

  assert.deepStrictEqual(calls, ["before", "after"]);
});

test("does nothing when callback set is empty", () => {
  const callbacks = new Set<() => void>();

  assert.doesNotThrow(() => runCleanupCallbacks(callbacks));
});

test("runs each callback exactly once", () => {
  let count = 0;
  const callbacks = new Set<() => void>([
    () => { count++; },
    () => { count++; },
  ]);

  runCleanupCallbacks(callbacks);

  assert.equal(count, 2);
});

test("registry runs all registered callbacks", () => {
  const calls: string[] = [];
  const registry = createCleanupRegistry();

  registry.register(() => calls.push("a"));
  registry.register(() => calls.push("b"));
  registry.runAll();

  assert.deepStrictEqual(calls, ["a", "b"]);
});

test("registry disposer removes callback before runAll", () => {
  const calls: string[] = [];
  const registry = createCleanupRegistry();

  registry.register(() => calls.push("a"));
  const dispose = registry.register(() => calls.push("b"));
  dispose();
  registry.runAll();

  assert.deepStrictEqual(calls, ["a"]);
});

test("registry disposer is idempotent", () => {
  const calls: string[] = [];
  const registry = createCleanupRegistry();

  const dispose = registry.register(() => calls.push("x"));
  dispose();
  dispose();
  registry.runAll();

  assert.deepStrictEqual(calls, []);
});

test("registry runAll continues when one callback throws", () => {
  const calls: string[] = [];
  const registry = createCleanupRegistry();

  registry.register(() => calls.push("before"));
  registry.register(() => {
    throw new Error("boom");
  });
  registry.register(() => calls.push("after"));
  registry.runAll();

  assert.deepStrictEqual(calls, ["before", "after"]);
});

test("registry runAll does nothing when all callbacks disposed", () => {
  const registry = createCleanupRegistry();

  const d1 = registry.register(() => {});
  const d2 = registry.register(() => {});
  d1();
  d2();

  assert.doesNotThrow(() => registry.runAll());
});
