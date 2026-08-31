// Tests for the `modal` section of @jfs/news-kit — absorbed verbatim from
// @jfs/modal-kit v0.1.4 (every assertion preserved; only the import path
// changed).
// Uses node:test + jsdom (a devDependency) so the focus-trap / scroll-lock /
// inert / Escape-stack behavior runs against a real-ish DOM. The module reads
// the ambient document via each element's ownerDocument, so a fresh JSDOM per
// test gives clean event-listener isolation; _resetModalsForTest() clears the
// shared open stack between tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createModal, isAnyModalOpen, getFocusable, _resetModalsForTest } from '../index.js';

function setup(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  _resetModalsForTest();
  const { document } = dom.window;
  return { dom, window: dom.window, document, $: (sel) => document.querySelector(sel) };
}

const MODAL_HTML = `
  <button id="opener">open</button>
  <aside id="other">background</aside>
  <div id="dialog" role="dialog" hidden>
    <button id="close" data-close>×</button>
    <input id="field" />
    <a id="link" href="#">a link</a>
  </div>`;

// Simulate the CSS the scroll-lock class relies on so getComputedStyle sees it
// (jsdom applies inline <style>). Not strictly needed for the assertions, which
// check the class/offset rather than layout.

// ───────────────────────── open / close basics ─────────────────────────

test('open() reveals the dialog and marks it open; close() hides it', () => {
  const { $ } = setup(MODAL_HTML);
  const modal = createModal($('#dialog'));
  assert.equal(modal.isOpen(), false);
  assert.equal($('#dialog').hidden, true);

  modal.open();
  assert.equal(modal.isOpen(), true);
  assert.equal($('#dialog').hidden, false);
  assert.equal($('#dialog').getAttribute('aria-hidden'), 'false');
  assert.equal(isAnyModalOpen(), true);

  modal.close();
  assert.equal(modal.isOpen(), false);
  assert.equal($('#dialog').hidden, true);
  assert.equal($('#dialog').getAttribute('aria-hidden'), 'true');
  assert.equal(isAnyModalOpen(), false);
});

test('open() is idempotent; close() on a closed modal is a no-op', () => {
  const { $ } = setup(MODAL_HTML);
  const modal = createModal($('#dialog'));
  modal.open();
  modal.open();
  assert.equal(isAnyModalOpen(), true); // not pushed twice
  modal.close();
  assert.equal(isAnyModalOpen(), false);
  modal.close(); // no throw
});

test('a falsy element yields an inert no-op controller', () => {
  setup('');
  const modal = createModal(null);
  assert.equal(modal.isOpen(), false);
  modal.open();
  modal.close();
  assert.equal(isAnyModalOpen(), false);
});

test('openClass + hiddenAttr:false drives class-based visibility (JFS/Zep style)', () => {
  const { $ } = setup(`<div id="dialog" class="overlay"><button>x</button></div>`);
  const modal = createModal($('#dialog'), { hiddenAttr: false, openClass: 'is-open', ariaHidden: false });
  modal.open();
  assert.equal($('#dialog').classList.contains('is-open'), true);
  assert.equal($('#dialog').hidden, false);
  modal.close();
  assert.equal($('#dialog').classList.contains('is-open'), false);
});

// ───────────────────────── focus save / restore ─────────────────────────

test('initial focus goes to the first focusable; restored to the trigger on close', () => {
  const { $, document } = setup(MODAL_HTML);
  const opener = $('#opener');
  opener.focus();
  assert.equal(document.activeElement, opener);

  const modal = createModal($('#dialog'));
  modal.open();
  assert.equal(document.activeElement, $('#close')); // first focusable

  modal.close();
  assert.equal(document.activeElement, opener); // restored
});

test('focusTarget selector overrides the initial focus', () => {
  const { $, document } = setup(MODAL_HTML);
  const modal = createModal($('#dialog'), { focusTarget: '#field' });
  modal.open();
  assert.equal(document.activeElement, $('#field'));
});

test('a dialog with no focusables focuses itself (tabindex -1)', () => {
  const { $, document } = setup(`<div id="dialog"><p>text only</p></div>`);
  const modal = createModal($('#dialog'));
  modal.open();
  assert.equal($('#dialog').getAttribute('tabindex'), '-1');
  assert.equal(document.activeElement, $('#dialog'));
});

