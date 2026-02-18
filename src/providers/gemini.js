const API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.5-pro";
const MAX_TOKENS = 16384;

/**
 * The credential environment variable name this provider needs.
 */
export const credentialName = "GEMINI_API_KEY";

/**
 * Convert agentium tool definitions to Gemini's functionDeclarations format.
 *
 * Agentium format:
 *   { name, description, input_schema: { type, properties, required } }
 *
 * Gemini format:
 *   { functionDeclarations: [{ name, description, parameters: { type, properties, required } }] }
 */
export function formatTools(tools) {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      })),
    },
  ];
}

/**
 * Format a request for the Gemini API.
 *
 * Gemini uses `contents` instead of `messages`, `systemInstruction` instead of `system`,
 * and roles "user" / "model" instead of "user" / "assistant".
 */
export function formatRequest(systemPrompt, messages, tools) {
  const contents = messages.map((msg) => convertMessage(msg));

  return {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    tools: formatTools(tools),
    generationConfig: {
      maxOutputTokens: MAX_TOKENS,
    },
  };
}

/**
 * Convert an internal message to Gemini's content format.
 */
function convertMessage(msg) {
  const role = msg.role === "assistant" ? "model" : "user";

  // Simple string content
  if (typeof msg.content === "string") {
    return { role, parts: [{ text: msg.content }] };
  }

  // Array content (Claude-style tool_use / tool_result blocks)
  if (Array.isArray(msg.content)) {
    const parts = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "tool_use") {
        parts.push({
          functionCall: {
            name: block.name,
            args: block.input,
          },
        });
      } else if (block.type === "tool_result") {
        parts.push({
          functionResponse: {
            name: block._name || "tool",
            response: { content: block.content },
          },
        });
      }
    }
    return { role, parts };
  }

  return { role, parts: [{ text: String(msg.content) }] };
}

/**
 * Format an assistant message for appending to the conversation.
 * Stores the raw Gemini parts so we can send them back correctly.
 */
export function formatAssistantMessage(rawContent) {
  // rawContent is the Gemini candidates[0].content.parts array
  return { role: "assistant", content: rawContent };
}

/**
 * Format tool results to send back as a user message.
 * Gemini expects functionResponse parts.
 */
export function formatToolResults(toolResults) {
  return {
    role: "user",
    content: toolResults.map((r) => ({
      type: "tool_result",
      _name: r.name,
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
  const candidate = apiResponse.candidates?.[0];
  if (!candidate) {
    throw new Error("Gemini returned no candidates");
  }

  const parts = candidate.content?.parts || [];

  const textParts = parts.filter((p) => p.text);
  const functionCallParts = parts.filter((p) => p.functionCall);

  const text = textParts.map((p) => p.text).join("\n") || null;

  // Gemini doesn't provide tool_use IDs like Claude does.
  // We generate synthetic IDs so the agent loop can track them.
  const toolCalls = functionCallParts.map((p, i) => ({
    id: `gemini_call_${Date.now()}_${i}`,
    name: p.functionCall.name,
    input: p.functionCall.args || {},
  }));

  const finishReason = candidate.finishReason;
  const done = finishReason === "STOP" && toolCalls.length === 0;

  return {
    text,
    toolCalls,
    done,
    raw: parts,
  };
}

/**
 * Make the API call to Gemini.
 */
export async function call(apiKey, formattedRequest) {
  const url = `${API_URL}/${MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(formattedRequest),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  return response.json();
}
