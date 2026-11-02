/* ===== NOVA 2.0 :: model catalog, persistence, file export, production handoff ===== */

/* Models NOVA can run today. All three are Claude at different depths. Which ones a plan unlocks is set in FEATURE_MIN (05-plans.js). */
const MODELS = {
  spark: { id: 'spark', label: 'Nova Spark', tier: 'quick', rank: 0, blurb: 'Fastest, for everyday answers' },
  core: { id: 'core', label: 'Nova Core', tier: 'default', rank: 1, blurb: 'Balanced quality and speed' },
  prime: { id: 'prime', label: 'Nova Prime', tier: 'complex', rank: 2, blurb: 'Deepest reasoning, slowest' },
};
/* Slots for other providers. They need a server, because API keys cannot be held safely in a page. */
const EXTERNAL_MODELS = [
  { id: 'ext-gpt', label: 'GPT-class model', blurb: 'Adapter slot for an OpenAI model' },
  { id: 'ext-gemini', label: 'Gemini-class model', blurb: 'Adapter slot for a Google model' },
  { id: 'ext-open', label: 'Open-weights model', blurb: 'Adapter slot for a self-hosted model' },
];

/* Persistence. In account mode data lives in this page's database under the viewer's private area
   (nobody else can read it, the owner included). Otherwise it falls back to this browser only. */
const Persist = {
  mode: 'browser', db: null, uid: null, owner: false, q: {}, onError: null,
  async init() {
    try {
      const user = window.claude ? await window.claude.use('user') : null;
      const db = window.claude ? await window.claude.use('db') : null;
      if (user) { this.owner = await user.isOwner(); this.uid = await user.id(); }
      if (db && this.uid) { this.db = db; this.mode = 'account'; }
    } catch (e) { this.mode = 'browser'; }
    return this.mode;
  },
  ref(n) { return this.db.doc('data/users/' + this.uid + '/' + n); },
  async load(n) {
    if (this.mode === 'account') {
      try { const s = await this.ref(n).get(); return s.exists ? s.data() : null; } catch (e) { if (this.onError) this.onError(e); return null; }
    }
    return store.get('cloud-' + n, null);
  },
  save(n, data) {
    if (this.mode !== 'account') { store.set('cloud-' + n, data); return Promise.resolve(true); }
    const s = this.q[n] || (this.q[n] = { busy: false, next: null });
    s.next = data;
    if (s.busy) return Promise.resolve(true);
    s.busy = true;
    const self = this;
    return (async () => {
      while (s.next) {
        const d = s.next; s.next = null;
        try { await self.ref(n).set(d); } catch (e) { s.busy = false; if (self.onError) self.onError(e); return false; }
      }
      s.busy = false; return true;
    })();
  },
};

/* File export through the downloads capability, with a copy fallback for text. */
const Files = {
  dl: null,
  async init() { try { this.dl = (await window.claude.use('downloads')) || null; } catch (e) { this.dl = null; } return !!this.dl; },
  available() { return true; },
  async save(filename, data) {
    if (this.dl) return this.dl.save({ filename, data });
    /* Independent site: download the file straight from the browser. */
    const mime = /\.svg$/i.test(filename) ? 'image/svg+xml' : /\.json$/i.test(filename) ? 'application/json' : 'text/markdown';
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  },
};
const DL_ERR = { declined: 'Save cancelled.', unavailable: 'Saving files is not available in this view.', rate_limited: 'Another save prompt is open. Finish it first.', too_large: 'File is too large to save.' };
const dlCopy = (e) => (e && DL_ERR[e.code]) || 'Could not save the file.';

/* Handoff document for turning this prototype into a paid product. */
function buildHandoffSpec() {
  const tiers = JSON.stringify(Object.fromEntries(Object.entries(TIERS).map(([k, t]) => [k, { label: t.label, price: t.price, dailyMessages: t.dailyMsgs === Infinity ? 'unlimited' : t.dailyMsgs, memoryItems: t.memoryMax, customPersonalities: t.customPersonas, codeFiles: t.codeFiles }])), null, 2);
  const gates = JSON.stringify(FEATURE_MIN, null, 2);
  return `# NOVA production handoff

This page checks plans in the browser. That is a demonstration only: anyone can read the source and bypass a check, and no money moves. To sell NOVA you need a server that owns identity, billing, entitlements and model access.

## What the prototype already defines
Tiers:
\`\`\`json
${tiers}
\`\`\`
Feature gates (lowest tier that unlocks each feature):
\`\`\`json
${gates}
\`\`\`
Models: ${Object.values(MODELS).map((m) => m.label + ' (' + m.tier + ')').join(', ')}. External model slots (need server-held API keys): ${EXTERNAL_MODELS.map((m) => m.label).join(', ')}.

## Required backend
1. **Accounts.** Sign-in with a hosted auth service. Every request carries a verified user id.
2. **Billing.** Hosted checkout for monthly subscriptions, with webhooks that write the user's tier and period end to your database. Handle failed payments, cancellation, refunds and tax.
3. **Entitlements.** Replace the browser license check with a server call that returns the user's tier. Never trust a tier stored in the browser.
4. **Model gateway.** A \`POST /v1/chat\` endpoint that checks the tier allows the model and the daily message cap, calls the provider with a server-held API key, streams the reply back, and counts the message. One adapter per provider with the same interface as the prototype's provider layer: \`complete(messages, { model, signal, onText })\`.
5. **Storage.** Tables for conversations, memories, notes and tasks so data follows the user across devices.
6. **Abuse control.** Per-user and per-IP rate limits, and an alarm on provider spend.

## Suggested launch order
Accounts, then billing, then entitlements, then the model gateway, then the Code Agent and Council on the server, then extra providers.
`;
}
