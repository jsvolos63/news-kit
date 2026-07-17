import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyRace, PUBLIC_CORS_PROXIES } from '../index.js';

const FEED = '<rss><channel><item><title>x</title></item></channel></rss>';

function mockFetch(map) {
  // map: proxiedUrl substring -> { ok, body } | () => Promise
  return async (url) => {
    for (const [needle, resp] of Object.entries(map)) {
      if (url.includes(needle)) {
        const r = typeof resp === 'function' ? await resp() : resp;
        return { ok: r.ok !== false, status: r.status || 200, text: async () => r.body || '' };
      }
    }
    throw new Error(`no mock for ${url}`);
  };
}

test('returns the first proxy that yields a usable feed', async () => {
  const fetchImpl = mockFetch({
    codetabs: { body: FEED },
    allorigins: { body: FEED },
    'corsproxy.io': { body: FEED },
  });
  const { text, via } = await proxyRace('https://feed.example/rss', { proxies: PUBLIC_CORS_PROXIES, fetchImpl, timeoutMs: 500 });
  assert.equal(text, FEED);
  assert.match(via, /^proxy:\d$/);
});

test('skips empty bodies and falls through to a populated proxy', async () => {
  const fetchImpl = mockFetch({
    codetabs: { body: '<rss></rss>' }, // 0 items -> rejected
    allorigins: { body: '<rss></rss>' },
    'corsproxy.io': { body: FEED },
  });
  const { text } = await proxyRace('https://feed.example/rss', { proxies: PUBLIC_CORS_PROXIES, fetchImpl, timeoutMs: 500 });
  assert.equal(text, FEED);
});

test('rejects when every transport fails', async () => {
  const fetchImpl = mockFetch({
    codetabs: { ok: false, status: 502 },
    allorigins: { ok: false, status: 500 },
    'corsproxy.io': { body: '' },
  });
  await assert.rejects(
    proxyRace('https://feed.example/rss', { proxies: PUBLIC_CORS_PROXIES, fetchImpl, timeoutMs: 500 }),
  );
});

test('throws without an explicit proxies/originProxy opt-in', async () => {
  // Public CORS proxies leak every fetched URL to a third party, so they must
  // never be a silent default.
  await assert.rejects(
    proxyRace('https://feed.example/rss', { fetchImpl: async () => ({}) }),
    /opt-in|originProxy/,
  );
});

test('originProxy alone (no public proxies) is a valid configuration', async () => {
  const fetchImpl = mockFetch({ 'my.origin': { body: FEED } });
  const { via } = await proxyRace('https://feed.example/rss', {
    originProxy: (u) => `https://my.origin/api/feed?url=${encodeURIComponent(u)}`,
    originDelayMs: 0,
    fetchImpl,
    timeoutMs: 500,
  });
  assert.equal(via, 'origin');
});

test('uses a custom proxy list', async () => {
  const fetchImpl = mockFetch({ myproxy: { body: FEED } });
  const { via } = await proxyRace('https://feed.example/rss', {
    proxies: [(u) => `https://myproxy/?u=${encodeURIComponent(u)}`],
    fetchImpl,
    timeoutMs: 500,
  });
  assert.equal(via, 'proxy:0');
});

test('per-attempt timeout still applies without AbortSignal.any/timeout', async () => {
  // Regression: the mergeSignals fallback used to `return a`, dropping the
  // timeout signal — and with AbortSignal.timeout missing there was no
  // timeout signal at all. Simulate an old engine by removing both statics.
  const savedAny = AbortSignal.any;
  const savedTimeout = AbortSignal.timeout;
  delete AbortSignal.any;
  delete AbortSignal.timeout;
  try {
    // A fetch that never resolves on its own but rejects when aborted.
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
      if (signal) {
        if (signal.aborted) return reject(new Error('aborted'));
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }
    });
    const started = Date.now();
    await assert.rejects(
      proxyRace('https://feed.example/rss', { proxies: PUBLIC_CORS_PROXIES, fetchImpl, timeoutMs: 100 }),
    );
    // Without a working timeout signal this promise never settles (the test
    // would hang to its own timeout); settling quickly proves the abort fired.
    assert.ok(Date.now() - started < 5000);
  } finally {
    AbortSignal.any = savedAny;
    AbortSignal.timeout = savedTimeout;
  }
});
