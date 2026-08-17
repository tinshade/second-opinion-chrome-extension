import { PROVIDERS, callProvider, parseJsonLoosely } from '../lib/providers.js';
import { buildMessages } from '../lib/prompt.js';

const DEFAULTS = {
  provider: 'openai',
  keys: {},
  models: {},
  ollamaUrl: 'http://localhost:11434',
  maxReviews: 20
};

async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ANALYZE') {
    analyze(msg.page, msg.note)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg?.type === 'GET_SETTINGS') {
    getSettings().then((s) =>
      sendResponse({
        provider: s.provider,
        model: s.models[s.provider] || PROVIDERS[s.provider]?.defaultModel,
        hasKey: !PROVIDERS[s.provider]?.needsKey || Boolean(s.keys[s.provider]),
        label: PROVIDERS[s.provider]?.label
      })
    );
    return true;
  }

  if (msg?.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (msg?.type === 'TOGGLE_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {});
    });
    return false;
  }

  if (msg?.type === 'TEST_CONNECTION') {
    testConnection(msg.provider)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

async function analyze(page, note) {
  const s = await getSettings();
  const provider = s.provider;
  const model = s.models[provider] || PROVIDERS[provider].defaultModel;

  const trimmed = { ...page, reviews: (page.reviews || []).slice(0, s.maxReviews) };
  const messages = buildMessages(trimmed, note);

  const started = Date.now();
  const text = await callProvider({
    provider,
    model,
    key: s.keys[provider],
    baseUrl: s.ollamaUrl,
    messages
  });

  const result = normalize(parseJsonLoosely(text));
  return {
    result,
    meta: {
      provider: PROVIDERS[provider].label,
      model,
      ms: Date.now() - started,
      reviewsUsed: trimmed.reviews.length
    }
  };
}

// Models drift from the schema. Pin it down before the UI has to render it.
function normalize(r) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === 'string' ? v : '');
  const item = (x) => ({
    point: str(x?.point) || str(x?.title) || '—',
    detail: str(x?.detail),
    source: ['reviews', 'listing', 'specs'].includes(x?.source) ? x.source : 'listing',
    strength: ['strong', 'moderate', 'weak'].includes(x?.strength) ? x.strength : 'moderate',
    mentions: Number.isFinite(x?.mentions) ? x.mentions : null
  });

  const mix = r?.evidence_mix || {};
  const nums = ['reviews', 'listing', 'specs'].map((k) => Math.max(0, Number(mix[k]) || 0));
  const total = nums.reduce((a, b) => a + b, 0) || 1;

  return {
    verdict: str(r?.verdict) || 'No verdict returned.',
    confidence: ['high', 'medium', 'low'].includes(r?.confidence) ? r.confidence : 'low',
    confidence_reason: str(r?.confidence_reason),
    evidence_mix: {
      reviews: Math.round((nums[0] / total) * 100),
      listing: Math.round((nums[1] / total) * 100),
      specs: Math.round((nums[2] / total) * 100)
    },
    pros: arr(r?.pros).map(item),
    cons: arr(r?.cons).map(item),
    flags: arr(r?.flags).map((f) => ({ issue: str(f?.issue) || '—', why: str(f?.why) })),
    buy_if: arr(r?.buy_if).map(str).filter(Boolean),
    skip_if: arr(r?.skip_if).map(str).filter(Boolean),
    unanswered: arr(r?.unanswered).map(str).filter(Boolean)
  };
}

async function testConnection(provider) {
  const s = await getSettings();
  const model = s.models[provider] || PROVIDERS[provider].defaultModel;
  const text = await callProvider({
    provider,
    model,
    key: s.keys[provider],
    baseUrl: s.ollamaUrl,
    messages: {
      system: 'Reply with JSON only.',
      user: 'Return exactly {"ok":true} and nothing else.'
    }
  });
  parseJsonLoosely(text);
  return { ok: true, model };
}
