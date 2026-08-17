// Adapters for each BYOK backend. Each one maps a {system, user} pair onto that
// vendor's request shape and pulls the raw text back out of the response.

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    needsKey: true,
    defaultModel: 'gpt-4o-mini',
    modelHint: 'gpt-4o-mini, gpt-4o, gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    build({ model, key, messages }) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: {
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: messages.system },
            { role: 'user', content: messages.user }
          ]
        }
      };
    },
    extract: (d) => d?.choices?.[0]?.message?.content ?? ''
  },

  anthropic: {
    label: 'Anthropic',
    needsKey: true,
    defaultModel: 'claude-sonnet-4-5',
    modelHint: 'claude-sonnet-4-5, claude-haiku-4-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    build({ model, key, messages }) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: {
          model,
          max_tokens: 2000,
          temperature: 0.2,
          system: messages.system,
          messages: [
            { role: 'user', content: messages.user },
            // Prefill the opening brace so the reply is JSON and nothing else.
            { role: 'assistant', content: '{' }
          ]
        }
      };
    },
    extract: (d) => '{' + (d?.content?.map((b) => b.text || '').join('') ?? '')
  },

  gemini: {
    label: 'Google Gemini',
    needsKey: true,
    defaultModel: 'gemini-2.0-flash',
    modelHint: 'gemini-2.0-flash, gemini-2.5-pro',
    keyUrl: 'https://aistudio.google.com/apikey',
    build({ model, key, messages }) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: {
          systemInstruction: { parts: [{ text: messages.system }] },
          contents: [{ role: 'user', parts: [{ text: messages.user }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
        }
      };
    },
    extract: (d) => d?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? ''
  },

  deepseek: {
    label: 'DeepSeek',
    needsKey: true,
    defaultModel: 'deepseek-chat',
    modelHint: 'deepseek-chat, deepseek-reasoner',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    build({ model, key, messages }) {
      return {
        url: 'https://api.deepseek.com/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: {
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: messages.system },
            { role: 'user', content: messages.user }
          ]
        }
      };
    },
    extract: (d) => d?.choices?.[0]?.message?.content ?? ''
  },

  ollama: {
    label: 'Ollama (local)',
    needsKey: false,
    defaultModel: 'llama3.1',
    modelHint: 'llama3.1, qwen2.5, mistral-nemo',
    keyUrl: 'https://ollama.com/download',
    build({ model, messages, baseUrl }) {
      const root = (baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
      return {
        url: `${root}/api/chat`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          model,
          stream: false,
          format: 'json',
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: messages.system },
            { role: 'user', content: messages.user }
          ]
        }
      };
    },
    extract: (d) => d?.message?.content ?? ''
  }
};

export async function callProvider({ provider, model, key, baseUrl, messages, signal }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider "${provider}".`);
  if (p.needsKey && !key) throw new Error(`Add your ${p.label} key in settings first.`);

  const req = p.build({ model: model || p.defaultModel, key, messages, baseUrl });

  let res;
  try {
    res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal
    });
  } catch (e) {
    if (provider === 'ollama') {
      throw new Error(
        `Could not reach Ollama at ${baseUrl || 'http://localhost:11434'}. Start it, then restart it with OLLAMA_ORIGINS=chrome-extension://* so it accepts the extension.`
      );
    }
    throw new Error(`Network request to ${p.label} failed: ${e.message}`);
  }

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 400);
    try {
      const j = JSON.parse(raw);
      detail = j.error?.message || j.error?.type || j.message || detail;
    } catch (_) {}
    throw new Error(`${p.label} returned ${res.status}: ${detail}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error(`${p.label} returned a response that was not JSON.`);
  }

  const text = p.extract(data);
  if (!text) throw new Error(`${p.label} returned an empty response.`);
  return text;
}

// Models wrap JSON in fences or prose often enough that this is worth doing.
export function parseJsonLoosely(text) {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error('The model did not return usable JSON. Try again, or pick a stronger model.');
}