// ───────────────────────── focus trap ─────────────────────────

function tab(document, dialog, shift = false) {
  const e = new dialog.ownerDocument.defaultView.KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  dialog.dispatchEvent(e);
  return e;
}

test('Tab at the last focusable wraps to the first', () => {
  const { $, document } = setup(MODAL_HTML);
  const dialog = $('#dialog');
  const modal = createModal(dialog);
  modal.open();
  $('#link').focus(); // last focusable
  const e = tab(document, dialog, false);
  assert.equal(e.defaultPrevented, true);
  assert.equal(document.activeElement, $('#close')); // wrapped to first
});

test('Shift+Tab at the first focusable wraps to the last', () => {
  const { $, document } = setup(MODAL_HTML);
  const dialog = $('#dialog');
  const modal = createModal(dialog);
  modal.open();
  $('#close').focus(); // first focusable
  const e = tab(document, dialog, true);
  assert.equal(e.defaultPrevented, true);
  assert.equal(document.activeElement, $('#link')); // wrapped to last
});

test('Tab from outside (focus escaped) is pulled back into the dialog', () => {
  const { $, document } = setup(MODAL_HTML);
  const dialog = $('#dialog');
  const modal = createModal(dialog);
  modal.open();
  $('#opener').focus(); // escaped outside
  const e = tab(document, dialog, false);
  assert.equal(e.defaultPrevented, true);
  assert.equal(document.activeElement, $('#close'));
});

test('trapFocus:false attaches no trap', () => {
  const { $, document } = setup(MODAL_HTML);
  const dialog = $('#dialog');
  const modal = createModal(dialog, { trapFocus: false });
  modal.open();
  $('#link').focus();
  const e = tab(document, dialog, false);
  assert.equal(e.defaultPrevented, false); // not trapped
});

// ───────────────────────── Escape stack ─────────────────────────

function esc(document) {
  const e = new document.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.dispatchEvent(e);
  return e;
}

test('Escape closes the topmost dialog only, unwinding one at a time', () => {
  const { document } = setup(`
    <div id="a"><button>a</button></div>
    <div id="b"><button>b</button></div>`);
  const a = createModal(document.querySelector('#a'));
  const b = createModal(document.querySelector('#b'));
  a.open();
  b.open();
  esc(document);
  assert.equal(b.isOpen(), false);
  assert.equal(a.isOpen(), true); // still open — only the top closed
  esc(document);
  assert.equal(a.isOpen(), false);
});

test('escClose:false opts a dialog out of the Escape stack', () => {
  const { document } = setup(MODAL_HTML);
  const modal = createModal(document.querySelector('#dialog'), { escClose: false });
  modal.open();
  esc(document);
  assert.equal(modal.isOpen(), true);
});

// ───────────────────────── scroll lock (reference-counted) ──────────────────

test('scroll-lock adds the class once for a stack and removes it when empty', () => {
  const { document } = setup(`
    <div id="a"><button>a</button></div>
    <div id="b"><button>b</button></div>`);
  const body = document.body;
  const a = createModal(document.querySelector('#a'));
  const b = createModal(document.querySelector('#b'));

  a.open();
  assert.equal(body.classList.contains('modal-open'), true);
  b.open();
  assert.equal(body.classList.contains('modal-open'), true);

  b.close();
  assert.equal(body.classList.contains('modal-open'), true); // a still open
  a.close();
  assert.equal(body.classList.contains('modal-open'), false); // stack empty
  assert.equal(body.style.top, '');
});

test('scrollLock:false leaves the body class alone', () => {
  const { document } = setup(MODAL_HTML);
  const modal = createModal(document.querySelector('#dialog'), { scrollLock: false });
  modal.open();
  assert.equal(document.body.classList.contains('modal-open'), false);
});

// ───────────────────────── inert siblings ─────────────────────────

test('siblings are marked inert on open and restored on close (marker-guarded)', () => {
  const { $ } = setup(MODAL_HTML);
  const other = $('#other');
  const modal = createModal($('#dialog'));
  modal.open();
  assert.equal(other.inert, true);
  assert.equal(other.dataset.jfsModalInert, '1');
  modal.close();
  assert.equal(other.inert, false);
  assert.equal(other.dataset.jfsModalInert, undefined);
});

