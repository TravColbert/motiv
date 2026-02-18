import { mkdir } from "fs/promises";
import { join } from "path";
import { paths, readJsonFile, writeJsonFile, APP_NAME, APP_NAME_LOWER } from "./config.js";
import { git } from "./git.js";

/**
 * Initialize the ledger: create directory structure, git init, initial commit.
 */
export async function initLedger() {
  // Create all ledger directories
  const dirs = [
    paths.ledger,
    paths.projects,
    paths.sources,
    paths.requests,
    paths.templates,
    paths.plugins,
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // Create workspaces directory
  await mkdir(paths.workspaces, { recursive: true });

  // Create .env file if it doesn't exist
  const envFile = Bun.file(paths.envFile);
  if (!(await envFile.exists())) {
    await Bun.write(
      paths.envFile,
      `# ${APP_NAME} credentials\n# ANTHROPIC_API_KEY=sk-ant-...\n# GITHUB_TOKEN=ghp_...\n`
    );
  }

  // Create .gitignore for the ledger
  const gitignorePath = join(paths.ledger, ".gitignore");
  const gitignoreFile = Bun.file(gitignorePath);
  if (!(await gitignoreFile.exists())) {
    await Bun.write(gitignorePath, "../.env\n");
  }

  // Initialize git repo in the ledger
  await git(paths.ledger, ["init", "-q"]);

  // Configure local git identity for ledger commits
  await git(paths.ledger, ["config", "user.name", APP_NAME]);
  await git(paths.ledger, ["config", "user.email", `${APP_NAME_LOWER}@local`]);

  // Create initial commit with empty structure
  // Add placeholder files so git tracks the directories
  for (const dir of [
    paths.projects,
    paths.sources,
    paths.requests,
    paths.templates,
    paths.plugins,
  ]) {
    const keepFile = join(dir, ".gitkeep");
    const file = Bun.file(keepFile);
    if (!(await file.exists())) {
      await Bun.write(keepFile, "");
    }
  }

  await git(paths.ledger, ["add", "."]);
  await git(paths.ledger, ["commit", "-q", "-m", `Initialize ${APP_NAME_LOWER} ledger`]);
}

/**
 * Check if the ledger has been initialized.
 */
export async function isLedgerInitialized() {
  const gitDir = Bun.file(join(paths.ledger, ".git"));
  // .git is a directory, so we check differently
  try {
    await git(paths.ledger, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stage all changes and commit to the ledger.
 */
export async function commitLedger(message) {
  await git(paths.ledger, ["add", "."]);

  // Check if there are changes to commit
  const result = await git(paths.ledger, ["status", "--porcelain"]);
  if (!result.stdout.trim()) return; // Nothing to commit

  await git(paths.ledger, ["commit", "-q", "-m", message]);
}

// --- Project operations ---

export async function listProjects() {
  const { readdir } = await import("fs/promises");
  try {
    const files = await readdir(paths.projects);
    const projects = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await readJsonFile(join(paths.projects, file));
      if (data) projects.push(data);
    }
    return projects;
  } catch {
    return [];
  }
}

export async function readProject(name) {
  return readJsonFile(join(paths.projects, `${name}.json`));
}

export async function writeProject(name, data) {
  await writeJsonFile(join(paths.projects, `${name}.json`), data);
}

// --- Request operations ---

export async function listRequests() {
  const { readdir } = await import("fs/promises");
  try {
    const entries = await readdir(paths.requests);
    const requests = [];
    for (const entry of entries) {
      if (entry === ".gitkeep") continue;
      const data = await readJsonFile(
        join(paths.requests, entry, "request.json")
      );
      if (data) requests.push(data);
    }
    return requests;
  } catch {
    return [];
  }
}

export async function readRequest(id) {
  return readJsonFile(join(paths.requests, id, "request.json"));
}

export async function writeRequest(id, data) {
  const dir = join(paths.requests, id);
  await mkdir(dir, { recursive: true });
  await writeJsonFile(join(dir, "request.json"), data);
}

export async function writeRequestLog(id, entry) {
  const logDir = join(paths.requests, id, "log");
  await mkdir(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeJsonFile(join(logDir, `${timestamp}.json`), entry);
}

export async function readRequestLogs(id) {
  const { readdir } = await import("fs/promises");
  const logDir = join(paths.requests, id, "log");
  try {
    const files = await readdir(logDir);
    const logs = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await readJsonFile(join(logDir, file));
      if (data) logs.push(data);
    }
    return logs.sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
  } catch {
    return [];
  }
}

/**
 * Generate the next request ID (sequential: REQ-0001, REQ-0002, ...).
 */
export async function nextRequestId() {
  const requests = await listRequests();
  if (requests.length === 0) return "REQ-0001";

  const nums = requests
    .map((r) => parseInt(r.id.replace("REQ-", ""), 10))
    .filter((n) => !isNaN(n));

  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `REQ-${String(max + 1).padStart(4, "0")}`;
}
