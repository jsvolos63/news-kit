// @jfs/news-kit — single-file bundle of all modules.
// Shared, dependency-free news primitives. Pure ESM, no runtime deps.
// (Concatenated from the per-module sources; internal imports removed.)

// ===================== decode-entities =====================
// HTML entity decoding for feed text.
//
// Every repo that parses RSS with regex (BearsMockDraft, Surf-Tracker server)
// ships its own copy of this, and BearsMockDraft's author left a comment
// warning that the `&amp;` rule MUST run last or you double-decode. This is the
// single canonical copy that gets that ordering right.

const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
};

/** Decode numeric (`&#39;` / `&#x27;`) and the common named entities. The literal
 *  `&amp;` -> `&` substitution is applied LAST so an already-decoded ampersand is
 *  never re-interpreted (e.g. `&amp;lt;` decodes to `&lt;`, not `<`). */
export function decodeEntities(s) {
  if (s == null) return '';
  let out = String(s)
    // Numeric decimal: &#39;
    .replace(/&#(\d+);/g, (_, n) => safeFromCodePoint(parseInt(n, 10)))
    // Numeric hex: &#x27;
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => safeFromCodePoint(parseInt(n, 16)))
    // Named entities, excluding amp (handled last).
    .replace(/&([a-zA-Z]+);/g, (m, name) => {
      const key = name.toLowerCase();
      if (key === 'amp') return m; // defer
      return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : m;
    });
  // Ampersand last.
  out = out.replace(/&amp;/g, '&');
  return out;
}

