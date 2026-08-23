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

/** Decode numeric (`&#39;` / `&#x27;`) and the common named entities. EVERY
 *  ampersand reference — named `&amp;` AND the numeric forms `&#38;` / `&#x26;`
 *  — is deferred to a single final pass so an already-decoded ampersand can
 *  never trigger a second round of entity interpretation. Without this,
 *  `&#38;lt;` would decode `&#38;`→`&` in the numeric pass and then `&lt;`→`<`,
 *  smuggling a raw `<` into "plain" text; instead it decodes to the literal
 *  string `&lt;` (matching `&amp;lt;`). */
export function decodeEntities(s) {
  if (s == null) return '';
  let out = String(s)
    // Numeric decimal: &#39; — but defer refs to '&' (cp 38) to the final pass.
    .replace(/&#(\d+);/g, (m, n) => {
      const cp = parseInt(n, 10);
      return cp === 38 ? m : safeFromCodePoint(cp);
    })
    // Numeric hex: &#x27; — likewise defer refs to '&' (0x26).
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => {
      const cp = parseInt(n, 16);
      return cp === 38 ? m : safeFromCodePoint(cp);
    })
    // Named entities, excluding amp (handled last).
    .replace(/&([a-zA-Z]+);/g, (m, name) => {
      const key = name.toLowerCase();
      if (key === 'amp') return m; // defer
      return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : m;
    });
  // Every ampersand reference last — &amp;, &#38;, &#x26; each become a single
  // literal '&', in one pass that does not re-scan its own output.
  out = out.replace(/&(?:amp|#0*38|#x0*26);/gi, '&');
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
// JFS-Sports is the only one that correctly splits the two URL use-cases, and
// the DOM-API side of that split is preserved here:
//   - safeContentUrl()     -> normalized href string, NOT HTML-escaped. Use for
//                             the DOM APIs (setAttribute('href', ...), .href,
//                             .src) where the browser stores the value
//                             verbatim; escaping would double-encode `&`.
//
// ABSORBED FROM @jfs/dom-kit (v0.3.3): dom-kit's `escapeHtml` and news-kit's
// `escHtml` were VERIFIED byte-identical in behavior — a differential run over
// 85,683 inputs (every code unit 0x00–0xFFFF, astral characters, lone
// surrogates, null/undefined/non-strings, 20k fuzzed strings) produced zero
// mismatches, so the two implementations were collapsed into ONE. dom-kit's
// single-pass table+regex form survives; `escHtml` and `escAttr` are aliases
// of it, so every consumer's existing import keeps working.
//
// The URL guards were NOT collapsed: all fifteen pairs among safeUrl /
// safeImageUrl / sanitizeUrl / sanitizeHref / safeContentUrl / isSafeContentUrl
// differ on real inputs (reject sentinel `#` vs `''` vs `null` vs `false`,
// relative-URL policy, `new URL()` normalization, HTML-escaping of `&`,
// data:image and blob: allowances). They keep their own implementations and
// their own contracts — see the `dom` section below for the guard-by-guard
// comparison.

// All five HTML-significant characters. The textContent → innerHTML trick
// only escapes <, >, & — quotes are left untouched, which is unsafe in
// attribute contexts. Replacing all five explicitly keeps the helper
// usable as `value="${escapeHtml(x)}"` too, not just inside text nodes.
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const HTML_ESCAPE_REGEX = /[&<>"']/g;

/** Escape the five HTML-significant characters. Safe for text nodes and for
 *  values placed inside either single- or double-quoted attributes. Coerces
 *  non-string values via String() and treats null / undefined as empty so
 *  callers don't have to guard upstream. */
export function escapeHtml(str) {
  if (str == null) return '';
  const s = typeof str === 'string' ? str : String(str);
  return s.replace(HTML_ESCAPE_REGEX, (ch) => HTML_ESCAPES[ch]);
}
// Aliases — market-monitor uses escHtml/escAttr, JFS-Sports uses escapeHtml,
// news-kit's own consumers use escHtml. One implementation, three names.
export { escapeHtml as escHtml, escapeHtml as escAttr };

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
// The @__PURE__ annotation is load-bearing: a top-level CALL is a potential
// side effect, so without it esbuild keeps this line — and through it
// makeClassifier and DEFAULT_SIGNALS — in every narrowed vendored build,
// even ones that pick none of the three (~1 KB of dead classifier shipped
// in Art-Gallery-'s 4-export copy before this).
export const classify = /* @__PURE__ */ makeClassifier(DEFAULT_SIGNALS, 'general');

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
    // Local bindings deliberately avoid the name `el`: the tree-shaker roots a
    // top-level declaration by identifier occurrence, so a local `el` here
    // would drag the exported `el()` element builder into every narrowed
    // vendored build that picks parseFeed.
    for (const t of tags) {
      const found = node.querySelector(t);
      if (found && found.textContent) return found.textContent;
    }
    return '';
  }
  function nsText(node, local) {
    // content:encoded etc. — match by local name regardless of prefix binding.
    const els = node.getElementsByTagName('*');
    for (const cand of els) {
      if (cand.localName === local && cand.textContent) return cand.textContent;
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
  if (s.length <= n) return s;
  // Never cut a surrogate pair in half: a cap landing between the high and
  // low halves of an astral char (emoji in a headline) would leave a lone
  // surrogate — an ill-formed string that turns into U+FFFD when encoded
  // (JSON responses, TextEncoder). Back off one unit instead.
  let end = n;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  return s.slice(0, end);
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

// Date can only represent ±8.64e15 ms; a numeric timestamp beyond that range
// makes new Date(t).toISOString() THROW (RangeError) rather than go NaN, so a
// single hostile feed item could otherwise crash a whole render. Out-of-range
// numbers are treated as "no date".
const MAX_DATE_MS = 8.64e15;

function toMs(ts) {
  if (ts == null) return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts.getTime();
  if (typeof ts === 'number') {
    return Number.isFinite(ts) && Math.abs(ts) <= MAX_DATE_MS ? ts : null;
  }
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

// Tags whose ENTIRE SUBTREE is dropped, never unwrapped. The list is
// generated from the canonical @jfs sanitizer policy
// (family/sanitizer-policy.json in @jfs/vendor-cli) by `npm run policy:sync`;
// CI fails on drift. UPPERCASE here because this sanitizer compares DOM
// tagName. This is now the kit's ONLY copy of the region: the absorbed
// dom-kit sanitizer's lowercase `_BLOCKED_TAGS` is DERIVED from this set (see
// the `dom` section) rather than carrying a second marked region, so the two
// lists cannot drift from each other at all.
const DEFAULT_BLOCKED = new Set([
  // @jfs-sanitizer-policy:blocked-tags:start case=upper quote=single
  'SCRIPT', 'STYLE', 'IFRAME', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'SELECT',
  'TEXTAREA', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'LINK',
  'META', 'BASE', 'TITLE', 'TEMPLATE',
  // @jfs-sanitizer-policy:blocked-tags:end
]);

const DEFAULT_ATTRS_BY_TAG = {
  A: ['href'],
  IMG: ['src', 'alt'],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
};

// Strip ALL C0 controls + DEL anywhere in a URL before scheme checks:
// browsers drop tab/newline/NUL from a URL before resolving its scheme, so
// `java\tscript:` would otherwise slip past the scheme tests below, and
// control characters embedded in an accepted URL must not survive into the
// returned value either. The regex is generated from the canonical @jfs
// sanitizer policy (family/sanitizer-policy.json in @jfs/vendor-cli) by
// `npm run policy:sync`; CI fails on drift. This is the kit's ONLY copy — the
// absorbed dom-kit guards (safeUrl / safeImageUrl, `dom` section below) share
// this constant instead of carrying a second marked region.
// @jfs-sanitizer-policy:url-control-chars:start const=URL_CONTROL_CHARS
const URL_CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
// @jfs-sanitizer-policy:url-control-chars:end

/** True if a URL is safe to keep as an href/src (blocks javascript:, data:, etc.).
 *  Permissive default: allows absolute http(s), protocol-relative and
 *  root-relative URLs. Pass a stricter validator via options.safeUrl when a
 *  consumer only wants absolute links. */
export function isSafeContentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // Strip control chars (see URL_CONTROL_CHARS), then trim surrounding spaces.
  const trimmed = url.replace(URL_CONTROL_CHARS, '').trim();
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

// URL-bearing attribute names routed through the URL validator (cfg.urlOf) no
// matter which tag allowlists them, so a consumer can never allowlist a
// URL-carrying attribute and get it copied unvalidated. `srcset` keeps its
// dedicated isSafeSrcset handling.
const URL_ATTRS = new Set([
  'href', 'src', 'srcset', 'poster', 'background', 'formaction', 'action',
  'cite', 'data', 'longdesc', 'ping', 'xlink:href', 'manifest',
]);
// Attribute names that are ALWAYS dropped, regardless of any per-tag or global
// allowlist: event handlers (on*), plus a small set of dangerous/identity
// attributes (inline style, id/name collisions, the `is` custom-element hook).
const DENIED_ATTRS = new Set(['style', 'id', 'name', 'is']);
/** True if `lname` (already lowercased) must be dropped no matter what. */
function isDeniedAttr(lname) {
  return /^on/i.test(lname) || DENIED_ATTRS.has(lname);
}
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
    // Named `built`, not `el` — see the note in parseFeed's textOf: a local
    // `el` would false-root the exported `el()` builder in narrowed builds.
    const built = buildAllowed(node, tag, doc, cfg, depth);
    if (built) target.appendChild(built);
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
    const lname = String(name).toLowerCase();
    // Internal denylist wins over any allowlist entry.
    if (isDeniedAttr(lname)) continue;
    const val = node.getAttribute(name);
    if (val == null) continue;
    if (lname === 'srcset') {
      // Keep the original value only if every candidate URL is safe.
      if (isSafeSrcset(val, (u) => cfg.urlOf(u) != null)) out.setAttribute(name, val);
    } else if (URL_ATTRS.has(lname)) {
      // Any URL-bearing attribute — not just href/src — is validated.
      const safe = cfg.urlOf(val);
      if (!safe) continue;
      out.setAttribute(name, safe);
      if (lname === 'href') hasHref = true;
    } else {
      out.setAttribute(name, val);
    }
  }
  // Global (non-URL) attributes permitted on any element. The internal denylist
  // and the URL-bearing set both win over the allowlist, so a consumer can't
  // mistakenly allow an event handler, inline style, or URL attribute here.
  for (const name of cfg.globalAttrs) {
    const lname = String(name).toLowerCase();
    if (isDeniedAttr(lname) || URL_ATTRS.has(lname) || out.hasAttribute(name)) continue;
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

// ===================== render-river =====================
// The John's News river presentation, extracted as the family's shared news
// UI: a newest-first column of article cards, grouped under Today/Yesterday/
// weekday dividers. Each card carries a meta line (optional favicon, bold
// source label, relative time, optional classification chip, right-aligned
// FULL TEXT / DEEP LINK badge), an optional kicker, a serif headline, a
// 3-line-clamped summary, a byline and an optional lazy thumbnail, with a
// per-source accent color on the card's left edge and source name.
//
// Rendering is DOM-node based (createElement + text nodes) — feed text can
// never be interpreted as HTML, and it works identically from ESM pages and
// classic-script global builds. URLs (headline href, thumbnail/favicon src)
// pass through safeContentUrl, so javascript:/data: links from a hostile
// feed are dropped, not rendered.
//
// DEEP-LINK RULE (the elegance contract): when a story can't be read in-app,
// its headline must stay a PLAIN anchor — no window.open, no intercepted
// click. A plain tap on a real <a href> is what lets iOS/Android hand the
// URL to the publisher's own app via universal links, so an NYT/Economist/
// Politico headline opens directly in that app. The onOpen callback
// preserves this: it only sees plain unmodified left-clicks, and returning
// `false` from it means "let the anchor navigate" (deep link); any other
// return prevents default so the app can open its in-app reader instead.
// Modifier/middle clicks always fall through to normal browser behavior.
//
// WHERE the anchor navigates depends on how the page is displayed. In a
// browser tab, external links carry target=_blank so the river stays put
// and closing the publisher tab lands the reader back on it. As an
// INSTALLED app (standalone display mode) there are no tabs: _blank spawns
// a separate launch window first, and when iOS hands the URL to the
// publisher's app that orphaned window survives underneath — closing the
// publisher drops the reader onto a stale window they must close to get
// back to the app. So standalone cards navigate the current context
// instead: a universal-link handoff leaves the app untouched, and a plain
// web target opens in the OS's in-app browser overlay, which returns
// cleanly. Detection is automatic (isStandaloneDisplay); opts.standalone
// overrides it.
//
// Styling ships as NEWS_RIVER_CSS and installs via ensureNewsRiverStyles():
// a constructed stylesheet (document.adoptedStyleSheets) where available —
// CSSOM insertion is exempt from CSP style-src, so it works under the
// family's strict no-'unsafe-inline' policies — falling back to a <style>
// tag elsewhere (jsdom, older engines, CSP-less pages). Theme variables are
// declared at zero specificity (:where), so a consumer restyles the river
// with a plain `.nk-river { --nk-card: …; }` rule in its own stylesheet.

export const NEWS_RIVER_CSS = `
:where(.nk-river) {
  --nk-card: #ffffff;
  --nk-ink: #14171a;
  --nk-muted: #5b6570;
  --nk-line: #e3e7eb;
  --nk-link: #0b5cad;
  --nk-full: #0a7d3f;
  --nk-chip: #eef1f4;
  --nk-shadow: 0 1px 2px rgba(20, 23, 26, 0.06), 0 2px 8px rgba(20, 23, 26, 0.04);
  --nk-serif: Georgia, 'Times New Roman', serif;
  --nk-radius: 14px;
}
@media (prefers-color-scheme: dark) {
  :where(.nk-river) {
    --nk-card: #171b1e;
    --nk-ink: #e8ebee;
    --nk-muted: #9aa4ad;
    --nk-line: #262c31;
    --nk-link: #5aa9f5;
    --nk-full: #4cc38a;
    --nk-chip: #20262b;
    --nk-shadow: none;
  }
}
.nk-river { display: flex; flex-direction: column; gap: 10px; }
.nk-day {
  font-family: var(--nk-serif);
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--nk-muted);
  margin: 14px 2px 2px;
  padding-bottom: 5px;
  border-bottom: 2px solid var(--nk-line);
}
.nk-day:first-child { margin-top: 2px; }
.nk-card {
  background: var(--nk-card);
  border: 1px solid var(--nk-line);
  border-left: 3px solid var(--nk-accent, var(--nk-line));
  border-radius: var(--nk-radius);
  padding: 14px 16px;
  box-shadow: var(--nk-shadow);
  /* Rigid width: a card can never grow past its column. min-width: 0 lets
     the flex item shrink below its content's min-content width, max-width
     caps it, and overflow-wrap (inherited by every text block inside)
     breaks long unbroken tokens (URLs, tickers) instead of letting one
     word push the card — and the whole page — wider than the viewport. */
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.nk-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: 12px;
  color: var(--nk-muted);
  margin-bottom: 6px;
  min-width: 0;
}
.nk-favicon { width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0; }
.nk-src { font-weight: 700; color: var(--nk-accent, var(--nk-ink)); min-width: 0; }
.nk-dot { opacity: 0.5; }
.nk-time { white-space: nowrap; }
.nk-chip {
  background: var(--nk-chip);
  color: var(--nk-muted);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 6px;
  white-space: nowrap;
}
.nk-badge {
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--nk-chip);
  color: var(--nk-muted);
  white-space: nowrap;
}
.nk-badge-full { background: color-mix(in srgb, var(--nk-full) 16%, transparent); color: var(--nk-full); }
.nk-badge-link { background: var(--nk-chip); color: var(--nk-muted); }
.nk-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--nk-accent, var(--nk-link));
  margin: 0 0 2px;
}
.nk-headline {
  font-family: var(--nk-serif);
  font-size: 18.5px;
  line-height: 1.28;
  margin: 2px 0 6px;
  font-weight: 700;
  letter-spacing: 0;
  color: var(--nk-ink);
}
.nk-headline a, .nk-headline button, .nk-headline span {
  color: inherit;
  text-decoration: none;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.nk-headline span { cursor: default; }
.nk-headline a:hover, .nk-headline button:hover { color: var(--nk-link); text-decoration: underline; }
.nk-summary {
  font-size: 14.5px;
  color: var(--nk-muted);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nk-row { display: flex; gap: 12px; align-items: flex-start; }
.nk-main { flex: 1; min-width: 0; }
.nk-thumb {
  width: 78px;
  height: 78px;
  object-fit: cover;
  border-radius: 10px;
  flex-shrink: 0;
  margin-top: 22px;
  background: var(--nk-chip);
}
.nk-byline { font-size: 12px; color: var(--nk-muted); margin-top: 8px; }
.nk-byline a { color: var(--nk-link); text-decoration: none; }
.nk-empty { text-align: center; color: var(--nk-muted); padding: 40px 0; font-size: 14.5px; margin: 0; }
/* Loading skeletons: fixed-height placeholder bars sized to match a text
   card, so a cold load reserves the river's space up front and the swap to
   real cards can't shift the page (the family's no-layout-drift rule). */
.nk-skel-bar { background: var(--nk-chip); border-radius: 6px; }
.nk-skel-meta { width: 42%; max-width: 180px; height: 12px; margin-bottom: 10px; }
.nk-skel-title { width: 94%; height: 17px; margin-bottom: 7px; }
.nk-skel-title-short { width: 63%; }
.nk-skel-summary { width: 86%; height: 12px; margin-top: 4px; }
@media (prefers-reduced-motion: no-preference) {
  .nk-skel .nk-skel-bar { animation: nk-skel-pulse 1.4s ease-in-out infinite; }
}
@keyframes nk-skel-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
`;

// Style installation is idempotent per document (flag property, not a DOM
// query, so it also works before <head> exists).
const RIVER_STYLE_FLAG = '__jfsNewsRiverStyles';

/** Install NEWS_RIVER_CSS into `doc` exactly once. Constructed stylesheet
 *  first (CSP-safe under style-src without 'unsafe-inline'); <style> tag
 *  fallback for engines without adoptedStyleSheets. */
export function ensureNewsRiverStyles(doc = globalThis.document) {
  if (!doc) throw new Error('ensureNewsRiverStyles requires a DOM (browser).');
  if (doc[RIVER_STYLE_FLAG]) return;
  doc[RIVER_STYLE_FLAG] = true;
  try {
    const Sheet = (doc.defaultView || globalThis).CSSStyleSheet;
    const sheet = new Sheet();
    sheet.replaceSync(NEWS_RIVER_CSS);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } catch {
    // No constructable-stylesheet support — fall back to a <style> tag.
    // (Blocked by a strict CSP, but every engine with such a CSP deployment
    // in this family also supports adoptedStyleSheets.)
    const style = doc.createElement('style');
    style.textContent = NEWS_RIVER_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
}

/** "Today" / "Yesterday" / "Thursday, July 17" in the reader's local time.
 *  Accepts epoch ms, ISO string or Date; `now` injectable for tests.
 *  Returns null for missing/invalid dates. */
export function riverDayLabel(ts, now = Date.now()) {
  const t = toMs(ts);
  if (t == null) return null;
  const d = new Date(t);
  const diffDays = riverDayDiff(d, now);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Surf-Tracker's coarse buckets for long-window feeds, where one divider per
 *  day would drown the river: "Today" / "Yesterday" / "Earlier this week" /
 *  "Earlier this month" / "Older". Same contract as riverDayLabel; pass it as
 *  renderNewsRiver's `groupLabel` option for feeds spanning weeks or months. */
export function riverCoarseGroupLabel(ts, now = Date.now()) {
  const t = toMs(ts);
  if (t == null) return null;
  const diffDays = riverDayDiff(new Date(t), now);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'Earlier this week';
  if (diffDays < 30) return 'Earlier this month';
  return 'Older';
}

// Whole local calendar days between `d` and `now` (0 = same day).
function riverDayDiff(d, now) {
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86400000);
}

// Element helper: children are nodes or strings; strings become TEXT nodes,
// so feed content is never parsed as HTML.
function riverNode(doc, tag, className, ...children) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const c of children) {
    if (c == null || c === '') continue;
    node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
  }
  return node;
}

/** Best-effort publication time in epoch ms: ts, publishedAt, published_at. */
function riverItemTime(item) {
  for (const v of [item.ts, item.publishedAt, item.published_at]) {
    const t = toMs(v);
    if (t != null) return t;
  }
  return null;
}

function riverSourceLabel(item, opts) {
  if (item.sourceLabel) return String(item.sourceLabel);
  const key = item.source == null ? '' : String(item.source);
  if (!key) return '';
  const labels = opts.sourceLabels;
  if (typeof labels === 'function') return String(labels(key) || key);
  if (labels && Object.prototype.hasOwnProperty.call(labels, key)) return String(labels[key]);
  return key;
}

/** True when the page runs as an installed app (home-screen / standalone
 *  PWA) rather than in a browser tab. iOS home-screen apps expose
 *  navigator.standalone; everything else answers the display-mode media
 *  query. Fails closed (false → browser-tab behavior). */
export function isStandaloneDisplay(win = globalThis.window) {
  if (!win) return false;
  try {
    if (win.navigator && win.navigator.standalone === true) return true;
    return !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

// See the deep-link rule above: _blank in a browser tab, current-context
// navigation in standalone display so a handoff to the publisher's app
// can't leave an orphaned launch window behind.
function riverExternalLink(a, href, standalone) {
  a.setAttribute('href', href);
  if (!standalone) a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
}

/** Best-effort dek cleanup: feeds frequently hand back a "summary" that is
 *  just the headline again (or the article body, which opens by repeating
 *  the headline). Returns the summary worth showing under the headline —
 *  '' when it would merely duplicate it, the trailing prose when it starts
 *  by repeating it verbatim, the input untouched otherwise. Exported so
 *  apps with their own card renderers share the one policy. */
export function dedupedNewsSummary(title, summary) {
  const t = String(title || '').trim();
  const s = String(summary || '').trim();
  if (!s) return '';
  if (!t) return s;
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const nt = norm(t);
  const ns = norm(s);
  if (!nt) return s;
  if (!ns) return '';
  // The summary IS the headline: identical, a truncation of it, or the
  // headline plus a few trailing characters (ellipsis, "Read more").
  if (ns === nt || nt.startsWith(ns)) return '';
  if (ns.startsWith(nt) && ns.length - nt.length < 24) return '';
  // Article bodies that open by repeating the headline verbatim: keep only
  // the prose after it (when there's a meaningful amount).
  if (s.slice(0, t.length).toLowerCase() === t.toLowerCase()) {
    const rest = s.slice(t.length).replace(/^[\s \-–—:.,;!?…]+/, '');
    return norm(rest).length >= 24 ? rest : '';
  }
  // Normalized-prefix overlap without a verbatim match (punctuation/casing
  // drift): keep the summary — better an echo than eaten prose.
  return s;
}

/**
 * Build one river card. Exported separately from renderNewsRiver so an app
 * with its own layout (columns, tabs) can place cards itself.
 *
 * Item fields (all optional except title): title, url, source (key used for
 * data-source + accents), sourceLabel, ts | publishedAt | published_at,
 * summary, authors (array or string), image, icon (favicon URL), kicker,
 * tag (small chip after the time), badge ({ text, kind }: kind 'full' and
 * 'link' get the FULL TEXT / DEEP LINK treatments; other kinds style via
 * .nk-badge-<kind>).
 *
 * Options: doc, now, sourceLabels (map or fn), accents (source -> CSS color,
 * applied as the --nk-accent custom property via CSSOM), onOpen(item, event)
 * (see the deep-link rule above), readAt ('link' default | 'always' |
 * 'never' — appends a "Read at <source> →" byline link), standalone
 * (boolean — overrides the automatic installed-app detection that decides
 * whether external links carry target=_blank; see the deep-link rule),
 * decorate(card, item).
 */
export function newsRiverCard(item, opts = {}) {
  const doc = opts.doc || globalThis.document;
  if (!doc) throw new Error('newsRiverCard requires a DOM (browser).');
  const now = opts.now ?? Date.now();
  const standalone = opts.standalone ?? isStandaloneDisplay(doc.defaultView || globalThis.window);
  const label = riverSourceLabel(item, opts);
  const url = item.url ? safeContentUrl(item.url) : null;
  const badge = item.badge && item.badge.text ? item.badge : null;

  const meta = riverNode(doc, 'div', 'nk-meta');
  const iconUrl = item.icon ? safeContentUrl(item.icon) : null;
  if (iconUrl) {
    const icon = riverNode(doc, 'img', 'nk-favicon');
    icon.setAttribute('src', iconUrl);
    icon.setAttribute('alt', '');
    icon.setAttribute('loading', 'lazy');
    icon.addEventListener('error', () => icon.remove());
    meta.appendChild(icon);
  }
  if (label) meta.appendChild(riverNode(doc, 'span', 'nk-src', label));
  const t = riverItemTime(item);
  if (t != null) {
    if (label) meta.appendChild(riverNode(doc, 'span', 'nk-dot', '·'));
    const time = riverNode(doc, 'time', 'nk-time', relativeTime(t, now));
    time.setAttribute('datetime', new Date(t).toISOString());
    meta.appendChild(time);
  }
  if (item.tag) meta.appendChild(riverNode(doc, 'span', 'nk-chip', String(item.tag)));
  if (badge) {
    const kind = /^[a-z][a-z0-9-]*$/i.test(String(badge.kind || '')) ? ` nk-badge-${badge.kind}` : '';
    meta.appendChild(riverNode(doc, 'span', `nk-badge${kind}`, String(badge.text)));
  }

  // Headline. With a URL it is ALWAYS a real anchor (deep links + open-in-
  // new-tab affordances survive); onOpen only intercepts plain left-clicks
  // and can decline by returning false.
  const title = String(item.title || '');
  let headline;
  if (url) {
    headline = riverNode(doc, 'a', null, title);
    riverExternalLink(headline, url, standalone);
    if (typeof opts.onOpen === 'function') {
      headline.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (opts.onOpen(item, e) !== false) e.preventDefault();
      });
    }
  } else if (typeof opts.onOpen === 'function') {
    headline = riverNode(doc, 'button', null, title);
    headline.setAttribute('type', 'button');
    headline.addEventListener('click', (e) => { opts.onOpen(item, e); });
  } else {
    headline = riverNode(doc, 'span', null, title);
  }

  const children = [meta];
  if (item.kicker) children.push(riverNode(doc, 'div', 'nk-kicker', String(item.kicker)));
  children.push(riverNode(doc, 'h3', 'nk-headline', headline));
  // A dek that just repeats the headline is noise — dedupe by default
  // (opts.dedupeSummary === false renders the summary verbatim).
  const dek = opts.dedupeSummary === false
    ? (item.summary ? String(item.summary) : '')
    : dedupedNewsSummary(title, item.summary);
  if (dek) children.push(riverNode(doc, 'p', 'nk-summary', dek));

  const authors = Array.isArray(item.authors)
    ? item.authors.filter(Boolean).join(', ')
    : (item.authors ? String(item.authors) : '');
  const readAtMode = opts.readAt || 'link';
  const readAt = url && label && (readAtMode === 'always' || (readAtMode === 'link' && badge && badge.kind === 'link'));
  if (authors || readAt) {
    const by = riverNode(doc, 'div', 'nk-byline');
    if (authors) by.appendChild(doc.createTextNode(authors));
    if (readAt) {
      if (authors) by.appendChild(doc.createTextNode(' · '));
      const a = riverNode(doc, 'a', null, `Read at ${label} →`);
      riverExternalLink(a, url, standalone);
      by.appendChild(a);
    }
    children.push(by);
  }

  let body = riverNode(doc, 'div', 'nk-main', ...children);
  const imgUrl = item.image ? safeContentUrl(item.image) : null;
  if (imgUrl) {
    const thumb = riverNode(doc, 'img', 'nk-thumb');
    thumb.setAttribute('src', imgUrl);
    thumb.setAttribute('alt', '');
    thumb.setAttribute('loading', 'lazy');
    // A broken/blocked image removes itself rather than leaving an empty frame.
    thumb.addEventListener('error', () => thumb.remove());
    body = riverNode(doc, 'div', 'nk-row', body, thumb);
  }

  const card = riverNode(doc, 'article', 'nk-card', body);
  if (item.source != null && item.source !== '') card.setAttribute('data-source', String(item.source));
  // Own-property lookup only — `source` is feed-controlled, so a key like
  // '__proto__' or 'constructor' must not walk the prototype chain (same
  // guard riverSourceLabel applies to the sourceLabels map).
  const accent = opts.accents && item.source != null
    && Object.prototype.hasOwnProperty.call(opts.accents, item.source)
    ? opts.accents[item.source]
    : null;
  // CSSOM property assignment — CSP-safe (style-src governs markup, not CSSOM).
  if (accent) card.style.setProperty('--nk-accent', String(accent));
  if (typeof opts.decorate === 'function') opts.decorate(card, item);
  return card;
}

/**
 * Render `items` into `container` as the river: styles installed (unless
 * opts.styles === false), newest-first (stable re-sort on publication time;
 * undated items keep their relative order at the end), day dividers dropped
 * wherever the local day changes (opts.groupByDay === false disables;
 * opts.groupLabel swaps the labeler — e.g. riverCoarseGroupLabel for
 * long-window feeds), and opts.emptyMessage shown when there is nothing to
 * render. All newsRiverCard options apply.
 */
export function renderNewsRiver(container, items, opts = {}) {
  const doc = opts.doc || container.ownerDocument || globalThis.document;
  if (opts.styles !== false) ensureNewsRiverStyles(doc);
  container.classList.add('nk-river');
  container.replaceChildren();

  const list = Array.isArray(items) ? items.filter((it) => it && it.title) : [];
  if (!list.length) {
    container.appendChild(riverNode(doc, 'p', 'nk-empty', opts.emptyMessage || 'No stories yet.'));
    return;
  }

  const now = opts.now ?? Date.now();
  const sorted = list
    .map((it, i) => ({ it, i, t: riverItemTime(it) }))
    .sort((a, b) => {
      if (a.t != null && b.t != null && a.t !== b.t) return b.t - a.t;
      if (a.t != null && b.t == null) return -1;
      if (a.t == null && b.t != null) return 1;
      return a.i - b.i;
    });

  // Resolve the installed-app check once for the whole river, not per card.
  const cardOpts = {
    ...opts,
    doc,
    now,
    standalone: opts.standalone ?? isStandaloneDisplay(doc.defaultView || globalThis.window),
  };
  const groupLabel = typeof opts.groupLabel === 'function' ? opts.groupLabel : riverDayLabel;
  let lastDay = null;
  for (const { it, t } of sorted) {
    if (opts.groupByDay !== false) {
      // Undated items sort last; give them a neutral divider instead of
      // letting them sit under the previous (wrong) day's heading. A river
      // of ONLY undated items gets no divider at all.
      const day = t != null ? groupLabel(t, now) : (lastDay != null ? (opts.undatedLabel || 'Earlier') : null);
      if (day && day !== lastDay) {
        container.appendChild(riverNode(doc, 'h2', 'nk-day', day));
        lastDay = day;
      }
    }
    container.appendChild(newsRiverCard(it, cardOpts));
  }
}

/**
 * Paint `count` fixed-height placeholder cards into `container` — the
 * standard cold-load state. Skeleton cards match a real text card's height,
 * so the space the river will occupy is reserved before any data arrives and
 * the swap to content (a later renderNewsRiver call over the same container)
 * cannot shift the page. Use ONLY when there is nothing to show: a feed with
 * cached/last-good items should keep them visible through a refresh instead
 * (repainting content with skeletons is itself layout drift).
 */
export function renderNewsRiverSkeletons(container, opts = {}) {
  const doc = opts.doc || container.ownerDocument || globalThis.document;
  if (opts.styles !== false) ensureNewsRiverStyles(doc);
  container.classList.add('nk-river');
  container.replaceChildren();
  const count = Number.isFinite(opts.count) ? Math.min(Math.max(Math.floor(opts.count), 1), 20) : 6;
  for (let i = 0; i < count; i += 1) {
    const card = riverNode(doc, 'article', 'nk-card nk-skel', riverNode(
      doc,
      'div',
      'nk-main',
      riverNode(doc, 'div', 'nk-skel-bar nk-skel-meta'),
      riverNode(doc, 'div', 'nk-skel-bar nk-skel-title'),
      riverNode(doc, 'div', 'nk-skel-bar nk-skel-title nk-skel-title-short'),
      riverNode(doc, 'div', 'nk-skel-bar nk-skel-summary'),
    ));
    // Decorative only — screen readers should wait for the real cards.
    card.setAttribute('aria-hidden', 'true');
    container.appendChild(card);
  }
}


// ===================== source-menu =====================
// The source filter behind John's News and BearsMockDraft's Sources sheet,
// extracted as the family's shared implementation (both apps carried a
// byte-for-byte port of the same ~150 lines; "John's News source-menu
// parity" was already a code comment in Bears). The "Art-Gallery two-control
// model": every row carries two independent controls that never share a
// code path —
//
//   1. The source NAME is a drill-down link: tapping it pins the river to
//      just that source. A session-only view state (deliberately NOT
//      persisted — reopening the app always starts unpinned), it wins over
//      the multi-select while active, and re-tapping the pinned source
//      clears it. The app should close its sheet on drill so the filtered
//      river is visible right away.
//   2. The CHECKBOX on the opposite side builds a multi-source selection:
//      toggling keeps the sheet open, refilters the river live, and the
//      selection persists (localStorage) until "All sources" clears it.
//
// The controller is container-agnostic: it renders the trigger button's
// content and the sheet's rows, but the sheet itself (modal-kit dialog,
// bottom sheet, popover) belongs to the app. Wire `onChange(reason)` and
// close your sheet when `reason` is 'drill' or 'clear'; re-render your feed
// through `filterItems()` on every change.

/** Per-source story counts for menu rows and the trigger-button total.
 *  Prototype-safe (null-prototype result; feed-controlled keys like
 *  '__proto__' are just data). `sourceOf` overrides the default
 *  `item.source` accessor. */
export function countBySource(items, sourceOf) {
  const of = typeof sourceOf === 'function'
    ? sourceOf
    : (it) => (it && it.source != null ? String(it.source) : '');
  const counts = Object.create(null);
  for (const it of items || []) {
    const key = of(it);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// The sheet usually lives OUTSIDE the .nk-river element, so the theme
// variables are re-declared here at zero specificity for .nk-sources and the
// trigger button — same palette, same override story (a consumer restyles
// with a plain `.nk-sources { --nk-link: … }` rule).
export const SOURCE_MENU_CSS = `
:where(.nk-sources, .nk-source-btn) {
  --nk-ink: #14171a;
  --nk-muted: #5b6570;
  --nk-line: #e3e7eb;
  --nk-link: #0b5cad;
  --nk-chip: #eef1f4;
}
@media (prefers-color-scheme: dark) {
  :where(.nk-sources, .nk-source-btn) {
    --nk-ink: #e8ebee;
    --nk-muted: #9aa4ad;
    --nk-line: #262c31;
    --nk-link: #5aa9f5;
    --nk-chip: #20262b;
  }
}
.nk-sources { color: var(--nk-ink); }
.nk-sources-heading {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--nk-muted);
  margin: 0 0 6px;
}
.nk-source-all {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 13px 4px;
  background: none;
  border: 0;
  border-bottom: 1px solid var(--nk-line);
  font: inherit;
  color: var(--nk-ink);
  cursor: pointer;
  text-align: left;
}
.nk-source-all[aria-pressed="true"] .nk-source-name { color: var(--nk-link); font-weight: 700; }
.nk-source-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
  border-bottom: 1px solid var(--nk-line);
}
.nk-source-link {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 13px 4px;
  background: none;
  border: 0;
  font: inherit;
  color: var(--nk-ink);
  cursor: pointer;
  text-align: left;
}
.nk-source-link:disabled { cursor: default; opacity: 0.45; }
.nk-source-link .nk-source-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* reads as a hyperlink: accent color, deliberately no underline */
  color: var(--nk-link);
}
.nk-source-count {
  opacity: 0.65;
  margin-left: 2px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.nk-source-go { margin-left: auto; opacity: 0.45; font-size: 18px; }
.nk-source-row--active .nk-source-name { font-weight: 700; }
.nk-source-row--active .nk-source-go { opacity: 0.9; color: var(--nk-link); }
.nk-source-check { display: flex; align-items: center; padding: 0 6px 0 12px; cursor: pointer; }
.nk-source-checkbox { width: 20px; height: 20px; accent-color: var(--nk-link); cursor: pointer; }
.nk-source-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  cursor: pointer;
}
.nk-source-btn .nk-source-caret { opacity: 0.6; font-size: 11px; }
`;

const SOURCE_MENU_STYLE_FLAG = '__jfsNewsSourceMenuStyles';

/** Install SOURCE_MENU_CSS into `doc` exactly once (same CSP-safe strategy
 *  as ensureNewsRiverStyles: constructed stylesheet, <style> fallback). */
export function ensureSourceMenuStyles(doc = globalThis.document) {
  if (!doc) throw new Error('ensureSourceMenuStyles requires a DOM (browser).');
  if (doc[SOURCE_MENU_STYLE_FLAG]) return;
  doc[SOURCE_MENU_STYLE_FLAG] = true;
  try {
    const Sheet = (doc.defaultView || globalThis).CSSStyleSheet;
    const sheet = new Sheet();
    sheet.replaceSync(SOURCE_MENU_CSS);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } catch {
    const style = doc.createElement('style');
    style.textContent = SOURCE_MENU_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
}

/**
 * Build the family source-filter controller.
 *
 * Options:
 *   storageKey    localStorage key for the persisted multi-select (omit for
 *                 a session-only filter);
 *   storage       injectable Storage (defaults to globalThis.localStorage;
 *                 every access is guarded, so private-mode throws are
 *                 non-fatal);
 *   sourceLabels  map or fn — source key -> human label (same contract as
 *                 the river's option of the same name);
 *   heading       sheet heading text ('' suppresses; default 'Sources');
 *   allLabel      the reset row's label (default 'All sources');
 *   onChange(reason, menu)  fires after every state change: 'drill' |
 *                 'toggle' | 'clear'. Re-render the feed through
 *                 filterItems(); close the sheet on 'drill' and 'clear';
 *   doc           Document override (tests).
 *
 * Returned API: state() -> { drill, selected: string[] }; isFiltered();
 * filterItems(items, sourceOf?); setCounts(counts); drillTo(src);
 * toggle(src); clear(); renderButton(btn); renderMenu(container);
 * buttonState() -> { text, count, active } for apps with bespoke buttons.
 */
export function createSourceMenu(opts = {}) {
  const doc = opts.doc || globalThis.document;
  const storageKey = opts.storageKey || null;
  const heading = opts.heading === undefined ? 'Sources' : String(opts.heading);
  const allLabel = opts.allLabel === undefined ? 'All sources' : String(opts.allLabel);

  function storageOf() {
    if (opts.storage !== undefined) return opts.storage;
    try {
      return globalThis.localStorage;
    } catch {
      return null; // storage disabled (privacy mode) — filter is session-only
    }
  }

  function loadSaved() {
    if (!storageKey) return new Set();
    try {
      const s = storageOf();
      const arr = JSON.parse((s && s.getItem(storageKey)) || '[]');
      return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
    } catch {
      return new Set(); // corrupt/unreadable saved state -> "all sources"
    }
  }

  function save() {
    if (!storageKey) return;
    try {
      const s = storageOf();
      if (s) s.setItem(storageKey, JSON.stringify([...selected]));
    } catch {
      // storage disabled/full — non-fatal, filter still works this session
    }
  }

  function labelOf(src) {
    const labels = opts.sourceLabels;
    if (typeof labels === 'function') return String(labels(src) || src);
    if (labels && Object.prototype.hasOwnProperty.call(labels, src)) return String(labels[src]);
    return String(src);
  }

  // A drill-down is session-only view state; the checkbox Set persists.
  let drill = null;
  const selected = loadSaved();
  // Null-prototype, like countBySource's result: source keys are
  // feed-controlled, and a lookup such as counts['constructor'] on a plain
  // object would find Object.prototype members instead of a count.
  let counts = Object.create(null);
  let btnEl = null;
  let menuEl = null;

  function changed(reason) {
    if (btnEl && btnEl.isConnected !== false) renderButton(btnEl);
    if (menuEl && menuEl.isConnected !== false) renderMenu(menuEl);
    if (typeof opts.onChange === 'function') opts.onChange(reason, api);
  }

  function drillTo(src) {
    // Re-tapping the pinned source unpins it; the saved checkboxes are a
    // separate concern and are left untouched (pure view change).
    drill = drill === src ? null : src;
    changed('drill');
  }

  function toggle(src) {
    // Building a multi-select supersedes a single-source drill-down: drop
    // the pin so the checkboxes' effect is visible immediately.
    drill = null;
    if (selected.has(src)) selected.delete(src);
    else selected.add(src);
    save();
    changed('toggle');
  }

  function clear() {
    drill = null;
    selected.clear();
    save();
    changed('clear');
  }

  function filterItems(items, sourceOf) {
    const of = typeof sourceOf === 'function'
      ? sourceOf
      : (it) => (it && it.source != null ? String(it.source) : '');
    const list = items || [];
    if (drill) return list.filter((it) => of(it) === drill);
    if (selected.size) return list.filter((it) => selected.has(of(it)));
    return list;
  }

  function totalCount() {
    return Object.keys(counts).reduce((n, k) => n + (counts[k] || 0), 0);
  }

  function buttonState() {
    const sel = [...selected];
    const text = drill ? labelOf(drill)
      : sel.length === 0 ? allLabel
      : sel.length === 1 ? labelOf(sel[0])
      : `${sel.length} sources`;
    const count = drill ? (counts[drill] || 0)
      : sel.length === 0 ? totalCount()
      : sel.reduce((n, s) => n + (counts[s] || 0), 0);
    return { text, count, active: !!drill || selected.size > 0 };
  }

  /** Fill a trigger button: label + count + caret, `.is-filtered` when a
   *  filter is active. The button element (and its aria-haspopup/expanded
   *  wiring) belongs to the app. */
  function renderButton(btn) {
    btnEl = btn;
    if (!btn) return;
    ensureSourceMenuStyles(btn.ownerDocument || doc);
    btn.classList.add('nk-source-btn');
    const d = btn.ownerDocument || doc;
    const st = buttonState();
    btn.replaceChildren(
      d.createTextNode(st.text),
      srcNode(d, 'span', 'nk-source-count', String(st.count)),
      srcNode(d, 'span', 'nk-source-caret', '▾'),
    );
    btn.classList.toggle('is-filtered', st.active);
  }

  /** Build the sheet body: heading, the "All sources" reset row, then one
   *  row per source (busiest first). Persisted selections missing from the
   *  current counts render with count 0 so they can still be unchecked. */
  function renderMenu(container) {
    menuEl = container;
    if (!container) return;
    const d = container.ownerDocument || doc;
    ensureSourceMenuStyles(d);
    container.classList.add('nk-sources');
    container.replaceChildren();

    if (heading) container.appendChild(srcNode(d, 'h2', 'nk-sources-heading', heading));

    const allActive = !drill && selected.size === 0;
    const allRow = srcNode(
      d,
      'button',
      'nk-source-all',
      srcNode(d, 'span', 'nk-source-name', (allActive ? '✓ ' : '') + allLabel),
      srcNode(d, 'span', 'nk-source-count', String(totalCount())),
    );
    allRow.setAttribute('type', 'button');
    allRow.setAttribute('aria-pressed', String(allActive));
    allRow.addEventListener('click', () => clear());
    container.appendChild(allRow);

    // Busiest first — the head of the list is what actually gets tapped.
    const keys = Object.keys(counts);
    selected.forEach((s) => { if (!keys.includes(s)) keys.push(s); });
    keys.sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b));

    for (const src of keys) {
      const n = counts[src] || 0;
      const drilled = drill === src;
      const clickable = n > 0 || drilled;
      const text = labelOf(src);

      const link = srcNode(
        d,
        'button',
        'nk-source-link',
        srcNode(d, 'span', 'nk-source-name', text),
        srcNode(d, 'span', 'nk-source-count', String(n)),
        clickable ? srcNode(d, 'span', 'nk-source-go', '›') : null,
      );
      link.setAttribute('type', 'button');
      link.setAttribute('aria-pressed', String(drilled));
      link.setAttribute('aria-label', (drilled ? 'Stop showing only ' : 'Show only ') + text);
      if (!clickable) link.disabled = true;
      link.addEventListener('click', () => drillTo(src));
      const go = link.querySelector('.nk-source-go');
      if (go) go.setAttribute('aria-hidden', 'true');

      const box = srcNode(d, 'input', 'nk-source-checkbox');
      box.setAttribute('type', 'checkbox');
      box.setAttribute('aria-label', `${text} — include in a multi-source selection`);
      box.checked = selected.has(src);
      box.addEventListener('change', () => toggle(src));
      const check = srcNode(d, 'label', 'nk-source-check', box);
      check.title = selected.has(src) ? 'Selected — tap to remove' : 'Tap to add to a multi-source selection';

      const row = srcNode(d, 'div', `nk-source-row${drilled ? ' nk-source-row--active' : ''}`, link, check);
      container.appendChild(row);
    }
  }

  const api = {
    state: () => ({ drill, selected: [...selected] }),
    isFiltered: () => !!drill || selected.size > 0,
    filterItems,
    setCounts(c) {
      // Re-key onto a null-prototype object so an app passing a plain-object
      // map (or parsed JSON) can't leak Object.prototype members into
      // counts[src] lookups for hostile source keys ('constructor', …).
      counts = Object.assign(Object.create(null), c || {});
      if (btnEl) renderButton(btnEl);
      if (menuEl && menuEl.isConnected) renderMenu(menuEl);
    },
    drillTo,
    toggle,
    clear,
    renderButton,
    renderMenu,
    buttonState,
  };
  return api;
}

// Element helper for the source menu (same contract as riverNode: string
// children become TEXT nodes, so labels/counts are never parsed as HTML).
function srcNode(doc, tag, className, ...children) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const c of children) {
    if (c == null || c === '') continue;
    node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
  }
  return node;
}

// ===================== dom =====================
// ABSORBED FROM @jfs/dom-kit (v0.3.3) — the generic DOM / escaping / URL-guard
// primitives, retired into this kit so the family stops paying for a separate
// repo, CI, pin and vendoring flow for 13 exports that overlapped this one.
//
// Two groups:
//
//   Group A — PURE (no DOM): the escaper (see the `escape` section — ONE
//     implementation now, exported as escapeHtml / escHtml / escAttr) plus the
//     URL guards safeUrl, safeImageUrl, sanitizeUrl, sanitizeHref.
//
//   Group B — DOM-dependent: el / elem, byId, $ / $$, sanitizeHtml. These
//     reach for `document` / `DOMParser`, which the browser supplies at
//     runtime (and a DOM shim supplies in tests). This module imports
//     NOTHING — it stays dependency-free at install time.
//
// Compatibility-superset rule: the sibling apps grew slightly different
// helpers for the same idea, so they adopt the kit by changing IMPORT PATHS,
// not call sites. That means we keep BOTH URL-guard fallbacks (safeUrl → "#",
// sanitizeUrl → "") byte-for-byte like their origins.
//
// WHY THE URL GUARDS ARE NOT DEDUPLICATED. Six guards now live in this file
// and NONE of them are interchangeable — a differential run over a shared
// corpus found all fifteen pairs differing on real inputs:
//
//   safeUrl(u)           -> string, rejects to "#". Allows http(s), mailto:,
//                           protocol-relative (rewritten to https:), and
//                           relative "/", "#", "?". For href attributes.
//   safeImageUrl(u)      -> string, rejects to "". Allows http(s),
//                           protocol-relative (→ https:), blob:, data:image/*.
//                           NO relative paths. For <img src> ONLY.
//   sanitizeUrl(u)       -> string, rejects to "". new URL() + http(s) only,
//                           returns the normalized href HTML-ESCAPED
//                           (`&` → `&amp;`). For innerHTML interpolation.
//   sanitizeHref(u)      -> string, rejects to "". Same parse/whitelist as
//                           sanitizeUrl but NOT HTML-escaped. For setAttribute
//                           / .href / .src, where escaping would over-encode.
//   safeContentUrl(u)    -> string|null, rejects to null. Same parse/whitelist
//                           as sanitizeHref, but ALSO requires a string input
//                           (`safeContentUrl(new URL(...))` → null, whereas
//                           `sanitizeHref(new URL(...))` → the href) and
//                           signals reject with null rather than "".
//   isSafeContentUrl(u)  -> boolean. Permissive feed-content predicate: allows
//                           absolute http(s), protocol-relative, root-relative
//                           AND bare relative text; rejects anything else
//                           carrying a scheme.
//
// Concrete divergences that make a silent unification a security/behavior
// change rather than a refactor:
//   "//evil.com/x"  → safeUrl "https://evil.com/x" | safeImageUrl
//                     "https://evil.com/x" | sanitizeUrl "" | sanitizeHref ""
//                     | safeContentUrl null | isSafeContentUrl true
//   "/root/rel"     → safeUrl "/root/rel" | safeImageUrl "" | isSafeContentUrl
//                     true | the three URL()-parsing guards reject
//   "mailto:a@b.c"  → safeUrl "mailto:a@b.c" | everything else rejects
//   "data:image/png;base64,AAA" → safeImageUrl keeps it | everything else
//                     rejects (this is exactly why safeImageUrl is <img>-only)
//   "http://x/?a=1&b=2" → sanitizeUrl "…&amp;b=2" | sanitizeHref /
//                     safeContentUrl "…&b=2"
//
// The ONE pair that WAS collapsed is the escaper: dom-kit's escapeHtml and
// news-kit's escHtml agreed on all 85,683 differential inputs, so there is a
// single implementation with both names (plus escAttr) exported.

/**
 * Art-Gallery URL guard. Allows http(s):, mailto:, protocol-relative
 * (`//` → https:), and relative (`/`, `#`, `?`). Everything else — including
 * javascript:, data:, vbscript: — collapses to `"#"` so a link never fires a
 * hostile scheme. Shares the policy-owned URL_CONTROL_CHARS strip with the
 * feed-content guards above.
 */
export function safeUrl(url) {
  if (url == null) return '#';
  const s = String(url).replace(URL_CONTROL_CHARS, '').trim();
  if (!s) return '#';
  // Protocol-relative is treated as https. This check has to run before the
  // single-slash check below, otherwise "//evil.com" would return verbatim
  // and resolve against the current scheme (file://, http://, etc.).
  if (s.startsWith('//')) return 'https:' + s;
  // Relative paths and fragments are safe.
  if (s.startsWith('/') || s.startsWith('#') || s.startsWith('?')) return s;
  const lower = s.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
    return s;
  }
  return '#';
}

/**
 * Allow only http(s), protocol-relative, blob:, and data:image/* URLs as
 * <img src>. Everything else (javascript:, data:text/html, vbscript:, file:,
 * …) returns an empty string so the browser doesn't issue any request.
 *
 * NOTE: permits `data:image/*` and is intended for `<img>` src ONLY — do not
 * reuse for `<object>`/`<embed>`/`<iframe>` src (their data: URLs can execute).
 */
export function safeImageUrl(url) {
  if (url == null) return '';
  const s = String(url).replace(URL_CONTROL_CHARS, '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return 'https:' + s;
  const lower = s.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return s;
  if (lower.startsWith('blob:')) return s;
  if (lower.startsWith('data:image/')) return s;
  return '';
}

/**
 * JFS-Sports URL sanitizer for innerHTML interpolation. Parses with `new
 * URL()`, whitelists http(s) only, and returns the HTML-ESCAPED normalized
 * href. Reject / parse-fail → `""`.
 *
 * Whitelist (not blacklist) so a future protocol can't slip through a missing
 * branch. u.href is the parsed/normalised form; escapeHtml additionally
 * encodes & → &amp; for valid HTML attributes.
 */
export function sanitizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return escapeHtml(u.href);
    return '';
  } catch {
    return '';
  }
}

/**
 * Like sanitizeUrl, but returns the URL WITHOUT HTML-attribute escaping. Use
 * when passing the value through setAttribute / element.src / element.href,
 * where the DOM stores the attribute verbatim and HTML escaping would
 * over-encode characters like `&` (`http://x.com/?a=1&b=2` → broken).
 * Reject / parse-fail → `""`.
 *
 * Differs from safeContentUrl only in its reject sentinel ("" vs null) and in
 * accepting any `new URL()`-coercible value (a URL object, say) rather than
 * requiring a string — which is why both survive the merge.
 */
export function sanitizeHref(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    return '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Group B — DOM-dependent helpers
// ---------------------------------------------------------------------------

// Tiny DOM-builder helper used by renderers to replace
// `node.innerHTML = '...'` patterns with structural construction.
// Text-shaped values pass through textContent (auto-escaped),
// eliminating the need for escapeHtml() at every interpolation
// point and removing one whole class of XSS surface area: a
// renderer that forgets `escapeHtml(apiResponseField)` while
// building an HTML string used to ship a working injection
// vector; the same renderer using `el(...)` cannot.
//
// Usage:
//   el('div', { class: 'card' }, el('span', null, 'hello'))
//
// Special attribute keys:
//   class    → element.className
//   text     → element.textContent (shortcut for a single string
//              child; can't be combined with children args)
//   data     → object whose keys/values become element.dataset.*
//             (camelCase keys become data-camel-case attributes
//             per the standard DOMStringMap rules)
//   on       → object whose keys are event names → handler
//             functions. Event delegation via data-action is the
//             default pattern; this is for the rare per-element
//             listener case.
//   Anything else → setAttribute(key, value) when the value is
//                   non-null. null / undefined values are skipped
//                   so `{ title: maybeText }` doesn't emit
//                   `title=""`.
//
// Children:
//   * null / undefined / false → skipped
//   * string                   → text node (auto-escaped)
//   * Node                     → appended as-is
//   * array                    → flattened (one level)
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'data') {
        for (const dk of Object.keys(v)) {
          const dv = v[dk];
          if (dv != null) node.dataset[dk] = String(dv);
        }
      } else if (k === 'on') {
        for (const ek of Object.keys(v)) {
          node.addEventListener(ek, v[ek]);
        }
      } else if (/^on/i.test(k)) {
        // Never set inline event-handler attributes (onclick/onerror/…)
        // from a (possibly computed) attr name — that would smuggle
        // script through the auto-escaping builder. Use the `on` key
        // for real listeners instead.
        continue;
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Weather-compatible thin wrapper over el() — `elem(tag, className, text)` —
 * so Weather migrates without call-site changes.
 */
export function elem(tag, className, text) {
  return el(tag, { class: className || null, text: text == null ? null : text });
}

/** document.getElementById shorthand (FlightCheck & Weather's `$`). */
export const byId = (id) => document.getElementById(id);

/** CSS-selector query shorthand (Art-Gallery-style `$` / `$$`). */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Whitelist-based HTML sanitizer for description blobs that some sources
// supply pre-formatted. Returns a STRING of HTML safe to assign to innerHTML —
// the string-returning sibling of sanitizeHtmlToFragment above, with its own
// (smaller) allowlist and its own attribute policy, so the two are kept
// separate rather than unified. Anything not on the allow-list —
// script/style/iframe, on* attributes, javascript: URLs, etc. — is dropped.
const _ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'cite', 'code', 'dd', 'dl', 'dt',
  'em', 'i', 'li', 'ol', 'p', 'pre', 'small', 'span', 'strong', 'sub',
  'sup', 'u', 'ul',
]);
const _ALLOWED_ATTRS = {
  a:    new Set(['href', 'title']),
  abbr: new Set(['title']),
  span: new Set(['title']),
};

