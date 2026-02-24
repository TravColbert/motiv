import { readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { resolveCredential, readJsonFile, AGENT_CONTEXT_FILENAME, APP_NAME, APP_NAME_LOWER } from "./config.js";
import { workspacePath, runInWorkspace, git } from "./git.js";
import { getProvider } from "./providers/index.js";

const MAX_TURNS = 50;

// Tools available to the agent (provider-agnostic format)
const TOOLS = [
  {
    name: "read_file",
    description:
      "Read the contents of a file in the project. Returns the full file content as text.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path from the project root to the file to read",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file in the project. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories as needed.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path from the project root to the file to write",
        },
        content: {
          type: "string",
          description: "The full content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description:
      "List files and directories at the given path. Returns names with '/' suffix for directories.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path from the project root. Use '.' for the root directory.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description:
      "Search for a text pattern across files in the project using grep. Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The text or regex pattern to search for",
        },
        path: {
          type: "string",
          description:
            "Relative directory to search in. Use '.' for the entire project.",
        },
        include: {
          type: "string",
          description:
            "Optional glob pattern to filter files (e.g., '*.js', '*.ts')",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "execute_command",
    description:
      "Execute a shell command in the project directory. Use for running tests, installing dependencies, or other build tasks. Do NOT use for git operations.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "edit_file",
    description:
      "Make a targeted edit to a file by replacing an exact string match. More efficient than write_file for small changes to large files. The old_string must appear exactly once in the file.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path from the project root to the file to edit",
        },
        old_string: {
          type: "string",
          description:
            "The exact text to find in the file. Must match exactly once, including whitespace and indentation.",
        },
        new_string: {
          type: "string",
          description:
            "The replacement text. Use an empty string to delete the matched text.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "find_files",
    description:
      "Find files by name or glob pattern across the project tree. Unlike search_files which searches file contents, this searches file paths/names. Returns matching file paths relative to the project root.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern to match file names (e.g., '*.test.ts', 'Dockerfile', '*.py')",
        },
        path: {
          type: "string",
          description:
            "Relative directory to search in. Defaults to the project root.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a file from the project. Use when refactoring requires removing files (e.g., dead modules, renamed files).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path from the project root to the file to delete",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "get_file_info",
    description:
      "Get metadata about a file without reading its contents. Returns existence, size, type (file or directory), and line count. Useful for checking whether a file exists or gauging its size before reading.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path from the project root to the file to inspect",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "view_diff",
    description:
      "View the uncommitted changes (diff) in the workspace. Shows what you have modified so far. Useful for self-review before calling done.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional relative path to limit the diff to a specific file or directory",
        },
      },
      required: [],
    },
  },
  {
    name: "done",
    description:
      "Signal that the implementation is complete. Call this when all changes have been made and you are confident the work is done.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "A short one-line title (max ~72 chars) summarizing the change, suitable for a commit message or PR title. Use imperative mood (e.g., 'Add retry logic to payment webhook handler').",
        },
        summary: {
          type: "string",
          description:
            "A concise summary of what was changed and why, suitable for a PR description body",
        },
      },
      required: ["title", "summary"],
    },
  },
];

function truncate(str, max = 80) {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

function formatToolParams(name, input) {
  switch (name) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "list_directory":
    case "delete_file":
    case "get_file_info":
      return input.path || "";
    case "search_files":
      return truncate(
        `"${input.pattern}"${input.path ? ` in ${input.path}` : ""}`
      );
    case "find_files":
      return truncate(
        `"${input.pattern}"${input.path ? ` in ${input.path}` : ""}`
      );
    case "execute_command":
      return truncate(input.command || "");
    case "view_diff":
      return input.path || "";
    case "done":
      return truncate(input.title || "");
    default:
      return "";
  }
}

/**
 * Execute a tool call in the workspace.
 */
