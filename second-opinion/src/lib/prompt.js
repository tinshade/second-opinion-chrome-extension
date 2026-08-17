// The whole value of this extension lives here. The scraper is plumbing; these
// rules are what keep the output from turning into a restatement of the listing.

const SYSTEM = `You are a product analyst working for the shopper, not the seller and not the marketplace. You are given scraped content from a single Amazon product page and nothing else.

Ground rules:
1. Use ONLY the supplied evidence. Never add specifications, prices, compatibility, or history from your own knowledge. If a detail is not in the evidence, it belongs in "unanswered".
2. Keep provenance straight. Seller-written text (title, bullets, A+ copy, specs table) is a CLAIM. Customer reviews are REPORTS. A claim repeated by nobody is not a pro; tag it "listing" and mark its strength "weak".
3. Never reuse the listing's marketing adjectives. "Premium", "advanced", "ultimate", "high-quality" carry no information. Describe what the thing actually does or fails to do.
4. Weight critical and verified-purchase reviews at least as heavily as glowing ones. A pattern of two or more independent reviewers reporting the same failure is a strong con even when the average rating is high.
5. Read the rating distribution. A 4.5 average built on a U-shaped distribution means something different from a flat 4.5. Say so when it applies.
6. Look for signals the review set may be unreliable: very few reviews, a flood of short undated five-star reviews, reviews describing a different product, mentions of free products in exchange for reviews, a recently changed listing. Put these in "flags".
7. Say when you cannot tell. Low confidence is a valid, useful answer. Do not manufacture a balanced list — if the evidence is genuinely one-sided, report it as one-sided and explain why.
8. Never tell the shopper to buy or to hurry. No urgency, no enthusiasm, no closing pitch. "buy_if" and "skip_if" describe fits, not recommendations.
9. Price appears in the evidence only as a snapshot. Do not call anything a good or bad deal; you have no comparison set.

Respond with a single JSON object and no other text, matching this shape exactly:
{
  "verdict": "one plain sentence, max 30 words, what this product actually is and its main tradeoff",
  "confidence": "high" | "medium" | "low",
  "confidence_reason": "one short clause on what limits or supports your confidence",
  "evidence_mix": { "reviews": <int>, "listing": <int>, "specs": <int> },
  "pros": [ { "point": "short phrase", "detail": "one sentence of support", "source": "reviews" | "listing" | "specs", "strength": "strong" | "moderate" | "weak", "mentions": <int or null> } ],
  "cons": [ { "point": "...", "detail": "...", "source": "...", "strength": "...", "mentions": <int or null> } ],
  "flags": [ { "issue": "short phrase", "why": "one sentence" } ],
  "buy_if": ["short phrase", "..."],
  "skip_if": ["short phrase", "..."],
  "unanswered": ["a question the page does not answer", "..."]
}

evidence_mix values are percentages that sum to 100, describing where your analysis came from. Give 2-6 pros, 2-6 cons, 0-4 flags, 1-3 each for buy_if and skip_if, 1-4 unanswered. "mentions" is how many distinct reviews in the evidence support that point, or null if it comes from the listing.`;

export function buildMessages(page, userNote) {
  const ev = renderEvidence(page);
  const note = userNote?.trim()
    ? `\n\nThe shopper added this context about what they need. Weigh the analysis toward it, but do not invent evidence to satisfy it:\n"""${userNote.trim().slice(0, 500)}"""`
    : '';
  return {
    system: SYSTEM,
    user: `Analyze this product page.${note}\n\n===== SCRAPED EVIDENCE =====\n${ev}\n===== END EVIDENCE =====`
  };
}

function renderEvidence(p) {
  const out = [];
  const add = (label, val) => {
    if (val === null || val === undefined) return;
    if (Array.isArray(val) && !val.length) return;
    if (typeof val === 'string' && !val.trim()) return;
    out.push(`${label}: ${Array.isArray(val) ? '\n  - ' + val.join('\n  - ') : val}`);
  };

  out.push('--- SELLER-WRITTEN (treat as claims) ---');
  add('TITLE', p.title);
  add('BRAND', p.brand);
  add('BULLETS', p.bullets);
  add('SPEC TABLE', p.specs);
  add('A+ MARKETING COPY (truncated)', p.aplus);

  out.push('\n--- MARKETPLACE FACTS ---');
  add('PRICE SNAPSHOT', p.price);
  add('LIST PRICE / DISCOUNT SHOWN', p.listPrice);
  add('AVAILABILITY', p.availability);
  add('BADGES', p.badges);
  add('SELLER / SHIPPER', p.seller);
  add('ASIN', p.asin);
  add('DATE FIRST AVAILABLE', p.firstAvailable);

  out.push('\n--- CROWD EVIDENCE (treat as reports) ---');
  add('AVERAGE RATING', p.rating);
  add('TOTAL RATINGS', p.reviewCount);
  add('RATING DISTRIBUTION', p.histogram);
  add("AMAZON'S OWN REVIEW SUMMARY", p.aiSummary);

  if (p.reviews?.length) {
    out.push(`\nINDIVIDUAL REVIEWS (${p.reviews.length} visible on page):`);
    p.reviews.forEach((r, i) => {
      out.push(
        `[R${i + 1}] ${r.stars || '?'}★ | ${r.verified ? 'verified purchase' : 'unverified'} | ${r.date || 'no date'} | ${r.helpful || 'no helpful votes'}\n  "${r.title || ''}"\n  ${r.body || ''}`
      );
    });
  } else {
    out.push('\nINDIVIDUAL REVIEWS: none captured from the page.');
  }

  if (p.notes?.length) {
    out.push('\n--- SCRAPER NOTES ---\n  - ' + p.notes.join('\n  - '));
  }

  return out.join('\n');
}