// Tags whose ENTIRE SUBTREE is removed rather than unwrapped. Derived from
// DEFAULT_BLOCKED — the kit's single policy-owned copy of the family's
// blocked-tag list (see the sanitize-html section) — lowercased because
// _scrub compares lowercased tag names. Before the kits merged, this list was
// a SECOND policy-marked blocked-tags region living in dom-kit that had to be
// kept in sync across repos by the family sync tool (and drifted once — MATH).
// Deriving it removes the possibility of drift entirely — and the comment
// deliberately does NOT spell the marker prefix, because the vendoring
// tree-shaker treats any declaration whose text contains it as a permanent
// root.
const _BLOCKED_TAGS = new Set([...DEFAULT_BLOCKED].map((t) => t.toLowerCase()));

export function sanitizeHtml(html) {
  if (html == null) return '';
  const str = String(html);
  if (!str) return '';
  const doc = new DOMParser().parseFromString(`<div>${str}</div>`, 'text/html');
  const root = doc.body.firstChild;
  if (!root) return '';
  _scrub(root);
  return root.innerHTML;
}

function _scrub(node, depth = 0) {
  // Fail CLOSED past the depth cap: this scrub mutates in place, so bailing
  // out with the subtree intact would keep UNsanitized markup. Empty the
  // node instead. (MAX_DEPTH is shared with sanitizeHtmlToFragment — both
  // sanitizers used the same 256 before the merge.)
  if (depth > MAX_DEPTH) {
    node.textContent = '';
    return;
  }
  // Walk children with a snapshot — replacing nodes mutates the live list.
  const kids = Array.from(node.childNodes);
  for (const child of kids) {
    if (child.nodeType === 1 /* Element */) {
      // Foreign-content (SVG/MathML) elements have lowercase tag names in
      // their own namespace; unwrapping them into an HTML sink can
      // resurrect HTML-breakout children (mXSS). Drop non-XHTML elements
      // entirely, subtree included.
      if (child.namespaceURI && child.namespaceURI !== XHTML_NS) {
        node.removeChild(child);
        continue;
      }
      const tag = child.tagName.toLowerCase();
      if (_BLOCKED_TAGS.has(tag)) {
        // Remove the element AND its subtree — never unwrap these.
        node.removeChild(child);
        continue;
      }
      if (!_ALLOWED_TAGS.has(tag)) {
        // Unwrap unknown tags: keep the children, drop the wrapper. This
        // preserves text content from things like <div>/<font>/<img>.
        //
        // CRITICAL: scrub the subtree BEFORE hoisting it. The outer loop
        // iterates a snapshot (`kids`) taken before this insertion, so
        // nodes moved up to `node` here are never revisited — hoisting
        // an unscrubbed <script>/onerror/javascript: child would ship it
        // verbatim. Scrubbing while the children are still inside `child`
        // cleans them in place, then we lift the now-safe result.
        _scrub(child, depth + 1);
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        continue;
      }
      const allowed = _ALLOWED_ATTRS[tag] || new Set();
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!allowed.has(name)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === 'href') {
          const safe = safeUrl(attr.value);
          child.setAttribute('href', safe);
          // Anchor links open in a new tab — give them noopener/noreferrer
          // so the target page can't reach back via window.opener.
          if (safe !== '#') {
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          }
        }
      }
      _scrub(child, depth + 1);
    } else if (child.nodeType !== 3 /* Text */ && child.nodeType !== 4 /* CDATA */) {
      // Drop comments, processing instructions, etc.
      node.removeChild(child);
    }
  }
}

