/* ===== NOVA 2.1 :: Council (NOVA Ultra): three viewpoints and one synthesis ===== */

const COUNCIL_SEATS = [
  { id: 'advocate', label: 'Advocate', brief: 'Make the strongest honest case for the most promising option, and name what that case depends on.' },
  { id: 'skeptic', label: 'Skeptic', brief: 'Find the weakest assumptions, risks and failure modes. Be specific. Do not disagree for its own sake.' },
  { id: 'practitioner', label: 'Practitioner', brief: 'Focus on what to do this week with limited time and money. Give concrete steps, in order.' },
];

function CouncilPanel() {
  const { plan, aiReady, notify, go } = useNova();
  const [q, setQ] = useState('');
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const ctl = useRef(null);
  useEffect(() => () => { if (ctl.current) ctl.current.abort(); }, []);

  if (!plan.can('council')) {
    return html`<div class="council">
      <div class="pagehead"><h2>Council</h2><p class="dim">Three viewpoints on one question, then a synthesis.</p></div>
      <${LockedPanel} title="The Council is part of NOVA Ultra" tier="ultra" blurb="Three seats answer your question from different angles, and a chair writes the synthesis: where they agree, where they split, and what to do next."
        bullets=${['Advocate, Skeptic and Practitioner viewpoints', 'A synthesis that names disagreements and what would change the advice', 'Everything in NOVA Pro included']} />
    </div>`;
  }

  const setSeat = (id, patch) => setRun((r) => (r ? { ...r, seats: { ...r.seats, [id]: { ...r.seats[id], ...patch } } } : r));
  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    if (!aiReady) { notify('Claude is not reachable in this view.', 'warn'); return; }
    const c = new AbortController(); ctl.current = c; setBusy(true);
    const seats = {};
    COUNCIL_SEATS.forEach((s) => { seats[s.id] = { text: '', status: 'running', error: '' }; });
    setRun({ question, seats, synth: { text: '', status: 'waiting', error: '' } });
    try {
      const settled = await Promise.allSettled(COUNCIL_SEATS.map((s) => {
        const prompt = `${BASE_PROMPT}\n\nYou are the ${s.label} on a council. ${s.brief}\nAnswer the question from that viewpoint only, in under 250 words. Keep what you know apart from what you are guessing.\n\nQuestion: ${question}`;
        return AI.provider.complete(prompt, {
          signal: c.signal, tier: 'default',
          onText: ({ text }) => setSeat(s.id, { text }),
        }).then((res) => { setSeat(s.id, { text: res.text, status: 'done', error: '' }); return { label: s.label, text: res.text }; })
          .catch((e) => { if (!e || e.code !== 'cancelled') setSeat(s.id, { status: 'failed', error: errCopy(e) }); return null; });
      }));
      const answers = settled.map((r) => r.value).filter(Boolean);
      if (c.signal.aborted) return;
      if (!answers.length) throw { code: 'empty_completion', message: 'no seat answered' };
      setRun((r) => (r ? { ...r, synth: { text: '', status: 'running', error: '' } } : r));
      const chair = `${BASE_PROMPT}\n\nYou chair a council. Read the viewpoints below and write a synthesis for the user with these parts: where they agree, where they disagree and why, the step you recommend, and what new information would change that recommendation. Keep claims apart from guesses.\n\nQuestion: ${question}\n\n${answers.map((a) => `${a.label}:\n${a.text}`).join('\n\n')}`;
      const res = await AI.provider.complete(chair, {
        signal: c.signal, tier: 'default',
        onText: ({ text }) => setRun((r) => (r ? { ...r, synth: { text, status: 'running', error: '' } } : r)),
      });
      setRun((r) => (r ? { ...r, synth: { text: res.text, status: 'done', error: '' } } : r));
    } catch (e) {
      if (!e || e.code !== 'cancelled') setRun((r) => (r ? { ...r, synth: { text: '', status: 'failed', error: errCopy(e) } } : r));
    } finally { setBusy(false); ctl.current = null; }
  };

  const seatBadge = (st) => (st.status === 'done' ? html`<span class="pill sp-done">Done</span>` : st.status === 'failed' ? html`<span class="pill sp-failed">Failed</span>` : html`<span class="pill sp-running">Thinking</span>`);

  return html`<div class="council">
    <div class="pagehead"><h2>Council</h2><p class="dim">Ask one question. Three seats answer from different angles, then a chair writes the synthesis. Each seat and the chair use one message from your daily allowance.</p></div>
    <section class="panel pad">
      <${Field} label="Question"><textarea id="council-q" rows="3" value=${q} placeholder="For example: Should I launch my Roblox game free with ads, or charge a one-time fee?" onInput=${(e) => setQ(e.target.value)}></textarea><//>
      <div class="row">${busy
        ? html`<button class="btn danger" onClick=${() => ctl.current && ctl.current.abort()}>Stop</button>`
        : html`<button class="btn primary" onClick=${ask} disabled=${!q.trim() || !aiReady}>Convene the council</button>`}</div>
      ${!aiReady ? html`<${Banner} kind="warn">Claude is not reachable in this view, so the council cannot meet.<//>` : null}
    </section>
    ${run ? html`<div class="seats">${COUNCIL_SEATS.map((s) => {
      const st = run.seats[s.id];
      return html`<section key=${s.id} class="panel pad seat">
        <div class="card-head"><h3>${s.label}</h3>${seatBadge(st)}</div>
        ${st.text ? html`<${Md} text=${st.text} />` : st.status === 'running' ? html`<div class="typing"><i></i><i></i><i></i><span>Thinking</span></div>` : null}
        ${st.error ? html`<${Banner} kind="bad">${st.error}<//>` : null}
      </section>`;
    })}</div>
    <section class="panel pad">
      <div class="card-head"><h3>Synthesis</h3>${run.synth.status === 'running' ? html`<span class="pill sp-running">Writing</span>` : run.synth.status === 'done' ? html`<span class="pill sp-done">Done</span>` : null}</div>
      ${run.synth.text ? html`<${Md} text=${run.synth.text} />`
        : run.synth.status === 'waiting' ? html`<p class="dim">The chair writes this once the seats have answered.</p>`
        : run.synth.status === 'running' ? html`<div class="typing"><i></i><i></i><i></i><span>Writing</span></div>` : null}
      ${run.synth.error ? html`<${Banner} kind="bad">${run.synth.error}<//>` : null}
    </section>` : null}
  </div>`;
}
