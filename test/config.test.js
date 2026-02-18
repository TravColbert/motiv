import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadEnv, resolveCredential, readJsonFile, writeJsonFile } from "../src/config.js";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

describe("config", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentium-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("readJsonFile / writeJsonFile", () => {
    test("writes and reads JSON", async () => {
      const filePath = join(tempDir, "test.json");
      const data = { name: "test", value: 42 };
      await writeJsonFile(filePath, data);
      const result = await readJsonFile(filePath);
      expect(result).toEqual(data);
    });

    test("returns null for non-existent file", async () => {
      const result = await readJsonFile(join(tempDir, "nope.json"));
      expect(result).toBeNull();
    });
  });

  describe("resolveCredential", () => {
    test("resolves from environment", () => {
      process.env.TEST_CRED_123 = "secret-value";
      expect(resolveCredential("TEST_CRED_123")).toBe("secret-value");
      delete process.env.TEST_CRED_123;
    });

    test("throws for missing credential", () => {
      expect(() => resolveCredential("NONEXISTENT_CRED")).toThrow(
        /not found/
      );
    });
  });
});
