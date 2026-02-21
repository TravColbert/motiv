#!/usr/bin/env bun

import { loadEnv, APP_NAME, APP_NAME_LOWER, DEFAULT_AUTONOMY, validateAutonomy } from "./config.js";
import {
  initLedger,
  isLedgerInitialized,
  listProjects,
  readProject,
  writeProject,
  commitLedger,
  listRequests,
  readRequest,
  readRequestLogs,
} from "./ledger.js";
import {
  ensureWorkspace,
  ensureWorkspaceForAmend,
  checkoutBranch,
  commitAll,
  pushBranch,
  deleteBranch,
  getCurrentCommit,
  runInWorkspace,
} from "./git.js";
import { createRequest, amendRequest, recordAttempt, markApplied, canRetry, canAmend } from "./request.js";
import { runAgent } from "./agent.js";
import { createPR, enableAutoMerge } from "./github.js";
import { readJsonFile } from "./config.js";
import { resolveDescription } from "./description.js";
import { join } from "path";
import { workspacePath } from "./git.js";

// --- CLI Argument Parsing ---

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`
${APP_NAME_LOWER} - Autonomous development agent

Commands:
  init                              Initialize the ledger
  project add --name <n> --repo <r> Register a project
         [--autonomy <level>]
  project list                      List registered projects
  submit --project <p> "desc"       Submit a request (inline description)
  submit --project <p> --file <f>   Submit a request (description from file)
  submit --project <p>              Submit a request (opens $EDITOR, or reads piped stdin)
         [--autonomy <level>]       Override project autonomy for this request
  amend <id> "desc"                 Add follow-up changes to a succeeded/applied request
  amend <id> --file <f>             Add follow-up changes (description from file)
  amend <id>                        Add follow-up changes (opens $EDITOR, or reads piped stdin)
       [--autonomy <level>]         Override autonomy for this amend
  status                            Dashboard of all requests
  list                              List all requests
  show <id>                         Show request details
  logs <id>                         Show request execution logs
  retry <id> [--autonomy <level>]   Re-attempt a failed request
         [--force]                 Rebuild from scratch, even if succeeded/applied

Autonomy Levels:
  ingest_only    Create request in ledger but do not execute
  execute_local  Execute locally but do not push or open a PR
  draft_pr       Push and open a draft PR (default)
  full           Push, open a PR, and enable auto-merge

Options:
  --help                            Show this help message
`);
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else if (args[i].length === 2 && args[i].startsWith("-")) {
      const key = args[i].slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(args[i]);
      i++;
    }
  }
  return { flags, positional };
}

// --- Command Handlers ---

