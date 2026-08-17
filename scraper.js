// Amazon ships several page layouts per locale and rotates them. Every field
// below is a list of candidate selectors tried in order, so one dead selector
// degrades that field instead of the whole scrape.
(function () {
  const clean = (s) =>
    (s || '')
      .replace(/\u200b|\u200e|\u200f/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const pick = (selectors, root = document) => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      const t = clean(el?.getAttribute?.('content') || el?.textContent);
      if (t) return t;
    }
    return '';
  };

  const pickAll = (selectors, { limit = 40, root = document } = {}) => {
    for (const sel of selectors) {
      const items = [...root.querySelectorAll(sel)]
        .map((el) => clean(el.textContent))
        .filter((t) => t && t.length > 1);
      if (items.length) return [...new Set(items)].slice(0, limit);
    }
    return [];
  };

  function getSpecs() {
    const rows = [];
    const tables = [
      '#productDetails_techSpec_section_1 tr',
      '#productDetails_detailBullets_sections1 tr',
      '#technicalSpecifications_section_1 tr',
      '#productOverview_feature_div tr',
      'table.a-normal.a-spacing-micro tr'
    ];
    for (const sel of tables) {
      document.querySelectorAll(sel).forEach((tr) => {
        const k = clean(tr.querySelector('th, td:first-child')?.textContent);
        const v = clean(tr.querySelector('td:last-child')?.textContent);
        if (k && v && k !== v) rows.push(`${k}: ${v}`);
      });
    }
    document.querySelectorAll('#detailBullets_feature_div li').forEach((li) => {
      const t = clean(li.textContent);
      if (t.includes(':')) rows.push(t.replace(/\s*:\s*/, ': '));
    });
    return [...new Set(rows)].slice(0, 35);
  }

  function getHistogram() {
    const out = [];
    document
      .querySelectorAll('#histogramTable tr, [data-hook="cr-filter-info-review-rating-count"], .a-histogram-row')
      .forEach((row) => {
        const t = clean(row.textContent);
        if (/star/i.test(t) && /\d/.test(t)) out.push(t);
      });
    // Newer layouts hide the percentage in a link title.
    if (!out.length) {
      document.querySelectorAll('#histogramTable a, [data-hook="histogram-row"] a').forEach((a) => {
        const t = clean(a.getAttribute('title') || a.textContent);
        if (t) out.push(t);
      });
    }
    return [...new Set(out)].slice(0, 6).join(' | ');
  }

  function getReviews() {
    const nodes = [
      ...document.querySelectorAll(
        '#cm-cr-dp-review-list [data-hook="review"], [data-hook="review"], .review[data-hook], #cm_cr-review_list .review'
      )
    ];
    return nodes
      .map((n) => {
        const stars = clean(
          n.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt, i.a-icon-star span')?.textContent
        ).match(/([\d.]+)/)?.[1];
        return {
          stars,
          title: clean(
            n.querySelector('[data-hook="review-title"] span:not(.a-icon-alt), [data-hook="review-title"]')?.textContent
          ),
          body: clean(n.querySelector('[data-hook="review-body"] span, [data-hook="review-body"]')?.textContent).slice(0, 900),
          date: clean(n.querySelector('[data-hook="review-date"]')?.textContent),
          verified: Boolean(n.querySelector('[data-hook="avp-badge"]')),
          helpful: clean(n.querySelector('[data-hook="helpful-vote-statement"]')?.textContent)
        };
      })
      .filter((r) => r.body && r.body.length > 20);
  }

  function isProductPage() {
    return Boolean(
      document.querySelector('#productTitle') &&
        (/\/(dp|gp\/product|gp\/aw\/d)\//.test(location.pathname) || document.querySelector('#dp-container'))
    );
  }

  function scrape() {
    const notes = [];
    const reviews = getReviews();

    const page = {
      url: location.href.split('?')[0],
      asin:
        location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/)?.[1] ||
        document.querySelector('input#ASIN, input[name="ASIN"]')?.value ||
        '',
      title: pick(['#productTitle', '#title span', 'h1 span#productTitle']),
      brand: pick(['#bylineInfo', '#brand', 'a#bylineInfo_feature_div']),
      price: pick([
        '#corePrice_feature_div .a-price .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
        '#priceblock_ourprice',
        '#priceblock_dealprice',
        '.a-price .a-offscreen',
        '#price_inside_buybox'
      ]),
      listPrice: pick([
        '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
        '.savingsPercentage',
        '#listPrice',
        'span.a-text-price .a-offscreen'
      ]),
      availability: pick(['#availability span', '#availability', '#outOfStock']),
      seller: [pick(['#sellerProfileTriggerId', '#merchant-info']), pick(['#tabular-buybox', '#fulfillerInfoFeature_feature_div'])]
        .filter(Boolean)
        .join(' | '),
      rating: pick([
        '#acrPopover .a-icon-alt',
        '[data-hook="rating-out-of-text"]',
        '#averageCustomerReviews .a-icon-alt',
        '#acrPopover'
      ]),
      reviewCount: pick(['#acrCustomerReviewText', '[data-hook="total-review-count"]']),
      histogram: getHistogram(),
      aiSummary: pick([
        '#product-summary p',
        '[data-hook="cr-product-insights-summary"]',
        '#cr-summarization-attributes-list',
        '.product-summary-text'
      ]).slice(0, 1200),
      bullets: pickAll(['#feature-bullets li span.a-list-item', '#feature-bullets li', '#featurebullets_feature_div li'], {
        limit: 12
      }),
      specs: getSpecs(),
      badges: [
        pick(['#zeitgeistBadge_feature_div', '.badge-wrapper']),
        pick(['#amazons-choice-badge', '#acBadge_feature_div']),
        document.querySelector('#promoPriceBlockMessage, #couponBadgeRegularVpc') ? 'Coupon or promo shown' : ''
      ]
        .filter(Boolean)
        .join(' | '),
      firstAvailable: (getSpecs().find((s) => /first available|date first/i.test(s)) || ''),
      aplus: clean(document.querySelector('#aplus, #aplus_feature_div, #dpx-aplus-product-description_feature_div')?.textContent).slice(
        0,
        2500
      ),
      reviews,
      notes
    };

    if (!page.reviews.length) notes.push('No review text was present in the DOM; the review module may not have loaded. Scroll to the reviews and re-run for better coverage.');
    if (page.reviews.length && page.reviews.length < 5) notes.push(`Only ${page.reviews.length} reviews were visible on the page — a small and non-random sample.`);
    if (!page.histogram) notes.push('The star distribution was not captured.');
    if (!page.price) notes.push('No price was visible, which usually means the item is unavailable or sold only by third parties.');
    if (/sponsored/i.test(document.querySelector('#titleSection')?.textContent || '')) notes.push('This listing is sponsored.');

    return page;
  }

  window.__secondOpinion = { scrape, isProductPage };
})();
