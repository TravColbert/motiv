# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Motiv

Motiv is an autonomous development agent CLI. It takes a description of a code change, clones the target repo, implements changes using an AI agent, runs tests, pushes a branch, and opens a draft PR. Zero npm dependencies — built entirely on Bun built-ins.

## Commands

```bash
bun test                    # Run all tests (Bun's native test runner)
bun test test/config.test   # Run a single test file
bun run src/index.js        # Run the CLI directly
bun build --compile src/index.js --outfile motiv  # Compile to standalone binary
```

## Architecture

### Module Map

- `src/index.js` — CLI entry point, command dispatcher, orchestrates the full request lifecycle (clone → agent → commit → push → PR)
- `src/agent.js` — LLM agent loop. Sends system prompt + tools to the provider, iterates tool calls up to 50 turns, executes tools sandboxed to the workspace directory
- `src/request.js` — Request state machine and lifecycle (`ingested → executing → succeeded → applied`, with `failed → retrying → needs_human` path)
- `src/ledger.js` — Persistent storage in `~/.motiv/ledger/` (a git repo). Every state change is a git commit for auditability
- `src/git.js` — Git operations wrapper (clone, fetch, branch, commit, push). Workspaces live at `~/.motiv/workspaces/<project>/`
- `src/github.js` — GitHub API client for creating draft PRs
- `src/description.js` — Resolves request descriptions from `--file`, positional args, piped stdin, or interactive `$EDITOR`
- `src/config.js` — Path constants (`~/.motiv/` tree), `.env` loading, credential resolution
- `src/providers/` — Pluggable LLM provider abstraction
  - `index.js` — Factory dispatching on `LLM_PROVIDER` env var (defaults to claude)
  - `claude.js` — Anthropic Claude adapter (claude-sonnet-4-20250514)
  - `gemini.js` — Google Gemini adapter (gemini-2.5-pro), bridges Gemini's API to match the Claude tool interface

### Key Patterns

**Provider interface**: Each provider implements `formatRequest`, `formatAssistantMessage`, `formatToolResults`, `formatUserMessage`, `parseResponse`, and `call`. This normalizes Claude and Gemini behind a single tool-calling interface.

**Agent tools**: The agent receives 10 tools — `read_file`, `write_file`, `edit_file` (targeted string replacement), `list_directory`, `find_files` (glob search by filename), `search_files` (content search), `delete_file`, `get_file_info`, `execute_command`, `view_diff` (shows uncommitted changes), plus `done` to signal completion with a short title and longer summary. All file operations are sandboxed to the workspace via path joining.

**Brief titles**: The `done` tool requires both a `title` (short one-liner for commit messages and PR titles) and a `summary` (longer text for the PR body). When long descriptions are submitted via `--file` or piped stdin, ledger commit messages also truncate to the first line (max 72 chars). The full description is always preserved in the request JSON and PR body.

**Ledger as audit trail**: The `~/.motiv/ledger/` directory is a git repo. Project configs, request documents, and logs are all JSON files committed on every state transition.

**Request lifecycle**: Requests track versioned specs, multiple execution attempts (max 2 retries), and branch/commit references. After 2 failures, requests escalate to `needs_human`.

## Conventions

- ES modules (`"type": "module"`) with Bun runtime
- No external npm dependencies — use Bun built-ins (`fetch`, `Bun.spawn`, `Bun.file`, `Bun.write`) and Node stdlib (`path`, `fs/promises`, `os`)
- Tests use `bun:test` (describe/test/expect)
- Custom flag parser in `index.js` — no CLI framework
- All data files are JSON (parsed with `JSON.parse`, written with `JSON.stringify`)
- Credentials referenced by env var name in configs, resolved from `~/.motiv/.env` at runtime — never stored in the ledger

## Current State

Phase 1 (MVP) is implemented: CLI-driven single-repo execution with Claude and Gemini providers. Phase 2 (external sources like Linear/Sentry, multi-repo decomposition, event/plugin system, autonomy levels) is designed in `.local/DESIGN.md` but not yet built.