async function cmdInit() {
  if (await isLedgerInitialized()) {
    console.log("Ledger already initialized.");
    return;
  }
  await initLedger();
  console.log(`${APP_NAME} initialized.`);
  console.log(`  Ledger: ~/.${APP_NAME_LOWER}/ledger/`);
  console.log(`  Credentials: ~/.${APP_NAME_LOWER}/.env`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Add your API keys to ~/.${APP_NAME_LOWER}/.env`);
  console.log(`  2. Register a project: ${APP_NAME_LOWER} project add --name <name> --repo <url>`);
}

async function cmdProjectAdd(subArgs) {
  const { flags } = parseFlags(subArgs);
  const name = flags.name;
  const repo = flags.repo;
  const defaultBranch = flags.branch || "main";
  const autonomy = flags.autonomy || DEFAULT_AUTONOMY;

  if (!name || !repo) {
    console.error(`Usage: ${APP_NAME_LOWER} project add --name <name> --repo <git-url> [--branch <branch>] [--autonomy <level>]`);
    process.exit(1);
  }

  try {
    validateAutonomy(autonomy);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const existing = await readProject(name);
  if (existing) {
    console.error(`Project "${name}" already exists.`);
    process.exit(1);
  }

  const project = {
    name,
    repo,
    default_branch: defaultBranch,
    autonomy,
  };

  await writeProject(name, project);
  await commitLedger(`Register project: ${name}`);
  console.log(`Project "${name}" registered.`);
  console.log(`  Repo: ${repo}`);
  console.log(`  Branch: ${defaultBranch}`);
  console.log(`  Autonomy: ${autonomy}`);
}

async function cmdProjectList() {
  const projects = await listProjects();
  if (projects.length === 0) {
    console.log(`No projects registered. Use: ${APP_NAME_LOWER} project add --name <name> --repo <url>`);

    return;
  }
  console.log("Projects:\n");
  for (const p of projects) {
    console.log(`  ${p.name}`);
    console.log(`    repo:     ${p.repo}`);
    console.log(`    branch:   ${p.default_branch || "main"}`);
    console.log(`    autonomy: ${p.autonomy || DEFAULT_AUTONOMY}`);
    console.log("");
  }
}

async function cmdSubmit(subArgs) {
  const { flags, positional } = parseFlags(subArgs);
  const projectName = flags.project;

  if (!projectName) {
    console.error(
      `Usage: ${APP_NAME_LOWER} submit --project <name> [--autonomy <level>] [--file <path>] ["description"]`
    );
    process.exit(1);
  }

  const description = await resolveDescription(flags, positional);

  const project = await readProject(projectName);
  if (!project) {
    console.error(`Project "${projectName}" not found. Register it first with: ${APP_NAME_LOWER} project add`);
    process.exit(1);
  }

  const autonomy = flags.autonomy || project.autonomy || DEFAULT_AUTONOMY;
  try {
    validateAutonomy(autonomy);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  await loadEnv();

  console.log(`Creating request for "${projectName}"...`);
  const request = await createRequest(projectName, description);
  console.log(`  Request:  ${request.id}`);
  console.log(`  Branch:   ${request.branch}`);
  console.log(`  Autonomy: ${autonomy}`);

  if (autonomy === "ingest_only") {
    console.log(`\nAutonomy is "ingest_only" — request ingested, execution skipped.`);
    return;
  }

  await executeRequest(project, request, autonomy);
}

async function cmdRetry(subArgs) {
  const { flags, positional } = parseFlags(subArgs);
  const id = positional[0] || flags._?.[0];
  const force = flags.force === true;

  if (!id) {
    console.error(`Usage: ${APP_NAME_LOWER} retry <request-id> [--autonomy <level>] [--force]`);
    process.exit(1);
  }

  const request = await readRequest(id);
  if (!request) {
    console.error(`Request ${id} not found.`);
    process.exit(1);
  }

  if (!canRetry(request, { force })) {
    console.error(`Request ${id} is in status "${request.status}" and cannot be retried.`);
    if (!force) console.error(`Use --force to rebuild from scratch regardless of status.`);
    process.exit(1);
  }

  const project = await readProject(request.project);
  if (!project) {
    console.error(`Project "${request.project}" not found.`);
    process.exit(1);
  }

  const autonomy = flags.autonomy || project.autonomy || DEFAULT_AUTONOMY;
  try {
    validateAutonomy(autonomy);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  await loadEnv();

  console.log(`${force ? "Force retrying" : "Retrying"} ${id} (autonomy: ${autonomy})...`);
  request.status = "ingested";

  if (autonomy === "ingest_only") {
    console.log(`Autonomy is "ingest_only" — execution skipped.`);
    return;
  }

  await executeRequest(project, request, autonomy, { force });
}

async function cmdAmend(subArgs) {
  const { flags, positional } = parseFlags(subArgs);
  const id = positional[0];

  if (!id) {
    console.error(
      `Usage: ${APP_NAME_LOWER} amend <request-id> [--autonomy <level>] [--file <path>] ["description"]`
    );
    process.exit(1);
  }

  const request = await readRequest(id);
  if (!request) {
    console.error(`Request ${id} not found.`);
    process.exit(1);
  }

  if (!canAmend(request)) {
    console.error(
      `Request ${id} is in status "${request.status}" and cannot be amended. Only succeeded or applied requests can be amended.`
    );
    process.exit(1);
  }

  const description = await resolveDescription(flags, positional.slice(1));

  const project = await readProject(request.project);
  if (!project) {
    console.error(`Project "${request.project}" not found.`);
    process.exit(1);
  }

  const autonomy = flags.autonomy || project.autonomy || DEFAULT_AUTONOMY;
  try {
    validateAutonomy(autonomy);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  await loadEnv();

  const specVersion = request.spec.length + 1;
  console.log(`Amending ${id} (spec v${specVersion})...`);
  const amended = await amendRequest(id, description);
  console.log(`  Branch:   ${amended.branch}`);
  console.log(`  Autonomy: ${autonomy}`);

  if (autonomy === "ingest_only") {
    console.log(`\nAutonomy is "ingest_only" — amendment ingested, execution skipped.`);
    return;
  }

  await executeRequest(project, amended, autonomy);
}

async function cmdStatus() {
  const requests = await listRequests();
  if (requests.length === 0) {
    console.log(`No requests. Submit one with: ${APP_NAME_LOWER} submit --project <name> "description"`);
    return;
  }

  const statusOrder = {
    executing: 0,
    retrying: 1,
    ingested: 2,
    failed: 3,
    needs_human: 4,
    succeeded: 5,
    applied: 6,
  };

  requests.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));

  console.log(`${APP_NAME} Status\n`);
  console.log(
    `  ${"ID".padEnd(10)} ${"Status".padEnd(16)} ${"Project".padEnd(16)} Description`
  );
  console.log(`  ${"─".repeat(10)} ${"─".repeat(16)} ${"─".repeat(16)} ${"─".repeat(30)}`);

  for (const r of requests) {
    const statusDisplay = formatStatus(r.status);
    const desc =
      r.description.length > 40
        ? r.description.slice(0, 37) + "..."
        : r.description;
    console.log(
      `  ${r.id.padEnd(10)} ${statusDisplay.padEnd(16)} ${r.project.padEnd(16)} ${desc}`
    );
  }
  console.log("");
}

async function cmdList() {
  const requests = await listRequests();
  if (requests.length === 0) {
    console.log("No requests.");
    return;
  }

  for (const r of requests) {
    const statusDisplay = formatStatus(r.status);
    console.log(`${r.id}  ${statusDisplay}  ${r.project}  ${r.description}`);
  }
}

async function cmdShow(subArgs) {
  const id = subArgs[0];
  if (!id) {
    console.error(`Usage: ${APP_NAME_LOWER} show <request-id>`);

    process.exit(1);
  }

  const request = await readRequest(id);
  if (!request) {
    console.error(`Request ${id} not found.`);
    process.exit(1);
  }

  const showProject = await readProject(request.project);
  const effectiveAutonomy = showProject?.autonomy || DEFAULT_AUTONOMY;

  console.log(`\nRequest:  ${request.id}`);
  console.log(`Status:   ${formatStatus(request.status)}`);
  console.log(`Project:  ${request.project}`);
  console.log(`Autonomy: ${effectiveAutonomy}`);
  console.log(`Branch:   ${request.branch}`);
  console.log(`Created:  ${request.created_at}`);
  console.log(`Updated:  ${request.updated_at}`);
  if (request.pr_url) {
    console.log(`PR:      ${request.pr_url}`);
  }

  console.log(`\nSpec versions: (${request.spec.length})`);
  for (const spec of request.spec) {
    const label = spec.version === 1 ? "initial" : "amend";
    console.log(`  v${spec.version} [${label}] (${spec.timestamp}):`);
    console.log(`    ${spec.description}`);
  }

  if (request.attempts.length > 0) {
    console.log(`\nAttempts:`);
    for (const a of request.attempts) {
      const icon = a.status === "succeeded" ? "ok" : "FAIL";
      console.log(
        `  #${a.id} [${icon}] ${a.timestamp}${a.commit ? ` commit:${a.commit}` : ""}`
      );
      if (a.reason) console.log(`         Reason: ${a.reason}`);
      if (a.summary) console.log(`         Summary: ${a.summary}`);
    }
  }

  console.log("");
}

