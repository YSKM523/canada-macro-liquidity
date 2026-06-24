export interface FetchRetryOpts {
  retries?: number;
  delayMs?: number; // per-attempt delay multiplier in ms (default 250; set 0 in tests)
}

/**
 * Wraps fetch with retry-on-transient logic.
 *
 * - 5xx responses and network errors are retried up to `retries` times (default 2).
 * - 4xx responses are NOT retried (client errors are not transient).
 * - After exhausting retries, returns the last Response or rethrows the last network error.
 * - Backoff: `delayMs * attempt` ms before each retry (attempt = 1, 2, ...).
 */
export async function fetchRetry(
  url: string,
  init?: RequestInit,
  opts?: FetchRetryOpts,
): Promise<Response> {
  const retries = opts?.retries ?? 2;
  const delayMs = opts?.delayMs ?? 250;

  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0 && delayMs > 0) {
      await new Promise<void>(r => setTimeout(r, delayMs * attempt));
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      lastError = err;
      // network error — retry
      continue;
    }

    if (response.status < 500) {
      // includes 2xx, 3xx, 4xx — all non-transient; return immediately
      return response;
    }

    // 5xx — transient; remember and retry
    lastResponse = response;
    lastError = undefined;
  }

  // Exhausted retries
  if (lastError !== undefined) throw lastError;
  return lastResponse!;
}
