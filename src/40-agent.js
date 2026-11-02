/* ===== NOVA 2.0 :: agent mode (plans, approvals, editing, templates, export, honest progress) ===== */
/* NOVA agents only produce text inside this app. Steps that need real-world action are "manual":
   the user does them and confirms. A step is never shown as done unless it was generated or the user confirmed it. */

const STEP_LABEL = { pending: 'Pending', awaiting: 'Needs approval', running: 'Running', done: 'Done', failed: 'Failed', skipped: 'Skipped' };
const EDITABLE = (s) => s.status === 'pending' || s.status === 'failed' || s.status === 'awaiting';
const slug = (t) => (t || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plan';

function planToMarkdown(p) {
  const lines = [`# ${p.title}`, '', `Goal: ${p.goal}`, '', `Exported ${new Date().toLocaleString()} from NOVA. Steps marked "confirmed by you" were done outside NOVA.`, ''];
  p.steps.forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s.title} [${STEP_LABEL[s.status]}]`, '', s.detail || '', '');
    if (s.result) lines.push(s.result, '');
  });
  lines.push('## Activity log', '', ...(p.log || []).map((l) => `- ${new Date(l.ts).toLocaleTimeString()} ${l.text}`));
  return lines.join('\n');
}

function StepEditor({ step, onSave, onCancel }) {
  const [t, setT] = useState(step.title);
  const [d, setD] = useState(step.detail);
  const [kind, setKind] = useState(step.kind);
  const [ap, setAp] = useState(step.approval);
  return html`<div class="stepedit">
    <${Field} label="Step title"><input id=${'se-t-' + step.id} value=${t} onInput=${(e) => setT(e.target.value)} /><//>
    <${Field} label="What should happen"><textarea id=${'se-d-' + step.id} rows="2" value=${d} onInput=${(e) => setD(e.target.value)}></textarea><//>
    <div class="row"><${Seg} label="Who does it" value=${kind} options=${{ generate: 'NOVA drafts', manual: 'You do this' }} onChange=${setKind} />
      <label class="chk"><input type="checkbox" checked=${ap} onChange=${(e) => setAp(e.target.checked)} /> Needs my approval</label></div>
    <div class="row"><button class="btn primary" disabled=${!t.trim()} onClick=${() => onSave({ title: clip(t.trim(), 80), detail: clip(d.trim(), 300), kind, approval: ap })}>Save step</button><button class="btn ghost" onClick=${onCancel}>Cancel</button></div>
  </div>`;
}

function AgentPanel() {
  const { plans, setPlans, templates, setTemplates, aiReady, notify, setBusyExt, plan: tierPlan, go, prefs } = useNova();
  const [activeId, setActiveId] = useState(plans[0] ? plans[0].id : null);
  const [goal, setGoal] = useState('');
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState('');
  const [runningId, setRunningId] = useState(null);
  const [auto, setAuto] = useState(false);
  const [editId, setEditId] = useState(null);
  const ctl = useRef(null);
  const plansRef = useRef(plans); plansRef.current = plans;
  const stopAuto = useRef(false);
  const model = modelFor(prefs.model, tierPlan);
  useEffect(() => () => { stopAuto.current = true; ctl.current && ctl.current.abort(); }, []);

  const plan = plans.find((p) => p.id === activeId) || null;
  const patchPlan = (pid, fn) => setPlans((ps) => ps.map((p) => (p.id === pid ? fn(p) : p)));
  const patchStep = (pid, sid, fn) => patchPlan(pid, (p) => ({ ...p, steps: p.steps.map((s) => (s.id === sid ? fn(s) : s)) }));
  const log = (pid, text) => patchPlan(pid, (p) => ({ ...p, log: [...(p.log || []), { ts: Date.now(), text }] }));

  const createPlan = async () => {
    const g = goal.trim(); if (!g) return;
    if (!aiReady) { setErr('The AI service is not reachable right now, so NOVA cannot build a plan.'); return; }
    setErr(''); setMaking(true);
    const prompt = `You are planning a task for a user. NOVA can only do text work inside this app: answering from its own knowledge, drafting, analysis, summarizing, outlining and writing code. It cannot send messages, browse the web, buy things, publish, or change files and accounts.
Break the goal into 3 to 7 steps. For each step set "kind" to "generate" if NOVA can produce its output as text, or "manual" if the user must do it outside this app. Set "approval" to true for any step that is hard to undo, spends money, shares information with other people, or that the user should review before the result is used. Give a short "reason" when approval is true.
Reply with only JSON in this shape: {"title": string, "steps": [{"title": string, "detail": string, "kind": "generate" | "manual", "approval": boolean, "reason": string}]}
Goal: ${g}`;
    const c = new AbortController(); ctl.current = c;
    try {
      const r = await AI.provider.json(prompt, { signal: c.signal, tier: 'default' });
      const steps = (r && Array.isArray(r.steps) ? r.steps : []).filter((s) => s && s.title).slice(0, 8).map((s) => ({
        id: uid(), title: clip(String(s.title), 80), detail: clip(String(s.detail || ''), 300),
        kind: s.kind === 'manual' ? 'manual' : 'generate', approval: !!s.approval, reason: clip(String(s.reason || ''), 160),
        status: 'pending', approved: false, result: '', error: '',
      }));
      if (steps.length < 2) throw { code: 'invalid_json', message: 'Plan had too few steps' };
      const p = { id: uid(), goal: g, title: clip(String(r.title || g), 70), createdAt: Date.now(), steps, log: [{ ts: Date.now(), text: 'Plan created by NOVA. No steps have been run.' }] };
      setPlans((ps) => [p, ...ps]); setActiveId(p.id); setGoal('');
    } catch (e) { if (!e || e.code !== 'cancelled') setErr(errCopy(e)); } finally { setMaking(false); ctl.current = null; }
  };

  /* Code Agent (NOVA Pro and up): one step per file, then a review. NOVA Ultra adds a second review pass. */
  const createCodePlan = async () => {
    const g = goal.trim(); if (!g) return;
    if (!aiReady) { setErr('The AI service is not reachable right now, so NOVA cannot build a plan.'); return; }
    if (!tierPlan.can('codeAgent')) { notify('The Code Agent is part of NOVA Pro.', 'warn'); go('plans'); return; }
    setErr(''); setMaking(true);
    const maxFiles = tierPlan.limit('codeFiles');
    const prompt = `Plan a small code project for this goal: ${g}
Reply with only JSON: {"title": string, "files": [{"path": string, "purpose": string}]}. Use at most ${maxFiles} files, with realistic paths for the language the goal implies. List files in the order they should be written, so each file can use the ones before it.`;
    const c = new AbortController(); ctl.current = c;
    try {
      const r = await AI.provider.json(prompt, { signal: c.signal, tier: 'default' });
      const files = (r && Array.isArray(r.files) ? r.files : []).filter((f) => f && f.path).slice(0, maxFiles);
      if (!files.length) throw { code: 'invalid_json', message: 'No files in plan' };
      const mk = (title, detail, approval, reason) => ({ id: uid(), title, detail, kind: 'generate', approval, reason, status: 'pending', approved: false, result: '', error: '' });
      const steps = files.map((f) => mk('Write ' + clip(String(f.path), 60),
        'Write the complete file ' + String(f.path) + '. Purpose: ' + clip(String(f.purpose || 'as the goal needs'), 200) + ' Output the full file in one fenced code block. Put the file path in the first comment line.', false, ''));
      steps.push(mk('Review the project', 'Review all the files written so far together. List bugs, missing edge cases and integration problems. Then give the corrected version of every file that needs changes.', true, 'Review the code before you use it'));
      if (tierPlan.tier === 'ultra') steps.push(mk('Second review pass', 'Check the corrected files again for anything the first review missed, and give final versions of any file still needing changes.', true, 'Final check before you use the code'));
      const p = { id: uid(), goal: g, title: clip('Code: ' + String(r.title || g), 70), createdAt: Date.now(), steps, log: [{ ts: Date.now(), text: 'Code plan created by NOVA. No files have been written yet.' }] };
      setPlans((ps) => [p, ...ps]); setActiveId(p.id); setGoal('');
    } catch (e) { if (!e || e.code !== 'cancelled') setErr(errCopy(e)); } finally { setMaking(false); ctl.current = null; }
  };

  const runStep = async (pid, sid) => {
    const p = plansRef.current.find((x) => x.id === pid); if (!p) return false;
    const idx = p.steps.findIndex((s) => s.id === sid); const st = p.steps[idx];
    const m = modelFor(prefs.model, tierPlan);
    const prior = p.steps.slice(0, idx).filter((s) => s.status === 'done').map((s) => `Step "${s.title}" (${s.kind === 'manual' ? 'confirmed by user' : 'generated'}): ${clip(s.result || 'no output', 600)}`).join('\n');
    const prompt = `You are carrying out one step of a plan. Produce this step's output as text only. You cannot take actions outside this chat. Do not claim to have done anything beyond writing this output.
Overall goal: ${p.goal}
All steps: ${p.steps.map((s, i) => `${i + 1}. ${s.title}`).join(' | ')}
${prior ? 'Earlier results:\n' + prior : 'No earlier results.'}
Current step: ${st.title}. ${st.detail}
Write the output for this step now, in Markdown.`;
    const c = new AbortController(); ctl.current = c; setRunningId(sid); setEditId(null);
    patchStep(pid, sid, (s) => ({ ...s, status: 'running', error: '', result: '' }));
    try {
      const res = await AI.provider.complete(prompt, { signal: c.signal, tier: m.tier, onText: ({ text }) => patchStep(pid, sid, (s) => ({ ...s, result: text })) });
      patchStep(pid, sid, (s) => ({ ...s, status: 'done', result: res.text }));
      log(pid, `Step "${st.title}": text generated by NOVA (${m.label}).`);
      return true;
    } catch (e) {
      if (e && e.code === 'cancelled') { patchStep(pid, sid, (s) => ({ ...s, status: 'pending' })); log(pid, `Step "${st.title}": stopped before finishing.`); }
      else { patchStep(pid, sid, (s) => ({ ...s, status: 'failed', error: errCopy(e) })); log(pid, `Step "${st.title}": failed.`); }
      return false;
    } finally { ctl.current = null; setRunningId(null); }
  };

  const approveAndRun = async (pid, sid) => {
    const p = plansRef.current.find((x) => x.id === pid); const st = p.steps.find((s) => s.id === sid);
    patchStep(pid, sid, (s) => ({ ...s, approved: true }));
    log(pid, `You approved "${st.title}".`);
    await runStep(pid, sid);
  };

  const runAll = async () => {
    if (!plan) return;
    stopAuto.current = false; setAuto(true);
    const pid = plan.id;
    try {
      for (;;) {
        if (stopAuto.current) break;
        const p = plansRef.current.find((x) => x.id === pid); if (!p) break;
        const next = p.steps.find((s) => s.status === 'pending' || s.status === 'awaiting' || s.status === 'failed');
        if (!next) break;
        if (next.kind === 'manual') { notify('Next step needs you: "' + next.title + '"', 'info'); break; }
        if (next.approval && !next.approved) { patchStep(pid, next.id, (s) => ({ ...s, status: 'awaiting' })); notify('Approval needed: "' + next.title + '"', 'warn'); break; }
        const ok = await runStep(pid, next.id); if (!ok) break;
      }
    } finally { setAuto(false); }
  };
  const stop = () => { stopAuto.current = true; ctl.current && ctl.current.abort(); };

  const confirmManual = (pid, s) => { patchStep(pid, s.id, (x) => ({ ...x, status: 'done', result: 'Marked done by you. NOVA did not perform this step.' })); log(pid, `You confirmed you completed "${s.title}".`); };
  const skip = (pid, s) => { patchStep(pid, s.id, (x) => ({ ...x, status: 'skipped' })); log(pid, `You skipped "${s.title}".`); };

  /* editing */
  const saveStep = (pid, sid, v) => { patchStep(pid, sid, (s) => ({ ...s, ...v, status: s.status === 'awaiting' ? 'pending' : s.status, approved: v.approval ? s.approved : false })); setEditId(null); log(pid, 'You edited a step.'); };
  const moveStep = (pid, sid, dir) => patchPlan(pid, (p) => {
    const i = p.steps.findIndex((s) => s.id === sid); const j = i + dir;
    if (j < 0 || j >= p.steps.length || !EDITABLE(p.steps[j]) || !EDITABLE(p.steps[i])) return p;
    const steps = [...p.steps]; [steps[i], steps[j]] = [steps[j], steps[i]]; return { ...p, steps };
  });
  const delStep = (pid, sid) => { patchPlan(pid, (p) => (p.steps.length <= 1 ? p : { ...p, steps: p.steps.filter((s) => s.id !== sid) })); log(pid, 'You removed a step.'); };
  const addStep = (pid) => {
    const s = { id: uid(), title: 'New step', detail: '', kind: 'generate', approval: false, reason: '', status: 'pending', approved: false, result: '', error: '' };
    patchPlan(pid, (p) => ({ ...p, steps: [...p.steps, s] })); setEditId(s.id);
  };

  /* templates and export */
  const saveTemplate = (p) => {
    const t = { id: uid(), title: p.title, goal: p.goal, steps: p.steps.map((s) => ({ title: s.title, detail: s.detail, kind: s.kind, approval: s.approval, reason: s.reason })) };
    setTemplates((ts) => [t, ...ts].slice(0, 20)); notify('Saved as template', 'ok');
  };
  const useTemplate = (t) => {
    const p = { id: uid(), goal: t.goal, title: t.title, createdAt: Date.now(), log: [{ ts: Date.now(), text: 'Plan created from a template. No steps have been run.' }],
      steps: t.steps.map((s) => ({ ...s, id: uid(), status: 'pending', approved: false, result: '', error: '' })) };
    setPlans((ps) => [p, ...ps]); setActiveId(p.id);
  };
  const exportPlan = async (p) => {
    const md = planToMarkdown(p);
    try { await Files.save('nova-' + slug(p.title) + '.md', md); notify('Plan exported', 'ok'); }
    catch (e) {
      if (e && e.code === 'declined') return;
      if (await copyText(md)) notify('Saving files is unavailable here, so the plan was copied to your clipboard.', 'info'); else notify(dlCopy(e), 'warn');
    }
  };

  const done = plan ? plan.steps.filter((s) => s.status === 'done').length : 0;
  const total = plan ? plan.steps.length : 0;
  const nextId = plan ? (plan.steps.find((s) => s.status !== 'done' && s.status !== 'skipped') || {}).id : null;
  const busy = !!runningId || making;
  useEffect(() => { setBusyExt(busy); return () => setBusyExt(false); }, [busy]);

  return html`<div class="agent">
    <div class="pagehead"><h2>Agent mode</h2><p class="dim">Give NOVA a goal. It proposes a plan, you edit it and approve the important steps, and the log records only what really happened. NOVA writes text inside this app. It cannot act on other apps or accounts, so those steps are yours to do and confirm.</p></div>
    <section class="panel pad">
      <${Field} label="Goal"><textarea id="agent-goal" rows="2" placeholder="Example: Prepare a launch announcement for my Roblox game" value=${goal} onInput=${(e) => setGoal(e.target.value)}></textarea><//>
      <div class="row">
        ${making ? html`<button class="btn danger" onClick=${stop}>Stop</button>` : html`<button class="btn primary" onClick=${createPlan} disabled=${!goal.trim() || !aiReady || busy}>Create plan</button>`}
        ${making ? html`<div class="typing"><i></i><i></i><i></i><span>Planning</span></div>` : null}
        <button class="btn" onClick=${createCodePlan} disabled=${!goal.trim() || !aiReady || busy} title="One step per file, then a review. Needs NOVA Pro.">${tierPlan.can('codeAgent') ? 'Code project' : 'Code project · NOVA Pro'}</button>
      </div>
      ${err ? html`<${Banner} kind="bad">${err}<//>` : null}
      ${!aiReady ? html`<${Banner} kind="warn">The AI service is not reachable right now, so plans cannot be created or run.<//>` : null}
    </section>
    <div class="agent-body">
      <aside class="panel pad plist"><div class="side-head"><h3>Plans</h3></div>
        ${plans.length === 0 ? html`<p class="dim empty-line">No plans yet.</p>` : html`<ul>${plans.map((p) => html`<li key=${p.id} class=${p.id === activeId ? 'on' : ''}>
          <button class="sess" onClick=${() => setActiveId(p.id)}><b>${p.title}</b><small>${p.steps.filter((s) => s.status === 'done').length}/${p.steps.length} done</small></button>
          <button class="x" aria-label=${'Delete plan ' + p.title} onClick=${() => { setPlans((ps) => ps.filter((x) => x.id !== p.id)); if (activeId === p.id) setActiveId(null); }}>×</button></li>`)}</ul>`}
        <div class="side-head tpl-head"><h3>Templates</h3></div>
        ${templates.length === 0 ? html`<p class="hint">Save a plan as a template to reuse it.</p>` : html`<ul>${templates.map((t) => html`<li key=${t.id}>
          <button class="sess" onClick=${() => useTemplate(t)} title="Create a plan from this template"><b>${t.title}</b><small>${t.steps.length} steps · tap to use</small></button>
          <button class="x" aria-label=${'Delete template ' + t.title} onClick=${() => setTemplates((ts) => ts.filter((x) => x.id !== t.id))}>×</button></li>`)}</ul>`}
      </aside>
      <section class="panel pad pdetail">${!plan ? html`<p class="dim empty-line">Create a plan or select one to see its steps.</p>` : html`
        <div class="card-head"><h3>${plan.title}</h3><span class="dim">${done} of ${total} steps done</span></div>
        <div class="bar"><i style=${{ width: (total ? done / total * 100 : 0) + '%' }}></i></div>
        <div class="row">
          ${auto || runningId ? html`<button class="btn danger" onClick=${stop}>Stop</button>` : html`<button class="btn primary" onClick=${runAll} disabled=${!aiReady || done === total}>Run next steps</button>`}
          <button class="btn" onClick=${() => exportPlan(plan)}>Export .md</button>
          <button class="btn" onClick=${() => saveTemplate(plan)}>Save as template</button>
        </div>
        <p class="hint">Runs in order and pauses at approvals and manual steps. You are charged only for steps that finish.</p>
        <ol class="steps">${plan.steps.map((s, i) => html`<li key=${s.id} class=${'step st-' + s.status}>
          <div class="step-head"><span class="num">${i + 1}</span><b>${s.title}</b>
            <span class=${'pill sp-' + s.status}>${STEP_LABEL[s.status]}</span>
            <span class="pill p-kind">${s.kind === 'manual' ? 'You do this' : 'NOVA drafts'}</span>
            ${s.approval ? html`<span class="pill p-warn">Approval</span>` : null}</div>
          ${editId === s.id ? html`<${StepEditor} step=${s} onSave=${(v) => saveStep(plan.id, s.id, v)} onCancel=${() => setEditId(null)} />` : html`
            ${s.detail ? html`<p class="dim">${s.detail}</p>` : null}
            ${s.approval && s.reason ? html`<p class="hint warnc">Why approval: ${s.reason}</p>` : null}`}
          ${s.status === 'running' && !s.result ? html`<div class="typing"><i></i><i></i><i></i><span>Working</span></div>` : null}
          ${s.result ? html`<div class="result"><${Md} text=${s.result} /></div>` : null}
          ${s.error ? html`<${Banner} kind="bad">${s.error}<//>` : null}
          <div class="row actions">
            ${s.status !== 'done' && s.status !== 'skipped' && s.status !== 'running' && s.id === nextId && editId !== s.id ? (
              s.kind === 'manual'
                ? html`<button class="btn" onClick=${() => confirmManual(plan.id, s)}>I did this</button>`
                : s.approval && !s.approved
                  ? html`<button class="btn primary" onClick=${() => approveAndRun(plan.id, s.id)} disabled=${!aiReady || busy}>Approve and run</button>`
                  : html`<button class="btn" onClick=${() => runStep(plan.id, s.id)} disabled=${!aiReady || busy}>${s.status === 'failed' ? 'Retry step' : 'Run step'}</button>`) : null}
            ${s.status !== 'done' && s.status !== 'skipped' && s.status !== 'running' && s.id === nextId && editId !== s.id ? html`<button class="btn ghost" onClick=${() => skip(plan.id, s)}>Skip</button>` : null}
            ${EDITABLE(s) && editId !== s.id && !busy ? html`<span class="spacer"></span>
              <button class="mini" aria-label="Move step up" onClick=${() => moveStep(plan.id, s.id, -1)}>↑</button>
              <button class="mini" aria-label="Move step down" onClick=${() => moveStep(plan.id, s.id, 1)}>↓</button>
              <button class="mini" onClick=${() => setEditId(s.id)}>Edit</button>
              <button class="mini" onClick=${() => delStep(plan.id, s.id)}>Remove</button>` : null}
          </div>
        </li>`)}</ol>
        <div class="row"><button class="btn ghost" onClick=${() => addStep(plan.id)} disabled=${busy}>+ Add step</button></div>
        <details class="logbox"><summary>Activity log (${(plan.log || []).length})</summary><ul>${(plan.log || []).map((l, i) => html`<li key=${i}><time>${fmtTime(l.ts)}</time> ${l.text}</li>`)}</ul></details>`}
      </section>
    </div>
  </div>`;
}
