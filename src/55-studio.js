/* ===== NOVA 2.0 :: Studio (vector image creation by Claude, with a monthly quota) ===== */

const SVG_OK = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'use', 'title', 'desc', 'symbol', 'filter', 'fegaussianblur', 'feoffset', 'feblend', 'femerge', 'femergenode', 'fecolormatrix', 'fecomposite', 'feflood', 'fedropshadow']);
const STYLES = ['Flat illustration', 'Icon or logo mark', 'Detailed scene', 'Line art', 'Isometric', 'Repeating pattern'];
const RATIOS = { square: ['Square', 512, 512], wide: ['Wide', 768, 432], tall: ['Tall', 432, 768] };

/* Keep only drawing elements. Drop scripts, event handlers, external links and anything that could load a remote resource. */
function cleanSvg(raw) {
  const m = String(raw || '').match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return null;
  let doc;
  try { doc = new DOMParser().parseFromString(m[0], 'image/svg+xml'); } catch (e) { return null; }
  if (doc.querySelector('parsererror')) return null;
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') return null;
  const walk = (el) => {
    [...el.children].forEach((ch) => { if (!SVG_OK.has(ch.localName.toLowerCase())) ch.remove(); else walk(ch); });
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase(); const v = a.value;
      const badHref = /^(xlink:)?href$/.test(n) && !v.trim().startsWith('#');
      const badUrl = /url\(\s*['"]?\s*(?!#)/i.test(v) || /@import|javascript:|data:/i.test(v);
      if (n.startsWith('on') || badHref || badUrl) el.removeAttribute(a.name);
    });
  };
  walk(root);
  if (!root.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width')); const h = parseFloat(root.getAttribute('height'));
    root.setAttribute('viewBox', w > 0 && h > 0 ? `0 0 ${w} ${h}` : '0 0 512 512');
  }
  root.removeAttribute('width'); root.removeAttribute('height');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const out = new XMLSerializer().serializeToString(root);
  return out.length > 60000 ? null : out;
}
const svgSrc = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