// ===================== modal =====================
// ABSORBED FROM @jfs/modal-kit (v0.1.4) — accessible dialog plumbing for the
// JFS family of buildless static PWAs: focus trap + focus save/restore,
// iOS-safe scroll-lock, a central Escape stack, marker-guarded inert/
// aria-hidden siblings, bfcache cleanup, and an opt-in history-sentinel so the
// browser Back button (and iOS edge-swipe) closes the topmost dialog.
//
// Six repos hand-roll this, ranging from best-in-class to buggy. Bears'
// js/lib/modal.js has the robust *environment* layer (position:fixed
// scroll-lock with offset restore, marker-guarded inert siblings, soft-keyboard
// blur, pagehide cleanup) but no Tab trap; JFS-Sports' modal-focus.js and
// Art-Gallery's createModalSession have the *lifecycle* layer (a real focus
// trap, a reference-counted open stack, history-back close). This section is
// the promoted superset: Bears' scroll-lock/inert/pagehide + Art-Gallery's
// trap/stack/history, in one API.
//
// Dependency-free. It reads the ambient `document` / `window` / `history`
// (like every reference impl — these are page scripts), so calling an
// instance's open()/close() requires a DOM. IMPORTING THE MODULE DOES NOT, and
// nothing here runs at module scope: the shared Escape / popstate / pagehide
// listeners are wired LAZILY, on the first open() (see wireGlobals), which is
// what keeps the package's `"sideEffects": false` honest and lets a narrowed
// vendored build tree-shake this section away entirely.
//
// One call per dialog:
//
//   import { createModal } from './news-kit/index.js';
//   const modal = createModal(document.getElementById('sheet'), {
//     focusTarget: '#sheet-close',
//     onClose: () => resetForm(),
//   });
//   openBtn.addEventListener('click', () => modal.open());
//
// Scroll-lock uses a `position: fixed` body class (default `.modal-open`); ship
//   .modal-open { position: fixed; width: 100%; }
// in your CSS so the page can't scroll behind the dialog.
//
// NAMING NOTE (merge): modal-kit's local/parameter name for the dialog element
// was `el`. In this merged kit `el` is the exported element builder absorbed
// from @jfs/dom-kit, so the dialog binding is spelled `dialogEl` / `target`
// here — which also keeps the vendoring tree-shaker from false-rooting the
// builder into every narrowed modal build. The PUBLIC contract is unchanged:
// the onOpen/onClose payload is still `{ el }`.