test('siblings are aria-hidden on open and restored on close (marker-guarded)', () => {
  const { $ } = setup(MODAL_HTML);
  const other = $('#other');
  const modal = createModal($('#dialog'));
  modal.open();
  assert.equal(other.getAttribute('aria-hidden'), 'true');
  assert.equal(other.dataset.jfsModalAriaHidden, '1');
  modal.close();
  assert.equal(other.hasAttribute('aria-hidden'), false);
  assert.equal(other.dataset.jfsModalAriaHidden, undefined);
});

test('a sibling with its own aria-hidden is never overwritten or stripped', () => {
  const { $ } = setup(MODAL_HTML);
  const other = $('#other');
  other.setAttribute('aria-hidden', 'false'); // the app's own value, not ours
  const modal = createModal($('#dialog'));
  modal.open();
  assert.equal(other.getAttribute('aria-hidden'), 'false'); // untouched
  assert.equal(other.dataset.jfsModalAriaHidden, undefined); // we didn't mark it
  modal.close();
  assert.equal(other.getAttribute('aria-hidden'), 'false'); // still the app's value
});

test('an already-inert sibling is left untouched on close (no marker to strip)', () => {
  const { $ } = setup(MODAL_HTML);
  const other = $('#other');
  other.inert = true; // pre-existing inert, not ours
  const modal = createModal($('#dialog'));
  modal.open();
  assert.equal(other.dataset.jfsModalInert, undefined); // we didn't mark it
  modal.close();
  assert.equal(other.inert, true); // still inert — we didn't strip someone else's
});

// ─────────── stacked dialogs: sibling hand-off + depth-counted markers ───────

// Two dialogs side by side under <body> — the John's-News shape (#reader and
// #diag are siblings), plus background chrome the dialogs must hide.
const STACKED_HTML = `
  <header id="hdr"><a id="hdrlink" href="#">home</a></header>
  <main id="main">page</main>
  <div id="reader" role="dialog" hidden><button id="r-close" data-close>×</button></div>
  <div id="diag" role="dialog" hidden><button id="d-close" data-close>×</button></div>`;

test('a sibling dialog opened second is interactive, not left inert by the first', () => {
  const { $ } = setup(STACKED_HTML);
  const reader = createModal($('#reader'), { scrollLock: false });
  const diag = createModal($('#diag'), { scrollLock: false });

  reader.open();
  assert.equal($('#diag').inert, true); // background while only the reader is open

  diag.open();
  // The topmost, focused dialog must not be inert or hidden from the AT tree.
  assert.equal($('#diag').inert, false);
  assert.equal($('#diag').dataset.jfsModalInert, undefined);
  assert.equal($('#diag').getAttribute('aria-hidden'), 'false'); // show() wrote it
});

test('a sibling dialog opened second is not aria-hidden even with ariaHidden:false', () => {
  const { $ } = setup(STACKED_HTML);
  // ariaHidden:false = the app owns el's aria-hidden; show() writes nothing, so
  // an aria-hidden left over from the first dialog's open would stick.
  const reader = createModal($('#reader'), { scrollLock: false, ariaHidden: false });
  const diag = createModal($('#diag'), { scrollLock: false, ariaHidden: false });

  reader.open();
  assert.equal($('#diag').getAttribute('aria-hidden'), 'true');

  diag.open();
  assert.equal($('#diag').hasAttribute('aria-hidden'), false);
  assert.equal($('#diag').dataset.jfsModalAriaHidden, undefined);
  assert.equal($('#diag').inert, false);
});

test('closing the inner dialog leaves the outer dialog\'s background hiding intact', () => {
  const { $ } = setup(STACKED_HTML);
  const hdr = $('#hdr');
  const main = $('#main');
  const reader = createModal($('#reader'), { scrollLock: false });
  const diag = createModal($('#diag'), { scrollLock: false });

  reader.open();
  assert.equal(hdr.inert, true);
  assert.equal(hdr.dataset.jfsModalInert, '1');

  diag.open(); // covers the same background — depth goes to 2
  assert.equal(hdr.dataset.jfsModalInert, '2');
  assert.equal(main.dataset.jfsModalAriaHidden, '2');

  diag.close(); // the reader is STILL open: the background must stay hidden
  assert.equal(reader.isOpen(), true);
  assert.equal(hdr.inert, true);
  assert.equal(hdr.getAttribute('aria-hidden'), 'true');
  assert.equal(hdr.dataset.jfsModalInert, '1');
  assert.equal(main.inert, true);
  assert.equal(main.getAttribute('aria-hidden'), 'true');

  reader.close(); // last one out restores everything
  assert.equal(hdr.inert, false);
  assert.equal(hdr.hasAttribute('aria-hidden'), false);
  assert.equal(hdr.dataset.jfsModalInert, undefined);
  assert.equal(main.inert, false);
  assert.equal(main.hasAttribute('aria-hidden'), false);
});

