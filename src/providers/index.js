import * as claude from "./claude.js";
import * as gemini from "./gemini.js";

const providers = {
  claude,
  gemini,
};

/**
 * Get the configured LLM provider.
 * Reads LLM_PROVIDER from environment. Defaults to "claude".
 *
 * Returns a provider module with:
 *   - credentialName: string
 *   - formatRequest(systemPrompt, messages, tools)
 *   - formatAssistantMessage(rawContent)
 *   - formatToolResults(toolResults)
 *   - formatUserMessage(text)
 *   - parseResponse(apiResponse)
 *   - call(apiKey, formattedRequest)
 */
export function getProvider() {
  const name = (process.env.LLM_PROVIDER || "claude").toLowerCase();
  const provider = providers[name];

  if (!provider) {
    const available = Object.keys(providers).join(", ");
    throw new Error(
      `Unknown LLM provider: "${name}". Available providers: ${available}`
    );
  }

  return provider;
}