function safeFromCodePoint(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

// ===================== escape =====================
// HTML escaping + URL sanitization.
//
// Consolidates the four near-identical copies across the repos:
//   - market-monitor  js/utils/escape.js  (escHtml, safeUrl)
//   - JFS-Sports      helpers.js          (escapeHtml, sanitizeUrl, sanitizeHref)
//   - BearsMockDraft  js/shared.js        (escapeText, escapeAttr, safeUrl)
//
// JFS-Sports is the only one that correctly splits the two URL use-cases, so
// that distinction is preserved here:
//   - safeContentUrl()     -> normalized href string, NOT HTML-escaped. Use for
//                             the DOM APIs (el.setAttribute('href', ...),
//                             el.href, el.src) where the browser stores the
//                             value verbatim; escaping would double-encode `&`.
//   - safeContentUrlAttr() -> HTML-escaped href, ready to drop into an
//                             innerHTML template literal:
//                             `<a href="${safeContentUrlAttr(u)}">`.
//
// FAMILY NAMING RULE: the generic DOM-safety names (escapeHtml, safeUrl,
// sanitizeUrl, sanitizeHref, sanitizeHtml) belong to @jfs/dom-kit, with
// dom-kit's permissive contracts (e.g. its safeUrl returns '#' on reject and
// allows mailto:). news-kit's guards are strict feed-content validators, so
// they live under content-scoped names (safeContentUrl, safeContentUrlAttr,
// isSafeContentUrl, sanitizeHtmlToFragment) — exporting the same name with a
// different contract from two kits is deliberately avoided.

/** Escape the five HTML-significant characters. Safe for text nodes and for
 *  values placed inside either single- or double-quoted attributes. */
export function escHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Validate a URL and return its normalized absolute href, or null when it is
 *  not a syntactically valid http(s) URL. Blocks javascript:, data:, vbscript:,
 *  mailto:, relative paths, credentials and non-standard schemes. */
export function safeContentUrl(u) {
  if (!u || typeof u !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

/** Same validation as safeContentUrl(), but HTML-escaped for `innerHTML`
 *  interpolation. Returns '' (not null) so it slots cleanly into a template
 *  literal. */
export function safeContentUrlAttr(u) {
  const href = safeContentUrl(u);
  return href ? escHtml(href) : '';
}

// ===================== classify =====================
// Keyword classification into signal buckets.
//
// Surf-Tracker's 6-bucket model is the default because `signalPriority` feeds
// both dedup ordering and UI sort. The engine is config-driven via
// makeClassifier(), so each app supplies its own vocabulary:
//   - BearsMockDraft: topic buckets (stadium, injury, draft, ...)
//   - market-monitor: tag buckets (RATES, INFLATION, EARNINGS, ...)
// while sharing one tested matcher and retiring their copy-pasted classify()s.

/** Default signal buckets (Surf-Tracker), first match wins. */
export const DEFAULT_SIGNALS = [
  ['ipo', [/\bIPO\b/, /\bfiles?\s+(to\s+go\s+public|for\s+(an\s+)?IPO)\b/i, /\bgo(es|ing)?\s+public\b/i, /\bdirect\s+listing\b/i]],
  ['funding', [/\braises?\b/i, /\bseries\s+[a-h]\b/i, /\bfunding\s+round\b/i, /\bvaluation\b/i, /\bled\s+by\b.*\b(capital|ventures|partners)\b/i]],
  ['financial', [/\bearnings\b/i, /\bQ[1-4]\s+20\d{2}\b/i, /\brevenue\s+(grew|growth|rose|fell|up|down)/i, /\bguidance\b/i, /\bprofit(?:ability)?\b/i]],
  ['leadership', [/\bCEO\b/, /\bCFO\b/, /\bappoint(s|ed|ment)\b/i, /\bnames?\b.*\b(chief|president|head\s+of)\b/i, /\bsteps?\s+down\b/i, /\bresign(s|ed|ation)\b/i]],
  ['product', [/\blaunch(es|ed|ing)?\b/i, /\bpartner(s|ship|ed)\b/i, /\bunveil(s|ed)?\b/i, /\brolls?\s+out\b/i, /\bintegrat(es|ion|ed)\b/i, /\bexpands?\b/i]],
];

/** Priority used by dedup ordering and UI sort (lower = more important). */
export const DEFAULT_PRIORITY = {
  ipo: 0, funding: 1, financial: 2, leadership: 3, product: 4, general: 5,
};

/**
 * Build a classifier from an ordered [name, RegExp[]] list.
 * @param {Array<[string, RegExp[]]>} buckets
 * @param {string} [fallback='general']
 * @returns {(text:string)=>string}
 */
export function makeClassifier(buckets, fallback = 'general') {
  return function classify(text) {
    const t = String(text || '');
    for (const [name, patterns] of buckets) {
      if (patterns.some((re) => re.test(t))) return name;
    }
    return fallback;
  };
}

/** Default classifier using the Surf-Tracker buckets. */
export const classify = makeClassifier(DEFAULT_SIGNALS, 'general');

/**
 * Map a signal to its sort priority. Unknown/missing signals sort last.
 * @param {string} signal
 * @param {Record<string,number>} [table=DEFAULT_PRIORITY]
 */
export function signalPriority(signal, table = DEFAULT_PRIORITY) {
  const p = table[signal];
  return Number.isFinite(p) ? p : 99;
}

// ===================== parse =====================
// RSS / Atom feed parsing.
//
// Two strategies, picked automatically:
//   - In the browser, DOMParser is used (matches market-monitor, JFS-Sports and
//     the Bears/Surf clients).
//   - In Node / serverless (no DOMParser), a regex fallback runs (matches the
//     BearsMockDraft build script and the Surf-Tracker aggregator).
// Both return the same normalized item shape, so callers don't branch.


const MAX_TITLE = 300;
const MAX_SUMMARY = 240;
const MAX_CONTENT = 200_000;
// Hard bound on the raw feed body before any parsing — a hostile feed (e.g. many
// unclosed <item> tags) could otherwise drive the regex scan quadratic. 4 MB is
// far above any real feed.
const MAX_FEED_BYTES = 4_000_000;
// Cap items the regex path will extract, independent of the caller's `max`.
const HARD_ITEM_CAP = 1000;

/**
 * @typedef {Object} NewsItem
 * @property {string} title
 * @property {string} url
 * @property {string} published_at   ISO 8601, or '' when the feed had no/invalid date
 * @property {number|null} ts        epoch ms, or null
 * @property {string} summary        short description (entities decoded, capped)
 * @property {string} content        full <content:encoded> body if present (raw HTML, capped)
 * @property {string} source         opts.source verbatim (badge/label)
 * @property {string} [signal]       present when opts.classify is supplied
 */

/**
 * Parse a feed body into normalized items.
 * @param {string} xml
 * @param {{source?:string, classify?:(text:string)=>string, max?:number}} [opts]
 * @returns {NewsItem[]}
 */
export function parseFeed(xml, opts = {}) {
  if (!xml || typeof xml !== 'string') return [];
  if (xml.length > MAX_FEED_BYTES) xml = xml.slice(0, MAX_FEED_BYTES);
  const hasDom = typeof globalThis.DOMParser === 'function';
  const raw = hasDom ? parseWithDom(xml) : parseWithRegex(xml);
  const source = opts.source || '';
  const max = Number.isFinite(opts.max) ? opts.max : 100;

  const items = [];
  for (const r of raw) {
    // Both paths already return final, entity-decoded text (the DOM path via
    // textContent, the regex path via decodedText()). Re-decoding here would
    // double-decode DOM-parsed feeds (e.g. a literal "&amp;" → "&"), so DON'T.
    const title = cap((r.title || '').trim(), MAX_TITLE);
    if (!title) continue;
    const url = (r.url || '').trim();
    const ts = parseDate(r.date);
    const item = {
      title,
      url,
      published_at: ts != null ? new Date(ts).toISOString() : '',
      ts,
      summary: cap(stripTags(r.summary || '').trim(), MAX_SUMMARY),
      content: cap(r.content || '', MAX_CONTENT),
      source,
    };
    if (typeof opts.classify === 'function') {
      item.signal = opts.classify(`${item.title} ${item.summary}`);
    }
    items.push(item);
    if (items.length >= max) break;
  }
  return items;
}

/** True if the body even looks like a feed (cheap, no parse). */
export function looksLikeFeed(body) {
  return typeof body === 'string'
    && (body.includes('<rss') || body.includes('<feed') || body.includes('<rdf:RDF'));
}

/** Count <item>/<entry> without a full parse — used by the proxy race to reject
 *  empty bodies returned by consent gates. */
export function countItems(body) {
  if (typeof body !== 'string') return 0;
  const rss = body.match(/<item[\s>]/gi);
  const atom = body.match(/<entry[\s>]/gi);
  return (rss ? rss.length : 0) + (atom ? atom.length : 0);
}

// ---- DOMParser path -------------------------------------------------------

function parseWithDom(xml) {
  const doc = new globalThis.DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) {
    // Malformed XML — fall back to the tolerant regex parser rather than drop
    // the whole feed.
    return parseWithRegex(xml);
  }
  const nodes = doc.querySelectorAll('item, entry');
  const out = [];
  nodes.forEach((node) => {
    out.push({
      title: textOf(node, ['title']),
      url: domLink(node),
      date: textOf(node, ['pubDate', 'published', 'updated', 'date']),
      summary: textOf(node, ['description', 'summary', 'content']),
      content: nsText(node, 'encoded') || '',
    });
  });
  return out;

  function textOf(node, tags) {
    for (const t of tags) {
      const el = node.querySelector(t);
      if (el && el.textContent) return el.textContent;
    }
    return '';
  }
  function nsText(node, local) {
    // content:encoded etc. — match by local name regardless of prefix binding.
    const els = node.getElementsByTagName('*');
    for (const el of els) {
      if (el.localName === local && el.textContent) return el.textContent;
    }
    return '';
  }
  function domLink(node) {
    const linkEl = node.querySelector('link');
    if (linkEl) {
      const href = linkEl.getAttribute && linkEl.getAttribute('href');
      if (href) return href; // Atom
      if (linkEl.textContent && linkEl.textContent.trim()) return linkEl.textContent.trim(); // RSS
    }
    return '';
  }
}

// ---- Regex path -----------------------------------------------------------

function parseWithRegex(xml) {
  const out = [];
  // Find each opening <item>/<entry>, then locate its close with indexOf from
  // that point. A previous lazy regex (/<(item|entry)\b[\s\S]*?<\/\1>/g) rescanned
  // to EOF from every unmatched open tag → O(n^2) on a feed with unclosed items.
  // This is a single linear pass.
  const openRe = /<(item|entry)\b[^>]*>/gi;
  let m;
  while ((m = openRe.exec(xml)) && out.length < HARD_ITEM_CAP) {
    const tag = m[1].toLowerCase();
    const closeIdx = xml.indexOf(`</${tag}`, openRe.lastIndex);
    if (closeIdx === -1) break; // no closing tag → stop rather than rescan
    const block = xml.slice(m.index, closeIdx);
    out.push({
      title: decodedText(block, ['title']),
      url: regexLink(block),
      date: decodedText(block, ['pubDate', 'published', 'updated', 'dc:date', 'date']),
      summary: decodedText(block, ['description', 'summary', 'content']),
      // Article body is HTML — unwrap CDATA but do NOT entity-decode it.
      content: decodeCdata(rawTag(block, ['content:encoded'])),
    });
    openRe.lastIndex = closeIdx; // continue scanning after this block
  }
  return out;
}

// Plain-text fields (title/date/summary): unwrap CDATA, then decode entities so
// the regex path matches what a DOM parser's textContent already returns.
function decodedText(block, tags) {
  return decodeEntities(decodeCdata(rawTag(block, tags))).trim();
}

function rawTag(block, tags) {
  for (const tag of tags) {
    const re = new RegExp(`<${escapeRe(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRe(tag)}>`, 'i');
    const mm = re.exec(block);
    if (mm && mm[1] != null) return mm[1];
  }
  return '';
}

function regexLink(block) {
  // Atom: <link href="..."/>  (prefer rel="alternate" or no rel)
  const atomRe = /<link\b([^>]*?)\/?>/gi;
  let candidate = '';
  let mm;
  while ((mm = atomRe.exec(block))) {
    const attrs = mm[1] || '';
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!href) continue;
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!rel || /alternate/i.test(rel[1])) return decodeEntities(href[1]).trim();
    if (!candidate) candidate = decodeEntities(href[1]).trim();
  }
  if (candidate) return candidate;
  // RSS: <link>...</link>
  const rss = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(block);
  if (rss && rss[1]) return decodeEntities(decodeCdata(rss[1])).trim();
  return '';
}