function StudioPanel() {
  const { gallery, setGallery, aiReady, notify, plan, go } = useNova();
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState(STYLES[0]);
  const [ratio, setRatio] = useState('square');
  const [refine, setRefine] = useState('');
  const [selId, setSelId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ctl = useRef(null);
  useEffect(() => () => ctl.current && ctl.current.abort(), []);
  const sel = gallery.find((g) => g.id === selId) || gallery[0] || null;
  const out = plan.quota.max !== Infinity && plan.quota.used >= plan.quota.max;

  const addItem = (item) => setGallery((g) => {
    let arr = [item, ...g].slice(0, 12);
    while (arr.length > 1 && JSON.stringify(arr).length > 180000) arr = arr.slice(0, -1);
    return arr;
  });

  const make = async (mode) => {
    const text = (mode === 'refine' ? refine : prompt).trim();
    if (!text) return;
    if (!aiReady) { setErr('The AI service is not reachable right now, so images cannot be created.'); return; }
    if (out) { setErr("You have used today's messages. Each image uses one message."); return; }
    const [, w, h] = RATIOS[ratio];
    const base = mode === 'refine' && sel
      ? `Here is an existing SVG:\n${sel.svg}\n\nChange it as follows: ${text}\nKeep the same viewBox "${sel.viewBox || '0 0 512 512'}" and keep what was not mentioned.`
      : `Create one SVG image of: ${text}\nStyle: ${style}.\nUse viewBox "0 0 ${w} ${h}".`;
    const input = `You are an SVG illustrator. ${base}
Rules: reply with only the SVG code, starting with <svg and ending with </svg>. Use only basic shapes, paths, gradients, masks and text. No scripts, no external images or fonts, no <image> and no <foreignObject>. Keep it under 8000 characters. Use a cohesive palette of 4 to 6 colors and a clear focal subject.`;
    setErr(''); setBusy(true);
    const c = new AbortController(); ctl.current = c;
    try {
      const res = await AI.provider.complete(input, { signal: c.signal, tier: 'default' });
      const svg = cleanSvg(res.text);
      if (!svg) throw { code: 'invalid_json', message: 'no usable image', bad: true };
      const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 512 512';
      const item = { id: uid(), prompt: mode === 'refine' && sel ? sel.prompt + ' → ' + text : text, style: mode === 'refine' && sel ? sel.style : style, svg, viewBox: vb, ts: Date.now() };
      addItem(item); setSelId(item.id);
      if (mode === 'refine') setRefine(''); else setPrompt('');
    } catch (e) {
      if (e && e.code === 'cancelled') return;
      setErr(e && e.bad ? 'NOVA returned something that was not a usable image. Try describing it differently.' : errCopy(e));
    } finally { setBusy(false); ctl.current = null; }
  };

  const download = async (g) => {
    try { await Files.save('nova-' + slug(g.prompt) + '.svg', g.svg); notify('Image saved', 'ok'); }
    catch (e) { if (e && e.code !== 'declined') notify(dlCopy(e), 'warn'); }
  };
  const copyCode = async (g) => notify((await copyText(g.svg)) ? 'SVG code copied' : 'Copy was blocked here.', 'info');

  return html`<div class="studio">
    <div class="pagehead"><h2>Studio</h2><p class="dim">Describe an image and Claude draws it as scalable vector art (SVG). This makes illustrations, icons, logo marks and patterns. It does not make photographs or realistic renders.</p></div>
    <div class="quota panel pad">
      <div><small class="dim">Today's messages</small><b>${plan.quota.max === Infinity ? 'No daily cap' : Math.max(0, plan.quota.max - plan.quota.used) + ' of ' + plan.quota.max + ' left'}</b></div>
      <div class="bar grow"><i style=${{ width: (plan.quota.max === Infinity ? 8 : Math.min(100, plan.quota.used / plan.quota.max * 100)) + '%' }}></i></div>
      <span class="dim">${plan.label} plan · each image uses one message</span>
      ${out ? html`<button class="btn primary" onClick=${() => go('plans')}>See plans</button>` : null}
    </div>
    <div class="grid2">
      <section class="panel pad">
        <h3>New image</h3>
        <${Field} label="Describe it"><textarea id="studio-prompt" rows="3" placeholder="A fox made of geometric shapes watching a sunrise over mountains" value=${prompt} onInput=${(e) => setPrompt(e.target.value)}></textarea><//>
        <${Field} label="Style"><select id="studio-style" value=${style} onChange=${(e) => setStyle(e.target.value)}>${STYLES.map((s) => html`<option key=${s}>${s}</option>`)}</select><//>
        <${Field} label="Shape"><${Seg} label="Shape" value=${ratio} options=${Object.fromEntries(Object.entries(RATIOS).map(([k, v]) => [k, v[0]]))} onChange=${setRatio} /><//>
        <div class="row">
          ${busy ? html`<button class="btn danger" onClick=${() => ctl.current && ctl.current.abort()}>Stop</button>` : html`<button class="btn primary" onClick=${() => make('new')} disabled=${!prompt.trim() || !aiReady || out}>Create image · 1 image</button>`}
          ${busy ? html`<div class="typing"><i></i><i></i><i></i><span>Drawing</span></div>` : null}
        </div>
        ${err ? html`<${Banner} kind="bad">${err}<//>` : null}
        ${!aiReady ? html`<${Banner} kind="warn">Claude is not reachable in this view.<//>` : null}
        <p class="hint">An image uses one message from your daily allowance, and only when a usable picture comes back.</p>
      </section>
      <section class="panel pad">
        <h3>Result</h3>
        ${!sel ? html`<p class="dim empty-line">Your images will appear here. Try a starter below.</p>
          <div class="chips left">${['A friendly robot waving, flat illustration', 'Minimal logo mark for a game studio called Nova Forge', 'Sunset over a pixel-art style city skyline'].map((q) => html`<button key=${q} class="chip" onClick=${() => setPrompt(q)}>${q}</button>`)}</div>` : html`
          <div class="canvas"><img alt=${'Generated image: ' + sel.prompt} src=${svgSrc(sel.svg)} /></div>
          <p class="hint">${sel.style} · ${clip(sel.prompt, 120)}</p>
          <div class="row"><button class="btn" onClick=${() => download(sel)}>Download .svg</button><button class="btn" onClick=${() => copyCode(sel)}>Copy code</button>
            <${Confirm} label="Delete" confirmLabel="Delete it" onConfirm=${() => { setGallery((g) => g.filter((x) => x.id !== sel.id)); setSelId(null); }} /></div>
          <${Field} label="Change this image"><input id="studio-refine" placeholder="Make the sky purple and add stars" value=${refine} onInput=${(e) => setRefine(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && !busy && make('refine')} /><//>
          <button class="btn" onClick=${() => make('refine')} disabled=${busy || !refine.trim() || !aiReady || out}>Apply change · 1 image</button>`}
      </section>
    </div>
    ${gallery.length > 1 ? html`<section class="panel pad"><h3>Gallery</h3><p class="hint">The last ${gallery.length} images, saved with your account.</p>
      <div class="gal">${gallery.map((g) => html`<button key=${g.id} class=${'thumb' + (sel && g.id === sel.id ? ' on' : '')} onClick=${() => setSelId(g.id)} aria-label=${'Open image: ' + g.prompt}><img alt="" src=${svgSrc(g.svg)} /></button>`)}</div></section>` : null}
  </div>`;
}
