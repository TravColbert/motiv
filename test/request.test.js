import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { canRetry, failedAttemptCount } from "../src/request.js";

describe("request", () => {
  describe("canRetry", () => {
    test("can retry failed requests", () => {
      expect(canRetry({ status: "failed" })).toBe(true);
    });

    test("can retry needs_human requests", () => {
      expect(canRetry({ status: "needs_human" })).toBe(true);
    });

    test("cannot retry succeeded requests", () => {
      expect(canRetry({ status: "succeeded" })).toBe(false);
    });

    test("cannot retry applied requests", () => {
      expect(canRetry({ status: "applied" })).toBe(false);
    });

    test("cannot retry ingested requests", () => {
      expect(canRetry({ status: "ingested" })).toBe(false);
    });
  });

  describe("failedAttemptCount", () => {
    test("counts failed attempts", () => {
      const request = {
        attempts: [
          { id: 1, status: "failed" },
          { id: 2, status: "succeeded" },
          { id: 3, status: "failed" },
        ],
      };
      expect(failedAttemptCount(request)).toBe(2);
    });

    test("returns 0 for no attempts", () => {
      expect(failedAttemptCount({ attempts: [] })).toBe(0);
    });
  });
});