function decodeCdata(s) {
  if (!s) return '';
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  if (cdata.test(s)) return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return s;
}

// ---- shared helpers -------------------------------------------------------

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(String(s).trim());
  return Number.isNaN(t) ? null : t;
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function cap(s, n) {
  s = s || '';
  return s.length > n ? s.slice(0, n) : s;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===================== dedupe =====================
// Near-duplicate detection, clustering and merge-with-retention.
//
// Adopted from Surf-Tracker (lib/news/dedupe.js) as the canonical implementation
// because it is strictly better than the truncate-the-headline heuristics in
// BearsMockDraft (first 70 chars) and market-monitor (first 80 alphanumerics),
// which produce both false merges (similar headlines collide) and false splits
// (the same wire story reworded by two outlets survives twice).
//
// Items are plain objects; the only fields read are `title`, `url`,
// `published_at` (ISO string) and the optional `signal`/`company`.


// Single-linkage clustering is O(n^2) in the worst case (all-unique titles), so
// cap the input — a hostile/huge feed merge can't hang the event loop. 2000 news
// items is already far more than any UI renders.
const MAX_DEDUPE_ITEMS = 2000;

const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it',
  'its', 'this', 'that', 'these', 'those', 'will', 'would', 'can', 'could',
  'has', 'have', 'had', 'new', 'says', 'said', 'after', 'over', 'amid', 'into',
]);

