import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as claude from "../src/providers/claude.js";
import * as gemini from "../src/providers/gemini.js";
import { getProvider } from "../src/providers/index.js";

// Sample tool definition in agentium's internal format
const SAMPLE_TOOLS = [
  {
    name: "read_file",
    description: "Read a file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
      },
      required: ["path"],
    },
  },
  {
    name: "done",
    description: "Signal completion",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Summary" },
      },
      required: ["summary"],
    },
  },
];

// --- Claude Provider ---

describe("claude provider", () => {
  test("credentialName is ANTHROPIC_API_KEY", () => {
    expect(claude.credentialName).toBe("ANTHROPIC_API_KEY");
  });

  test("formatTools passes through directly", () => {
    const result = claude.formatTools(SAMPLE_TOOLS);
    expect(result).toEqual(SAMPLE_TOOLS);
  });

  test("formatRequest produces correct shape", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = claude.formatRequest("system prompt", messages, SAMPLE_TOOLS);

    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.system).toBe("system prompt");
    expect(result.messages).toEqual(messages);
    expect(result.tools).toEqual(SAMPLE_TOOLS);
    expect(result.max_tokens).toBe(16384);
  });

  test("formatUserMessage produces correct shape", () => {
    const result = claude.formatUserMessage("hello world");
    expect(result).toEqual({ role: "user", content: "hello world" });
  });

  test("formatAssistantMessage wraps content", () => {
    const content = [{ type: "text", text: "hi" }];
    const result = claude.formatAssistantMessage(content);
    expect(result).toEqual({ role: "assistant", content });
  });

  test("formatToolResults produces tool_result blocks", () => {
    const results = [
      { id: "tool_1", name: "read_file", content: '{"content":"hello"}' },
    ];
    const msg = claude.formatToolResults(results);
    expect(msg.role).toBe("user");
    expect(msg.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: '{"content":"hello"}',
      },
    ]);
  });

  test("parseResponse extracts text-only response", () => {
    const apiResponse = {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "All done" }],
    };
    const parsed = claude.parseResponse(apiResponse);
    expect(parsed.text).toBe("All done");
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.done).toBe(true);
  });

  test("parseResponse extracts tool calls", () => {
    const apiResponse = {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Let me read that file" },
        {
          type: "tool_use",
          id: "tool_abc",
          name: "read_file",
          input: { path: "README.md" },
        },
      ],
    };
    const parsed = claude.parseResponse(apiResponse);
    expect(parsed.text).toBe("Let me read that file");
    expect(parsed.toolCalls).toEqual([
      { id: "tool_abc", name: "read_file", input: { path: "README.md" } },
    ]);
    expect(parsed.done).toBe(false);
  });

  test("parseResponse handles multiple tool calls", () => {
    const apiResponse = {
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "read_file",
          input: { path: "a.js" },
        },
        {
          type: "tool_use",
          id: "t2",
          name: "read_file",
          input: { path: "b.js" },
        },
      ],
    };
    const parsed = claude.parseResponse(apiResponse);
    expect(parsed.toolCalls.length).toBe(2);
    expect(parsed.toolCalls[0].id).toBe("t1");
    expect(parsed.toolCalls[1].id).toBe("t2");
    expect(parsed.done).toBe(false);
  });
});

// --- Gemini Provider ---

