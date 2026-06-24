import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchRetry } from '../src/http';

// Minimal fake Response factory
function fakeResp(status: number): Response {
  return { status, ok: status < 400 } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchRetry', () => {
  it('(a) returns 200 after two 520s (retries=2)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      if (calls <= 2) return fakeResp(520);
      return fakeResp(200);
    });

    const r = await fetchRetry('https://example.com', undefined, { retries: 2, delayMs: 0 });
    expect(r.status).toBe(200);
    expect(calls).toBe(3); // attempt 0 (520) + attempt 1 (520) + attempt 2 (200)
  });

  it('(b) returns 404 immediately without retrying (4xx is not transient)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return fakeResp(404);
    });

    const r = await fetchRetry('https://example.com', undefined, { retries: 2, delayMs: 0 });
    expect(r.status).toBe(404);
    expect(calls).toBe(1);
  });

  it('(c) recovers when fetch throws twice then resolves', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      if (calls <= 2) throw new TypeError('network error');
      return fakeResp(200);
    });

    const r = await fetchRetry('https://example.com', undefined, { retries: 2, delayMs: 0 });
    expect(r.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('rethrows last network error when all attempts throw', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('connection refused'); });

    await expect(
      fetchRetry('https://example.com', undefined, { retries: 2, delayMs: 0 })
    ).rejects.toThrow('connection refused');
  });

  it('returns last 5xx response when all retries exhausted without network error', async () => {
    vi.stubGlobal('fetch', async () => fakeResp(503));

    const r = await fetchRetry('https://example.com', undefined, { retries: 2, delayMs: 0 });
    expect(r.status).toBe(503);
  });

  it('does not retry on 400 (client error)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return fakeResp(400);
    });

    const r = await fetchRetry('https://example.com', undefined, { retries: 2, delayMs: 0 });
    expect(r.status).toBe(400);
    expect(calls).toBe(1);
  });

  it('uses default retries=2 when opts not specified', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return fakeResp(520);
    });

    // Will exhaust 3 attempts total (0,1,2) with default retries=2 and return 520
    const r = await fetchRetry('https://example.com', undefined, { delayMs: 0 });
    expect(r.status).toBe(520);
    expect(calls).toBe(3);
  });
});
