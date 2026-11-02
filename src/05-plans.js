/* ===== NOVA 1.1 :: plans, entitlements, personalities, voice profiles ===== */

/* OWNER SETUP: paste your payment links (for example Stripe Payment Links) here, then republish.
   Empty means the Get button stays disabled and says checkout is not open yet. */
const CHECKOUT = { pro: '', max: '', ultra: '' };

const TIER_RANK = { free: 0, pro: 1, max: 2, ultra: 3 };
const TIERS = {
  free: { label: 'NOVA', price: 'Free', pitch: 'Everything from version 1.0, forever.', dailyMsgs: 40, memoryMax: 0, customPersonas: 0, codeFiles: 0 },
  pro: { label: 'NOVA Pro', price: '$9 / month', pitch: 'Deeper thinking, memory that lasts, and a coding agent.', dailyMsgs: 300, memoryMax: 200, customPersonas: 5, codeFiles: 5 },
  max: { label: 'NOVA Max', price: '$15 / month', pitch: 'Everything in Pro with a much bigger daily allowance and more memory.', dailyMsgs: 1000, memoryMax: 500, customPersonas: 10, codeFiles: 8 },
  ultra: { label: 'NOVA Ultra', price: '$25 / month', pitch: 'No message cap, a multi-view Council, and a bigger coding agent.', dailyMsgs: Infinity, memoryMax: 1000, customPersonas: 15, codeFiles: 12 },
};
/* The lowest tier that unlocks each feature. Change a value here to move a feature between plans. */
const FEATURE_MIN = {
  deepModel: 'pro', personasAll: 'pro', personasCustom: 'pro', longMemory: 'pro', voicePro: 'pro', handsFree: 'pro', codeAgent: 'pro',
  imageAttach: 'pro', council: 'ultra',
};
/* Free plans get Spark and Core. Prime needs deepModel. A locked choice quietly falls back to Core, and the picker says why. */
function modelFor(id, plan) {
  const m = MODELS[id] || MODELS.spark;
  if (m.rank >= 2 && !plan.can('deepModel')) return MODELS.core;
  return m;
}

/* Offline license check. This runs in the browser, so a determined person can bypass it.
   Before you charge real customers, replace readKey with a call to your own server that
   validates keys issued by your payment webhook. */
const KEY_SALT = 'nova-v1-demo-salt';
function hash4(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(-4); }
function makeKey(tier) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const body = Array.from({ length: 8 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  const t = { pro: 'P', max: 'M', ultra: 'U' }[tier] || 'P';
  return `NOVA-${t}-${body}-${hash4(t + body + KEY_SALT)}`;
}
function readKey(key) {
  const m = /^NOVA-([PMU])-([A-Z2-9]{8})-([0-9A-Z]{4})$/.exec(String(key || '').trim().toUpperCase());
  if (!m || hash4(m[1] + m[2] + KEY_SALT) !== m[3]) return null;
  return m[1] === 'U' ? 'ultra' : m[1] === 'M' ? 'max' : 'pro';
}

function usePlan(isOwner) {
  const [stored, setStored] = useStored('plan', { key: '' });
  const [preview, setPreview] = useStored('planPreview', '');
  const [usage, setUsage] = useStored('usage', { date: '', count: 0 });
  const keyTier = readKey(stored.key) || 'free';
  const previewTier = isOwner && TIER_RANK[preview] !== undefined ? preview : '';
  const tier = previewTier || keyTier;
  const T = TIERS[tier];
  const today = todayISO();
  const count = usage.date === today ? usage.count : 0;
  const ref = useRef({});
  ref.current = { count, tier, today };
  const quota = {
    used: count, max: T.dailyMsgs,
    take: (n = 1) => {
      const u = ref.current; const max = TIERS[u.tier].dailyMsgs;
      if (u.count + n > max) return false;
      const next = u.count + n; ref.current = { ...u, count: next };
      setUsage({ date: u.today, count: next });
      return true;
    },
  };
  return {
    tier, label: T.label, keyTier, previewTier, hasKey: keyTier !== 'free', quota,
    can: (f) => TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN[f]],
    limit: (k) => T[k],
    setPreview,
    activate: (key) => { const t = readKey(key); if (!t) return { ok: false }; setStored({ key: String(key).trim().toUpperCase() }); return { ok: true, tier: t }; },
    deactivate: () => setStored({ key: '' }),
    reset: () => { setStored({ key: '' }); setPreview(''); setUsage({ date: '', count: 0 }); },
  };
}

/* ---------- Personalities (tone only, never overrides the honesty rules) ---------- */
const PERSONAS = {
  nova: { label: 'NOVA', tier: 'free', text: 'Calm, capable and friendly. Plain language.' },
  concise: { label: 'Straight to the point', tier: 'free', text: 'Use as few words as is useful. No filler, no preamble.' },
  mentor: { label: 'Patient mentor', tier: 'free', text: 'Teach step by step, check understanding, and offer a small next exercise when it helps.' },
  butler: { label: 'Formal butler', tier: 'pro', text: 'Composed, formal and dryly witty, like a British butler who is also an engineer. Courteous, never servile, never long-winded.' },
  coach: { label: 'Motivating coach', tier: 'pro', text: 'Energetic and encouraging. Break goals into small wins and name the next action. Praise only what is real.' },
  architect: { label: 'Systems architect', tier: 'pro', text: 'Think in components, trade-offs and failure modes. State the decision, the alternatives, and why.' },
  critic: { label: 'Honest critic', tier: 'pro', text: 'Challenge weak assumptions and vague plans politely but directly. Say what is wrong before what is right.' },
};
function resolvePersona(id, custom, plan) {
  const c = custom.find((x) => x.id === id);
  if (c && plan.can('personasCustom')) return { id: c.id, label: c.label, text: c.text };
  const p = PERSONAS[id];
  if (p && (p.tier === 'free' || plan.can('personasAll'))) return { id, label: p.label, text: p.text };
  return { id: 'nova', label: PERSONAS.nova.label, text: PERSONAS.nova.text };
}

/* ---------- Voice profiles ---------- */
const VOICE_PROFILES = {
  standard: { label: 'Standard', rate: 1, pitch: 1, pref: null },
  butler: { label: 'Butler (British, low)', rate: 0.95, pitch: 0.85, pref: /UK|British|en-GB|Daniel|Arthur|Oliver/i },
  calm: { label: 'Calm', rate: 0.9, pitch: 1, pref: null },
  bright: { label: 'Bright', rate: 1.12, pitch: 1.1, pref: null },
};
function resolveVoice(profileId, plan) {
  const p = plan.can('voicePro') ? VOICE_PROFILES[profileId] || VOICE_PROFILES.standard : VOICE_PROFILES.standard;
  return { voicePref: p.pref, voiceRateMul: p.rate, voicePitch: p.pitch, longRead: plan.can('voicePro') };
}

function LockedPanel({ title, tier, blurb, bullets }) {
  const { go } = useNova();
  return html`<div class="locked panel pad">
    <span class="pill p-warn">${TIERS[tier].label}</span>
    <h2>${title}</h2><p class="dim">${blurb}</p>
    <ul>${bullets.map((b) => html`<li key=${b}>${b}</li>`)}</ul>
    <div class="row"><button class="btn primary" onClick=${() => go('plans')}>See plans</button></div>
    <p class="hint">Everything in NOVA 1.0 stays free.</p>
  </div>`;
}