/** lowercase, strip a leading [TICKER], punctuation -> space, collapse. */
export function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Google/Bing News titles are "Headline - Publisher"; drop the publisher tail. */
export function stripPublisher(title) {
  return String(title || '').replace(/\s+[-–—|]\s+[^-–—|]+$/, '').trim();
}

/** Deduped content words that define a headline's identity. */
export function titleSignature(title, companyName = '') {
  const company = new Set(normalizeTitle(companyName).split(' ').filter(Boolean));
  const toks = normalizeTitle(stripPublisher(title))
    .split(' ')
    .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w) && !company.has(w));
  return [...new Set(toks)];
}

/** Jaccard + containment overlap between a signature array and a signature Set. */
export function nearDuplicate(aArr, bSet) {
  const aSize = aArr.length;
  const bSize = bSet.size;
  if (aSize < 3 || bSize < 3) return false;
  const inter = aArr.filter((w) => bSet.has(w)).length;
  if (!inter) return false;
  const union = aSize + bSize - inter;
  const jaccard = inter / union;
  const containment = inter / Math.min(aSize, bSize);
  if (jaccard >= 0.6 && inter >= 4) return true;
  if (containment >= 0.85 && inter >= 4) return true;
  if (containment >= 0.8 && inter >= 3) return true;
  return false;
}

export function earliestDate(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta <= tb ? a : b;
}

