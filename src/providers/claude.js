import { fetchWithRetry } from "./retry.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 16384;

/**
 * The credential environment variable name this provider needs.
 */
export const credentialName = "ANTHROPIC_API_KEY";

/**
 * Convert agentium tool definitions to Claude's format.
 * Claude uses `input_schema` which matches our internal format directly.
 */
export function formatTools(tools) {
  return tools;
}

/**
 * Format a request for the Claude Messages API.
 */
export function formatRequest(systemPrompt, messages, tools) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    tools: formatTools(tools),
    messages,
  };
}

/**
 * Format an assistant message for appending to the conversation.
 * Returns the message in the provider's native shape.
 */
export function formatAssistantMessage(content) {
  return { role: "assistant", content };
}

/**
 * Format tool results to send back as a user message.
 */
export function formatToolResults(toolResults) {
  return {
    role: "user",
    content: toolResults.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: r.content,
    })),
  };
}

/**
 * Format the initial user message.
 */
export function formatUserMessage(text) {
  return { role: "user", content: text };
}

/**
 * Parse the API response into a normalized shape.
 * Returns { text, toolCalls: [{ id, name, input }], done: bool, raw }
 */
export function parseResponse(apiResponse) {
  const textBlocks = apiResponse.content.filter((c) => c.type === "text");
  const toolBlocks = apiResponse.content.filter((c) => c.type === "tool_use");

  const text = textBlocks.map((b) => b.text).join("\n") || null;
  const toolCalls = toolBlocks.map((b) => ({
    id: b.id,
    name: b.name,
    input: b.input,
  }));

  const done = apiResponse.stop_reason === "end_turn" && toolCalls.length === 0;

  return {
    text,
    toolCalls,
    done,
    raw: apiResponse.content,
  };
}

/**
 * Make the API call to Claude.
 */
export async function call(apiKey, formattedRequest) {
  const response = await fetchWithRetry(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(formattedRequest),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  return response.json();
}
