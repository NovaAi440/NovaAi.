/* ===== NOVA 2.0 :: memory viewer, settings, overview ===== */

function StorageNote() {
  const { persistMode, hydrated } = useNova();
  if (!hydrated) return html`<p class="hint">Checking where your data can be saved…</p>`;
  return persistMode === 'account'
    ? html`<${Banner} kind="ok">Permanent items are saved to your private area of this page's database. Only you can read them, and they follow you across devices.<//>`
    : html`<${Banner} kind="warn">The database is not available in this view, so permanent items are saved in this browser only. They will not follow you to other devices.<//>`;
}

function MemoryPanel() {
  const { memory, setMemory, addMemory, useMemory, setUseMemory, autoCapture, setAutoCapture, notify, plan, go } = useNova();
  const [text, setText] = useState('');
  const [scope, setScope] = useState('perm');
  const [editing, setEditing] = useState(null);
  const perm = memory.filter((m) => m.scope === 'perm');
  const sess = memory.filter((m) => m.scope !== 'perm');
  const canPerm = plan.can('longMemory');
  const needPro = () => { notify('Permanent memory is part of NOVA Pro.', 'warn'); go('plans'); };
  const add = (e) => { e.preventDefault(); if (!text.trim()) return; if (scope === 'perm' && !canPerm) { needPro(); return; } addMemory(clip(text.trim(), 240), 'user', scope); setText(''); };
  const toggleScope = (id) => {
    const cur = memory.find((x) => x.id === id);
    if (cur && cur.scope !== 'perm' && !canPerm) { needPro(); return; }
    setMemory((ms) => ms.map((x) => (x.id === id ? { ...x, scope: x.scope === 'perm' ? 'session' : 'perm' } : x)));
  };
  const preview = memory.length ? memory.map((m) => '- ' + m.text).join('\n') : '(nothing is sent)';
  const exportMem = async () => {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), permanent: perm.map((m) => m.text), session: sess.map((m) => m.text) }, null, 2);
    try { await Files.save('nova-memory.json', data); notify('Memory exported', 'ok'); } catch (e) { if (e && e.code !== 'declined') notify(dlCopy(e), 'warn'); }
  };
  const row = (m) => html`<li key=${m.id} class="mem">
    ${editing === m.id
      ? html`<input class="grow" id=${'mem-edit-' + m.id} value=${m.text} onInput=${(e) => setMemory((ms) => ms.map((x) => (x.id === m.id ? { ...x, text: e.target.value } : x)))} onKeyDown=${(e) => e.key === 'Enter' && setEditing(null)} />
         <button class="mini" onClick=${() => setEditing(null)}>Done</button>`
      : html`<span class="ttl">${m.text}<small> ${m.source === 'auto' ? 'suggested by NOVA' : 'added by you'} at ${fmtTime(m.ts)}</small></span>
         <button class="mini" onClick=${() => toggleScope(m.id)}>${m.scope === 'perm' ? 'Make session-only' : 'Make permanent'}</button>
         <button class="mini" onClick=${() => setEditing(m.id)}>Edit</button>`}
    <button class="x" aria-label="Forget this item" onClick=${() => setMemory((ms) => ms.filter((x) => x.id !== m.id))}>×</button></li>`;
  return html`<div class="memory">
    <div class="pagehead"><h2>Memory</h2>
      <p class="dim">Two kinds. Session items last until you close or reload this tab. Permanent items are saved to your account and survive reloads. Nothing is permanent unless you choose it.</p></div>
    <${StorageNote} />
    <div class="grid2">
      <section class="panel pad">
        <div class="card-head"><h3>Remembered items</h3><span class="dim">${perm.length} permanent · ${sess.length} session</span></div>
        <form class="add" onSubmit=${add}>
          <input id="mem-add" placeholder="Add something for NOVA to keep in mind" value=${text} onInput=${(e) => setText(e.target.value)} />
          <select id="mem-scope" value=${scope} onChange=${(e) => setScope(e.target.value)} aria-label="Memory type"><option value="perm">${canPerm ? 'Permanent' : 'Permanent · NOVA Pro'}</option><option value="session">Session only</option></select>
          <button class="btn primary" type="submit">Remember</button>
        </form>
        ${memory.length === 0 ? html`<p class="dim empty-line">Nothing remembered yet. Use Remember under any message, or add an item above.</p>` : html`
          ${perm.length ? html`<h3 class="sub">Permanent</h3><ul class="list">${perm.map(row)}</ul>` : null}
          ${sess.length ? html`<h3 class="sub">This session</h3><ul class="list">${sess.map(row)}</ul>` : null}`}
        <div class="row">
          <button class="btn" onClick=${exportMem} disabled=${memory.length === 0}>Export .json</button>
          <${Confirm} label="Forget session items" confirmLabel="Forget them" onConfirm=${() => { setMemory((ms) => ms.filter((m) => m.scope === 'perm')); notify('Session items cleared', 'ok'); }} />
          <${Confirm} label="Forget everything" confirmLabel="Forget all" onConfirm=${() => { setMemory([]); notify('All memory cleared', 'ok'); }} />
        </div>
      </section>
      <section class="panel pad">
        <div class="card-head"><h3>Controls</h3></div>
        <label class="switch"><input type="checkbox" id="mem-use" checked=${useMemory} onChange=${(e) => setUseMemory(e.target.checked)} /><span>Include memory in prompts</span></label>
        <p class="hint">${useMemory ? 'Remembered items, both kinds, are sent to Claude with every message in every mode.' : 'Off. Remembered items are kept here but not sent to Claude.'}</p>
        <label class="switch"><input type="checkbox" id="mem-auto" checked=${autoCapture} onChange=${(e) => setAutoCapture(e.target.checked)} /><span>Let NOVA suggest memories automatically</span></label>
        <p class="hint">Off by default. When on, each reply triggers one extra quick Claude call that may add up to two session items. Review them here, then make the good ones permanent.</p>
        <h3 class="sub">Exactly what is sent</h3>
        <pre class="preview">${useMemory ? preview : '(memory is switched off, nothing is sent)'}</pre>
        <p class="hint">Chat history within a session is also sent as context. Clearing a chat removes it from that context.</p>
      </section>
    </div>
  </div>`;
}