// ───────────────────────── shared module state ─────────────────────────

// Sessions currently open, in open order. The last entry is the topmost dialog
// (the one Escape and the Back button act on). Reference-counted for scroll-lock.
const openStack = [];

let globalsWired = false;
let savedScrollY = 0;
// Set right before we call history.back() ourselves, so the popstate it fires
// is recognized as our own and doesn't double-close.
let expectOwnPopstate = false;

// Scroll-lock is reference-counted across every OPEN dialog that asked for it —
// independent of the Escape/history stack. Without a dedicated count, a
// `scrollLock:false` dialog closing last could leave the body frozen, or one
// opening second could suppress a `scrollLock:true` dialog's lock. We remember
// the doc + class used to lock so the unlock (possibly triggered by a different
// dialog or pagehide) reverses exactly that.
let scrollLockCount = 0;
let lockedDoc = null;
let lockedClass = null;

// History-sentinel sessions in push order, so a programmatic close only pops the
// browser history entry when it's the topmost sentinel (popping a buried one
// would desync the guard from the visible dialog).
const historyStack = [];

// The standard focusable set, plus contenteditable and positive-tabindex nodes.
// @__PURE__ for the same reason as `classify` above: .join() is a top-level
// call, and without the annotation every narrowed build that skips the modal
// section still ships this selector.
const FOCUSABLE_SELECTOR = /* @__PURE__ */ [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function winOf(target) {
  return (target.ownerDocument && target.ownerDocument.defaultView) || globalThis.window || globalThis;
}

// Run a user-supplied lifecycle callback without letting it escape. A throwing
// onOpen/onClose must not propagate out of a shared document/window handler
// (Escape, popstate) or out of open()/close() and leave the page with scroll
// still locked or siblings still inert.
function safeCall(fn, arg) {
  if (typeof fn !== 'function') return;
  try {
    fn(arg);
  } catch (err) {
    // Surface for debugging without breaking modal teardown.
    if (typeof console !== 'undefined' && console.error) {
      console.error('[news-kit/modal] lifecycle callback threw:', err);
    }
  }
}

function isVisible(target) {
  // Layout-free visibility check: honors `aria-hidden`, the element's own
  // computed `visibility` (which inherits), and — crucially — `display:none`
  // (and the `hidden` attribute, which is UA `display:none`) ANYWHERE up the
  // ancestor chain. `display` doesn't inherit, so an element inside a
  // `display:none` wrapper has its own `display:block` and would otherwise slip
  // through, letting the Tab trap focus an unrendered control. Deliberately
  // avoids offsetParent/size so it stays correct under a layout-less test DOM
  // (jsdom) as well as in real browsers.
  if (target.getAttribute && target.getAttribute('aria-hidden') === 'true') return false;
  const view = winOf(target);
  const getCS = typeof view.getComputedStyle === 'function' ? (n) => view.getComputedStyle(n) : null;
  if (getCS) {
    const own = getCS(target);
    if (own && own.visibility === 'hidden') return false;
  }
  for (let node = target; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hasAttribute && node.hasAttribute('hidden')) return false;
    if (getCS) {
      const s = getCS(node);
      if (s && s.display === 'none') return false;
    }
  }
  return true;
}