/**
 * Collapse near-duplicate items into one representative each (single-linkage:
 * an item joins a cluster if it matches ANY member). Highest-priority signal and
 * earliest publication win.
 * @param {Array<Object>} items
 * @returns {Array<Object>}
 */
export function dedupeItems(items) {
  const bounded = items.length > MAX_DEDUPE_ITEMS ? items.slice(0, MAX_DEDUPE_ITEMS) : items;
  const ordered = [...bounded].sort((a, b) => {
    const pa = signalPriority(a.signal);
    const pb = signalPriority(b.signal);
    if (pa !== pb) return pa - pb;
    return (Date.parse(a.published_at) || 0) - (Date.parse(b.published_at) || 0);
  });

  const clusters = [];
  for (const it of ordered) {
    const company = it.company || '';
    const sigArr = titleSignature(it.title, company);
    const exactKey = `${company}\t${normalizeTitle(stripPublisher(it.title))}`;
    let target = null;
    for (const cl of clusters) {
      if (cl.company !== company) continue;
      if (cl.exactKeys.has(exactKey) || cl.sigSets.some((s) => nearDuplicate(sigArr, s))) {
        target = cl;
        break;
      }
    }
    if (target) {
      target.item.published_at = earliestDate(target.item.published_at, it.published_at);
      target.exactKeys.add(exactKey);
      target.sigSets.push(new Set(sigArr));
    } else {
      clusters.push({
        company,
        exactKeys: new Set([exactKey]),
        sigSets: [new Set(sigArr)],
        item: it,
      });
    }
  }
  return clusters.map((c) => c.item);
}

/**
 * Merge a fresh fetch into the previous set without ever letting a transient
 * empty fetch blank out yesterday's stories. URL-keyed; stale items age out.
 * @param {Array<Object>} prevItems
 * @param {Array<Object>} freshItems
 * @param {{cutoffDays?:number, cap?:number}} [opts]
 */
export function mergeItems(prevItems, freshItems, opts = {}) {
  const cutoffDays = opts.cutoffDays ?? 60;
  const cap = opts.cap ?? 60;
  const byUrl = new Map();
  for (const it of prevItems || []) if (it && it.url) byUrl.set(it.url, it);
  for (const it of freshItems || []) {
    if (!it || !it.url) continue;
    byUrl.set(it.url, byUrl.has(it.url) ? { ...byUrl.get(it.url), ...it } : it);
  }
  const cutoff = Date.now() - cutoffDays * 24 * 3600 * 1000;
  let merged = [...byUrl.values()].filter(
    (x) => !x.published_at || Date.parse(x.published_at) >= cutoff,
  );
  merged = dedupeItems(merged);
  merged.sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0));
  return merged.slice(0, cap);
}

// ===================== proxy =====================
// CORS proxy race with a delayed own-origin fallback.
//
// Generalizes Surf-Tracker's client strategy (docs/js/05-fetch.js): the flaky
// free public proxies race immediately, and the app's own serverless proxy
// joins late so it only costs an invocation when the free ones fail. First
// non-empty body wins; the losers are aborted.
//
// SECURITY NOTE: public proxies leak every fetched URL to a third party and are
// rate-limited and frequently down. The recommended end state is an own-origin
// proxy with an SSRF host allowlist (market-monitor's netlify/functions/
// rss-proxy.js is the model). Pass it as `originProxy` and, once it's reliable,
// shrink or drop `proxies`.


