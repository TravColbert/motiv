# Motiv

An autonomous development agent. Submit a description of a code change, and Motiv clones the repo, implements the change using an AI agent, runs tests, pushes a branch, and opens a draft PR.

Zero dependencies. Built with Bun and JavaScript.

## Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- Git (configured with SSH access to your repositories)
- An [Anthropic API key](https://console.anthropic.com/)
- A [GitHub personal access token](https://github.com/settings/tokens) with `repo` scope

## Install

```bash
git clone https://github.com/tcolbert/motiv.git
cd motiv
```

To compile to a standalone binary:

```bash
bun build --compile src/index.js --outfile motiv
sudo mv motiv /usr/local/bin/
```

Or run directly with Bun (all examples below use this approach):

```bash
bun run src/index.js <command>
```

## Quick Start

### 1. Initialize

```bash
bun run src/index.js init
```

This creates `~/.motiv/` with:
- `ledger/` -- a git-tracked directory that stores all project configs, requests, and execution logs
- `workspaces/` -- where repositories are cloned
- `.env` -- where API keys are stored (gitignored from the ledger)

### 2. Add credentials

Edit `~/.motiv/.env`:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
GITHUB_TOKEN=ghp_your-token-here
```

### 3. Register a project

```bash
bun run src/index.js project add --name my-api --repo git@github.com:you/my-api.git
```

Optionally specify the default branch (defaults to `main`):

```bash
bun run src/index.js project add --name my-api --repo git@github.com:you/my-api.git --branch develop
```

### 4. Submit a request

Inline description:

```bash
bun run src/index.js submit --project my-api "Add rate limiting to the /search endpoint"
```

From a file (useful for detailed, multi-paragraph specs):

```bash
bun run src/index.js submit --project my-api --file spec.md
```

Piped from stdin:

```bash
cat spec.md | bun run src/index.js submit --project my-api
```

Motiv will:
1. Clone (or fetch) the repository into `~/.motiv/workspaces/my-api/`
2. Create a branch `motiv/REQ-0001`
3. Run the AI agent to implement the change
4. Run local tests if a `.motiv.json` manifest exists with a `test_command`
5. Commit, push, and open a draft PR on GitHub

### 5. Monitor progress

```bash
# Dashboard of all requests
bun run src/index.js status

# Detailed view of a specific request
bun run src/index.js show REQ-0001

# Execution logs
bun run src/index.js logs REQ-0001
```

## Commands

| Command | Description |
|---|---|
| `init` | Initialize the ledger and credentials file |
| `project add --name <n> --repo <url> [--branch <b>]` | Register a project |
| `project list` | List registered projects |
| `submit --project <name> "description"` | Submit a request (inline description) |
| `submit --project <name> --file <path>` | Submit a request (description from file) |
| `submit --project <name>` | Submit a request (reads from piped stdin) |
| `status` | Dashboard of all requests and their states |
| `list` | List all requests |
| `show <id>` | Full history of a specific request |
| `logs <id>` | Execution logs for a request |
| `retry <id>` | Re-attempt a failed request |

## Project Manifest

For better results, add a `.motiv.json` file to the root of your repository. This tells the agent about your project's conventions and how to run tests:

```json
{
  "name": "my-api",
  "description": "REST API for the platform. Handles user management, search, and billing.",
  "tech_stack": {
    "language": "typescript",
    "framework": "express",
    "test_command": "npm test",
    "ci": "github-actions"
  },
  "conventions": {
    "branch_prefix": "motiv/",
    "commit_style": "conventional",
    "notes": "All new endpoints must include OpenAPI annotations."
  }
}
```

If `tech_stack.test_command` is set, Motiv runs tests locally before pushing. If tests fail, the agent attempts to self-correct (up to 2 retries).

## How It Works

Motiv maintains a **ledger** at `~/.motiv/ledger/` -- a git repository that tracks every request, its status, spec versions, execution attempts, and logs. Every state change is a git commit, giving you a full audit trail via `git log`.

When a request is submitted, the agent (Claude) receives the full repository and a set of tools:
- `read_file` / `write_file` -- read and modify project files
- `edit_file` -- targeted string replacement for surgical edits (avoids rewriting entire files)
- `list_directory` / `find_files` -- explore the codebase structure
- `search_files` -- search file contents by pattern
- `delete_file` -- remove files during refactoring
- `get_file_info` -- check file existence, size, and line count without reading contents
- `execute_command` -- run tests, install dependencies, etc.
- `view_diff` -- review uncommitted changes before finishing
- `done` -- signal completion with a short title (used for commit messages and PR titles) and a longer summary (used for the PR body)

The agent works in a loop, calling tools as needed until the implementation is complete. Motiv then commits the changes, runs tests, pushes, and opens a draft PR.

Long request descriptions (e.g., from `--file` or piped input) are handled gracefully: the agent generates a brief title for use in commit messages and PR titles, while the full description is preserved in the PR body and request records.

## Request Lifecycle

```
ingested ──> executing ──> succeeded ──> applied (PR opened)
                │
                ▼
             failed ──> retrying (max 2) ──> needs_human
```

## Directory Structure

```
~/.motiv/
├── .env                    # API keys (gitignored)
├── ledger/                 # Git-tracked request ledger
│   ├── projects/           # Project configurations
│   ├── requests/           # Request documents and logs
│   │   └── REQ-0001/
│   │       ├── request.json
│   │       └── log/
│   ├── sources/            # (Phase 2) External source configs
│   ├── plugins/            # (Phase 2) Notification plugins
│   └── templates/          # (Phase 2) Request templates
└── workspaces/             # Cloned repositories
    └── my-api/
```

## Running Tests

```bash
bun test
```

## License

MIT