/** Visible, focusable descendants of `container`, in DOM order. Exported so
 *  consumers/tests can reuse the same focusable definition the trap uses. */
export function getFocusable(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
}

/** True while any dialog created by this module is open. */
export function isAnyModalOpen() {
  return openStack.length > 0;
}

function topSession() {
  return openStack[openStack.length - 1] || null;
}

// ───────────────────────── shared globals (wired once) ─────────────────────

// Called from open(), never at module scope — see the side-effect note above.
function wireGlobals(doc) {
  if (globalsWired) return;
  globalsWired = true;

  // Escape closes the topmost dialog that opted in. `defaultPrevented` lets a
  // dialog's own handler (or a nested widget) suppress this.
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    if (e.defaultPrevented) return;
    const top = topSession();
    if (top && top.escClose) {
      e.preventDefault();
      top.requestClose();
    }
  });

  // Browser Back / iOS edge-swipe: close the topmost history-enabled dialog
  // rather than navigating the page away.
  const view = doc.defaultView || globalThis.window;
  if (view && typeof view.addEventListener === 'function') {
    view.addEventListener('popstate', () => {
      if (expectOwnPopstate) {
        expectOwnPopstate = false;
        return;
      }
      // The user popped the topmost sentinel — close the dialog that pushed it
      // (not just whatever is visually on top), and don't push another back().
      const sess = historyStack[historyStack.length - 1];
      if (sess) {
        historyStack.pop();
        sess.requestClose(true);
      }
    });

    // bfcache safety: if the page is frozen with a dialog open, make sure the
    // scroll-lock class/offset can't survive a restore and freeze the page.
    view.addEventListener('pagehide', () => {
      forceUnlockScroll();
    });
  }
}