function SettingsPanel() {
  const { prefs, setPrefs, voice, resetAll, storageOk, persistMode, plan } = useNova();
  const set = (p) => setPrefs((x) => ({ ...x, ...p }));
  return html`<div class="settings">
    <div class="pagehead"><h2>Assistant preferences</h2><p class="dim">${storageOk ? 'Saved in this browser.' : 'Browser storage is unavailable here, so these reset when you close the tab.'}</p></div>
    <div class="grid2">
      <section class="panel pad">
        <h3>Behavior</h3>
        <${Field} label="Your name"><input id="pref-name" value=${prefs.userName} placeholder="Optional" onInput=${(e) => set({ userName: e.target.value })} /><//>
        <${Field} label="Answer length"><${Seg} label="Answer length" value=${prefs.length} options=${{ concise: 'Concise', balanced: 'Balanced', detailed: 'Detailed' }} onChange=${(v) => set({ length: v })} /><//>
        <${Field} label="Default model"><${ModelPicker} id="pref-model" /><//>
        <p class="hint">Spark is fastest. Core balances quality and speed. Prime thinks longest and is part of NOVA Pro. See Plans for details.</p>
      </section>
      <section class="panel pad">
        <h3>Voice</h3>
        <p class="hint">Speech input: ${voice.micSupported ? 'supported by this browser (may still need microphone permission).' : 'not supported by this browser.'}<br/>Spoken replies: ${voice.ttsSupported ? 'supported.' : 'not supported by this browser.'}</p>
        <label class="switch"><input type="checkbox" id="pref-voice" checked=${prefs.voiceReplies} onChange=${(e) => set({ voiceReplies: e.target.checked })} disabled=${!voice.ttsSupported} /><span>Read replies aloud automatically</span></label>
        <label class="switch"><input type="checkbox" id="pref-autosend" checked=${prefs.voiceAutoSend} onChange=${(e) => set({ voiceAutoSend: e.target.checked })} disabled=${!voice.micSupported || !plan.can('handsFree')} /><span>Send automatically when I stop speaking</span></label>
        <p class="hint">${plan.can('handsFree') ? 'Sends your message once you pause speaking.' : 'Hands-free sending is part of NOVA Pro.'}</p>
        <${Field} label="Voice"><select id="pref-voicename" value=${prefs.voiceName} onChange=${(e) => set({ voiceName: e.target.value })} disabled=${!voice.ttsSupported}><option value="">System default</option>${voice.voices.map((v) => html`<option key=${v.name} value=${v.name}>${v.name}</option>`)}</select><//>
        <${Field} label=${'Speech rate ' + (prefs.voiceRate || 1).toFixed(1) + 'x'}><input id="pref-rate" type="range" min="0.7" max="1.5" step="0.1" value=${prefs.voiceRate} onInput=${(e) => set({ voiceRate: Number(e.target.value) })} /><//>
        <${VoiceProfileField} />
        <button class="btn" disabled=${!voice.ttsSupported} onClick=${() => voice.speak('NOVA voice check. This is how replies will sound.')}>Test voice</button>
      </section>
    </div>
    <${PersonaSection} />
    <section class="panel pad"><h3>Data</h3>
      <p class="hint">Sessions, tasks, schedule, notes, plans and preferences are stored in this browser only. Permanent memory, templates, your gallery and your usage are stored ${persistMode === 'account' ? 'in your private account area for this page' : 'in this browser (the database is not available here)'}. Session memory is never stored.</p>
      <p class="hint">Erasing removes your content. It does not change your plan or today's message count.</p>
      <${Confirm} label="Erase all NOVA content" confirmLabel="Erase everything" onConfirm=${resetAll} />
    </section>
  </div>`;
}

