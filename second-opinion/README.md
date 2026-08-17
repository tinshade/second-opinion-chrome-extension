# Second Opinion — Amazon Shopping Assistant

A Manifest V3 browser extension that reads an Amazon product page, sends the scraped evidence to **your own** LLM, and renders a pros/cons analysis where every point is tagged with where it came from: a buyer reported it, the spec sheet says it, or the seller claims it.

No backend. Your key goes from your browser straight to the provider.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select this folder.
4. Click the extension icon → **Model and keys** → pick a provider, paste a key, **Test connection**.
5. Open any Amazon product page. A tab labelled *Second opinion* appears on the right edge.

Firefox needs `browser_specific_settings` added to the manifest and `chrome.*` aliased to `browser.*`; everything else ports as-is.

## Providers

| Provider | Endpoint | Notes |
|---|---|---|
| OpenAI | `/v1/chat/completions` | JSON mode |
| Anthropic | `/v1/messages` | assistant prefill forces JSON; sends the direct-browser-access header |
| Gemini | `:generateContent` | `responseMimeType: application/json` |
| DeepSeek | `/chat/completions` | OpenAI-compatible |
| Ollama | `/api/chat` | local, no key |

**Ollama needs one extra step.** It rejects browser-origin requests by default. Restart it with `OLLAMA_ORIGINS=chrome-extension://*` in the environment.

Adding a sixth provider means one entry in `src/lib/providers.js` — a `build()` that returns `{url, headers, body}` and an `extract()` that returns the text. Nothing else changes.

## How it's put together

```
manifest.json
src/lib/providers.js      adapters + loose JSON parsing
src/lib/prompt.js         the anti-bias rules and output schema  ← the actual product
src/background/           service worker: settings, provider call, schema normalisation
src/content/scraper.js    fallback selector chains for Amazon's layout variants
src/content/panel.js      shadow-DOM panel so Amazon's CSS can't reach it
src/options/, src/popup/
```

The service worker makes the network calls, not the content script: `host_permissions` there let the fetch bypass CORS, and your key never enters the page context where Amazon's own scripts run.

## What keeps the analysis honest

The prompt in `src/lib/prompt.js` is the part worth tuning. It currently:

- forbids outside knowledge — anything not on the page goes in **"the page never says"** instead of being invented
- separates seller claims from buyer reports, and refuses to count an unrepeated marketing claim as a pro
- bans the listing's own adjectives, so "premium build" can't launder itself into the output
- weights critical and verified-purchase reviews at least as heavily as glowing ones
- looks at the shape of the rating distribution, not just the average
- flags thin or suspicious review sets
- allows a one-sided conclusion rather than manufacturing false balance
- allows "low confidence" as an answer
- forbids urgency, recommendations to buy, and any judgement about whether the price is good

## Known limits

- Only reviews already rendered in the DOM are readable — roughly eight. **Scroll to the reviews before running.** Fetching the full review pages would work but trips Amazon's bot defences, so it's deliberately left out.
- Amazon rotates DOM layouts and runs A/B tests per locale. Selectors are chained with fallbacks and failures degrade one field, but expect to patch `scraper.js` occasionally.
- Scraping and automated access sit against Amazon's terms of service. This is fine as a personal tool you drive by hand; it is not fine as a product you ship at scale.
- An LLM reading eight reviews is a better-organised summary, not an audit. It cannot detect a fake review that reads plausibly.

## Worth building next

- Cache results by ASIN in `chrome.storage.local` so re-opening a page costs nothing.
- Streaming responses, so the verdict appears before the ledger fills in.
- A "compare open tabs" mode — the same schema across three ASINs makes a real comparison table.
- Per-source token budgeting; long A+ copy currently eats prompt space that reviews would use better.