async function executeTool(projectName, toolName, toolInput) {
  const wsPath = workspacePath(projectName);

  switch (toolName) {
    case "read_file": {
      const filePath = join(wsPath, toolInput.path);
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return { error: `File not found: ${toolInput.path}` };
      }
      const content = await file.text();
      return { content };
    }

    case "write_file": {
      const filePath = join(wsPath, toolInput.path);
      const { mkdir } = await import("fs/promises");
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (dir) await mkdir(dir, { recursive: true });
      await Bun.write(filePath, toolInput.content);
      return { success: true, message: `Wrote ${toolInput.path}` };
    }

    case "list_directory": {
      const dirPath = join(wsPath, toolInput.path || ".");
      try {
        const entries = await readdir(dirPath);
        const results = [];
        for (const entry of entries) {
          if (entry === ".git") continue;
          const entryPath = join(dirPath, entry);
          const entryStat = await stat(entryPath);
          results.push(entryStat.isDirectory() ? `${entry}/` : entry);
        }
        return { entries: results.sort() };
      } catch (e) {
        return { error: `Cannot list directory: ${toolInput.path}` };
      }
    }

    case "search_files": {
      const searchPath = toolInput.path || ".";
      let cmd = `rg --line-number --no-heading "${toolInput.pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
      if (toolInput.include) {
        cmd += ` --glob "${toolInput.include}"`;
      }
      const result = await runInWorkspace(projectName, cmd);
      if (result.exitCode === 0) {
        return { matches: result.stdout };
      } else if (result.exitCode === 1) {
        return { matches: "", message: "No matches found" };
      }
      let grepCmd = `grep -rn "${toolInput.pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
      if (toolInput.include) {
        grepCmd += ` --include="${toolInput.include}"`;
      }
      const grepResult = await runInWorkspace(projectName, grepCmd);
      return { matches: grepResult.stdout || "No matches found" };
    }

    case "execute_command": {
      const result = await runInWorkspace(projectName, toolInput.command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
      };
    }

    case "edit_file": {
      const filePath = join(wsPath, toolInput.path);
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return { error: `File not found: ${toolInput.path}` };
      }
      const content = await file.text();
      const occurrences = content.split(toolInput.old_string).length - 1;
      if (occurrences === 0) {
        return { error: `old_string not found in ${toolInput.path}. Make sure the string matches exactly, including whitespace and indentation.` };
      }
      if (occurrences > 1) {
        return { error: `old_string appears ${occurrences} times in ${toolInput.path}. It must be unique — include more surrounding context to disambiguate.` };
      }
      const newContent = content.replace(toolInput.old_string, toolInput.new_string);
      await Bun.write(filePath, newContent);
      return { success: true, message: `Edited ${toolInput.path}` };
    }

    case "find_files": {
      const searchPath = toolInput.path || ".";
      let cmd = `rg --files --glob "${toolInput.pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
      const result = await runInWorkspace(projectName, cmd);
      if (result.exitCode === 0 && result.stdout.trim()) {
        return { files: result.stdout.trim() };
      }
      // Fallback to find
      const findCmd = `find "${searchPath}" -name "${toolInput.pattern.replace(/"/g, '\\"')}" -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null | head -200 | sort`;
      const findResult = await runInWorkspace(projectName, findCmd);
      return { files: findResult.stdout.trim() || "No files found" };
    }

    case "delete_file": {
      const filePath = join(wsPath, toolInput.path);
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return { error: `File not found: ${toolInput.path}` };
      }
      await unlink(filePath);
      return { success: true, message: `Deleted ${toolInput.path}` };
    }

    case "get_file_info": {
      const filePath = join(wsPath, toolInput.path);
      try {
        const fileStat = await stat(filePath);
        const info = {
          exists: true,
          type: fileStat.isDirectory() ? "directory" : "file",
          size: fileStat.size,
          modified: fileStat.mtime.toISOString(),
        };
        if (!fileStat.isDirectory()) {
          const content = await Bun.file(filePath).text();
          info.lines = content.split("\n").length;
        }
        return info;
      } catch (e) {
        if (e.code === "ENOENT") {
          return { exists: false };
        }
        return { error: `Cannot stat: ${toolInput.path}` };
      }
    }

    case "view_diff": {
      const args = ["diff", "HEAD"];
      if (toolInput.path) args.push("--", toolInput.path);
      try {
        const result = await git(wsPath, args);
        const diff = result.stdout.trim();
        return { diff: diff || "No changes detected" };
      } catch {
        // If HEAD doesn't exist yet (empty repo), diff against empty tree
        try {
          const args = ["diff"];
          if (toolInput.path) args.push("--", toolInput.path);
          const result = await git(wsPath, args);
          return { diff: result.stdout.trim() || "No changes detected" };
        } catch {
          return { diff: "No changes detected" };
        }
      }
    }

    case "done": {
      return { done: true, title: toolInput.title, summary: toolInput.summary };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Read the per-project agent context file from the workspace.
 * Returns the file contents, or an empty string if it doesn't exist.
 */
async function loadAgentContext(projectName) {
  const contextPath = join(workspacePath(projectName), AGENT_CONTEXT_FILENAME);
  const file = Bun.file(contextPath);
  if (!(await file.exists())) return "";
  return await file.text();
}

/**
 * Build the system prompt parts for the agent.
 * Returns an array of strings — each becomes a separately cacheable block.
 */
function buildSystemPrompt(project, agentContext) {
  const base = `You are ${APP_NAME}, an autonomous development agent. You are implementing a code change in a Git repository.

## Project
- Name: ${project.name}
- Repository: ${project.repo}
- Default branch: ${project.default_branch || "main"}

## Instructions
1. Start by understanding the project structure. List directories and read key files (README, package.json, etc.) to understand the codebase.
2. Read the project's .${APP_NAME_LOWER}.json manifest if it exists for additional context about conventions and tech stack.
3. Plan your approach before making changes.
4. Implement the requested changes by reading and writing files.
5. If the project has tests, run them to verify your changes work.
6. When done, call the "done" tool with a short imperative title (max ~72 chars, e.g., "Add retry logic to payment webhook handler") and a longer summary of your changes.

## Rules
- Do NOT use git commands. ${APP_NAME} handles all git operations.
- Make clean, minimal changes. Don't refactor unrelated code.
- Follow existing code style and conventions.
- If you encounter an issue you cannot resolve, call "done" with a summary explaining what went wrong.
- Be thorough but efficient with your context -- read files you need, don't read everything.`;

  const parts = [base];
  if (agentContext.trim()) {
    parts.push(agentContext.trim());
  }
  return parts;
}

/**
 * Core agent loop shared by runAgent and runContextAgent.
 * Sends messages, executes tools, repeats until done or max turns.
 * Returns { success, title, summary, error, usage }.
 */
async function agentLoop(project, systemParts, userText, tools, maxTurns = MAX_TURNS) {
  const provider = getProvider();
  const apiKey = resolveCredential(provider.credentialName);

  const messages = [];
  messages.push(provider.formatUserMessage(userText));

  let turns = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (turns < maxTurns) {
    turns++;
    console.log(`  Agent turn ${turns}...`);

    const formattedRequest = provider.formatRequest(
      systemParts,
      messages,
      tools
    );

    let apiResponse;
    try {
      apiResponse = await provider.call(apiKey, formattedRequest);
    } catch (err) {
      console.error(`  LLM API error on turn ${turns}: ${err.message}`);
      return {
        success: false,
        error: err.message,
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      };
    }

    const parsed = provider.parseResponse(apiResponse);

    if (parsed.usage) {
      totalInputTokens += parsed.usage.input_tokens;
      totalOutputTokens += parsed.usage.output_tokens;
      console.log(`    Tokens — in: ${parsed.usage.input_tokens}, out: ${parsed.usage.output_tokens}`);
    }

    if (parsed.text) {
      for (const line of parsed.text.split('\n')) {
        console.log(`    ${line}`);
      }
    }

    messages.push(provider.formatAssistantMessage(parsed.raw));

    if (parsed.done || parsed.toolCalls.length === 0) {
      console.log(`  Total tokens — in: ${totalInputTokens}, out: ${totalOutputTokens}`);
      return {
        success: true,
        summary: parsed.text || "Changes implemented",
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      };
    }

    const toolResults = [];

    for (const toolCall of parsed.toolCalls) {
      const params = formatToolParams(toolCall.name, toolCall.input);
      console.log(`    Tool: ${toolCall.name}${params ? ` — ${params}` : ""}`);

      const result = await executeTool(
        project.name,
        toolCall.name,
        toolCall.input
      );

      if (result.done) {
        console.log(`  Total tokens — in: ${totalInputTokens}, out: ${totalOutputTokens}`);
        return {
          success: true,
          title: result.title,
          summary: result.summary,
          usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
        };
      }

      toolResults.push({
        id: toolCall.id,
        name: toolCall.name,
        content: JSON.stringify(result),
      });
    }

    messages.push(provider.formatToolResults(toolResults));
  }

  console.log(`  Total tokens — in: ${totalInputTokens}, out: ${totalOutputTokens}`);
  return {
    success: false,
    error: `Agent exceeded maximum turns (${maxTurns})`,
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
  };
}

/**
 * Run the agent loop: send messages, execute tools, repeat until done.
 * Returns { success, title, summary, error, usage }.
 */
export async function runAgent(project, request) {
  const agentContext = await loadAgentContext(project.name);
  const systemPrompt = buildSystemPrompt(project, agentContext);

  const currentSpec = request.spec[request.spec.length - 1];
  let userText;

  if (request.spec.length > 1) {
    const priorSpecs = request.spec.slice(0, -1);
    const priorSummaries = request.attempts
      .filter((a) => a.status === "succeeded" && a.summary)
      .map((a) => a.summary);

    let context = "## Prior work on this branch\n\n";
    context += "Previous specs implemented:\n";
    for (const spec of priorSpecs) {
      context += `- v${spec.version}: ${spec.description}\n`;
    }
    if (priorSummaries.length > 0) {
      context += "\nWhat was done:\n";
      for (const summary of priorSummaries) {
        context += `- ${summary}\n`;
      }
    }
    context += "\nThose changes are already committed on this branch. Do NOT redo or revert them.\n";

    userText = `${context}\n## New amendment (v${currentSpec.version})\n\nPlease implement the following additional change:\n\n${currentSpec.description}\n\nStart by reviewing the existing changes (use view_diff or read relevant files) to understand what has already been done, then implement the new change.`;
  } else {
    userText = `Please implement the following change:\n\n${currentSpec.description}\n\nStart by exploring the project structure to understand the codebase.`;
  }

  return agentLoop(project, systemPrompt, userText, TOOLS);
}

// Read-only tools for the context agent
const CONTEXT_TOOLS = TOOLS.filter((t) =>
  ["read_file", "list_directory", "search_files", "find_files", "get_file_info", "execute_command", "done"].includes(t.name)
);

/**
 * Build the system prompt parts for the context-generation agent.
 */
function buildContextSystemPrompt(project) {
  return [`You are ${APP_NAME}, an autonomous development agent. You are analyzing a project to generate an agent context file that will guide future development work.

## Project
- Name: ${project.name}
- Repository: ${project.repo}
- Default branch: ${project.default_branch || "main"}

## Your Task

Explore this project and produce a comprehensive markdown document (the "agent context") that will be included in the system prompt for all future ${APP_NAME} requests against this project. The goal is to give a future coding agent everything it needs to work effectively in this codebase without re-discovering it each time.

## What to Include

The output should be a well-structured markdown document covering:

1. **Project overview** — what the project does, in one or two sentences.
2. **Tech stack** — language(s), framework(s), runtime, key dependencies.
3. **Repository structure** — brief map of important directories and what they contain.
4. **Build & run commands** — how to install dependencies, build, run, and test.
5. **Code conventions** — module system (ESM/CJS), naming patterns, file organization, import style.
6. **Testing** — test framework, how to run tests, where tests live, any test conventions.
7. **Any project-specific patterns** — e.g., architecture patterns (MVC, plugin system), config files the agent should know about, CI/CD details visible in the repo.

## Rules

- Do NOT include generic advice that applies to all projects. Be specific to THIS codebase.
- Keep it concise — aim for a document that's useful as quick reference, not an exhaustive wiki.
- Use markdown headers and bullet points for easy scanning.
- Do NOT use git commands.
- When you are done, call the "done" tool. Put a short title in the "title" field and put the full markdown document in the "summary" field.`];
}

/**
 * Run the context-generation agent. Explores the project and returns
 * a tailored agent-context.md document.
 * Returns { success, content, error }.
 */
export async function runContextAgent(project) {
  const systemPrompt = buildContextSystemPrompt(project);
  const userText = `Analyze this project and generate the agent context document. Start by exploring the project structure, then read key files (README, package.json, config files, a few source files, test files, etc.) to understand the codebase.`;

  const result = await agentLoop(project, systemPrompt, userText, CONTEXT_TOOLS, 30);

  if (!result.success) return result;

  return {
    success: true,
    content: result.summary,
    usage: result.usage,
  };
}
