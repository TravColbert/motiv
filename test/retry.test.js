import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { fetchWithRetry } from "../src/providers/retry.js";

function mockResponse(status, body = "", headers = {}) {
  return new Response(body, {
    status,
    headers: new Headers(headers),
  });
}

describe("fetchWithRetry", () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  test("returns immediately on 200", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return mockResponse(200, '{"ok":true}');
    };

    const response = await fetchWithRetry("http://test.com", {});
    expect(response.status).toBe(200);
    expect(callCount).toBe(1);
  });

  test("returns immediately on non-retryable error (400)", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return mockResponse(400, "Bad request");
    };

    const response = await fetchWithRetry("http://test.com", {});
    expect(response.status).toBe(400);
    expect(callCount).toBe(1);
  });

  test("returns immediately on non-retryable error (401)", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return mockResponse(401, "Unauthorized");
    };

    const response = await fetchWithRetry("http://test.com", {});
    expect(response.status).toBe(401);
    expect(callCount).toBe(1);
  });

  test("retries on 429 and succeeds", async () => {
    console.error = () => {};
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) return mockResponse(429, "Rate limited");
      return mockResponse(200, '{"ok":true}');
    };

    const response = await fetchWithRetry("http://test.com", {}, { maxRetries: 3 });
    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("retries on 500 and succeeds", async () => {
    console.error = () => {};
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount <= 2) return mockResponse(500, "Internal error");
      return mockResponse(200, '{"ok":true}');
    };

    const response = await fetchWithRetry("http://test.com", {}, { maxRetries: 3 });
    expect(response.status).toBe(200);
    expect(callCount).toBe(3);
  });

  test("retries on 529 (overloaded)", async () => {
    console.error = () => {};
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) return mockResponse(529, "Overloaded");
      return mockResponse(200, '{"ok":true}');
    };

    const response = await fetchWithRetry("http://test.com", {}, { maxRetries: 2 });
    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("gives up after max retries and returns last response", async () => {
    console.error = () => {};
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return mockResponse(429, "Rate limited");
    };

    const response = await fetchWithRetry("http://test.com", {}, { maxRetries: 2 });
    expect(response.status).toBe(429);
    expect(callCount).toBe(3); // initial + 2 retries
  });

  test("respects retry-after header", async () => {
    console.error = () => {};
    const timestamps = [];
    globalThis.fetch = async () => {
      timestamps.push(Date.now());
      if (timestamps.length === 1) {
        return mockResponse(429, "Rate limited", { "retry-after": "1" });
      }
      return mockResponse(200, '{"ok":true}');
    };

    const response = await fetchWithRetry("http://test.com", {}, { maxRetries: 2 });
    expect(response.status).toBe(200);
    expect(timestamps.length).toBe(2);
    const elapsed = timestamps[1] - timestamps[0];
    expect(elapsed).toBeGreaterThanOrEqual(900); // ~1s with some tolerance
  });

  test("logs retry messages to stderr", async () => {
    const logged = [];
    console.error = (...args) => logged.push(args.join(" "));

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) return mockResponse(429, "Rate limited");
      return mockResponse(200, '{"ok":true}');
    };

    await fetchWithRetry("http://test.com", {}, { maxRetries: 2 });
    expect(logged.length).toBe(1);
    expect(logged[0]).toContain("Rate limited");
    expect(logged[0]).toContain("attempt 1/2");
  });

  test("logs server error message for 500", async () => {
    const logged = [];
    console.error = (...args) => logged.push(args.join(" "));

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) return mockResponse(500, "Internal error");
      return mockResponse(200, '{"ok":true}');
    };

    await fetchWithRetry("http://test.com", {}, { maxRetries: 2 });
    expect(logged.length).toBe(1);
    expect(logged[0]).toContain("Server error (500)");
  });

  test("passes through fetch options", async () => {
    let capturedOptions;
    globalThis.fetch = async (_url, options) => {
      capturedOptions = options;
      return mockResponse(200, "ok");
    };

    await fetchWithRetry("http://test.com", {
      method: "POST",
      headers: { "x-api-key": "test" },
      body: '{"data":true}',
    });

    expect(capturedOptions.method).toBe("POST");
    expect(capturedOptions.headers["x-api-key"]).toBe("test");
    expect(capturedOptions.body).toBe('{"data":true}');
  });

  test("with maxRetries 0, does not retry", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return mockResponse(429, "Rate limited");
    };

    const response = await fetchWithRetry("http://test.com", {}, { maxRetries: 0 });
    expect(response.status).toBe(429);
    expect(callCount).toBe(1);
  });
});
