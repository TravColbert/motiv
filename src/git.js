import { join } from "path";
import { paths, APP_NAME, APP_NAME_LOWER } from "./config.js";

/**
 * Common exclude patterns for workspace repos.
 * Written to .git/info/exclude so they don't modify the repo's tracked .gitignore.
 */
const WORKSPACE_EXCLUDES = `# ${APP_NAME} workspace excludes -- common build artifacts and dependencies

# JavaScript / Node
node_modules/
.npm
dist/
build/
.next/
.nuxt/
.output/
.cache/

# Python
__pycache__/
*.pyc
*.pyo
.venv/
venv/
env/
*.egg-info/
.eggs/
.mypy_cache/
.pytest_cache/
.ruff_cache/

# Java / JVM
target/
.gradle/
*.class

# Rust
target/

# Go
vendor/

# .NET / C#
bin/
obj/
packages/

# Ruby
.bundle/

# PHP
vendor/

# IDE and editor files
.idea/
.vscode/
*.swp
*.swo
*~

# OS files
.DS_Store
Thumbs.db

# Environment and secrets
.env
.env.local
.env.*.local

# Misc
coverage/
tmp/
temp/
*.log
`;

/**
 * Run a git command in the given directory.
 * Returns { stdout, stderr, exitCode }.
 * Throws on non-zero exit code.
 */
export async function git(cwd, args) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const error = new Error(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`
    );
    error.exitCode = exitCode;
    error.stderr = stderr;
    error.stdout = stdout;
    throw error;
  }

  return { stdout, stderr, exitCode };
}

/**
 * Get the workspace path for a project.
 */
export function workspacePath(projectName) {
  return join(paths.workspaces, projectName);
}

/**
 * Clone a repo into the workspaces directory.
 */
export async function cloneRepo(repoUrl, projectName) {
  const dest = workspacePath(projectName);
  await git(paths.workspaces, ["clone", "-q", repoUrl, dest]);
  await git(dest, ["config", "user.name", APP_NAME]);
  await git(dest, ["config", "user.email", `${APP_NAME_LOWER}@local`]);
  await writeWorkspaceExcludes(dest);
  return dest;
}

/**
 * Write common exclude patterns to a workspace's .git/info/exclude.
 * This acts as a local-only gitignore that won't show up in PRs.
 */
async function writeWorkspaceExcludes(repoPath) {
  const excludePath = join(repoPath, ".git", "info", "exclude");
  await Bun.write(excludePath, WORKSPACE_EXCLUDES);
}

/**
 * Fetch latest changes for a project workspace.
 */
export async function fetchRepo(projectName) {
  const cwd = workspacePath(projectName);
  await git(cwd, ["fetch", "--all", "-q"]);
}

/**
 * Checkout a branch. If createNew is true, creates it unless it already exists.
 */
export async function checkoutBranch(projectName, branch, createNew = false) {
  const cwd = workspacePath(projectName);
  if (createNew) {
    try {
      await git(cwd, ["checkout", "-b", branch]);
    } catch (err) {
      // Branch already exists — just switch to it and reset to current HEAD
      if (err.exitCode === 128 && err.stderr.includes("already exists")) {
        await git(cwd, ["checkout", branch]);
        await git(cwd, ["reset", "--hard", "HEAD"]);
      } else {
        throw err;
      }
    }
  } else {
    await git(cwd, ["checkout", branch]);
  }
}

/**
 * Ensure the workspace is on the default branch and up to date.
 */
export async function resetToDefault(projectName, defaultBranch = "main") {
  const cwd = workspacePath(projectName);
  await git(cwd, ["checkout", defaultBranch]);
  await git(cwd, ["pull", "--ff-only", "-q"]);
}

/**
 * Stage all changes, commit with message.
 */
export async function commitAll(projectName, message) {
  const cwd = workspacePath(projectName);
  await git(cwd, ["add", "."]);

  // Check if there's anything to commit
  const result = await git(cwd, ["status", "--porcelain"]);
  if (!result.stdout.trim()) return false;

  await git(cwd, ["commit", "-q", "-m", message]);
  return true;
}

/**
 * Push a branch to origin.
 */
export async function pushBranch(projectName, branch) {
  const cwd = workspacePath(projectName);
  await git(cwd, ["push", "-u", "origin", branch]);
}

/**
 * Check if a workspace exists (has been cloned).
 */
export async function workspaceExists(projectName) {
  const dest = workspacePath(projectName);
  const gitDir = join(dest, ".git");
  const file = Bun.file(gitDir);
  // .git is a directory so file.exists() may not work, use git rev-parse
  try {
    await git(dest, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a workspace is ready: clone if needed, fetch, reset to default branch.
 */
export async function ensureWorkspace(project) {
  const exists = await workspaceExists(project.name);
  if (!exists) {
    console.log(`  Cloning ${project.repo}...`);
    await cloneRepo(project.repo, project.name);
  } else {
    console.log(`  Fetching latest changes...`);
    await fetchRepo(project.name);
  }
  await resetToDefault(project.name, project.default_branch || "main");
}

/**
 * Get the current commit hash (short).
 */
export async function getCurrentCommit(projectName) {
  const cwd = workspacePath(projectName);
  const result = await git(cwd, ["rev-parse", "--short", "HEAD"]);
  return result.stdout.trim();
}

/**
 * Run a shell command in the workspace (for tests, etc.).
 * Returns { stdout, stderr, exitCode } without throwing.
 */
export async function runInWorkspace(projectName, command) {
  const cwd = workspacePath(projectName);
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}
