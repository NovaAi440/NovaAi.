/* ===== NOVA 1.0 :: personal planner (tasks, schedule, notes) ===== */
const PRIORITY = { high: 'High', med: 'Medium', low: 'Low' };
const STATUS_NEXT = { todo: 'doing', doing: 'done', done: 'todo' };
const STATUS_LABEL_T = { todo: 'To do', doing: 'In progress', done: 'Done' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const nowHHMM = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function TasksCard() {
  const { tasks, setTasks } = useNova();
  const [title, setTitle] = useState('');
  const [prio, setPrio] = useState('med');
  const [due, setDue] = useState('');
  const [filter, setFilter] = useState('all');
  const add = (e) => {
    e.preventDefault();
    const t = title.trim(); if (!t) return;
    setTasks((ts) => [{ id: uid(), title: t, priority: prio, status: 'todo', due, createdAt: Date.now() }, ...ts]);
    setTitle(''); setDue('');
  };
  const done = tasks.filter((t) => t.status === 'done').length;
  const shown = tasks.filter((t) => filter === 'all' || t.status === filter);
  const rank = { high: 0, med: 1, low: 2 };
  shown.sort((a, b) => (a.status === 'done') - (b.status === 'done') || rank[a.priority] - rank[b.priority]);
  return html`<section class="panel pad">
    <div class="card-head"><h3>Tasks</h3><span class="dim">${done} of ${tasks.length} done</span></div>
    <div class="bar"><i style=${{ width: tasks.length ? (done / tasks.length) * 100 + '%' : '0%' }}></i></div>
    <form class="add" onSubmit=${add}>
      <input id="task-title" placeholder="Add a task" value=${title} onInput=${(e) => setTitle(e.target.value)} />
      <select id="task-prio" value=${prio} onChange=${(e) => setPrio(e.target.value)} aria-label="Priority">${Object.entries(PRIORITY).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
      <input id="task-due" type="date" value=${due} onInput=${(e) => setDue(e.target.value)} aria-label="Due date" />
      <button class="btn primary" type="submit">Add</button>
    </form>
    <${Seg} label="Filter" value=${filter} options=${{ all: 'All', todo: 'To do', doing: 'In progress', done: 'Done' }} onChange=${setFilter} />
    ${shown.length === 0 ? html`<p class="dim empty-line">${tasks.length ? 'No tasks match this filter.' : 'No tasks yet. Add your first one above.'}</p>` : html`<ul class="list">${shown.map((t) => html`<li key=${t.id} class=${'task ' + t.status}>
      <button class=${'state s-' + t.status} onClick=${() => setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, status: STATUS_NEXT[x.status] } : x)))} title="Change status" aria-label=${'Status: ' + STATUS_LABEL_T[t.status] + '. Click to advance.'}>${STATUS_LABEL_T[t.status]}</button>
      <span class="ttl">${t.title}${t.due ? html`<small class=${t.due < todayISO() && t.status !== 'done' ? 'late' : ''}> due ${t.due}</small>` : null}</span>
      <span class=${'pill p-' + t.priority}>${PRIORITY[t.priority]}</span>
      <button class="x" aria-label=${'Delete task ' + t.title} onClick=${() => setTasks((ts) => ts.filter((x) => x.id !== t.id))}>×</button>
    </li>`)}</ul>`}
  </section>`;
}

function ScheduleCard() {
  const { events, setEvents, tasks, notify, aiReady } = useNova();
  const [date, setDate] = useState(todayISO());
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [title, setTitle] = useState('');
  const [focus, setFocus] = useState('');
  const [plan, setPlan] = useState(null); // {items:[{id,start,end,title,on}]}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ctl = useRef(null);
  useEffect(() => () => ctl.current && ctl.current.abort(), []);

  const day = events.filter((e) => e.date === date).sort((a, b) => a.start.localeCompare(b.start));
  const isToday = date === todayISO(); const now = nowHHMM();

  const add = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (!HHMM.test(start) || !HHMM.test(end) || end <= start) { setErr('End time must be after the start time.'); return; }
    setErr('');
    setEvents((es) => [...es, { id: uid(), date, start, end, title: title.trim() }]);
    setTitle('');
  };

  const draftPlan = async () => {
    setErr(''); setPlan(null);
    if (!aiReady) { setErr('The AI service is not reachable right now.'); return; }
    const open = tasks.filter((t) => t.status !== 'done').map((t) => `- ${t.title} (${PRIORITY[t.priority]} priority${t.due ? ', due ' + t.due : ''})`).join('\n') || '- none';
    const fixed = day.map((e) => `- ${e.start}-${e.end} ${e.title}`).join('\n') || '- none';
    const prompt = `Plan ${date} as time blocks for a busy person.${isToday ? ' Current time is ' + now + '. Only schedule blocks after now.' : ''}\nOpen tasks:\n${open}\nExisting fixed events (do not overlap):\n${fixed}\nUser focus: ${focus.trim() || 'none given'}\nReply with only a JSON array of at most 8 objects like {"start":"09:00","end":"10:00","title":"Write report draft"}. Use 24-hour HH:MM, order by start, keep titles under 60 characters.`;
    const c = new AbortController(); ctl.current = c; setBusy(true);
    try {
      const arr = await AI.provider.json(prompt, { signal: c.signal, tier: 'default' });
      const items = (Array.isArray(arr) ? arr : []).filter((x) => x && HHMM.test(String(x.start)) && HHMM.test(String(x.end)) && x.end > x.start && x.title)
        .slice(0, 8).map((x) => ({ id: uid(), start: x.start, end: x.end, title: clip(String(x.title), 60), on: true }));
      if (!items.length) setErr('NOVA did not return usable time blocks. Try again with a clearer focus.');
      else setPlan({ items });
    } catch (e2) { if (!e2 || e2.code !== 'cancelled') setErr(errCopy(e2)); } finally { setBusy(false); ctl.current = null; }
  };
  const approve = () => {
    const picked = plan.items.filter((i) => i.on);
    setEvents((es) => [...es, ...picked.map((i) => ({ id: uid(), date, start: i.start, end: i.end, title: i.title }))]);
    notify(picked.length + ' block' + (picked.length === 1 ? '' : 's') + ' added to your schedule', 'ok');
    setPlan(null);
  };

  return html`<section class="panel pad">
    <div class="card-head"><h3>Daily schedule</h3><input id="sched-date" type="date" value=${date} onInput=${(e) => setDate(e.target.value || todayISO())} aria-label="Schedule date" /></div>
    ${day.length === 0 ? html`<p class="dim empty-line">Nothing scheduled for ${isToday ? 'today' : date}.</p>` : html`<ul class="list">${day.map((e) => html`<li key=${e.id} class=${'slot' + (isToday && now >= e.start && now < e.end ? ' now' : '')}>
      <span class="time">${e.start}–${e.end}</span><span class="ttl">${e.title}</span>
      ${isToday && now >= e.start && now < e.end ? html`<span class="pill p-now">Now</span>` : null}
      <button class="x" aria-label=${'Delete ' + e.title} onClick=${() => setEvents((es) => es.filter((x) => x.id !== e.id))}>×</button>
    </li>`)}</ul>`}
    <form class="add" onSubmit=${add}>
      <input id="ev-start" type="time" value=${start} onInput=${(e) => setStart(e.target.value)} aria-label="Start" />
      <input id="ev-end" type="time" value=${end} onInput=${(e) => setEnd(e.target.value)} aria-label="End" />
      <input id="ev-title" placeholder="Block title" value=${title} onInput=${(e) => setTitle(e.target.value)} />
      <button class="btn primary" type="submit">Add</button>
    </form>
    <div class="ai-box">
      <div class="row"><input id="plan-focus" placeholder="Optional focus for today" value=${focus} onInput=${(e) => setFocus(e.target.value)} />
        ${busy ? html`<button class="btn danger" onClick=${() => ctl.current && ctl.current.abort()}>Stop</button>` : html`<button class="btn" onClick=${draftPlan} disabled=${!aiReady}>Plan with NOVA</button>`}</div>
      ${busy ? html`<div class="typing"><i></i><i></i><i></i><span>Drafting blocks</span></div>` : null}
      ${err ? html`<${Banner} kind="bad">${err}<//>` : null}
      ${plan ? html`<div class="proposal"><p class="hint">Proposed by NOVA. Nothing is added until you approve.</p>
        <ul class="list">${plan.items.map((i) => html`<li key=${i.id}><label class="chk"><input type="checkbox" checked=${i.on} onChange=${() => setPlan((p) => ({ items: p.items.map((x) => (x.id === i.id ? { ...x, on: !x.on } : x)) }))} /><span class="time">${i.start}–${i.end}</span> ${i.title}</label></li>`)}</ul>
        <div class="row"><button class="btn primary" onClick=${approve} disabled=${!plan.items.some((i) => i.on)}>Approve selected</button><button class="btn ghost" onClick=${() => setPlan(null)}>Discard</button></div></div>` : null}
    </div>
  </section>`;
}

function NotesCard() {
  const { notes, setNotes } = useNova();
  const [sel, setSel] = useState(notes[0] ? notes[0].id : null);
  const [q, setQ] = useState('');
  const cur = notes.find((n) => n.id === sel) || null;
  const list = notes.filter((n) => !q || (n.title + ' ' + n.body).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.updated - a.updated);
  const addNote = () => { const n = { id: uid(), title: 'Untitled note', body: '', updated: Date.now() }; setNotes((ns) => [n, ...ns]); setSel(n.id); };
  const edit = (patch) => setNotes((ns) => ns.map((n) => (n.id === sel ? { ...n, ...patch, updated: Date.now() } : n)));
  const del = () => { setNotes((ns) => ns.filter((n) => n.id !== sel)); setSel(null); };
  return html`<section class="panel pad wide">
    <div class="card-head"><h3>Notes</h3><button class="btn" onClick=${addNote}>+ New note</button></div>
    <div class="notes">
      <div class="nlist">
        <input id="note-search" placeholder="Search notes" value=${q} onInput=${(e) => setQ(e.target.value)} />
        ${list.length === 0 ? html`<p class="dim empty-line">${notes.length ? 'No notes match.' : 'No notes yet.'}</p>` : html`<ul class="list">${list.map((n) => html`<li key=${n.id} class=${n.id === sel ? 'on' : ''}><button class="sess" onClick=${() => setSel(n.id)}><b>${n.title || 'Untitled note'}</b><small>${clip(n.body.replace(/\s+/g, ' '), 46) || 'Empty'}</small></button></li>`)}</ul>`}
      </div>
      <div class="neditor">${cur ? html`
        <input id="note-title" class="ntitle" value=${cur.title} onInput=${(e) => edit({ title: e.target.value })} aria-label="Note title" />
        <textarea id="note-body" rows="9" value=${cur.body} placeholder="Write here. Notes are saved in this browser." onInput=${(e) => edit({ body: e.target.value })}></textarea>
        <div class="row"><small class="dim">Saved ${fmtTime(cur.updated)}</small><${Confirm} label="Delete note" confirmLabel="Delete it" onConfirm=${del} /></div>`
        : html`<p class="dim empty-line">Select a note or create a new one.</p>`}</div>
    </div>
  </section>`;
}

function PlannerPanel() {
  const { storageOk } = useNova();
  return html`<div class="planner">
    <div class="pagehead"><h2>Personal planner</h2><p class="dim">${storageOk ? 'Tasks, schedule and notes are saved in this browser only. They do not sync to other devices.' : 'Browser storage is unavailable here, so planner data lasts until you close this tab.'}</p></div>
    <div class="grid2"><${TasksCard} /><${ScheduleCard} /></div>
    <${NotesCard} />
  </div>`;
}