describe("gemini provider", () => {
  test("credentialName is GEMINI_API_KEY", () => {
    expect(gemini.credentialName).toBe("GEMINI_API_KEY");
  });

  test("formatTools produces functionDeclarations", () => {
    const result = gemini.formatTools(SAMPLE_TOOLS);
    expect(result).toEqual([
      {
        functionDeclarations: [
          {
            name: "read_file",
            description: "Read a file",
            parameters: SAMPLE_TOOLS[0].input_schema,
          },
          {
            name: "done",
            description: "Signal completion",
            parameters: SAMPLE_TOOLS[1].input_schema,
          },
        ],
      },
    ]);
  });

  test("formatRequest produces correct shape", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = gemini.formatRequest("system prompt", messages, SAMPLE_TOOLS);

    expect(result.systemInstruction).toEqual({
      parts: [{ text: "system prompt" }],
    });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].role).toBe("user");
    expect(result.contents[0].parts).toEqual([{ text: "hello" }]);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].functionDeclarations).toHaveLength(2);
    expect(result.generationConfig.maxOutputTokens).toBe(16384);
  });

  test("formatRequest converts assistant role to model", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];
    const result = gemini.formatRequest("sys", messages, SAMPLE_TOOLS);
    expect(result.contents[1].role).toBe("model");
  });

  test("formatUserMessage produces correct shape", () => {
    const result = gemini.formatUserMessage("hello world");
    expect(result).toEqual({ role: "user", content: "hello world" });
  });

  test("formatToolResults produces functionResponse blocks", () => {
    const results = [
      { id: "g1", name: "read_file", content: '{"content":"hello"}' },
    ];
    const msg = gemini.formatToolResults(results);
    expect(msg.role).toBe("user");
    expect(msg.content).toEqual([
      {
        type: "tool_result",
        _name: "read_file",
        content: '{"content":"hello"}',
      },
    ]);
  });

  test("parseResponse extracts text-only response", () => {
    const apiResponse = {
      candidates: [
        {
          content: { parts: [{ text: "All done" }] },
          finishReason: "STOP",
        },
      ],
    };
    const parsed = gemini.parseResponse(apiResponse);
    expect(parsed.text).toBe("All done");
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.done).toBe(true);
  });

  test("parseResponse extracts function calls", () => {
    const apiResponse = {
      candidates: [
        {
          content: {
            parts: [
              { text: "Let me read that" },
              {
                functionCall: {
                  name: "read_file",
                  args: { path: "README.md" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };
    const parsed = gemini.parseResponse(apiResponse);
    expect(parsed.text).toBe("Let me read that");
    expect(parsed.toolCalls.length).toBe(1);
    expect(parsed.toolCalls[0].name).toBe("read_file");
    expect(parsed.toolCalls[0].input).toEqual({ path: "README.md" });
    expect(parsed.toolCalls[0].id).toMatch(/^gemini_call_/);
    expect(parsed.done).toBe(false);
  });

  test("parseResponse handles multiple function calls", () => {
    const apiResponse = {
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "read_file", args: { path: "a.js" } } },
              { functionCall: { name: "read_file", args: { path: "b.js" } } },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };
    const parsed = gemini.parseResponse(apiResponse);
    expect(parsed.toolCalls.length).toBe(2);
    expect(parsed.done).toBe(false);
  });

  test("parseResponse throws on empty candidates", () => {
    expect(() => gemini.parseResponse({ candidates: [] })).toThrow(
      /no candidates/
    );
  });
});

// --- Provider Factory ---

describe("getProvider", () => {
  let originalProvider;

  beforeEach(() => {
    originalProvider = process.env.LLM_PROVIDER;
  });

  afterEach(() => {
    if (originalProvider !== undefined) {
      process.env.LLM_PROVIDER = originalProvider;
    } else {
      delete process.env.LLM_PROVIDER;
    }
  });

  test("defaults to claude", () => {
    delete process.env.LLM_PROVIDER;
    const provider = getProvider();
    expect(provider.credentialName).toBe("ANTHROPIC_API_KEY");
  });

  test("returns claude when configured", () => {
    process.env.LLM_PROVIDER = "claude";
    const provider = getProvider();
    expect(provider.credentialName).toBe("ANTHROPIC_API_KEY");
  });

  test("returns gemini when configured", () => {
    process.env.LLM_PROVIDER = "gemini";
    const provider = getProvider();
    expect(provider.credentialName).toBe("GEMINI_API_KEY");
  });

  test("is case-insensitive", () => {
    process.env.LLM_PROVIDER = "Gemini";
    const provider = getProvider();
    expect(provider.credentialName).toBe("GEMINI_API_KEY");
  });

  test("throws for unknown provider", () => {
    process.env.LLM_PROVIDER = "gpt5";
    expect(() => getProvider()).toThrow(/Unknown LLM provider/);
  });
});
