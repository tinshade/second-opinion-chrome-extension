import { PROVIDERS } from '../lib/providers.js';

const $ = (id) => document.getElementById(id);
let state = { provider: 'openai', keys: {}, models: {}, ollamaUrl: 'http://localhost:11434', maxReviews: 20 };

async function load() {
  const s = await chrome.storage.local.get(state);
  state = { ...state, ...s };
  renderProviders();
  syncFields();
}

function renderProviders() {
  $('providers').innerHTML = Object.entries(PROVIDERS)
    .map(
      ([id, p]) => `
      <button type="button" class="prov" data-id="${id}" aria-pressed="${id === state.provider}">
        ${p.label}
        <span>${p.needsKey ? 'key required' : 'runs on your machine'}</span>
      </button>`
    )
    .join('');

  $('providers').querySelectorAll('.prov').forEach((b) =>
    b.addEventListener('click', () => {
      captureFields();
      state.provider = b.dataset.id;
      renderProviders();
      syncFields();
      say('');
    })
  );
}

function syncFields() {
  const p = PROVIDERS[state.provider];
  $('keyField').hidden = !p.needsKey;
  $('urlField').hidden = state.provider !== 'ollama';
  $('apiKey').value = state.keys[state.provider] || '';
  $('apiKey').type = 'password';
  $('reveal').textContent = 'Show';
  $('keyLink').href = p.keyUrl;
  $('model').value = state.models[state.provider] || p.defaultModel;
  $('modelHint').textContent = `Known to work: ${p.modelHint}. Any model id the provider accepts will do.`;
  $('ollamaUrl').value = state.ollamaUrl;
  $('maxReviews').value = state.maxReviews;
}

function captureFields() {
  const p = PROVIDERS[state.provider];
  if (p.needsKey) state.keys[state.provider] = $('apiKey').value.trim();
  state.models[state.provider] = $('model').value.trim() || p.defaultModel;
  state.ollamaUrl = $('ollamaUrl').value.trim() || 'http://localhost:11434';
  state.maxReviews = Math.min(60, Math.max(4, Number($('maxReviews').value) || 20));
}

function say(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${kind}`;
}

async function save() {
  captureFields();
  await chrome.storage.local.set(state);
  say('Settings saved.', 'ok');
}

$('reveal').addEventListener('click', () => {
  const f = $('apiKey');
  const hidden = f.type === 'password';
  f.type = hidden ? 'text' : 'password';
  $('reveal').textContent = hidden ? 'Hide' : 'Show';
});

$('save').addEventListener('click', save);

$('test').addEventListener('click', async () => {
  await save();
  say('Sending a one-line test request…');
  const res = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', provider: state.provider });
  if (res?.ok) say(`${PROVIDERS[state.provider].label} answered as ${res.model}. You are set.`, 'ok');
  else say(res?.error || 'The test request failed.', 'bad');
});

load();