// ───────────────────────── scroll lock (reference-counted) ──────────────────

function acquireScrollLock(doc, cls) {
  if (scrollLockCount === 0) {
    lockedDoc = doc;
    lockedClass = cls;
    const view = doc.defaultView || globalThis.window;
    savedScrollY = (view && (view.scrollY || view.pageYOffset)) || 0;
    doc.body.classList.add(cls);
    // Set via CSSOM (not an inline style attribute), so a strict CSP style-src
    // without 'unsafe-inline' still allows it.
    doc.body.style.top = `-${savedScrollY}px`;
  }
  scrollLockCount++;
}

function releaseScrollLock() {
  if (scrollLockCount === 0) return;
  scrollLockCount--;
  if (scrollLockCount === 0) forceUnlockScroll();
}

// Reverse whatever acquireScrollLock did, using the doc/class it locked with
// (the releasing dialog — or pagehide — may not be the one that locked).
function forceUnlockScroll() {
  if (!lockedDoc || !lockedDoc.body) {
    scrollLockCount = 0;
    lockedDoc = null;
    lockedClass = null;
    return;
  }
  const doc = lockedDoc;
  doc.body.classList.remove(lockedClass);
  doc.body.style.top = '';
  const view = doc.defaultView || globalThis.window;
  if (view && typeof view.scrollTo === 'function') {
    try {
      view.scrollTo(0, savedScrollY);
    } catch {
      // A layout-less test DOM may not implement scrollTo — harmless to skip.
    }
  }
  scrollLockCount = 0;
  lockedDoc = null;
  lockedClass = null;
}

