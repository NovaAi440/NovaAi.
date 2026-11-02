/* ===== NOVA 1.0 :: voice hook, shared UI bits ===== */
const Nova = createContext(null);
const useNova = () => useContext(Nova);

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const TTS = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

function speakable(md) {
  return md
    .replace(/```[\s\S]*?(```|$)/g, ' (code block omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function useVoice(prefs) {
  const [listening, setListening] = useState(false);
  const [micMsg, setMicMsg] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const recRef = useRef(null);

  useEffect(() => {
    if (!TTS) return undefined;
    const load = () => setVoices(window.speechSynthesis.getVoices() || []);
    load();
    window.speechSynthesis.addEventListener && window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => { window.speechSynthesis.removeEventListener && window.speechSynthesis.removeEventListener('voiceschanged', load); };
  }, []);

  const stopListening = useCallback(() => { try { recRef.current && recRef.current.stop(); } catch (e) { /* ignore */ } }, []);

  const startListening = useCallback((onText) => {
    if (!SR) { setMicMsg('Speech input is not supported by this browser. Type instead, or try Chrome or Edge.'); return false; }
    try {
      const rec = new SR();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true; rec.continuous = false;
      rec.onstart = () => { setListening(true); setMicMsg(''); };
      rec.onresult = (ev) => {
        let t = '';
        for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
        onText(t.trim(), !!ev.results[ev.results.length - 1].isFinal);
      };
      rec.onerror = (ev) => {
        const m = {
          'not-allowed': 'Microphone access is blocked in this view. Allow the microphone for this site, or type instead.',
          'service-not-allowed': 'Speech service is blocked in this view. Type instead.',
          'no-speech': 'No speech heard. Try again.',
          'audio-capture': 'No microphone found.',
          network: 'Speech recognition needs a network connection.',
          aborted: '',
        }[ev.error];
        setMicMsg(m === undefined ? 'Speech input failed (' + ev.error + ').' : m);
      };
      rec.onend = () => setListening(false);
      recRef.current = rec; rec.start();
      return true;
    } catch (e) {
      setListening(false);
      setMicMsg('Could not start the microphone in this view. Type instead.');
      return false;
    }
  }, []);

  const stopSpeaking = useCallback(() => { if (TTS) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } } setSpeaking(false); }, []);

  const speak = useCallback((md) => {
    if (!TTS) return false;
    const text = speakable(md);
    if (!text) return false;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, prefs.longRead ? 4000 : 1400));
      const pref = prefs.voicePref;
      const v = voices.find((x) => x.name === prefs.voiceName) || (pref && voices.find((x) => pref.test(x.name + ' ' + x.lang)));
      if (v) u.voice = v;
      u.rate = (prefs.voiceRate || 1) * (prefs.voiceRateMul || 1);
      u.pitch = prefs.voicePitch || 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { setSpeaking(false); return false; }
  }, [voices, prefs]);

  useEffect(() => () => { try { recRef.current && recRef.current.abort(); } catch (e) { /* ignore */ } if (TTS) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } } }, []);

  return { micSupported: !!SR, ttsSupported: TTS, listening, micMsg, setMicMsg, speaking, voices, startListening, stopListening, speak, stopSpeaking };
}

/* Animated AI status indicator */
const STATUS_LABEL = { idle: 'Online', thinking: 'Thinking', speaking: 'Speaking', listening: 'Listening', offline: 'AI offline' };
function StatusOrb({ state, size }) {
  return html`<span class=${'orb orb-' + state + (size === 'lg' ? ' orb-lg' : '')} aria-hidden="true"><i></i><i></i><b></b></span>`;
}

class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error('NOVA panel error', err); } catch (e) { /* ignore */ } }
  render() {
    if (this.state.err) {
      return html`<div class="panel pad"><h3>This panel hit an error</h3>
        <p class="dim">${String(this.state.err.message || this.state.err)}</p>
        <button class="btn" onClick=${() => this.setState({ err: null })}>Reload panel</button></div>`;
    }
    return this.props.children;
  }
}

function MicIcon() {
  return html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
}
function ClipIcon() {
  return html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5 12.5 21a5.5 5.5 0 0 1-8-8L13 4.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6L15 7.5"/></svg>`;
}
function StopIcon() {
  return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;
}

function Banner({ kind, children }) { return html`<div class=${'banner ' + (kind || 'info')} role="status">${children}</div>`; }

function Confirm({ label, confirmLabel, onConfirm, cls }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return armed
    ? html`<button class=${'btn danger ' + (cls || '')} onClick=${() => { setArmed(false); onConfirm(); }}>${confirmLabel || 'Confirm'}</button>`
    : html`<button class=${'btn ghost ' + (cls || '')} onClick=${() => setArmed(true)}>${label}</button>`;
}

function Field({ label, children }) { return html`<label class="field"><span>${label}</span>${children}</label>`; }
