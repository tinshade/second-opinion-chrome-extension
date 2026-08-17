(function () {
  if (window.__soPanelMounted) return;
  window.__soPanelMounted = true;

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let host, root, state = { view: 'idle', data: null, meta: null, error: null };

  async function mount() {
    host = document.createElement('div');
    host.id = 'second-opinion-host';
    host.style.cssText = 'all:initial;position:fixed;top:0;right:0;z-index:2147483646;';
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'open' });

    const css = await fetch(chrome.runtime.getURL('src/content/panel.css')).then((r) => r.text());
    const style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'so';
    wrap.innerHTML = `
      <button class="launch" type="button" aria-label="Open Second Opinion">
        <span class="launch-mark">2°</span>
        <span class="launch-text">Second opinion</span>
      </button>
      <aside class="drawer" role="dialog" aria-label="Second Opinion analysis" hidden>
        <header class="head">
          <div class="head-left">
            <span class="eyebrow">Second opinion</span>
            <span class="chip" data-role="chip">checking settings</span>
          </div>
          <button class="icon" type="button" data-act="close" aria-label="Close panel">×</button>
        </header>
        <div class="body" data-role="body"></div>
      </aside>`;
    root.appendChild(wrap);

    root.querySelector('.launch').addEventListener('click', toggle);
    wrap.addEventListener('click', onClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !root.querySelector('.drawer').hidden) toggle();
    });

    render();
  }

  function onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') toggle();
    if (act === 'run') run();
    if (act === 'settings') chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    if (act === 'again') { state = { view: 'idle', data: null, meta: null, error: null }; render(); }
  }

  function toggle() {
    const d = root.querySelector('.drawer');
    const open = d.hidden;
    d.hidden = !open;
    root.querySelector('.launch').classList.toggle('is-hidden', open);
    document.documentElement.classList.toggle('so-open', open);
    if (open) refreshChip();
  }

  async function refreshChip() {
    const chip = root.querySelector('[data-role="chip"]');
    try {
      const s = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      chip.textContent = s.hasKey ? `${s.label} · ${s.model}` : `${s.label} · no key`;
      chip.classList.toggle('chip-warn', !s.hasKey);
    } catch (_) {
      chip.textContent = 'settings unavailable';
    }
  }

  async function run() {
    if (!window.__secondOpinion?.isProductPage()) {
      state = { view: 'error', error: 'This is not a product page. Open a listing first.' };
      return render();
    }
    const note = root.querySelector('[data-role="note"]')?.value || '';
    state = { view: 'loading' };
    render();

    const page = window.__secondOpinion.scrape();
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ANALYZE', page, note });
      if (!res?.ok) throw new Error(res?.error || 'The analysis did not come back.');
      state = { view: 'result', data: res.result, meta: res.meta };
    } catch (e) {
      state = { view: 'error', error: e.message };
    }
    render();
  }

  function render() {
    const body = root.querySelector('[data-role="body"]');
    if (state.view === 'idle') body.innerHTML = viewIdle();
    else if (state.view === 'loading') body.innerHTML = viewLoading();
    else if (state.view === 'error') body.innerHTML = viewError(state.error);
    else body.innerHTML = viewResult(state.data, state.meta);
    body.scrollTop = 0;
  }

  function viewIdle() {
    const ok = window.__secondOpinion?.isProductPage();
    const t = document.querySelector('#productTitle')?.textContent?.trim() || '';
    return `
      <div class="pad">
        <p class="lede">Reads what is on this page — the listing copy, the spec table, the visible reviews — and sorts it into claims the seller makes and things buyers actually report.</p>
        ${ok ? `<p class="target">${esc(t.slice(0, 140))}${t.length > 140 ? '…' : ''}</p>` : `<p class="target warn">No product detected on this page.</p>`}
        <label class="field">
          <span class="label">What are you using it for? <em>optional</em></span>
          <textarea data-role="note" rows="2" placeholder="e.g. daily commute, small kitchen, gift for a 9-year-old"></textarea>
        </label>
        <button class="primary" type="button" data-act="run" ${ok ? '' : 'disabled'}>Analyze this page</button>
        <p class="fine">Scroll down to the reviews before running. Only reviews already loaded in the page can be read.</p>
        <button class="ghost" type="button" data-act="settings">Model and keys</button>
      </div>`;
  }

  function viewLoading() {
    return `
      <div class="pad">
        <div class="scan"><span></span><span></span><span></span></div>
        <p class="lede">Reading the listing, then the reviews, then weighing one against the other.</p>
      </div>`;
  }

  function viewError(msg) {
    return `
      <div class="pad">
        <p class="err-title">That did not go through</p>
        <p class="err-body">${esc(msg)}</p>
        <button class="primary" type="button" data-act="again">Try again</button>
        <button class="ghost" type="button" data-act="settings">Model and keys</button>
      </div>`;
  }

  function bar(mix) {
    const seg = (k, v) => (v > 0 ? `<span class="seg seg-${k}" style="flex:${v}" title="${k} ${v}%"></span>` : '');
    return `<div class="mixbar">${seg('reviews', mix.reviews)}${seg('specs', mix.specs)}${seg('listing', mix.listing)}</div>
      <div class="mixkey">
        <span><i class="dot dot-reviews"></i>${mix.reviews}% buyers</span>
        <span><i class="dot dot-specs"></i>${mix.specs}% specs</span>
        <span><i class="dot dot-listing"></i>${mix.listing}% seller copy</span>
      </div>`;
  }

  function ledger(items, kind) {
    if (!items.length) return `<p class="empty">Nothing here the evidence supports.</p>`;
    return items
      .map(
        (it) => `
      <li class="row row-${kind}">
        <div class="row-head">
          <span class="row-point">${esc(it.point)}</span>
          <span class="tag tag-${it.source}">${it.source === 'reviews' ? `buyers${it.mentions ? ` ×${it.mentions}` : ''}` : it.source === 'specs' ? 'spec' : 'seller claim'}</span>
        </div>
        ${it.detail ? `<p class="row-detail">${esc(it.detail)}</p>` : ''}
        <span class="strength strength-${it.strength}">${it.strength} evidence</span>
      </li>`
      )
      .join('');
  }

  function chips(list) {
    return list.map((x) => `<li>${esc(x)}</li>`).join('');
  }

  function viewResult(d, meta) {
    return `
      <div class="pad">
        <p class="verdict">${esc(d.verdict)}</p>
        <p class="conf conf-${d.confidence}">${d.confidence} confidence${d.confidence_reason ? ` — ${esc(d.confidence_reason)}` : ''}</p>

        <section class="block">
          <h3 class="h">Where this came from</h3>
          ${bar(d.evidence_mix)}
        </section>

        <section class="block">
          <h3 class="h">Holds up <span class="count">${d.pros.length}</span></h3>
          <ul class="ledger">${ledger(d.pros, 'pro')}</ul>
        </section>

        <section class="block">
          <h3 class="h">Works against it <span class="count">${d.cons.length}</span></h3>
          <ul class="ledger">${ledger(d.cons, 'con')}</ul>
        </section>

        ${
          d.flags.length
            ? `<section class="block">
                <h3 class="h h-flag">Treat with caution</h3>
                <ul class="flags">${d.flags.map((f) => `<li><strong>${esc(f.issue)}</strong>${f.why ? ` — ${esc(f.why)}` : ''}</li>`).join('')}</ul>
              </section>`
            : ''
        }

        <section class="block split">
          <div>
            <h3 class="h">Fits if</h3>
            <ul class="plain">${chips(d.buy_if)}</ul>
          </div>
          <div>
            <h3 class="h">Wrong pick if</h3>
            <ul class="plain">${chips(d.skip_if)}</ul>
          </div>
        </section>

        ${
          d.unanswered.length
            ? `<section class="block">
                <h3 class="h">The page never says</h3>
                <ul class="plain">${chips(d.unanswered)}</ul>
              </section>`
            : ''
        }

        <footer class="foot">
          <span>${esc(meta.provider)} · ${esc(meta.model)}</span>
          <span>${meta.reviewsUsed} reviews read · ${(meta.ms / 1000).toFixed(1)}s</span>
        </footer>
        <button class="ghost" type="button" data-act="again">Run it again</button>
      </div>`;
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === 'TOGGLE_PANEL') toggle();
    if (m?.type === 'RUN_ANALYSIS') {
      if (root.querySelector('.drawer').hidden) toggle();
      run();
    }
  });

  mount();
})();
