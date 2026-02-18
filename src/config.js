import { homedir } from "os";
import { join } from "path";

export const APP_NAME = "Motiv";
export const APP_NAME_LOWER = APP_NAME.toLowerCase();

// Core paths
const APP_HOME = join(homedir(), `.${APP_NAME_LOWER}`);
const LEDGER_DIR = join(APP_HOME, "ledger");
const WORKSPACES_DIR = join(APP_HOME, "workspaces");
const ENV_FILE = join(APP_HOME, ".env");

// Ledger subdirectories
const PROJECTS_DIR = join(LEDGER_DIR, "projects");
const SOURCES_DIR = join(LEDGER_DIR, "sources");
const REQUESTS_DIR = join(LEDGER_DIR, "requests");
const TEMPLATES_DIR = join(LEDGER_DIR, "templates");
const PLUGINS_DIR = join(LEDGER_DIR, "plugins");

export const paths = {
  home: APP_HOME,
  ledger: LEDGER_DIR,
  workspaces: WORKSPACES_DIR,
  envFile: ENV_FILE,
  projects: PROJECTS_DIR,
  sources: SOURCES_DIR,
  requests: REQUESTS_DIR,
  templates: TEMPLATES_DIR,
  plugins: PLUGINS_DIR,
};

/**
 * Load environment variables from APP_HOME/.env
 * Bun automatically loads .env from cwd, but we need to load from our own path.
 * We parse it manually to stay zero-dep.
 */
export async function loadEnv() {
  const file = Bun.file(ENV_FILE);
  if (!(await file.exists())) return;

  const text = await file.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

/**
 * Resolve a credential reference to its actual value.
 * The credential field in config files is an environment variable name.
 */
export function resolveCredential(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Credential "${name}" not found. Set it in ${ENV_FILE} or as an environment variable.`
    );
  }
  return value;
}

/**
 * Read and parse a JSON config file. Returns null if file doesn't exist.
 */
export async function readJsonFile(filePath) {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  const text = await file.text();
  return JSON.parse(text);
}

/**
 * Write a JSON config file with pretty formatting.
 */
export async function writeJsonFile(filePath, data) {
  await Bun.write(filePath, JSON.stringify(data, null, 2) + "\n");
}

// --- Autonomy Levels ---

export const AUTONOMY_LEVELS = ["ingest_only", "execute_local", "draft_pr", "full"];
export const DEFAULT_AUTONOMY = "draft_pr";

export function validateAutonomy(level) {
  if (!AUTONOMY_LEVELS.includes(level)) {
    throw new Error(
      `Invalid autonomy level "${level}". Must be one of: ${AUTONOMY_LEVELS.join(", ")}`
    );
  }
  return level;
}
