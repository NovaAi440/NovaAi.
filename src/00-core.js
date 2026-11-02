/* ===== NOVA 1.0 :: core (utils, storage, provider layer, prompts, markdown) ===== */
const { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext, Component } = React;
const html = htm.bind(React.createElement);

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const pad2 = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* Per-browser convenience storage. Every access is guarded: it may be empty or blocked. */
const store = {
  get(k, d) { try { const v = localStorage.getItem('nova1:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('nova1:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  wipe() { try { Object.keys(localStorage).filter((k) => k.startsWith('nova1:')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ } },
};
function useStored(key, init) {
  const [v, setV] = useState(() => store.get(key, init));
  useEffect(() => { store.set(key, v); }, [key, v]);
  return [v, setV];
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch (e2) { return false; }
  }
}

/* ---------- Provider layer: swap or add models here in future versions ---------- */
const ClaudeProvider = {
  id: 'claude', label: 'Claude', sample: null, limits: null, tiers: ['quick', 'default', 'complex'],
  async init() {
    try { this.sample = (await window.claude.use('sample')) || null; } catch (e) { this.sample = null; }
    if (this.sample) { try { this.limits = await this.sample.limits(); } catch (e) { this.limits = null; } }
    return !!this.sample;
  },
  available() { return !!this.sample; },
  imagesOk() { return !!(this.limits && this.limits.images); },
  complete(input, o = {}) {
    if (AI.gate && !AI.gate()) return Promise.reject({ code: 'daily_limit', message: 'daily message limit' });
    const opts = { signal: o.signal, onText: o.onText, modelTier: o.tier || 'default', cache: false };
    if (o.images && o.images.length) opts.images = o.images;
    return this.sample(input, opts);
  },
  json(input, o = {}) {
    if (AI.gate && !AI.gate()) return Promise.reject({ code: 'daily_limit', message: 'daily message limit' });
    return this.sample.json(input, { signal: o.signal, modelTier: o.tier || 'quick', cache: false });
  },
};
/* ---------- Server provider: used on an independent website. Model calls go to /api/chat, where the API key stays on the server. ---------- */
const API_CHAT = '/api/chat';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const blobToImage = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => { const str = String(r.result || ''); resolve({ mediaType: blob.type, data: str.slice(str.indexOf(',') + 1) }); };
  r.onerror = () => reject({ code: 'invalid_request', message: 'image read failed' });
  r.readAsDataURL(blob);
});
async function postChat(body, signal) {
  let res;
  try {
    res = await fetch(API_CHAT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw { code: 'cancelled', message: 'cancelled' };
    throw { code: 'upstream_error', message: 'network' };
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) throw { code: (data && data.code) || (res.status === 429 ? 'rate_limited' : 'upstream_error'), message: (data && data.message) || 'request failed' };
  if (!data || typeof data.text !== 'string') throw { code: 'empty_completion', message: 'empty' };
  return data;
}
const ServerProvider = {
  id: 'server', label: 'NOVA AI service', configured: false, tiers: ['quick', 'default', 'complex'],
  limits: { images: { mediaTypes: IMAGE_TYPES, maxInputBytes: IMAGE_MAX_BYTES } },
  async init() {
    try { const r = await fetch(API_CHAT, { method: 'GET' }); const d = await r.json(); this.configured = !!(d && d.configured); }
    catch (e) { this.configured = false; }
    return this.configured;
  },
  available() { return this.configured; },
  imagesOk() { return this.configured; },
  async complete(input, o = {}) {
    if (AI.gate && !AI.gate()) throw { code: 'daily_limit', message: 'daily message limit' };
    const images = o.images && o.images.length ? await Promise.all(o.images.map(blobToImage)) : [];
    const data = await postChat({ messages: input, tier: o.tier || 'default', images }, o.signal);
    if (o.onText) o.onText({ text: data.text, delta: data.text });
    return { text: data.text, truncated: !!data.truncated, modelTierApplied: data.tier || o.tier || 'default' };
  },
  async json(input, o = {}) {
    if (AI.gate && !AI.gate()) throw { code: 'daily_limit', message: 'daily message limit' };
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
    const data = await postChat({ messages, tier: o.tier || 'quick', json: true }, o.signal);
    const t = data.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) { throw { code: 'invalid_json', message: 'invalid json' }; }
  },
};
const PROVIDERS = { claude: ClaudeProvider, server: ServerProvider };
/* Every model call passes through AI.gate, which the app sets to take one message from the plan's daily allowance.
   Inside Claude Artifacts the page uses the Claude runtime; on an independent site it uses the server provider. */
const AI = {
  active: 'claude', gate: null,
  get provider() { return PROVIDERS[this.active]; },
  async init() {
    this.active = typeof window !== 'undefined' && window.claude ? 'claude' : 'server';
    return this.provider.init();
  },
};
/* Every model call passes through AI.gate, which the app sets to take one message from the plan's daily allowance. */


const ERR_COPY = {
  not_granted: 'Claude access was declined for this page. Reload the page and allow it to use Claude.',
  rate_limited: 'Too many requests, or your usage limit was reached. Wait a moment, then try again.',
  daily_limit: "You have used today's messages on your plan. Plans shows the limits. The count resets at midnight.",
  session_expired: 'Your session expired. Sign in again, then retry.',
  sampling_disabled: 'Claude is not available for this account or organization.',
  refused: 'Claude declined this request. Rephrase it and try again.',
  empty_completion: 'Claude returned nothing. Try rephrasing.',
  upstream_error: 'Connection problem. Your message is kept. Press Retry.',
  prompt_too_large: 'This conversation is too long. Start a new session.',
  invalid_json: 'The reply could not be read as structured data. Try again.',
  invalid_request: 'The request could not be sent. Check your input.',
  capability_disabled: 'Claude is not usable in this view.',
  ai_not_configured: 'The AI service is not set up on this site yet. The site owner needs to add the API key on the server.',
  cancelled: '',
};
const errCopy = (e) => (e && e.code in ERR_COPY ? ERR_COPY[e.code] : 'Something went wrong' + (e && e.message ? ': ' + clip(String(e.message), 140) : '') + '.');

/* ---------- Modes ---------- */
const MODES = {
  home: { label: 'Overview', glyph: '◎', blurb: 'Command center' },
  chat: { label: 'Assistant', glyph: '◈', blurb: 'Conversation' },
  dev: { label: 'Developer', glyph: '⌥', blurb: 'Code and debugging' },
  research: { label: 'Research', glyph: '⌕', blurb: 'Structured reports' },
  gaming: { label: 'Gaming', glyph: '◇', blurb: 'Roblox and Fortnite' },
  studio: { label: 'Studio', glyph: '✦', blurb: 'Vector image creation' },
  council: { label: 'Council', glyph: '⚖', blurb: 'Three views, one synthesis' },
  agent: { label: 'Agent', glyph: '⛬', blurb: 'Plans with approvals' },
  planner: { label: 'Planner', glyph: '▦', blurb: 'Tasks, schedule, notes' },
  memory: { label: 'Memory', glyph: '▣', blurb: 'Session and long-term' },
  plans: { label: 'Plans', glyph: '◆', blurb: 'NOVA, Pro and Ultra' },
  settings: { label: 'Settings', glyph: '⚙', blurb: 'Preferences' },
};
const CHAT_MODES = ['chat', 'dev', 'research', 'gaming'];

const DEV_LANGS = ['Python', 'JavaScript', 'HTML', 'CSS', 'Roblox Lua'];
const DEV_TASKS = { generate: 'Generate code', explain: 'Explain code', debug: 'Debug' };
const RESEARCH_TASKS = { plan: 'Research plan', explain: 'Explain topic', compare: 'Compare', report: 'Full report' };
const GAME_PLATFORMS = { roblox: 'Roblox', fortnite: 'Fortnite Creative' };
const GAME_FOCUS = { code: 'Lua code', mechanics: 'Mechanics and ideas', design: 'Design plan' };

const DEFAULT_OPTS = {
  chat: {},
  dev: { lang: 'Python', task: 'generate' },
  research: { task: 'report' },
  gaming: { platform: 'roblox', focus: 'code' },
};

const QUICK = {
  chat: ['Help me plan a productive week', 'Explain how large language models work, simply', 'Draft a polite message declining a meeting'],
  dev: ['Write a function that debounces another function', 'Explain what this code does and where it could break', 'Why does my loop never end? I will paste the code next'],
  research: ['Compare electric and hydrogen cars for city commuting', 'Research plan: how sleep affects learning', 'Explain how vaccines train the immune system'],
  gaming: ['Roblox: a sword with a swing cooldown and hit detection', 'Roblox: a round-based minigame loop with a lobby', 'Fortnite Creative: ideas for a 10-player parkour map'],
};

const BASE_PROMPT = `You are NOVA, a personal AI assistant inside a browser dashboard. You are powered by Claude.
Rules you always follow:
- You exist only inside this chat. You cannot browse the web, open files, send messages, run code, or change anything outside this conversation. Never claim you did any of those. If asked, say what you can do instead: draft, explain, plan, review.
- Keep what you know apart from what you are guessing. If you are unsure, say so plainly.
- Be direct and useful. Use Markdown. Prefer short paragraphs. Use lists only when they help. Put code in fenced blocks with a language tag.`;

function modePrompt(mode, o = {}) {
  if (mode === 'dev') {
    const lang = o.lang || 'Python';
    const task = o.task || 'generate';
    const luau = lang === 'Roblox Lua'
      ? '\nFor Roblox Lua: write Luau for Roblox Studio. Say whether each script is a Script, LocalScript or ModuleScript and where it goes in the Explorer (for example ServerScriptService). Use current APIs, task.wait instead of wait, and RemoteEvents for client-server communication. Validate anything sent from the client on the server.'
      : '';
    const how = {
      generate: 'Write complete, runnable code for the request. Give the code first, then a short explanation and how to run or use it. List any assumptions.',
      explain: 'Explain the code the user provides: what it does, how it flows, and any risks. Walk through it in order. Keep the explanation proportionate to the code.',
      debug: 'Find the root cause of the problem. Show the corrected code, then explain what was wrong and how to avoid it. If the report lacks the detail you need, ask for it before guessing.',
    }[task];
    return `MODE: Developer. Language: ${lang}. Task: ${DEV_TASKS[task]}.\n${how}${luau}`;
  }
  if (mode === 'research') {
    const task = o.task || 'report';
    const shape = {
      plan: 'Produce a research plan: the question restated, sub-questions, what evidence would answer each, what sources to consult, and risks of bias.',
      explain: 'Explain the topic clearly for an intelligent newcomer, then name what is still debated.',
      compare: 'Compare the options in a Markdown table with consistent criteria, then give a short reading of the trade-offs. Do not declare a winner unless the criteria support one.',
      report: 'Write a structured report with these sections: Summary, Key findings, Evidence and confidence, Open questions, What to verify next.',
    }[task];
    return `MODE: Research. ${shape}
Honesty rules for this mode:
- You cannot browse or look anything up here. Everything comes from your training knowledge, which may be out of date.
- Label every substantive claim as [Established] (well documented, widely agreed), [Likely] (probable but contested or dated) or [Assumption] (your inference or a guess).
- Never invent citations, statistics, quotes or URLs. Name the kinds of sources to check (for example "peer-reviewed reviews on X", "the regulator's published figures") instead of fabricated references.
- End with a short list titled "Verify before relying on this".`;
  }
  if (mode === 'gaming') {
    const roblox = (o.platform || 'roblox') === 'roblox';
    const focus = o.focus || 'code';
    if (roblox) {
      const f = {
        code: 'Generate Roblox Lua (Luau) code. State the script type and where it lives in Studio. Add comments that explain the logic. Mention how to test it in Studio.',
        mechanics: 'Propose game mechanics and ideas. Give 3 to 5 options with how each plays, what to build first, and what could go wrong.',
        design: 'Produce a game design plan: concept, core loop, progression, systems list, a build order for one developer, and a testing plan.',
      }[focus];
      return `MODE: Gaming, platform Roblox, focus ${GAME_FOCUS[focus]}.\n${f}\nUse Luau, task.wait, server-authoritative logic, and RemoteEvents with server validation.`;
    }
    const f = {
      code: 'Fortnite Creative uses devices and Verse. Prefer device-based setups and give Verse snippets only when you are confident in the syntax. Say when something needs checking in the editor.',
      mechanics: 'Propose map and mode ideas built from Creative devices. Give 3 to 5 options with the devices involved and how a round plays.',
      design: 'Produce a design plan for a Creative island: concept, player flow, device list, build order, and a playtest plan.',
    }[focus];
    return `MODE: Gaming, platform Fortnite Creative, focus ${GAME_FOCUS[focus]}.\n${f}\nDo not invent device names. If you are unsure a device or Verse API exists, say so.`;
  }
  return 'MODE: General assistant. Converse naturally and help with whatever the user asks.';
}

function buildInstructions({ mode, opts, prefs, memory, useMemory }) {
  const toneMap = { concise: 'Keep answers short.', balanced: 'Balance brevity and detail.', detailed: 'Give thorough, detailed answers.' };
  const lines = [BASE_PROMPT, '', modePrompt(mode, opts), '', 'Style: ' + (toneMap[prefs.length] || toneMap.balanced) + (prefs.userName ? ` The user's name is ${prefs.userName}.` : '')];
  if (prefs.personaText) lines.push('Personality (tone only; the honesty rules above always apply): ' + prefs.personaText);
  if (prefs.voiceReplies) lines.push('Replies may be read aloud, so avoid long tables and keep code short unless asked.');
  if (useMemory && memory.length) {
    lines.push('', 'Notes the user chose to keep, some saved permanently and some from this session (context only, may be stale):');
    memory.forEach((m) => lines.push('- ' + m.text));
  }
  return lines.join('\n');
}

/* Send one chat turn to the active provider. Streams through onText. */
function runChat({ session, prefs, memory, useMemory, signal, onText, model, images }) {
  const turns = session.messages.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return Promise.reject({ code: 'invalid_request', message: 'Nothing to send' });
  const input = [{ role: 'user', content: buildInstructions({ mode: session.mode, opts: session.opts, prefs, memory, useMemory }) }, ...turns.slice(-40)];
  return AI.provider.complete(input, { signal, onText, tier: model ? model.tier : 'default', images });
}

/* ---------- Markdown (safe: builds React nodes, never raw HTML) ---------- */
function inline(t) {
  return t.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.length > 1 && p[0] === '`' && p[p.length - 1] === '`') return html`<code key=${i}>${p.slice(1, -1)}</code>`;
    if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return html`<strong key=${i}>${p.slice(2, -2)}</strong>`;
    return p;
  });
}
const LIST_RE = /^\s*([-*]|\d+\.)\s+/;
function parseBlocks(text) {
  const lines = text.split('\n'); const out = []; let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const f = ln.match(/^```(\S*)/);
    if (f) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; out.push({ t: 'code', lang: f[1], body: buf.join('\n') }); continue;
    }
    if (/^#{1,4}\s/.test(ln)) { out.push({ t: 'h', body: ln.replace(/^#{1,4}\s+/, '') }); i++; continue; }
    if (/^\s*\|/.test(ln)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = rows.filter((r) => !/^\s*\|[\s:|-]+\|?\s*$/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      out.push({ t: 'table', rows: cells }); continue;
    }
    if (LIST_RE.test(ln)) {
      const ordered = /^\s*\d+\./.test(ln); const items = [];
      while (i < lines.length && LIST_RE.test(lines[i])) { items.push(lines[i].replace(LIST_RE, '')); i++; }
      out.push({ t: 'list', ordered, items }); continue;
    }
    if (!ln.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !LIST_RE.test(lines[i]) && !/^\s*\|/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push({ t: 'p', body: para.join(' ') });
  }
  return out;
}

function CodeBlock({ lang, body }) {
  const [done, setDone] = useState(false);
  const onCopy = async () => { if (await copyText(body)) { setDone(true); setTimeout(() => setDone(false), 1400); } };
  return html`<div class="code">
    <div class="code-bar"><span>${lang || 'code'}</span><button class="mini" onClick=${onCopy}>${done ? 'Copied' : 'Copy'}</button></div>
    <pre><code>${body}</code></pre>
  </div>`;
}

function Md({ text }) {
  const blocks = useMemo(() => parseBlocks(text || ''), [text]);
  return html`<div class="md">${blocks.map((b, i) => {
    if (b.t === 'code') return html`<${CodeBlock} key=${i} lang=${b.lang} body=${b.body} />`;
    if (b.t === 'h') return html`<h4 key=${i}>${inline(b.body)}</h4>`;
    if (b.t === 'p') return html`<p key=${i}>${inline(b.body)}</p>`;
    if (b.t === 'list') {
      const Tag = b.ordered ? 'ol' : 'ul';
      return html`<${Tag} key=${i}>${b.items.map((it, j) => html`<li key=${j}>${inline(it)}</li>`)}<//>`;
    }
    if (b.t === 'table') {
      const [head, ...rest] = b.rows;
      return html`<div class="tbl" key=${i}><table>
        <thead><tr>${(head || []).map((c, j) => html`<th key=${j}>${inline(c)}</th>`)}</tr></thead>
        <tbody>${rest.map((r, j) => html`<tr key=${j}>${r.map((c, k) => html`<td key=${k}>${inline(c)}</td>`)}</tr>`)}</tbody>
      </table></div>`;
    }
    return null;
  })}</div>`;
}
