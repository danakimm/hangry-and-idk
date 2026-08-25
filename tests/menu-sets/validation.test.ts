import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  normalizeName,
  validateMenuSetName,
  validateMenuItemName,
  validateItems,
  validateColor,
  validateEmoji,
  validateVersion,
} from "../../features/menu-sets/server/validation.server.ts";

describe("menu set validation", () => {
  test("normalizeName applies Unicode NFC normalization", () => {
    const decomposed = "\u1100\u1161";
    const composed = "\uAC00";
    assert.equal(normalizeName(decomposed), composed);
  });

  test("normalizeName trims and collapses spaces", () => {
    assert.equal(normalizeName("  hello   world  "), "hello world");
    assert.equal(normalizeName("test"), "test");
    assert.equal(normalizeName(""), "");
  });

  test("validateMenuSetName accepts valid names", () => {
    assert.equal(validateMenuSetName("회사 점심"), null);
    assert.equal(validateMenuSetName("a"), null);
    assert.equal(validateMenuSetName("a".repeat(30)), null);
  });

  test("validateMenuSetName rejects empty name", () => {
    const result = validateMenuSetName("");
    assert.notEqual(result, null);
    assert.match(result!.message, /입력/);
  });

  test("validateMenuSetName rejects too long name", () => {
    const result = validateMenuSetName("a".repeat(31));
    assert.notEqual(result, null);
    assert.match(result!.message, /30자/);
  });

  test("validateMenuItemName accepts valid names", () => {
    assert.equal(validateMenuItemName("한식"), null);
    assert.equal(validateMenuItemName("a"), null);
    assert.equal(validateMenuItemName("a".repeat(12)), null);
  });

  test("validateMenuItemName rejects empty name", () => {
    const result = validateMenuItemName("");
    assert.notEqual(result, null);
  });

  test("validateMenuItemName rejects too long name", () => {
    const result = validateMenuItemName("a".repeat(13));
    assert.notEqual(result, null);
    assert.match(result!.message, /12자/);
  });

  test("validateItems accepts 2-10 items", () => {
    const items = [
      { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
      { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
    ];
    assert.equal(validateItems(items), null);
  });

  test("validateItems rejects fewer than 2 items", () => {
    const items = [{ id: null, name: "한식", emoji: "🍚", color: "#ef4938" }];
    const result = validateItems(items);
    assert.notEqual(result, null);
    assert.match(result!.message, /최소/);
  });

  test("validateItems rejects more than 10 items", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      id: null,
      name: `메뉴${i}`,
      emoji: "🍽️",
      color: "#ef4938",
    }));
    const result = validateItems(items);
    assert.notEqual(result, null);
    assert.match(result!.message, /최대/);
  });

  test("validateItems rejects duplicate normalized names", () => {
    const items = [
      { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
      { id: null, name: "한식 ", emoji: "🥟", color: "#f6c84a" },
    ];
    const result = validateItems(items);
    assert.notEqual(result, null);
    assert.match(result!.message, /중복/);
  });

  test("validateColor accepts valid hex colors", () => {
    assert.equal(validateColor("#ef4938"), true);
    assert.equal(validateColor("#000000"), true);
    assert.equal(validateColor("#ffffff"), true);
  });

  test("validateColor rejects invalid colors", () => {
    assert.equal(validateColor("ef4938"), false);
    assert.equal(validateColor("#gg0000"), false);
    assert.equal(validateColor("#12345"), false);
    assert.equal(validateColor("#1234567"), false);
  });

  test("validateEmoji accepts valid emoji presentations", () => {
    assert.equal(validateEmoji("🍚"), true);
    assert.equal(validateEmoji("🍽️"), true);
    assert.equal(validateEmoji("🍣"), true);
  });

  test("validateEmoji rejects plain text", () => {
    assert.equal(validateEmoji("abc"), false);
    assert.equal(validateEmoji("한"), false);
  });

  test("validateEmoji rejects empty string", () => {
    assert.equal(validateEmoji(""), false);
  });

  test("validateVersion accepts positive safe integers", () => {
    assert.equal(validateVersion(1), true);
    assert.equal(validateVersion(100), true);
  });

  test("validateVersion rejects non-numbers", () => {
    assert.equal(validateVersion("1"), false);
    assert.equal(validateVersion(null), false);
    assert.equal(validateVersion(undefined), false);
  });

  test("validateVersion rejects non-positive or infinite", () => {
    assert.equal(validateVersion(0), false);
    assert.equal(validateVersion(-1), false);
    assert.equal(validateVersion(Infinity), false);
    assert.equal(validateVersion(NaN), false);
  });

  test("validateVersion rejects fractional and unsafe integers", () => {
    assert.equal(validateVersion(1.5), false);
    assert.equal(validateVersion(Number.MAX_SAFE_INTEGER + 1), false);
  });
});
