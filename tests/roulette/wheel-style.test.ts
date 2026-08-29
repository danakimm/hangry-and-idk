import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildWheelBackgrounds } from "../../features/roulette/client/wheel-style.ts";

const colors = Array.from({ length: 10 }, (_, index) => `#00000${index}`);

describe("roulette wheel backgrounds", () => {
  const cases = [
    { menuCount: 2, sliceAngle: 180, sliceStartAngle: -90, dividerStartAngle: -90.5 },
    { menuCount: 6, sliceAngle: 60, sliceStartAngle: -30, dividerStartAngle: -30.5 },
    { menuCount: 8, sliceAngle: 45, sliceStartAngle: -22.5, dividerStartAngle: -23 },
    { menuCount: 10, sliceAngle: 36, sliceStartAngle: -18, dividerStartAngle: -18.5 },
  ];

  for (const {
    menuCount,
    sliceAngle,
    sliceStartAngle,
    dividerStartAngle,
  } of cases) {
    test(`aligns ${menuCount} dividers with ${menuCount} slice boundaries`, () => {
      const result = buildWheelBackgrounds(colors.slice(0, menuCount));

      assert.equal(result.sliceAngle, sliceAngle);
      assert.equal(result.sliceStartAngle, sliceStartAngle);
      assert.equal(result.dividerStartAngle, dividerStartAngle);
      assert.ok(
        result.wheelBackground.startsWith(`conic-gradient(from ${sliceStartAngle}deg,`),
      );
      assert.ok(
        result.dividerBackground.startsWith(
          `repeating-conic-gradient(from ${dividerStartAngle}deg,`,
        ),
      );
      assert.ok(
        result.dividerBackground.endsWith(`transparent 1deg ${sliceAngle}deg)`),
      );
    });
  }

  test("recalculates the divider interval when the menu count changes", () => {
    const eightMenus = buildWheelBackgrounds(colors.slice(0, 8));
    const sixMenus = buildWheelBackgrounds(colors.slice(0, 6));

    assert.equal(eightMenus.sliceAngle, 45);
    assert.equal(sixMenus.sliceAngle, 60);
    assert.notEqual(eightMenus.dividerBackground, sixMenus.dividerBackground);
  });

  test("returns safe backgrounds when there are no menus", () => {
    assert.deepEqual(buildWheelBackgrounds([]), {
      sliceAngle: 0,
      sliceStartAngle: 0,
      dividerStartAngle: 0,
      wheelBackground: "transparent",
      dividerBackground: "none",
    });
  });
});
