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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      return response;
    }

    lastResponse = response;

    if (attempt < maxRetries) {
      const delayMs = getRetryDelay(response, attempt);
      const delaySec = (delayMs / 1000).toFixed(1);
      const reason = response.status === 429 ? "Rate limited" : `Server error (${response.status})`;
      console.error(`  ${reason}, retrying in ${delaySec}s (attempt ${attempt + 1}/${maxRetries})...`);
      await sleep(delayMs);
    }
  }

  return lastResponse;
}
