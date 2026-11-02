/* ===== NOVA 2.0 :: chat engine + chat panels (Assistant, Developer, Research, Gaming) ===== */

const TEXT_EXT = /\.(txt|md|csv|json|js|ts|py|lua|luau|html|css|xml|yml|yaml|log|sql|sh|java|c|cpp|cs|go|rs)$/i;
const MAX_TEXT = 40000;

function useChatEngine(env) {
  const { sessions, setSessions, prefs, memory, useMemory, voice, autoCapture, addMemory } = env;
  const [busyId, setBusyId] = useState(null);
  const ctl = useRef(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const imgRef = useRef({}); // message id -> image Blobs (kept in memory only, never persisted)

  const patch = useCallback((sid, fn) => setSessions((ss) => ss.map((s) => (s.id === sid ? fn(s) : s))), [setSessions]);
  const patchMsg = useCallback((sid, mid, fn) => patch(sid, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === mid ? fn(m) : m)) })), [patch]);
  const lastUserOf = (snap) => [...snap.messages].reverse().find((m) => m.role === 'user');

  const capture = useCallback((userText, reply) => {
    if (!AI.provider.available()) return;
    const prompt = `From this exchange, list up to 2 short facts about the user, their preferences or decisions that are worth remembering. Reply with only a JSON array of strings. Reply [] if nothing is worth keeping.\n\nUser: ${clip(userText, 800)}\n\nAssistant: ${clip(reply, 800)}`;
    AI.provider.json(prompt, { tier: 'quick' })
      .then((arr) => { if (Array.isArray(arr)) arr.slice(0, 2).forEach((t) => typeof t === 'string' && t.trim() && addMemory(clip(t.trim(), 240), 'auto')); })
      .catch(() => { /* auto-capture is best effort and is not charged on failure */ });
  }, [addMemory]);

  const run = useCallback(async (sid, snapshot) => {
    const aid = uid();
    if (!AI.provider.available()) {
      patch(sid, (s) => ({ ...s, messages: [...snapshot.messages, { id: aid, role: 'assistant', content: '', error: 'The AI service is not reachable right now, so NOVA cannot answer. Try again in a moment.', ts: Date.now() }] }));
      return;
    }
    const model = MODELS[prefs.model] || MODELS.spark;
    const lu = lastUserOf(snapshot);
    const images = lu && imgRef.current[lu.id] ? imgRef.current[lu.id] : [];
    patch(sid, (s) => ({ ...s, messages: [...snapshot.messages, { id: aid, role: 'assistant', content: '', pending: true, model: model.id, ts: Date.now() }] }));
    const c = new AbortController();
    ctl.current = c; setBusyId(sid);
    try {
      const res = await runChat({
        session: snapshot, prefs, memory, useMemory, signal: c.signal, model, images,
        onText: ({ text }) => patchMsg(sid, aid, (m) => ({ ...m, content: text })),
      });
      patchMsg(sid, aid, (m) => ({ ...m, content: res.text, pending: false, truncated: res.truncated }));
      if (prefs.voiceReplies) voice.speak(res.text);
      if (autoCapture) capture(lu ? (lu.shown || lu.content) : '', res.text);
    } catch (e) {
      if (e && e.code === 'cancelled') {
        patch(sid, (s) => ({ ...s, messages: s.messages.flatMap((m) => (m.id !== aid ? [m] : (m.content ? [{ ...m, pending: false, stopped: true }] : []))) }));
      } else {
        patchMsg(sid, aid, (m) => ({ ...m, pending: false, content: (e && e.text) || m.content || '', error: errCopy(e) }));
      }
    } finally {
      if (ctl.current === c) ctl.current = null;
      setBusyId(null);
    }
  }, [patch, patchMsg, prefs, memory, useMemory, voice, autoCapture, capture]);

  const send = useCallback((sid, text, files = []) => {
    const s = sessionsRef.current.find((x) => x.id === sid);
    const t = (text || '').trim();
    if (!s || !t || busyId) return false;
    const imgs = files.filter((f) => f.kind === 'image');
    let content = t;
    files.filter((f) => f.kind === 'text').forEach((f) => { content += `\n\n[Attached file: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``; });
    const msg = { id: uid(), role: 'user', content, shown: t, attach: files.map((f) => ({ name: f.name, kind: f.kind })), ts: Date.now() };
    if (imgs.length) imgRef.current[msg.id] = imgs.map((f) => f.blob);
    const snap = { ...s, title: s.messages.length ? s.title : clip(t, 34), messages: [...s.messages, msg] };
    setSessions((ss) => ss.map((x) => (x.id === sid ? snap : x)));
    run(sid, snap);
    return true;
  }, [busyId, run, setSessions]);

  const retry = useCallback((sid) => {
    const s = sessionsRef.current.find((x) => x.id === sid);
    if (!s || busyId) return;
    const msgs = [...s.messages];
    while (msgs.length && msgs[msgs.length - 1].role !== 'user') msgs.pop();
    if (!msgs.length) return;
    run(sid, { ...s, messages: msgs });
  }, [busyId, run]);

  const stop = useCallback(() => { if (ctl.current) ctl.current.abort(); }, []);
  useEffect(() => () => { if (ctl.current) ctl.current.abort(); }, []);

  return { busyId, send, retry, stop };
}

function Message({ m, onRetry, canRetry }) {
  const { voice, addMemory, notify } = useNova();
  const isUser = m.role === 'user';
  const copy = async () => notify((await copyText(m.content)) ? 'Copied to clipboard' : 'Copy was blocked. Select the text and copy it manually.', 'info');
  const remember = () => { addMemory(clip(m.content.replace(/\s+/g, ' '), 240), 'user'); notify('Saved to session memory. Make it permanent in Memory.', 'ok'); };
  const speak = () => { if (!voice.ttsSupported) notify('Text-to-speech is not supported in this browser.', 'warn'); else if (!voice.speak(m.content)) notify('Nothing to read aloud.', 'warn'); };
  return html`<article class=${'msg ' + (isUser ? 'user' : 'nova')}>
    <header><span class="who">${isUser ? 'YOU' : 'NOVA'}</span><time>${fmtTime(m.ts)}</time>${!isUser && m.model && MODELS[m.model] ? html`<span class="mtag">${MODELS[m.model].label}</span>` : null}</header>
    ${isUser ? html`<div class="utext">${m.shown != null ? m.shown : m.content}${m.attach && m.attach.length ? html`<div class="atts">${m.attach.map((a, i) => html`<span key=${i} class="att">${a.kind === 'image' ? 'Image' : 'File'}: ${a.name}</span>`)}</div>` : null}</div>` : html`
      ${m.pending && !m.content ? html`<div class="typing" aria-label="NOVA is typing"><i></i><i></i><i></i><span>Thinking</span></div>` : html`<${Md} text=${m.content} />`}
      ${m.stopped ? html`<p class="note">Stopped. Partial answer shown.</p>` : null}
      ${m.truncated ? html`<p class="note">Answer was cut short. Ask for the rest or for less at a time.</p>` : null}
      ${m.error ? html`<${Banner} kind="bad">${m.error} ${canRetry ? html`<button class="mini" onClick=${onRetry}>Retry</button>` : null}<//>` : null}
      ${!m.pending && m.content ? html`<footer>
        <button class="mini" onClick=${copy}>Copy</button>
        <button class="mini" onClick=${voice.speaking ? voice.stopSpeaking : speak}>${voice.speaking ? 'Stop voice' : 'Read aloud'}</button>
        <button class="mini" onClick=${remember}>Remember</button>
      </footer>` : null}`}
  </article>`;
}

function Seg({ value, options, onChange, label }) {
  return html`<div class="seg" role="group" aria-label=${label}>${Object.entries(options).map(([k, v]) => html`<button key=${k} class=${value === k ? 'on' : ''} onClick=${() => onChange(k)}>${v}</button>`)}</div>`;
}

function ModelPicker({ id }) {
  const { prefs, setPrefs, plan, go } = useNova();
  const cur = modelFor(prefs.model, plan);
  const pick = (v) => {
    const m = MODELS[v];
    if (m.rank >= 2 && !plan.can('deepModel')) { go('plans'); return; }
    setPrefs((p) => ({ ...p, model: v }));
  };
  return html`<select id=${id || 'model-pick'} class="modelsel" value=${cur.id} aria-label="Model" onChange=${(e) => pick(e.target.value)}>
    ${Object.values(MODELS).map((m) => { const locked = m.rank >= 2 && !plan.can('deepModel'); return html`<option key=${m.id} value=${m.id}>${m.label} · ${m.blurb}${locked ? ' · NOVA Pro' : ''}</option>`; })}
  </select>`;
}

function ChatToolbar({ session, update }) {
  const o = session.opts || {};
  const set = (patch) => update(session.id, { opts: { ...o, ...patch } });
  if (session.mode === 'dev') return html`<div class="toolbar">
    <${Field} label="Language"><select id="dev-lang" value=${o.lang} onChange=${(e) => set({ lang: e.target.value })}>${DEV_LANGS.map((l) => html`<option key=${l}>${l}</option>`)}</select><//>
    <${Field} label="Task"><${Seg} label="Task" value=${o.task} options=${DEV_TASKS} onChange=${(v) => set({ task: v })} /><//>
  </div>`;
  if (session.mode === 'research') return html`<div class="toolbar">
    <${Field} label="Output"><${Seg} label="Output" value=${o.task} options=${RESEARCH_TASKS} onChange=${(v) => set({ task: v })} /><//>
    <p class="hint">NOVA cannot browse. Claims are labeled Established, Likely or Assumption and come from training knowledge.</p>
  </div>`;
  if (session.mode === 'gaming') return html`<div class="toolbar">
    <${Field} label="Platform"><${Seg} label="Platform" value=${o.platform} options=${GAME_PLATFORMS} onChange=${(v) => set({ platform: v })} /><//>
    <${Field} label="Focus"><${Seg} label="Focus" value=${o.focus} options=${GAME_FOCUS} onChange=${(v) => set({ focus: v })} /><//>
  </div>`;
  return null;
}

function ChatPanel({ mode }) {
  const nv = useNova();
  const { sessions, activeBy, setActive, newSession, deleteSession, updateSession, clearSession, chat, voice, aiReady, notify, plan, prefs, go } = nv;
  const list = sessions.filter((s) => s.mode === mode);
  const session = list.find((s) => s.id === activeBy[mode]) || list[0];
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const baseRef = useRef('');
  const scRef = useRef(null);
  const fileRef = useRef(null);
  const sendRef = useRef(null);
  const busy = !!session && chat.busyId === session.id;
  const anyBusy = !!chat.busyId;

  const last = session && session.messages[session.messages.length - 1];
  useEffect(() => {
    const el = scRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (near || (last && last.role === 'user')) el.scrollTop = el.scrollHeight;
  }, [session && session.messages.length, last && last.content]);

  sendRef.current = (full) => { if (session && chat.send(session.id, full, files)) { setDraft(''); setFiles([]); return true; } return false; };

  if (!session) return html`<div class="panel pad"><p class="dim">No session yet.</p><button class="btn" onClick=${() => newSession(mode)}>Start a session</button></div>`;

  const doSend = () => { if (voice.listening) voice.stopListening(); sendRef.current(draft); };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } };
  const onMic = () => {
    if (voice.listening) { voice.stopListening(); return; }
    baseRef.current = draft ? draft.trimEnd() + ' ' : '';
    voice.startListening((t, final) => {
      const full = baseRef.current + t;
      setDraft(full);
      if (final && nv.prefs.voiceAutoSend && full.trim()) sendRef.current(full);
    });
  };
  const onPick = (e) => {
    const picked = [...(e.target.files || [])]; e.target.value = '';
    picked.forEach((f) => {
      if (files.length >= 4) { notify('You can attach up to 4 files per message.', 'warn'); return; }
      if (f.type.startsWith('image/')) {
        if (!plan.can('imageAttach')) { notify('Image attachments are part of NOVA Pro. Open Plans to compare.', 'warn'); return; }
        if (!AI.provider.imagesOk()) { notify('Image input is not available in this view.', 'warn'); return; }
        const limit = AI.provider.limits.images;
        if (limit.mediaTypes && !limit.mediaTypes.includes(f.type)) { notify('That image type is not supported. Use PNG, JPEG, WebP or GIF.', 'warn'); return; }
        if (f.size > limit.maxInputBytes) { notify('That image is too large.', 'warn'); return; }
        setFiles((x) => [...x, { id: uid(), name: f.name, kind: 'image', blob: f }]);
      } else if (TEXT_EXT.test(f.name) || f.type.startsWith('text/')) {
        const r = new FileReader();
        r.onload = () => { let text = String(r.result || ''); if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT) + '\n[truncated]'; notify(f.name + ' was trimmed to fit.', 'info'); } setFiles((x) => [...x, { id: uid(), name: f.name, kind: 'text', text }]); };
        r.onerror = () => notify('Could not read ' + f.name + '.', 'warn');
        r.readAsText(f);
      } else notify('Unsupported file type. Attach text, code, CSV, JSON or an image.', 'warn');
    });
  };
  const lastErr = last && last.role === 'assistant' && last.error;

  return html`<div class="chat">
    <aside class="sessions" aria-label="Sessions">
      <div class="side-head"><h3>Sessions</h3><button class="mini" onClick=${() => newSession(mode)}>+ New</button></div>
      <ul>${list.map((s) => html`<li key=${s.id} class=${s.id === session.id ? 'on' : ''}>
        <button class="sess" onClick=${() => setActive(mode, s.id)}><b>${s.title}</b><small>${s.messages.length} messages</small></button>
        ${list.length > 1 ? html`<button class="x" aria-label=${'Delete session ' + s.title} onClick=${() => deleteSession(s.id)}>×</button>` : null}
      </li>`)}</ul>
    </aside>
    <section class="convo">
      <div class="convo-head">
        <div><h2>${MODES[mode].label}</h2><span class="dim">${session.title}</span></div>
        <div class="row tight"><${ModelPicker} id=${'model-' + mode} /><${Confirm} label="Clear chat" confirmLabel="Clear it" onConfirm=${() => clearSession(session.id)} /></div>
      </div>
      <${ChatToolbar} session=${session} update=${updateSession} />
      ${!aiReady ? html`<${Banner} kind="warn">The AI service is not reachable right now. The planner, notes and memory still work.<//>` : null}
      ${aiReady && plan.quota.max !== Infinity && plan.quota.used >= plan.quota.max * 0.8 ? html`<${Banner} kind=${plan.quota.used >= plan.quota.max ? 'bad' : 'warn'}>${plan.quota.used >= plan.quota.max ? "You have used today's messages." : (plan.quota.max - plan.quota.used) + ' messages left today.'} <button class="mini" onClick=${() => go('plans')}>See plans</button><//>` : null}
      <div class="scroll" ref=${scRef}>
        ${session.messages.length === 0 ? html`<div class="empty">
          <${StatusOrb} state="idle" size="lg" />
          <h3>${mode === 'chat' ? 'How can I help?' : MODES[mode].label + ' mode is ready'}</h3>
          <p class="dim">Pick a starter or type your own request. Attach a file with the paperclip.</p>
          <div class="chips">${QUICK[mode].map((q) => html`<button key=${q} class="chip" onClick=${() => setDraft(q)}>${q}</button>`)}</div>
        </div>` : session.messages.map((m, i) => html`<${Message} key=${m.id} m=${m} canRetry=${i === session.messages.length - 1 && !anyBusy} onRetry=${() => chat.retry(session.id)} />`)}
      </div>
      <div class="composer">
        ${voice.micMsg ? html`<p class="hint warnc">${voice.micMsg}</p>` : null}
        ${files.length ? html`<div class="atts">${files.map((f) => html`<span key=${f.id} class="att">${f.kind === 'image' ? 'Image' : 'File'}: ${f.name} <button class="x" aria-label=${'Remove ' + f.name} onClick=${() => setFiles((x) => x.filter((y) => y.id !== f.id))}>×</button></span>`)}</div>` : null}
        <div class="row">
          <textarea id=${'composer-' + mode} rows="2" value=${draft} placeholder=${voice.listening ? 'Listening…' : 'Message NOVA. Enter to send, Shift+Enter for a new line.'} onInput=${(e) => setDraft(e.target.value)} onKeyDown=${onKey} disabled=${anyBusy && !busy}></textarea>
          <div class="col">
            <button class=${'mic' + (voice.listening ? ' live' : '')} onClick=${onMic} aria-pressed=${voice.listening} title="Speech input" aria-label="Speech input">${voice.listening ? html`<${StopIcon} />` : html`<${MicIcon} />`}</button>
            <button class="mic" onClick=${() => fileRef.current && fileRef.current.click()} title="Attach a file" aria-label="Attach a file"><${ClipIcon} /></button>
            <input ref=${fileRef} id=${'attach-' + mode} type="file" multiple hidden accept="image/*,.txt,.md,.csv,.json,.js,.ts,.py,.lua,.luau,.html,.css,.xml,.yml,.yaml,.log,.sql,.sh,.java,.c,.cpp,.cs,.go,.rs" onChange=${onPick} />
          </div>
          <div class="col">
            ${busy
              ? html`<button class="btn danger" onClick=${chat.stop}>Stop</button>`
              : html`<button class="btn primary" onClick=${doSend} disabled=${!draft.trim() || anyBusy || !aiReady}>Send</button>`}
          </div>
        </div>
      </div>
    </section>
  </div>`;
}
