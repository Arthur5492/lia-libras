import { describe, expect, test } from "vitest";
import { shownName } from "../../src/recognize/model";

describe("shownName", () => {
  test("a sign with a short text shows the short text", () => {
    expect(shownName({ slug: "h", name: "Letra H", short: "H" })).toBe("H");
  });

  test("a sign without a short text shows its name", () => {
    expect(shownName({ slug: "oi", name: "Oi" })).toBe("Oi");
  });
});