test('repeated inner open/close cycles keep the marker depth balanced', () => {
  const { $ } = setup(STACKED_HTML);
  const hdr = $('#hdr');
  const reader = createModal($('#reader'), { scrollLock: false });
  const diag = createModal($('#diag'), { scrollLock: false });

  reader.open();
  for (let i = 0; i < 3; i++) {
    diag.open();
    assert.equal(hdr.dataset.jfsModalInert, '2');
    assert.equal($('#diag').inert, false); // interactive every time it comes up
    diag.close();
    assert.equal(hdr.dataset.jfsModalInert, '1'); // never drifts upward
    assert.equal(hdr.inert, true);
  }
  reader.close();
  assert.equal(hdr.inert, false);
  assert.equal(hdr.dataset.jfsModalInert, undefined);
});

test('a stacked dialog never strips an inert/aria-hidden the app set itself', () => {
  const { $ } = setup(STACKED_HTML);
  const hdr = $('#hdr');
  hdr.inert = true; // the app's own, not ours
  hdr.setAttribute('aria-hidden', 'true');
  const reader = createModal($('#reader'), { scrollLock: false });
  const diag = createModal($('#diag'), { scrollLock: false });

  reader.open();
  diag.open();
  assert.equal(hdr.dataset.jfsModalInert, undefined); // never marked → never counted
  assert.equal(hdr.dataset.jfsModalAriaHidden, undefined);
  diag.close();
  reader.close();
  assert.equal(hdr.inert, true); // still the app's
  assert.equal(hdr.getAttribute('aria-hidden'), 'true');
});

// ───────────────────────── backdrop / [data-close] ─────────────────────────

function click(el, window) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

test('a click on a [data-close] element closes the dialog', () => {
  const { $, window } = setup(MODAL_HTML);
  const modal = createModal($('#dialog'));
  modal.open();
  click($('#close'), window);
  assert.equal(modal.isOpen(), false);
});

test('a click on the backdrop (the dialog element itself) closes it', () => {
  const { $, window } = setup(MODAL_HTML);
  const dialog = $('#dialog');
  const modal = createModal(dialog);
  modal.open();
  click(dialog, window);
  assert.equal(modal.isOpen(), false);
});

test('a click on inner content does not close (predicate is false)', () => {
  const { $, window } = setup(MODAL_HTML);
  const modal = createModal($('#dialog'));
  modal.open();
  click($('#field'), window);
  assert.equal(modal.isOpen(), true);
});

// ───────────────────────── history sentinel (opt-in) ─────────────────────────

test('history:true pushes a sentinel on open and closes on popstate', () => {
  const { document, window } = setup(MODAL_HTML);
  const modal = createModal(document.querySelector('#dialog'), { history: true });
  modal.open();
  assert.deepEqual(window.history.state, { __jfsModal: true });

  // Browser Back → popstate → close the top history dialog.
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
  assert.equal(modal.isOpen(), false);
});

