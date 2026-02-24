const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;

const RETRYABLE_STATUS_CODES = new Set([429, 529, 500, 502, 503, 504]);

function isRetryable(status) {
  return RETRYABLE_STATUS_CODES.has(status);
}

function getRetryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_DELAY_MS);
    }
  }
  // Exponential backoff with jitter: base * 2^attempt * (0.5–1.0)
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(exponential * jitter, MAX_DELAY_MS);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a duration string like "1m30s", "45s", "2m" into milliseconds.
 */
function parseDuration(str) {
  if (!str) return null;
  let ms = 0;
  const minutes = str.match(/(\d+(?:\.\d+)?)m(?!s)/);
  const seconds = str.match(/(\d+(?:\.\d+)?)s/);
  const millis = str.match(/(\d+(?:\.\d+)?)ms/);
  if (minutes) ms += parseFloat(minutes[1]) * 60000;
  if (seconds) ms += parseFloat(seconds[1]) * 1000;
  if (millis) ms += parseFloat(millis[1]);
  return ms || null;
}

/**
 * Extract rate limit info from response headers.
 */
function extractRateLimit(response) {
  const get = (name) => response.headers.get(name);
  return {
    remainingTokens: get("x-ratelimit-remaining-tokens") ? Number(get("x-ratelimit-remaining-tokens")) : null,
    remainingRequests: get("x-ratelimit-remaining-requests") ? Number(get("x-ratelimit-remaining-requests")) : null,
    resetTokens: parseDuration(get("x-ratelimit-reset-tokens")),
    resetRequests: parseDuration(get("x-ratelimit-reset-requests")),
  };
}

/**
 * Wrapper around fetch that retries on transient errors (429, 529, 5xx)
 * with exponential backoff and retry-after header support.
 */
export async function fetchWithRetry(url, options, { maxRetries = MAX_RETRIES } = {}) {
  let lastResponse;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.ok || !isRetryable(response.status)) {
      return { response, rateLimit: extractRateLimit(response) };
    }

    lastResponse = response;

    if (attempt < maxRetries) {
      const delayMs = getRetryDelay(response, attempt);
      const delaySec = (delayMs / 1000).toFixed(1);
      const reason = response.status === 429 ? "Rate limited" : `Server error (${response.status})`;
      console.error(`  ${reason}, retrying in ${delaySec}s (attempt ${attempt + 1}/${maxRetries})...`);
      try {
        const body = await response.text();
        if (body) {
          const truncated = body.length > 500 ? body.slice(0, 500) + "..." : body;
          console.error(`    Response: ${truncated}`);
        }
      } catch {
        // Ignore if body can't be read
      }
      await sleep(delayMs);
    }
  }

  return { response: lastResponse, rateLimit: extractRateLimit(lastResponse) };
}
