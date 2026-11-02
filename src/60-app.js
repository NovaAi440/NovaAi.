/* ===== NOVA 2.1 :: app shell ===== */
/* Raw preferences are what the user chose. P is what the current plan allows, and every component reads P. */
const DEFAULT_PREFS = { userName: '', length: 'balanced', model: 'spark', voiceReplies: false, voiceAutoSend: false, voiceName: '', voiceRate: 1, personaId: 'nova', voiceProfile: 'standard' };

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 15000); return () => clearInterval(i); }, []);
  return html`<span class="clock">${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
}

function Toasts({ items }) {
  return html`<div class="toasts" aria-live="polite">${items.map((t) => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.msg}</div>`)}</div>`;
}

function App() {
  const [storageOk] = useState(() => store.set('probe', 1) && store.get('probe', 0) === 1);
  const [sessions, setSessions] = useState(() => store.get('sessions', []).map((s) => ({ ...s, messages: (s.messages || []).filter((m) => !m.pending) })));
  const [activeBy, setActiveBy] = useState(() => store.get('activeBy', {}));
  const [tasks, setTasks] = useStored('tasks', []);
  const [events, setEvents] = useStored('events', []);
  const [notes, setNotes] = useStored('notes', []);
  const [plans, setPlans] = useState(() => store.get('plans', []).map((p) => ({ ...p, steps: p.steps.map((s) => (s.status === 'running' ? { ...s, status: 'pending' } : s)) })));
  const [prefsRaw, setPrefs] = useStored('prefs', DEFAULT_PREFS);
  const [customPersonas, setCustomPersonas] = useStored('personas', []);
  const [memory, setMemory] = useState([]);           // items carry scope: 'perm' (saved to account when available) or 'session'
  const [templates, setTemplates] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [persistMode, setPersistMode] = useState('browser');
  const [isOwner, setIsOwner] = useState(false);
  const [useMemory, setUseMemory] = useState(true);
  const [autoCapture, setAutoCapture] = useState(false);
  const [view, setView] = useState('home');
  const [aiReady, setAiReady] = useState(false);
  const [busyExt, setBusyExt] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => { store.set('sessions', sessions); }, [sessions]);
  useEffect(() => { store.set('activeBy', activeBy); }, [activeBy]);
  useEffect(() => { store.set('plans', plans); }, [plans]);
  useEffect(() => { let on = true; AI.init().then((ok) => on && setAiReady(ok)); return () => { on = false; }; }, []);

  const notify = useCallback((msg, kind) => {
    const id = uid();
    setToasts((t) => [...t.slice(-3), { id, msg, kind: kind || 'info' }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const notifyRef = useRef(notify); notifyRef.current = notify;

  /* ---- load account data (permanent memory, templates, gallery) ---- */
  const lastSaved = useRef({});
  const persistIf = (name, value) => { const s = JSON.stringify(value); if (lastSaved.current[name] === s) return; lastSaved.current[name] = s; Persist.save(name, value); };
  useEffect(() => {
    let on = true;
    (async () => {
      let lastWarn = 0;
      Persist.onError = () => { if (Date.now() - lastWarn > 15000) { lastWarn = Date.now(); notifyRef.current('Could not save to your account just now. Your changes stay in this visit.', 'warn'); } };
      await Files.init();
      const mode = await Persist.init();
      const [mem, tpl, gal] = await Promise.all(['memory', 'templates', 'gallery'].map((n) => Persist.load(n)));
      if (!on) return;
      setPersistMode(mode);
      setIsOwner(!!Persist.owner);
      if (mem && Array.isArray(mem.items)) setMemory((ms) => { const have = new Set(ms.map((m) => m.id)); return [...mem.items.filter((i) => i && i.id && i.text && !have.has(i.id)).map((i) => ({ ...i, scope: 'perm' })), ...ms]; });
      if (tpl && Array.isArray(tpl.items)) setTemplates(tpl.items);
      if (gal && Array.isArray(gal.items)) setGallery(gal.items);
      setHydrated(true);
    })();
    return () => { on = false; };
  }, []);
  useEffect(() => { if (hydrated) persistIf('memory', { items: memory.filter((m) => m.scope === 'perm') }); }, [memory, hydrated]);
  useEffect(() => { if (hydrated) persistIf('templates', { items: templates }); }, [templates, hydrated]);
  useEffect(() => { if (hydrated) persistIf('gallery', { items: gallery }); }, [gallery, hydrated]);

  /* ---- plan: entitlements, daily allowance, and the preferences the plan allows ---- */
  const plan = usePlan(isOwner);
  useEffect(() => { AI.gate = () => plan.quota.take(1); });

  const modelId = modelFor(prefsRaw.model || 'spark', plan).id;
  const voiceProf = resolveVoice(prefsRaw.voiceProfile || 'standard', plan);
  const persona = resolvePersona(prefsRaw.personaId || 'nova', customPersonas, plan);
  const P = {
    ...DEFAULT_PREFS, ...prefsRaw,
    model: modelId,
    voiceAutoSend: !!prefsRaw.voiceAutoSend && plan.can('handsFree'),
    voicePref: voiceProf.voicePref, voiceRateMul: voiceProf.voiceRateMul, voicePitch: voiceProf.voicePitch, longRead: voiceProf.longRead,
    personaText: persona.text, personaLabel: persona.label,
  };
  const voice = useVoice(P);

  const addMemory = useCallback((text, source, scope) => {
    setMemory((ms) => (ms.some((m) => m.text.toLowerCase() === text.toLowerCase()) ? ms : [...ms, { id: uid(), text, source, scope: scope || 'session', ts: Date.now() }].slice(-60)));
  }, []);

  const newSession = useCallback((mode) => {
    const s = { id: uid(), mode, title: 'New session', opts: { ...DEFAULT_OPTS[mode] }, messages: [], createdAt: Date.now() };
    setSessions((ss) => [...ss, s]);
    setActiveBy((a) => ({ ...a, [mode]: s.id }));
    return s;
  }, []);
  const setActive = useCallback((mode, id) => setActiveBy((a) => ({ ...a, [mode]: id })), []);
  const updateSession = useCallback((id, patch) => setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s))), []);
  const clearSession = useCallback((id) => { voice.stopSpeaking(); setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, messages: [], title: 'New session' } : s))); }, [voice.stopSpeaking]);
  const deleteSession = useCallback((id) => {
    const gone = sessions.find((s) => s.id === id);
    if (!gone) return;
    const rest = sessions.filter((s) => s.id !== id);
    const n = rest.find((s) => s.mode === gone.mode);
    setSessions(rest);
    setActiveBy((a) => (a[gone.mode] === id ? { ...a, [gone.mode]: n ? n.id : null } : a));
  }, [sessions]);

  const chat = useChatEngine({ sessions, setSessions, prefs: P, memory, useMemory, voice, autoCapture, addMemory });

  const go = useCallback((v) => { setView(v); setNavOpen(false); }, []);
  useEffect(() => { if (CHAT_MODES.includes(view) && !sessions.some((s) => s.mode === view)) newSession(view); }, [view, sessions, newSession]);

  const resetAll = () => {
    store.wipe(); voice.stopSpeaking();
    setSessions([]); setActiveBy({}); setTasks([]); setEvents([]); setNotes([]); setPlans([]); setPrefs(DEFAULT_PREFS); setCustomPersonas([]);
    setMemory((ms) => ms.filter((m) => m.scope === 'perm')); setTemplates([]); setGallery([]);
    setView('home'); notify('Your content was erased. Your plan and license were kept.', 'ok');
  };

  const state = chat.busyId || busyExt ? 'thinking' : voice.listening ? 'listening' : voice.speaking ? 'speaking' : aiReady ? 'idle' : 'offline';
  const q = plan.quota;
  const quotaText = q.max === Infinity ? 'no daily cap' : Math.max(0, q.max - q.used) + ' of ' + q.max + ' left today';

  const ctx = { sessions, activeBy, setActive, newSession, deleteSession, updateSession, clearSession, chat, voice, aiReady, notify, prefs: P, setPrefs,
    tasks, setTasks, events, setEvents, notes, setNotes, plans, setPlans, memory, setMemory, addMemory, useMemory, setUseMemory, autoCapture, setAutoCapture,
    templates, setTemplates, gallery, setGallery, persistMode, hydrated, plan, isOwner, customPersonas, setCustomPersonas,
    go, resetAll, storageOk, setBusyExt };

  const panels = { planner: PlannerPanel, agent: AgentPanel, memory: MemoryPanel, settings: SettingsPanel, studio: StudioPanel, plans: PlansPanel, council: CouncilPanel };
  let panel;
  if (CHAT_MODES.includes(view)) panel = html`<${ChatPanel} mode=${view} />`;
  else if (panels[view]) { const C = panels[view]; panel = html`<${C} />`; }
  else panel = html`<${HomePanel} />`;

  const speechChip = voice.ttsSupported
    ? html`<button class=${'vchip' + (P.voiceReplies ? ' on' : '')} onClick=${() => { if (voice.speaking) voice.stopSpeaking(); else setPrefs((x) => ({ ...x, voiceReplies: !P.voiceReplies })); }} title="Toggle spoken replies">${voice.speaking ? 'Voice: speaking · tap to stop' : P.voiceReplies ? 'Voice out: auto' : 'Voice out: off'}</button>`
    : html`<span class="vchip off">Voice out: unavailable</span>`;

  return html`<${Nova.Provider} value=${ctx}>
    <div class="shell">
      <header class="top">
        <button class="burger" onClick=${() => setNavOpen((o) => !o)} aria-label="Toggle navigation" aria-expanded=${navOpen}><i></i><i></i><i></i></button>
        <div class="brand"><${StatusOrb} state=${state} /><div><b>NOVA</b><small>v2.1 · personal AI</small></div></div>
        <div class="status"><span class=${'st st-' + state}>${STATUS_LABEL[state]}</span></div>
        <button class=${'credit' + (q.max !== Infinity && q.used >= q.max * 0.8 ? ' low' : '')} onClick=${() => go('plans')} title="Plans and today's allowance"><b>${plan.label}</b> <small>${quotaText}</small></button>
        <div class="vstat">
          <span class=${'vchip' + (voice.listening ? ' live' : voice.micSupported ? '' : ' off')}>${voice.listening ? 'Mic: listening' : voice.micSupported ? 'Mic: ready' : 'Mic: unavailable'}</span>
          ${speechChip}
        </div>
        <${Clock} />
      </header>
      <nav class=${'rail' + (navOpen ? ' open' : '')} aria-label="Modes">
        ${Object.entries(MODES).map(([k, m]) => html`<button key=${k} class=${view === k ? 'on' : ''} onClick=${() => go(k)}><span class="glyph">${m.glyph}</span><span><b>${m.label}</b><small>${m.blurb}</small></span></button>`)}
      </nav>
      <main class="main"><${ErrorBoundary} key=${view}>${panel}<//></main>
      <${Toasts} items=${toasts} />
    </div>
  <//>`;
}

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