// ───────────────────────── inert siblings (marker-guarded) ──────────────────

// Our markers carry a DEPTH, not a boolean flag. Two open dialogs can cover the
// same background element (one opened over another); with a plain '1' flag the
// inner dialog's close() would strip the `inert`/`aria-hidden` the still-open
// outer dialog installed, handing the background back to the tab order and the
// AT tree behind a visibly open modal. Counting means only the LAST release
// restores the element. ('1' written by an older version reads back as depth 1.)
function markerDepth(node, key) {
  const raw = node.dataset ? node.dataset[key] : null;
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function hideBackground(node) {
  // Only inert nodes we ourselves marked, so we never strip an `inert` that was
  // set for another reason (the app's own markup, say).
  const depth = markerDepth(node, 'jfsModalInert');
  if (depth > 0) {
    node.dataset.jfsModalInert = String(depth + 1);
  } else if (!node.inert) {
    node.inert = true;
    node.dataset.jfsModalInert = '1';
  }
  // aria-hidden alongside inert (separately marker-guarded + depth-counted):
  // `inert` is a no-op expando in browsers that don't support it (Safari <
  // 15.5), and aria-hidden keeps screen readers out of the background there
  // too. Never overwrite an aria-hidden the app set itself.
  const aria = markerDepth(node, 'jfsModalAriaHidden');
  if (aria > 0) {
    node.dataset.jfsModalAriaHidden = String(aria + 1);
  } else if (!node.hasAttribute('aria-hidden')) {
    node.setAttribute('aria-hidden', 'true');
    node.dataset.jfsModalAriaHidden = '1';
  }
}

function showBackground(node) {
  const depth = markerDepth(node, 'jfsModalInert');
  if (depth > 1) {
    node.dataset.jfsModalInert = String(depth - 1);
  } else if (depth === 1) {
    node.inert = false;
    delete node.dataset.jfsModalInert;
  }
  const aria = markerDepth(node, 'jfsModalAriaHidden');
  if (aria > 1) {
    node.dataset.jfsModalAriaHidden = String(aria - 1);
  } else if (aria === 1) {
    node.removeAttribute('aria-hidden');
    delete node.dataset.jfsModalAriaHidden;
  }
}

// Drop OUR markers on `target` outright, whatever their depth. Called as a
// dialog opens: a dialog that is a SIBLING of an already-open one was marked
// inert (and aria-hidden) by that dialog's open(), and would otherwise come up
// unclickable, unfocusable and absent from the screen-reader tree even though
// it is the topmost, focused dialog. Marker-guarded as ever — an `inert`/
// `aria-hidden` the app set itself is left alone.
function clearOwnHiding(target) {
  if (target.dataset && target.dataset.jfsModalInert) {
    target.inert = false;
    delete target.dataset.jfsModalInert;
  }
  if (target.dataset && target.dataset.jfsModalAriaHidden) {
    target.removeAttribute('aria-hidden');
    delete target.dataset.jfsModalAriaHidden;
  }
}

function setSiblingsInert(target, on) {
  const parent = target.parentNode;
  if (!parent) return;
  for (const sib of Array.from(parent.children)) {
    if (sib === target) continue;
    const tag = sib.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    if (on) hideBackground(sib);
    else showBackground(sib);
  }
}

// ───────────────────────── history sentinel (opt-in) ────────────────────────

function pushHistorySentinel(hist) {
  if (hist && typeof hist.pushState === 'function') {
    try {
      hist.pushState({ __jfsModal: true }, '');
    } catch {
      // Some embedded contexts forbid pushState; the dialog still works, it
      // just won't be Back-button-closable.
    }
  }
}

// ───────────────────────── createModal ─────────────────────────

/** Create a dialog controller for `dialogEl`. Returns `{ open, close, isOpen }`.
 *  A falsy element yields an inert no-op controller (defensive, matches Bears).
 *
 *  Options (all optional):
 *    focusTarget    element | selector-within-the-dialog | (default) first focusable
 *    focusDelay     ms to defer initial focus (default 0; set ~30 to let iOS
 *                   finish hiding the soft keyboard, as Bears does)
 *    escClose       Escape closes this dialog when topmost (default true)
 *    trapFocus      wrap Tab/Shift+Tab inside the dialog (default true)
 *    scrollLock     lock body scroll while open (default true)
 *    scrollLockClass  body class supplying `position:fixed` (default 'modal-open')
 *    inertSiblings  mark sibling elements inert + aria-hide (default true)
 *    closeOnBackdrop  a pointer on the dialog itself or any [data-close] closes
 *                   it (default true)
 *    shouldCloseOnPointer(e)  replace the default backdrop/[data-close] predicate
 *    history        push a history sentinel so Back / edge-swipe closes it
 *                   (default false — it manipulates the history stack)
 *    hiddenAttr     toggle .hidden for visibility (default true)
 *    openClass      also toggle this class on the dialog (for apps whose CSS
 *                   keys visibility off a class, e.g. 'is-open' / 'visible')
 *    ariaHidden     toggle the dialog's aria-hidden with visibility (default true)
 *    onOpen({el}) / onClose({el})  lifecycle callbacks
 */
export function createModal(dialogEl, options = {}) {
  if (!dialogEl) {
    return { open() {}, close() {}, isOpen() { return false; } };
  }

  const opts = {
    focusTarget: null,
    focusDelay: 0,
    escClose: true,
    trapFocus: true,
    scrollLock: true,
    scrollLockClass: 'modal-open',
    inertSiblings: true,
    closeOnBackdrop: true,
    shouldCloseOnPointer: null,
    history: false,
    hiddenAttr: true,
    openClass: null,
    ariaHidden: true,
    onOpen: null,
    onClose: null,
    ...options,
  };

  const doc = dialogEl.ownerDocument || globalThis.document;

  const session = {
    escClose: opts.escClose,
    history: opts.history,
    scrollLockClass: opts.scrollLockClass,
    opened: false,
    prevFocus: null,
    // Wired below so the shared Escape/popstate handlers can close whichever
    // session is topmost without reaching for the returned controller.
    requestClose: null,
  };

  function show() {
    if (opts.hiddenAttr) dialogEl.hidden = false;
    if (opts.openClass) dialogEl.classList.add(opts.openClass);
    if (opts.ariaHidden) dialogEl.setAttribute('aria-hidden', 'false');
  }
  function hide() {
    if (opts.hiddenAttr) dialogEl.hidden = true;
    if (opts.openClass) dialogEl.classList.remove(opts.openClass);
    if (opts.ariaHidden) dialogEl.setAttribute('aria-hidden', 'true');
  }

  function resolveFocusTarget() {
    const t = opts.focusTarget;
    if (t) {
      const node = typeof t === 'string' ? dialogEl.querySelector(t) : t;
      if (node) return node;
    }
    const focusables = getFocusable(dialogEl);
    if (focusables.length) return focusables[0];
    // Nothing focusable inside — focus the dialog itself so the trap and screen
    // readers have an anchor.
    if (!dialogEl.getAttribute('tabindex')) dialogEl.setAttribute('tabindex', '-1');
    return dialogEl;
  }

  function onKeydown(e) {
    if (e.key !== 'Tab' && e.keyCode !== 9) return;
    const focusables = getFocusable(dialogEl);
    if (focusables.length === 0) {
      e.preventDefault();
      if (typeof dialogEl.focus === 'function') dialogEl.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = doc.activeElement;
    const escaped = !dialogEl.contains(active);
    if (e.shiftKey) {
      if (active === first || escaped) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || escaped) {
      e.preventDefault();
      first.focus();
    }
  }

  function onPointerDown(e) {
    const predicate =
      opts.shouldCloseOnPointer ||
      ((ev) =>
        ev.target === dialogEl ||
        (ev.target && typeof ev.target.closest === 'function' && ev.target.closest('[data-close]')));
    if (predicate(e)) {
      e.preventDefault();
      close();
    }
  }

  function open() {
    if (session.opened) return;
    session.opened = true;

    // Capture + blur the trigger so restore returns focus there, and iOS drops
    // the soft keyboard before we lock.
    const active = doc.activeElement;
    session.prevFocus = active && active !== doc.body ? active : null;
    if (session.prevFocus && typeof session.prevFocus.blur === 'function') session.prevFocus.blur();

    openStack.push(session);
    wireGlobals(doc);

    if (opts.scrollLock) acquireScrollLock(doc, opts.scrollLockClass);
    // Undo any hiding an earlier sibling dialog's open() put on US before we
    // show, so the dialog coming up on top is interactive and in the AT tree.
    clearOwnHiding(dialogEl);
    if (opts.inertSiblings) setSiblingsInert(dialogEl, true);

    show();

    if (opts.trapFocus) dialogEl.addEventListener('keydown', onKeydown);
    if (opts.closeOnBackdrop || opts.shouldCloseOnPointer) dialogEl.addEventListener('click', onPointerDown);
    if (opts.history) {
      pushHistorySentinel(doc.defaultView && doc.defaultView.history);
      historyStack.push(session);
    }

    const focusTarget = resolveFocusTarget();
    const doFocus = () => {
      if (session.opened && typeof focusTarget.focus === 'function') {
        focusTarget.focus({ preventScroll: true });
      }
    };
    if (opts.focusDelay > 0) setTimeout(doFocus, opts.focusDelay);
    else doFocus();

    safeCall(opts.onOpen, { el: dialogEl });
  }

  function close(fromHistory = false) {
    if (!session.opened) return;
    session.opened = false;

    const idx = openStack.indexOf(session);
    if (idx !== -1) openStack.splice(idx, 1);

    if (opts.trapFocus) dialogEl.removeEventListener('keydown', onKeydown);
    if (opts.closeOnBackdrop || opts.shouldCloseOnPointer) dialogEl.removeEventListener('click', onPointerDown);
    if (opts.inertSiblings) setSiblingsInert(dialogEl, false);

    hide();

    if (opts.scrollLock) releaseScrollLock();

    if (session.prevFocus && doc.contains(session.prevFocus) && typeof session.prevFocus.focus === 'function') {
      session.prevFocus.focus({ preventScroll: true });
    }
    session.prevFocus = null;

    // Reconcile the browser history sentinel — unless this close was itself
    // triggered by a history pop (the popstate handler already navigated and
    // removed the entry).
    if (opts.history && !fromHistory) {
      const hIdx = historyStack.indexOf(session);
      if (hIdx !== -1) {
        const isTopSentinel = hIdx === historyStack.length - 1;
        historyStack.splice(hIdx, 1);
        // Only pop the browser entry when it's the topmost sentinel; popping a
        // buried one would rewind the wrong dialog. A buried sentinel is left as
        // an inert history entry (a later stray Back is absorbed as a no-op).
        if (isTopSentinel) {
          const hist = doc.defaultView && doc.defaultView.history;
          if (hist && typeof hist.back === 'function') {
            expectOwnPopstate = true;
            hist.back();
          }
        }
      }
    }

    safeCall(opts.onClose, { el: dialogEl });
  }

  session.requestClose = close;

  // The public close is a wrapper so the internal fromHistory flag can never
  // leak in from consumer call sites: `btn.addEventListener('click', modal.close)`
  // passes the click Event as the first argument, and a truthy fromHistory
  // would skip the sentinel reconciliation above — leaving a dead history
  // entry so a later Back press closes nothing. Only the shared popstate
  // handler (via session.requestClose) may pass fromHistory = true.
  return { open, close: () => close(false), isOpen: () => session.opened };
}

/** Test seam: force the modal module back to a clean slate (empty stack,
 *  globals re-wire on next open). Not part of the production surface. */
export function _resetModalsForTest() {
  openStack.length = 0;
  historyStack.length = 0;
  globalsWired = false;
  savedScrollY = 0;
  expectOwnPopstate = false;
  scrollLockCount = 0;
  lockedDoc = null;
  lockedClass = null;
}