async function cmdLogs(subArgs) {
  const id = subArgs[0];
  if (!id) {
    console.error(`Usage: ${APP_NAME_LOWER} logs <request-id>`);

    process.exit(1);
  }

  const logs = await readRequestLogs(id);
  if (logs.length === 0) {
    console.error(`No logs found for ${id}.`);
    process.exit(1);
  }

  console.log(`\nLogs for ${id}:\n`);
  for (const log of logs) {
    console.log(`  [${log.timestamp}] ${log.event}: ${log.message}`);
  }
  console.log("");
}

// --- Core Execution Flow ---

async function executeRequest(project, request, autonomy = DEFAULT_AUTONOMY, { force = false } = {}) {
  const isAmend = request.spec.length > 1;
  console.log(`\nExecuting ${request.id}${isAmend ? ` (amend v${request.spec.length})` : ""}${force ? " (force rebuild)" : ""}...`);

  try {
    // 1. Prepare workspace
    if (isAmend && !force) {
      console.log(`Checking out existing branch ${request.branch}...`);
      await ensureWorkspaceForAmend(project, request.branch);
    } else {
      console.log("Preparing workspace...");
      await ensureWorkspace(project);
      if (force) {
        console.log(`Deleting old branch ${request.branch}...`);
        await deleteBranch(project.name, request.branch);
      }
      console.log(`Creating branch ${request.branch}...`);
      await checkoutBranch(project.name, request.branch, true);
    }

    // 2. Run agent
    console.log("Running agent...");
    const result = await runAgent(project, request);

    if (!result.success) {
      console.log(`\nAgent failed: ${result.error}`);
      await recordAttempt(request.id, {
        status: "failed",
        reason: result.error,
      });
      const updated = await readRequest(request.id);
      console.log(`Request ${request.id} status: ${formatStatus(updated.status)}`);
      return;
    }

    console.log(`\nAgent completed: ${result.summary}`);

    const briefTitle = result.title || truncate(request.description, 72);

    // 3. Commit changes
    console.log("Committing changes...");
    const committed = await commitAll(
      project.name,
      `${request.id}: ${briefTitle}`
    );
    if (!committed) {
      console.log("No changes to commit.");
      await recordAttempt(request.id, {
        status: "failed",
        reason: "Agent reported success but no files were changed",
      });
      return;
    }

    const commitHash = await getCurrentCommit(project.name);

    // 4. Run local tests if configured
    const manifest = await readJsonFile(
      join(workspacePath(project.name), `.${APP_NAME_LOWER}.json`)
    );
    const testCommand = manifest?.tech_stack?.test_command;

    if (testCommand) {
      console.log(`Running tests: ${testCommand}...`);
      const testResult = await runInWorkspace(project.name, testCommand);
      if (testResult.exitCode !== 0) {
        console.log("Tests failed.");
        console.log(testResult.stdout);
        console.log(testResult.stderr);
        await recordAttempt(request.id, {
          status: "failed",
          commit: commitHash,
          reason: `Tests failed: ${testResult.stderr || testResult.stdout}`.slice(0, 500),
        });
        const updated = await readRequest(request.id);
        console.log(`Request ${request.id} status: ${formatStatus(updated.status)}`);
        return;
      }
      console.log("Tests passed.");
    }

    // 5. Record successful attempt
    await recordAttempt(request.id, {
      status: "succeeded",
      commit: commitHash,
      summary: result.summary,
    });

    // execute_local: stop after local commit + tests
    if (autonomy === "execute_local") {
      console.log(`\nDone! Changes committed locally (autonomy: execute_local).`);
      console.log(`  Branch: ${request.branch}`);
      console.log(`  Commit: ${commitHash}`);
      return;
    }

    // 6. Push branch
    console.log(`${force ? "Force pushing" : "Pushing"} branch ${request.branch}...`);
    await pushBranch(project.name, request.branch, { force });

    // 7. PR handling — skip creation for amends (push auto-updates the existing PR)
    if (isAmend && request.pr_url) {
      await markApplied(request.id, request.pr_url);
      console.log(`\nDone! Pushed to existing PR: ${request.pr_url}`);
    } else {
      const isDraft = autonomy !== "full";
      console.log(`Creating ${isDraft ? "draft " : ""}PR...`);
      const pr = await createPR({
        repoUrl: project.repo,
        branch: request.branch,
        baseBranch: project.default_branch || "main",
        title: `${request.id}: ${briefTitle}`,
        body: buildPRBody(request, result.summary),
        draft: isDraft,
      });

      if (autonomy === "full") {
        console.log("Enabling auto-merge...");
        await enableAutoMerge(project.repo, pr.number);
      }

      await markApplied(request.id, pr.html_url);
      console.log(`\nDone! ${isDraft ? "Draft PR" : "PR"}: ${pr.html_url}`);
    }
  } catch (error) {
    console.error(`\nExecution error: ${error.message}`);
    try {
      await recordAttempt(request.id, {
        status: "failed",
        reason: error.message,
      });
    } catch {
      // Ledger write may also fail if something is very wrong
    }
  }
}

