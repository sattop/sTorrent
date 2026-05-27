import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, getDictionary } from "../src/i18n";

const baseKeys = Object.keys(getDictionary("en")).sort();

describe("i18n dictionaries", () => {
  it("keeps the same keys in every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(getDictionary(locale)).sort()).toEqual(baseKeys);
    }
  });

  it("does not contain empty translations", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const value of Object.values(getDictionary(locale))) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
