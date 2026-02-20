import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { canRetry, canAmend, failedAttemptCount } from "../src/request.js";

describe("request", () => {
  describe("canRetry", () => {
    test("can retry failed requests", () => {
      expect(canRetry({ status: "failed" })).toBe(true);
    });

    test("can retry needs_human requests", () => {
      expect(canRetry({ status: "needs_human" })).toBe(true);
    });

    test("cannot retry succeeded requests without force", () => {
      expect(canRetry({ status: "succeeded" })).toBe(false);
    });

    test("cannot retry applied requests without force", () => {
      expect(canRetry({ status: "applied" })).toBe(false);
    });

    test("cannot retry ingested requests without force", () => {
      expect(canRetry({ status: "ingested" })).toBe(false);
    });

    test("force allows retry of succeeded requests", () => {
      expect(canRetry({ status: "succeeded" }, { force: true })).toBe(true);
    });

    test("force allows retry of applied requests", () => {
      expect(canRetry({ status: "applied" }, { force: true })).toBe(true);
    });

    test("force allows retry of ingested requests", () => {
      expect(canRetry({ status: "ingested" }, { force: true })).toBe(true);
    });

    test("force allows retry of failed requests", () => {
      expect(canRetry({ status: "failed" }, { force: true })).toBe(true);
    });
  });

  describe("canAmend", () => {
    test("can amend succeeded requests", () => {
      expect(canAmend({ status: "succeeded" })).toBe(true);
    });

    test("can amend applied requests", () => {
      expect(canAmend({ status: "applied" })).toBe(true);
    });

    test("cannot amend ingested requests", () => {
      expect(canAmend({ status: "ingested" })).toBe(false);
    });

    test("cannot amend executing requests", () => {
      expect(canAmend({ status: "executing" })).toBe(false);
    });

    test("cannot amend failed requests", () => {
      expect(canAmend({ status: "failed" })).toBe(false);
    });

    test("cannot amend needs_human requests", () => {
      expect(canAmend({ status: "needs_human" })).toBe(false);
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