/** Default public CORS proxies (the set hardcoded across Bears/JFS/Surf). */
export const DEFAULT_PROXIES = [
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

/**
 * Fetch `targetUrl` through whichever proxy returns a usable feed first.
 * @param {string} targetUrl
 * @param {{
 *   proxies?: Array<(u:string)=>string>,
 *   originProxy?: ((u:string)=>string)|null,
 *   originDelayMs?: number,
 *   timeoutMs?: number,
 *   minItems?: number,
 *   fetchImpl?: typeof fetch,
 *   acceptBody?: (body:string)=>boolean,
 * }} [opts]
 * @returns {Promise<{ text: string, via: string }>}
 * @throws when every transport fails or returns an empty/unusable body.
 */
export async function proxyRace(targetUrl, opts = {}) {
  const proxies = opts.proxies || DEFAULT_PROXIES;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const minItems = opts.minItems ?? 1;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const accept = opts.acceptBody || ((body) => countItems(body) >= minItems);
  if (typeof fetchImpl !== 'function') {
    throw new Error('proxyRace: no fetch implementation available');
  }

  const controller = new AbortController();
  const transports = proxies.map((p, i) => ({ build: p, label: `proxy:${i}`, delay: 0 }));
  if (opts.originProxy) {
    transports.push({ build: opts.originProxy, label: 'origin', delay: opts.originDelayMs ?? 1500 });
  }

  const attempts = transports.map((t) => attempt(t));

  // Resolve on the first acceptable body; only reject once ALL have failed.
  return new Promise((resolve, reject) => {
    let remaining = attempts.length;
    let settled = false;
    let lastErr = null;
    for (const a of attempts) {
      a.then(
        (res) => {
          if (settled) return;
          settled = true;
          controller.abort();
          resolve(res);
        },
        (err) => {
          lastErr = err;
          remaining -= 1;
          if (!settled && remaining === 0) {
            reject(lastErr || new Error('proxyRace: all transports failed'));
          }
        },
      );
    }
  });

  async function attempt(t) {
    if (t.delay) await sleep(t.delay, controller.signal);
    // Per-attempt timeout. AbortSignal.timeout when available; otherwise a
    // hand-rolled controller so the timeout still applies on older engines
    // (previously the timeout was silently dropped there).
    let localTimeout;
    let timeoutId = null;
    if (typeof AbortSignal.timeout === 'function') {
      localTimeout = AbortSignal.timeout(timeoutMs);
    } else {
      const tc = new AbortController();
      timeoutId = setTimeout(() => tc.abort(), timeoutMs);
      localTimeout = tc.signal;
    }
    try {
      const signal = mergeSignals(controller.signal, localTimeout);
      const res = await fetchImpl(t.build(targetUrl), { signal });
      if (!res || !res.ok) throw new Error(`${t.label}: HTTP ${res ? res.status : 'no-response'}`);
      const text = await res.text();
      if (!accept(text)) throw new Error(`${t.label}: empty/unusable body`);
      return { text, via: t.label };
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(id);
        reject(new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        reject(new Error('aborted'));
      }, { once: true });
    }
  });
}

function mergeSignals(a, b) {
  if (!b) return a;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  // Fallback: chain BOTH aborts into a fresh controller. (This used to
  // `return a`, silently dropping b — the per-attempt timeout signal.)
  const merged = new AbortController();
  const onAbort = () => merged.abort();
  for (const s of [a, b]) {
    if (s.aborted) {
      merged.abort();
      break;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return merged.signal;
}

// ===================== time =====================
// Relative time formatting ("just now", "3m ago", "2h ago", "Jun 16").
//
// All four repos ship their own copy. `now` is injectable for deterministic
// tests.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param {number|string|Date} ts  epoch ms, ISO string, or Date
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function relativeTime(ts, now = Date.now()) {
  const t = toMs(ts);
  if (t == null) return '';
  const diff = now - t;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = new Date(t);
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return sameYear ? base : `${base}, ${d.getFullYear()}`;
}

function toMs(ts) {
  if (ts == null) return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts.getTime();
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? null : parsed;
}

// ===================== sanitize-html =====================
// Allowlist HTML sanitizer for the in-app article reader.
//
// Consolidates the whitelist rebuilders in BearsMockDraft (js/news.js) and
// Surf-Tracker (docs/js/14-reader.js): parse third-party article HTML, then
// rebuild a fresh tree containing ONLY allowlisted tags/attributes. Never
// assign untrusted markup to innerHTML directly.
//
// Three tag dispositions (BearsMockDraft's model, which is the better of the
// two — it preserves article prose that publishers wrap in non-semantic
// containers):
//   - ALLOWED  → kept as an element, recursively cleaned
//   - BLOCKED  → removed entirely, INCLUDING the subtree (script/style/iframe…)
//   - anything else (unknown) → UNWRAPPED: the tag is dropped but its cleaned
//     children are kept, so text inside <section>/<article>/<table>/<div>
//     survives instead of vanishing.
//
// The full rebuild needs a DOM, so `sanitizeHtmlToFragment()` is browser-only
// (it throws without one — fail-closed by design). The security-critical URL
// decision is factored out as the pure, Node-testable `isSafeContentUrl()`,
// and the URL policy is injectable so a stricter consumer (e.g. a reader that
// only wants absolute links) can pass its own validator.
//
// (Named sanitizeHtmlToFragment, not sanitizeHtml: the generic name belongs to
// @jfs/dom-kit, whose sanitizeHtml returns a string — see the family naming
// rule in the escape section above.)

const DEFAULT_ALLOWED = new Set([
  'P', 'BR', 'HR', 'SPAN', 'DIV', 'B', 'STRONG', 'I', 'EM', 'U', 'A',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  'FIGURE', 'FIGCAPTION', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'PRE', 'CODE',
]);

const DEFAULT_BLOCKED = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON',
  'SELECT', 'TEXTAREA', 'SVG', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED',
  'LINK', 'META', 'BASE', 'TITLE',
]);

