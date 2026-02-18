import { join } from "path";
import { tmpdir } from "os";
import { unlink } from "fs/promises";
import { APP_NAME_LOWER } from "./config.js";

/**
 * Open $EDITOR with a temp file, wait for the user to write a description,
 * then read and return it (stripping comment lines).
 */
export async function editorDescription() {
  const tmpFile = join(tmpdir(), `${APP_NAME_LOWER}-desc-${Date.now()}.md`);
  const header =
    "# Enter your request description below.\n# Lines starting with # will be stripped.\n\n";
  await Bun.write(tmpFile, header);

  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const proc = Bun.spawn(editor.split(" ").concat(tmpFile), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;

  const content = await Bun.file(tmpFile).text();
  await unlink(tmpFile).catch(() => {});

  const description = content
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();

  if (!description) {
    console.error("Aborting: empty description.");
    process.exit(1);
  }
  return description;
}

/**
 * Resolve the request description from one of (in priority order):
 *   1. --file / -f flag (read from file)
 *   2. Positional inline argument
 *   3. Piped stdin
 *   4. Interactive $EDITOR
 */
export async function resolveDescription(flags, positional) {
  // Priority 1: --file / -f flag
  if (flags.file || flags.f) {
    const filePath = flags.file || flags.f;
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    return (await file.text()).trim();
  }

  // Priority 2: Positional inline arg
  if (positional.length > 0) {
    return positional.join(" ");
  }

  // Priority 3: Piped stdin
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString().trim();
    if (text) return text;
  }

  // Priority 4: $EDITOR interactive
  return await editorDescription();
}