test('close() passed a truthy Event (addEventListener(modal.close)) still consumes the sentinel', async () => {
  const { document, window } = setup(MODAL_HTML);
  const modal = createModal(document.querySelector('#dialog'), { history: true });
  modal.open();
  assert.deepEqual(window.history.state, { __jfsModal: true });

  // Consumers wire `closeBtn.addEventListener('click', modal.close)`, which
  // passes the click Event as close()'s first argument. It must not be
  // mistaken for the internal fromHistory flag — a truthy fromHistory skips
  // the sentinel reconciliation, leaving a dead history entry so a later
  // Back press closes nothing.
  modal.close(new window.MouseEvent('click'));
  assert.equal(modal.isOpen(), false);

  // jsdom applies our history.back() (and the popstate it fires, which the
  // module must absorb as its own) asynchronously, a couple of macrotasks
  // out — poll briefly, bounded so the buggy path (back() never called)
  // fails fast instead of hanging.
  for (let i = 0; i < 20 && window.history.state !== null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(window.history.state, null); // sentinel entry was popped

  // The absorbed popstate must not have desynced the stack: a real Back press
  // now (fresh popstate) finds no sentinel session and closes nothing.
  assert.doesNotThrow(() => {
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
  });
  assert.equal(isAnyModalOpen(), false);
});

test('history is off by default (no sentinel pushed)', () => {
  const { document, window } = setup(MODAL_HTML);
  const before = window.history.length;
  const modal = createModal(document.querySelector('#dialog'));
  modal.open();
  assert.equal(window.history.length, before);
  modal.close();
});

// ───────────────────────── lifecycle callbacks ─────────────────────────

test('onOpen and onClose fire with the element', () => {
  const { $ } = setup(MODAL_HTML);
  const events = [];
  const modal = createModal($('#dialog'), {
    onOpen: ({ el }) => events.push(['open', el.id]),
    onClose: ({ el }) => events.push(['close', el.id]),
  });
  modal.open();
  modal.close();
  assert.deepEqual(events, [['open', 'dialog'], ['close', 'dialog']]);
});

// ───────────────────────── getFocusable ─────────────────────────

// ───────────────────────── hardening ─────────────────────────

test('scroll-lock never gets stuck when a scrollLock:false modal closes last', () => {
  const { document } = setup(`
    <div id="a"><button>a</button></div>
    <div id="b"><button>b</button></div>`);
  const body = document.body;
  const a = createModal(document.querySelector('#a'), { scrollLock: true });
  const b = createModal(document.querySelector('#b'), { scrollLock: false });
  a.open();
  b.open();
  a.close();
  b.close();
  // The old length-gated logic left the body frozen here; the refcount unlocks.
  assert.equal(body.classList.contains('modal-open'), false);
  assert.equal(body.style.top, '');
});

test('a scrollLock:true modal opening second still locks', () => {
  const { document } = setup(`
    <div id="a"><button>a</button></div>
    <div id="b"><button>b</button></div>`);
  const body = document.body;
  const a = createModal(document.querySelector('#a'), { scrollLock: false });
  const b = createModal(document.querySelector('#b'), { scrollLock: true });
  a.open();
  assert.equal(body.classList.contains('modal-open'), false);
  b.open();
  assert.equal(body.classList.contains('modal-open'), true);
  b.close();
  assert.equal(body.classList.contains('modal-open'), false);
  a.close();
});

test('a throwing onClose does not escape or strand scroll-lock / inert', () => {
  const { $, document } = setup(MODAL_HTML);
  const other = $('#other');
  const modal = createModal($('#dialog'), { onClose: () => { throw new Error('boom'); } });
  modal.open();
  assert.doesNotThrow(() => modal.close());
  assert.equal(document.body.classList.contains('modal-open'), false);
  assert.equal(other.inert, false);
  assert.equal($('#dialog').hidden, true);
});

test('a throwing onClose in the Escape handler does not escape the handler', () => {
  const { document } = setup(MODAL_HTML);
  const modal = createModal(document.querySelector('#dialog'), {
    escClose: true,
    onClose: () => { throw new Error('boom'); },
  });
  modal.open();
  assert.doesNotThrow(() => esc(document));
  assert.equal(modal.isOpen(), false);
});

test('getFocusable excludes controls inside a display:none ancestor', () => {
  const { $ } = setup(`
    <div id="dialog">
      <div style="display:none"><button id="buried">x</button></div>
      <button id="shown">y</button>
    </div>`);
  const ids = getFocusable($('#dialog')).map((n) => n.id);
  assert.deepEqual(ids, ['shown']);
});

test('getFocusable returns visible focusables in order and skips hidden/disabled', () => {
  const { $ } = setup(`
    <div id="dialog">
      <button id="b1">1</button>
      <button id="b2" disabled>2</button>
      <input id="i1" />
      <a id="a1">no href</a>
      <button id="b3" style="display:none">3</button>
      <div id="d1" tabindex="0">focusable div</div>
      <div id="d2" tabindex="-1">not focusable</div>
    </div>`);
  const ids = getFocusable($('#dialog')).map((n) => n.id);
  assert.deepEqual(ids, ['b1', 'i1', 'd1']);
});