const DEFAULT_ATTRS_BY_TAG = {
  A: ['href'],
  IMG: ['src', 'alt'],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
};

/** True if a URL is safe to keep as an href/src (blocks javascript:, data:, etc.).
 *  Permissive default: allows absolute http(s), protocol-relative and
 *  root-relative URLs. Pass a stricter validator via options.safeUrl when a
 *  consumer only wants absolute links. */
export function isSafeContentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // Strip ALL C0 controls + DEL anywhere (browsers drop tab/newline/NUL from a
  // URL before resolving its scheme, so `java\tscript:` and `javascript:`
  // would otherwise slip past the scheme test), then trim surrounding spaces.
  const trimmed = url.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^\/\//.test(trimmed)) return true; // protocol-relative
  if (/^\//.test(trimmed)) return true; // root-relative
  // Anything else carrying a scheme is rejected; bare relative text is allowed.
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

const DANGEROUS_SCHEME_RE = /(javascript|data|vbscript|file|blob):/;

/** True if a `srcset` value is safe. `isSafe` is the per-URL validator (defaults
 *  to isSafeContentUrl). Because naive comma-splitting can diverge from the
 *  browser's candidate parsing (a comma inside a URL over-splits and can hide a
 *  dangerous scheme in a fragment), this ALSO rejects the whole value if any
 *  dangerous scheme appears anywhere (control chars stripped first). Pure. */
export function isSafeSrcset(value, isSafe = isSafeContentUrl) {
  const raw = String(value == null ? '' : value);
  const flat = raw.replace(/[\u0000-\u0020\u007F]+/g, '').toLowerCase();
  if (DANGEROUS_SCHEME_RE.test(flat)) return false;
  const ok = (u) => { const v = isSafe(u); return v === true || (typeof v === 'string' && !!v); };
  return raw
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean)
    .every(ok);
}

const URL_ATTRS = new Set(['href', 'src', 'srcset']);
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const MAX_DEPTH = 256;

/**
 * Rebuild `html` into a safe DocumentFragment using the allowlist. Browser-only.
 * @param {string} html
 * @param {{
 *   doc?: Document,
 *   allowed?: Set<string>|string[],
 *   blocked?: Set<string>|string[],
 *   attrs?: Record<string,string[]>,
 *   globalAttrs?: Set<string>|string[],  // non-URL attrs allowed on any element (e.g. dir, lang)
 *   safeUrl?: (url:string)=>(string|null|boolean),
 *   lazyImages?: boolean,
 * }} [options]
 * @returns {DocumentFragment}
 */
export function sanitizeHtmlToFragment(html, options = {}) {
  const doc = options.doc || globalThis.document;
  if (!doc || typeof globalThis.DOMParser !== 'function') {
    throw new Error('sanitizeHtmlToFragment requires a DOM (browser).');
  }
  const cfg = {
    allowed: toSet(options.allowed, DEFAULT_ALLOWED),
    blocked: toSet(options.blocked, DEFAULT_BLOCKED),
    attrs: options.attrs || DEFAULT_ATTRS_BY_TAG,
    // Attribute names (lowercase, NOT upper-cased) permitted on every allowed
    // element. URL-bearing names are ignored here — they must be per-tag so
    // they go through validation.
    globalAttrs: options.globalAttrs instanceof Set
      ? options.globalAttrs
      : new Set(options.globalAttrs || []),
    lazyImages: options.lazyImages === true,
    // Default true (v0.1.0 behavior): give a kept <img> an alt='' and unwrap an
    // <img> that has no safe src. An article reader that wants to keep src-less
    // images / authored alts can switch these off.
    defaultAlt: options.defaultAlt !== false,
    requireImageSrc: options.requireImageSrc !== false,
    // A validator may return a normalized href (string) or a boolean; normalize
    // both into "use this string or skip".
    urlOf: (raw) => {
      const v = (options.safeUrl || isSafeContentUrl)(raw);
      if (v === true) return raw;
      if (typeof v === 'string' && v) return v;
      return null;
    },
  };
  const parsed = new globalThis.DOMParser().parseFromString(String(html || ''), 'text/html');
  const frag = doc.createDocumentFragment();
  appendCleanChildren(parsed.body, frag, doc, cfg, 0);
  return frag;
}

