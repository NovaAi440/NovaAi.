/* ===== NOVA 2.1 :: Plans page, personality and voice settings ===== */

const COMPARE = [
  ['Daily messages', '40', '300', '1,000', 'Unlimited'],
  ['Chat, Developer, Research, Gaming, Studio, Agent, Planner', 'Included', 'Included', 'Included', 'Included'],
  ['Model depth', 'Spark, Core', 'Spark, Core, Prime', 'Spark, Core, Prime', 'Spark, Core, Prime'],
  ['Personalities', '3 built in', '7 built in, 5 custom', '7 built in, 10 custom', '7 built in, 15 custom'],
  ['Memory', 'This session', 'Plus long-term, 200 items', 'Plus long-term, 500 items', 'Plus long-term, 1000 items'],
  ['Voice', 'Read aloud', 'Voice profiles, long read-aloud, hands-free', 'Voice profiles, long read-aloud, hands-free', 'Voice profiles, long read-aloud, hands-free'],
  ['Code Agent', 'Not included', 'Up to 5 files, review pass', 'Up to 8 files, review pass', 'Up to 12 files, automatic 2-pass review'],
  ['Council', 'Not included', 'Not included', 'Not included', '3 viewpoints and a synthesis'],
];

function PlansPanel() {
  const { plan, isOwner, notify } = useNova();
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState(null);
  const [genTier, setGenTier] = useState('pro');
  const [gen, setGen] = useState('');
  const activate = (e) => {
    e.preventDefault();
    const r = plan.activate(key);
    if (r.ok) { setMsg({ kind: 'ok', text: TIERS[r.tier].label + ' is active on this device.' }); setKey(''); }
    else setMsg({ kind: 'bad', text: 'That key is not valid. Check it for typos and try again.' });
  };
  const used = plan.quota.used; const max = plan.quota.max;
  return html`<div class="plans">
    <div class="pagehead"><h2>Plans</h2><p class="dim">The free plan keeps every feature from version 1.0. Each paid plan adds to the one below it.</p></div>
    <section class="panel pad"><div class="card-head"><h3>Your plan: ${plan.label}</h3><span class="dim">${max === Infinity ? used + ' messages today, no cap' : used + ' of ' + max + ' messages used today'}</span></div>
      <div class="bar"><i style=${{ width: max === Infinity ? '8%' : Math.min(100, used / max * 100) + '%' }}></i></div>
      ${plan.previewTier ? html`<${Banner} kind="warn">Owner preview is on: you are seeing ${TIERS[plan.previewTier].label} without a license. Visitors do not get this.<//>` : null}
    </section>
    <div class="tiers">${['free', 'pro', 'max', 'ultra'].map((t) => {
      const T = TIERS[t]; const cur = plan.tier === t; const url = CHECKOUT[t];
      return html`<div key=${t} class=${'tier' + (cur ? ' cur' : '') + (t === 'ultra' ? ' top' : '')}>
        <h3>${T.label}</h3><p class="price">${T.price}</p><p class="dim">${T.pitch}</p>
        ${cur ? html`<span class="pill p-now">Current plan</span>`
          : t === 'free' ? html`<span class="dim">Always included</span>`
          : url ? html`<a class="btn primary" href=${url} target="_blank" rel="noopener noreferrer">Get ${T.label}</a>`
          : html`<button class="btn" disabled>Checkout not open yet</button>`}
      </div>`;
    })}</div>
    <section class="panel pad"><h3>What each plan includes</h3>
      <div class="tbl"><table><thead><tr><th>Feature</th><th>NOVA</th><th>Pro</th><th>Max</th><th>Ultra</th></tr></thead>
      <tbody>${COMPARE.map((r) => html`<tr key=${r[0]}>${r.map((c, i) => html`<${i === 0 ? 'th' : 'td'} key=${i}>${c}<//>`)}</tr>`)}</tbody></table></div>
    </section>
    <div class="grid2">
      <section class="panel pad"><h3>Have a license key?</h3>
        <form class="add" onSubmit=${activate}><input id="license-key" placeholder="NOVA-P-XXXXXXXX-XXXX" value=${key} onInput=${(e) => setKey(e.target.value)} autocomplete="off" /><button class="btn primary" type="submit" disabled=${!key.trim()}>Activate</button></form>
        ${msg ? html`<${Banner} kind=${msg.kind}>${msg.text}<//>` : null}
        ${plan.hasKey ? html`<div class="row"><span class="dim">A ${TIERS[plan.keyTier].label} key is stored on this device.</span><${Confirm} label="Remove key" confirmLabel="Remove it" onConfirm=${() => { plan.deactivate(); setMsg(null); notify('License key removed', 'ok'); }} /></div>` : null}
        <p class="hint">Keys unlock features on this browser only. Your data stays on this device.</p>
      </section>
      ${isOwner ? html`<section class="panel pad"><h3>Owner tools</h3>
        <p class="hint">Only you see this card. Use preview to test each plan, and generate keys to hand out for testing.</p>
        <${Field} label="Preview a plan on this device"><${Seg} label="Preview plan" value=${plan.previewTier || 'off'} options=${{ off: 'Off', free: 'Free', pro: 'Pro', max: 'Max', ultra: 'Ultra' }} onChange=${(v) => plan.setPreview(v === 'off' ? '' : v)} /><//>
        <${Field} label="Generate a test key"><${Seg} label="Key tier" value=${genTier} options=${{ pro: 'Pro', max: 'Max', ultra: 'Ultra' }} onChange=${setGenTier} /><//>
        <div class="row"><button class="btn" onClick=${() => setGen(makeKey(genTier))}>Generate</button>${gen ? html`<code class="keybox">${gen}</code><button class="mini" onClick=${async () => notify((await copyText(gen)) ? 'Key copied' : 'Copy was blocked. Select the key and copy it.', 'info')}>Copy</button>` : null}</div>
        <p class="hint warnc">To earn money: add your payment links to CHECKOUT in the source, and replace readKey with a server check that your payment webhook feeds. A page alone cannot take payments or enforce licenses safely.</p>
      </section>` : html`<section class="panel pad"><h3>Questions</h3><p class="dim">Plans renew monthly through the checkout provider. Free features never expire.</p></section>`}
    </div>
  </div>`;
}

function PersonaSection() {
  const { plan, prefs, setPrefs, customPersonas, setCustomPersonas, go, notify } = useNova();
  const [name, setName] = useState(''); const [desc, setDesc] = useState('');
  const cur = resolvePersona(prefs.personaId, customPersonas, plan).id;
  const pick = (id, locked) => { if (locked) { notify('That personality needs NOVA Pro.', 'warn'); go('plans'); return; } setPrefs((x) => ({ ...x, personaId: id })); };
  const limit = plan.limit('customPersonas');
  const add = (e) => {
    e.preventDefault();
    if (!name.trim() || !desc.trim()) return;
    if (customPersonas.length >= limit) { notify('Custom personality limit reached on your plan.', 'warn'); return; }
    const p = { id: 'c-' + uid(), label: clip(name.trim(), 30), text: clip(desc.trim(), 400) };
    setCustomPersonas((l) => [...l, p]); setPrefs((x) => ({ ...x, personaId: p.id })); setName(''); setDesc('');
  };
  return html`<section class="panel pad"><h3>Personality</h3>
    <p class="hint">Changes tone only. NOVA's honesty rules always apply.</p>
    <div class="chips left">${Object.entries(PERSONAS).map(([id, p]) => { const locked = p.tier === 'pro' && !plan.can('personasAll'); return html`<button key=${id} class=${'chip' + (cur === id ? ' sel' : '')} onClick=${() => pick(id, locked)} aria-pressed=${cur === id}>${p.label}${locked ? html` <span class="tag">Pro</span>` : null}</button>`; })}
      ${customPersonas.map((p) => { const locked = !plan.can('personasCustom'); return html`<button key=${p.id} class=${'chip' + (cur === p.id ? ' sel' : '')} onClick=${() => pick(p.id, locked)} aria-pressed=${cur === p.id}>${p.label}${locked ? html` <span class="tag">Pro</span>` : null}</button>`; })}</div>
    ${plan.can('personasCustom') ? html`<h3 class="sub">Create your own (${customPersonas.length} of ${limit})</h3>
      <form onSubmit=${add}><${Field} label="Name"><input id="persona-name" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Study buddy" /><//>
        <${Field} label="How should it sound and behave?"><textarea id="persona-desc" rows="3" value=${desc} onInput=${(e) => setDesc(e.target.value)} placeholder="Upbeat, uses short sentences, quizzes me at the end of each answer."></textarea><//>
        <button class="btn primary" type="submit" disabled=${!name.trim() || !desc.trim()}>Save personality</button></form>
      ${customPersonas.length ? html`<ul class="list">${customPersonas.map((p) => html`<li key=${p.id}><span class="ttl"><b>${p.label}</b><small> ${p.text}</small></span><button class="x" aria-label=${'Delete ' + p.label} onClick=${() => setCustomPersonas((l) => l.filter((x) => x.id !== p.id))}>×</button></li>`)}</ul>` : null}`
      : html`<p class="hint">Custom personalities, and four more built-in ones, come with NOVA Pro. <button class="mini" onClick=${() => go('plans')}>See plans</button></p>`}
  </section>`;
}

function VoiceProfileField() {
  const { plan, prefs, setPrefs, go, notify } = useNova();
  const cur = plan.can('voicePro') ? prefs.voiceProfile || 'standard' : 'standard';
  const opts = Object.fromEntries(Object.entries(VOICE_PROFILES).map(([k, v]) => [k, v.label + (k !== 'standard' && !plan.can('voicePro') ? ' (Pro)' : '')]));
  return html`<${Field} label="Voice profile"><${Seg} label="Voice profile" value=${cur} options=${opts} onChange=${(v) => { if (v !== 'standard' && !plan.can('voicePro')) { notify('Voice profiles need NOVA Pro.', 'warn'); go('plans'); return; } setPrefs((x) => ({ ...x, voiceProfile: v })); }} /><//>`;
}
