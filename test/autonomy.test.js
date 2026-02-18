import { describe, test, expect } from "bun:test";
import {
  AUTONOMY_LEVELS,
  DEFAULT_AUTONOMY,
  validateAutonomy,
} from "../src/config.js";

describe("autonomy levels", () => {
  test("DEFAULT_AUTONOMY is draft_pr", () => {
    expect(DEFAULT_AUTONOMY).toBe("draft_pr");
  });

  test("AUTONOMY_LEVELS contains all four levels", () => {
    expect(AUTONOMY_LEVELS).toEqual([
      "ingest_only",
      "execute_local",
      "draft_pr",
      "full",
    ]);
  });

  describe("validateAutonomy", () => {
    test.each(["ingest_only", "execute_local", "draft_pr", "full"])(
      "accepts valid level: %s",
      (level) => {
        expect(validateAutonomy(level)).toBe(level);
      }
    );

    test("rejects invalid level", () => {
      expect(() => validateAutonomy("yolo")).toThrow(/Invalid autonomy level/);
    });

    test("rejects empty string", () => {
      expect(() => validateAutonomy("")).toThrow(/Invalid autonomy level/);
    });

    test("error message lists valid levels", () => {
      expect(() => validateAutonomy("bad")).toThrow(
        /ingest_only, execute_local, draft_pr, full/
      );
    });
  });
});