function HomePanel() {
  const { go, tasks, events, plans, memory, sessions, aiReady, setActive, voice, plan: tierPlan } = useNova();
  const open = tasks.filter((t) => t.status !== 'done');
  const today = events.filter((e) => e.date === todayISO()).sort((a, b) => a.start.localeCompare(b.start));
  const plan = plans[0];
  const recent = [...sessions].filter((s) => s.messages.length).sort((a, b) => b.messages[b.messages.length - 1].ts - a.messages[a.messages.length - 1].ts).slice(0, 4);
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const stat = (label, value, sub, onClick) => html`<button class="stat" onClick=${onClick}><small>${label}</small><b>${value}</b><span>${sub}</span></button>`;
  return html`<div class="home">
    <section class="hero panel">
      <div><p class="eyebrow">NOVA 2.0 · ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h2>${greet}.</h2><p class="dim">${aiReady ? 'Claude link is active. Choose a mode or start talking.' : 'The AI service is not reachable right now. Planner, notes and memory still work.'}</p>
        <div class="row"><button class="btn primary" onClick=${() => go('chat')}>Open assistant</button><button class="btn" onClick=${() => go('agent')}>Plan a task</button><button class="btn" onClick=${() => go('studio')}>Create an image</button></div></div>
      <${StatusOrb} state=${aiReady ? 'idle' : 'offline'} size="lg" />
    </section>
    <div class="stats">
      ${stat('Open tasks', open.length, open.length ? 'Next: ' + clip(open[0].title, 28) : 'All clear', () => go('planner'))}
      ${stat('Today', today.length, today.length ? 'First: ' + today[0].start + ' ' + clip(today[0].title, 22) : 'Nothing scheduled', () => go('planner'))}
      ${stat('Agent plan', plan ? plan.steps.filter((s) => s.status === 'done').length + '/' + plan.steps.length : '0', plan ? clip(plan.title, 30) : 'No plans yet', () => go('agent'))}
      ${stat("Today's messages", tierPlan.quota.max === Infinity ? tierPlan.quota.used : Math.max(0, tierPlan.quota.max - tierPlan.quota.used) + ' left', tierPlan.label + ' plan', () => go('plans'))}
    </div>
    <div class="grid2">
      <section class="panel pad"><h3>Modes</h3><div class="launch">${['chat', 'dev', 'research', 'gaming', 'studio', 'agent'].map((m) => html`<button key=${m} class="tile" onClick=${() => go(m)}><span class="glyph">${MODES[m].glyph}</span><b>${MODES[m].label}</b><small>${MODES[m].blurb}</small></button>`)}</div></section>
      <section class="panel pad"><h3>Recent conversations</h3>
        ${recent.length === 0 ? html`<p class="dim empty-line">No conversations yet.</p>` : html`<ul class="list">${recent.map((s) => html`<li key=${s.id}><button class="sess" onClick=${() => { setActive(s.mode, s.id); go(s.mode); }}><b>${s.title}</b><small>${MODES[s.mode].label} · ${s.messages.length} messages</small></button></li>`)}</ul>`}
        <p class="hint">${memory.filter((m) => m.scope === 'perm').length} permanent and ${memory.filter((m) => m.scope !== 'perm').length} session memories. Voice: input ${voice.micSupported ? 'available' : 'unavailable'}, output ${voice.ttsSupported ? 'available' : 'unavailable'}.</p>
      </section>
    </div>
  </div>`;
}
