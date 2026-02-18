import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveDescription } from "../src/description.js";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

describe("resolveDescription", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "motiv-desc-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("--file flag", () => {
    test("reads description from file via --file", async () => {
      const filePath = join(tempDir, "spec.md");
      await Bun.write(filePath, "Implement the new feature\n\nWith details.");
      const result = await resolveDescription({ file: filePath }, []);
      expect(result).toBe("Implement the new feature\n\nWith details.");
    });

    test("reads description from file via -f short flag", async () => {
      const filePath = join(tempDir, "spec.txt");
      await Bun.write(filePath, "  Short spec with whitespace  \n");
      const result = await resolveDescription({ f: filePath }, []);
      expect(result).toBe("Short spec with whitespace");
    });

    test("--file takes priority over positional args", async () => {
      const filePath = join(tempDir, "spec.md");
      await Bun.write(filePath, "From file");
      const result = await resolveDescription({ file: filePath }, [
        "from",
        "positional",
      ]);
      expect(result).toBe("From file");
    });
  });

  describe("positional args", () => {
    test("joins positional args into description", async () => {
      const result = await resolveDescription({}, ["fix", "the", "bug"]);
      expect(result).toBe("fix the bug");
    });

    test("single positional arg works", async () => {
      const result = await resolveDescription({}, ["refactor authentication"]);
      expect(result).toBe("refactor authentication");
    });
  });
});