function buildPRBody(request, summary) {
  return `## Summary

${summary}

## Request

- **ID**: ${request.id}
- **Source**: ${request.origin.source}
- **Description**: ${request.description}

---
*This PR was created automatically by [${APP_NAME}](https://github.com/TravColbert/motiv).*
`;
}

function truncate(text, maxLen) {
  const firstLine = text.split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3) + "...";
}

function formatStatus(status) {
  const icons = {
    ingested: "[ ] ingested",
    executing: "[~] executing",
    succeeded: "[+] succeeded",
    failed: "[!] failed",
    retrying: "[~] retrying",
    needs_human: "[!!] needs_human",
    applied: "[*] applied",
  };
  return icons[status] || status;
}

// --- Main ---

async function main() {
  if (!command || command === "--help" || command === "help") {
    usage();
    process.exit(0);
  }

  // Commands that don't require an initialized ledger
  if (command === "init") {
    await cmdInit();
    return;
  }

  // All other commands require an initialized ledger
  if (!(await isLedgerInitialized())) {
    console.error(`${APP_NAME} not initialized. Run: ${APP_NAME_LOWER} init`);
    process.exit(1);
  }

  const subArgs = args.slice(1);

  switch (command) {
    case "project": {
      const subCommand = subArgs[0];
      if (subCommand === "add") {
        await cmdProjectAdd(subArgs.slice(1));
      } else if (subCommand === "list") {
        await cmdProjectList();
      } else {
        console.error(`Usage: ${APP_NAME_LOWER} project [add|list]`);
        process.exit(1);
      }
      break;
    }

    case "submit":
      await cmdSubmit(subArgs);
      break;

    case "status":
      await cmdStatus();
      break;

    case "list":
      await cmdList();
      break;

    case "show":
      await cmdShow(subArgs);
      break;

    case "logs":
      await cmdLogs(subArgs);
      break;

    case "retry":
      await cmdRetry(subArgs);
      break;

    case "amend":
      await cmdAmend(subArgs);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
