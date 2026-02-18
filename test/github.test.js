import { describe, test, expect } from "bun:test";
import { parseRepoUrl } from "../src/github.js";

describe("github", () => {
  describe("parseRepoUrl", () => {
    test("parses SSH URL", () => {
      const result = parseRepoUrl("git@github.com:tcolbert/my-api.git");
      expect(result).toEqual({ owner: "tcolbert", repo: "my-api" });
    });

    test("parses SSH URL without .git suffix", () => {
      const result = parseRepoUrl("git@github.com:tcolbert/my-api");
      expect(result).toEqual({ owner: "tcolbert", repo: "my-api" });
    });

    test("parses HTTPS URL", () => {
      const result = parseRepoUrl("https://github.com/tcolbert/my-api.git");
      expect(result).toEqual({ owner: "tcolbert", repo: "my-api" });
    });

    test("parses HTTPS URL without .git suffix", () => {
      const result = parseRepoUrl("https://github.com/tcolbert/my-api");
      expect(result).toEqual({ owner: "tcolbert", repo: "my-api" });
    });

    test("throws for invalid URL", () => {
      expect(() => parseRepoUrl("not-a-url")).toThrow(/Cannot parse/);
    });
  });
});