function appendCleanChildren(parent, target, doc, cfg, depth) {
  // Bound recursion so deeply-nested hostile HTML can't overflow the stack.
  if (depth > MAX_DEPTH) return;
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3) {
      target.appendChild(doc.createTextNode(node.nodeValue));
      continue;
    }
    if (node.nodeType !== 1) continue; // drop comments / processing instructions
    // Foreign-content (SVG/MathML) elements report a lowercase tagName, so the
    // uppercase BLOCKED/ALLOWED sets miss them — and unwrapping them into an
    // HTML sink would resurrect their (HTML-breakout) children. Drop any
    // non-XHTML element entirely, with its subtree.
    if (node.namespaceURI && node.namespaceURI !== XHTML_NS) continue;
    const tag = (node.localName || node.tagName).toUpperCase();
    if (cfg.blocked.has(tag)) continue; // remove element AND its subtree
    if (!cfg.allowed.has(tag)) {
      // Unknown tag: unwrap — keep its cleaned children, drop the wrapper.
      appendCleanChildren(node, target, doc, cfg, depth + 1);
      continue;
    }
    const el = buildAllowed(node, tag, doc, cfg, depth);
    if (el) target.appendChild(el);
    else appendCleanChildren(node, target, doc, cfg, depth + 1); // e.g. <img> w/ unsafe src → unwrap
  }
}

function buildAllowed(node, tag, doc, cfg, depth) {
  if (tag === 'IMG' && cfg.requireImageSrc) {
    const src = cfg.urlOf(node.getAttribute('src'));
    if (!src) return null; // signal caller to unwrap (keep any children)
  }
  const out = doc.createElement(tag);
  let hasHref = false;
  for (const name of cfg.attrs[tag] || []) {
    const val = node.getAttribute(name);
    if (val == null) continue;
    if (name === 'href' || name === 'src') {
      const safe = cfg.urlOf(val);
      if (!safe) continue;
      out.setAttribute(name, safe);
      if (name === 'href') hasHref = true;
    } else if (name === 'srcset') {
      // Keep the original value only if every candidate URL is safe.
      if (isSafeSrcset(val, (u) => cfg.urlOf(u) != null)) out.setAttribute(name, val);
    } else {
      out.setAttribute(name, val);
    }
  }
  // Global (non-URL) attributes permitted on any element. Reject URL-bearing and
  // event-handler names defensively, even if a consumer mistakenly allowlists one.
  for (const name of cfg.globalAttrs) {
    if (URL_ATTRS.has(name) || /^on/i.test(name) || out.hasAttribute(name)) continue;
    const val = node.getAttribute(name);
    if (val != null) out.setAttribute(name, val);
  }
  // Only decorate real links — a hrefless <a> isn't a navigation target.
  if (tag === 'A' && hasHref) {
    out.setAttribute('target', '_blank');
    out.setAttribute('rel', 'noopener noreferrer');
  }
  if (tag === 'IMG') {
    // Give a kept image an alt (default '' = decorative) when alt is allowed,
    // rather than leaving it unannounced to screen readers.
    if (cfg.defaultAlt && (cfg.attrs.IMG || []).includes('alt') && !out.hasAttribute('alt')) {
      out.setAttribute('alt', '');
    }
    if (cfg.lazyImages) out.setAttribute('loading', 'lazy');
  }
  appendCleanChildren(node, out, doc, cfg, depth + 1);
  return out;
}

function toSet(v, fallback) {
  if (!v) return fallback;
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return new Set(v.map((s) => String(s).toUpperCase()));
  return fallback;
}

