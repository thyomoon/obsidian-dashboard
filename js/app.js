// 화면. 데이터는 전부 구글 드라이브의 볼트 파일에서 오고, 고친 것은 바로 그 파일에 쓴다.
(function () {
  'use strict';
  const C = window.CONFIG;
  const $ = (s) => document.querySelector(s);
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const EDITABLE = ['내 한 줄', '오늘의 일기'];
  const ICON = {
    out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>'
  };

  const S = {
    today: '', folders: null,
    logs: [],          // [{id, name, date, modifiedTime}] 날짜 내림차순
    meetings: [],      // [{id, name, title, date, modifiedTime, meeting: true}] Meetings 폴더의 미팅 노트
    files: {},         // id → {text, modifiedTime, parsed}
    showDone: false, kind: 'todo', tab: 'home',
    openDate: null, showList: false, selDate: null, month: null,
    todayEvents: null, monthEvents: null, eventsError: false,
    busy: new Set(), drafts: {}, base: {}, saveLabel: '', lastLoad: 0, editItem: null, editWhere: null
  };

  // ---------- 날짜 (샌프란시스코 현지 시각) ----------
  function laParts(d) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: C.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = {};
    f.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
    return p;
  }
  const dateKey = (d) => { const p = laParts(d); return p.year + '-' + p.month + '-' + p.day; };
  const timeHM = (d) => { const p = laParts(d); return p.hour + ':' + p.minute; };
  const stamp = () => dateKey(new Date()) + 'T' + timeHM(new Date());
  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }
  function weekday(key) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  const md = (key) => key.slice(5).replace('-', '/');
  const kor = (key) => Number(key.slice(5, 7)) + '월 ' + Number(key.slice(8)) + '일 ' + WD[weekday(key)] + '요일';

  // ---------- 공통 ----------
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const show = (s) => MD.inlineHtml(s);
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function setStatus(kind, text) {
    const s = $('#status');
    s.className = 'status ' + kind;
    $('#status-text').textContent = text;
  }
  function fail(err) {
    console.error(err);
    if (err instanceof G.AuthError) { showLogin(err.message); return; }
    toast(err.message || String(err));
    setStatus('err', '문제 생김');
  }
  const logByDate = (d) => S.logs.find((l) => l.date === d) || null;
  const parsedOf = (l) => (l && S.files[l.id] ? S.files[l.id].parsed : null);
  function obsidianUrl(date, path) {
    const file = C.VAULT_PATH.slice(1).concat(path || C.LOG_PATH).join('/') + '/' + date;
    return 'obsidian://open?vault=' + encodeURIComponent(C.OBSIDIAN_VAULT) + '&file=' + encodeURIComponent(file);
  }

  // ---------- 캐시: 바뀌지 않은 파일은 다시 받지 않는다 ----------
  const CACHE = 'od.cache';
  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE)) || {}; } catch (e) { return {}; } }
  function saveCache() {
    const c = {};
    Object.keys(S.files).forEach((id) => { c[id] = { text: S.files[id].text, modifiedTime: S.files[id].modifiedTime }; });
    try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (e) { /* 용량이 차도 동작은 한다 */ }
  }
  function putFile(id, text, modifiedTime) {
    S.files[id] = { text, modifiedTime, parsed: MD.parseLog(text), fm: MD.frontmatter(text) };
    const l = S.logs.find((x) => x.id === id) || S.meetings.find((x) => x.id === id);
    if (l) l.modifiedTime = modifiedTime;
  }

  // ---------- 불러오기 ----------
  async function loadVault() {
    setStatus('', '불러오는 중');
    try { S.folders = await G.findLogFolder(); }
    catch (e) {
      if (e instanceof G.AuthError) throw e;
      G.forgetFolders(); S.folders = await G.findLogFolder();
    }
    const logs = (await G.listLogs()).sort((a, b) => (a.date < b.date ? 1 : -1));
    const meetings = (await G.listMeetings()).sort((a, b) => (a.name < b.name ? 1 : -1));
    const cache = loadCache();
    await Promise.all(logs.concat(meetings).map(async (l) => {
      const have = S.files[l.id] || cache[l.id];
      if (have && have.modifiedTime === l.modifiedTime) { putFile(l.id, have.text, l.modifiedTime); return; }
      putFile(l.id, await G.readText(l.id), l.modifiedTime);
    }));
    S.logs = logs;
    S.meetings = meetings;
    Object.keys(S.files).forEach((id) => { if (!logs.some((l) => l.id === id) && !meetings.some((m) => m.id === id)) delete S.files[id]; });
    saveCache();
    S.lastLoad = Date.now();
    setStatus('ok', '구글 드라이브 연결됨');
  }

  async function loadEvents() {
    const t = S.today;
    const [y, m] = S.month;
    const mStart = y + '-' + String(m).padStart(2, '0') + '-01';
    const mEnd = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
    try {
      const [day, month] = await Promise.all([
        G.events(laMidnightISO(t), laMidnightISO(addDays(t, 2))),
        G.events(laMidnightISO(addDays(mStart, -1)), laMidnightISO(addDays(mEnd, 1)))
      ]);
      S.todayEvents = day; S.monthEvents = month; S.eventsError = false;
    } catch (e) {
      if (e instanceof G.AuthError) throw e;
      console.error(e); S.eventsError = true;
    }
  }

  // LA 자정의 ISO 시각(서머타임 반영): 그날 정오의 오프셋을 써서 계산한다.
  function laMidnightISO(key) {
    const [y, m, d] = key.split('-').map(Number);
    const noon = new Date(Date.UTC(y, m - 1, d, 12));
    const p = laParts(noon);
    const offsetH = 12 - Number(p.hour);
    return new Date(Date.UTC(y, m - 1, d, offsetH)).toISOString();
  }

  function eventDays(e) {
    if (e.allDay) {
      const out = [];
      for (let k = e.start; k < (e.end || addDays(e.start, 1)); k = addDays(k, 1)) out.push(k);
      return out;
    }
    return [dateKey(new Date(e.start))];
  }
  function eventsOn(list, key) { return (list || []).filter((e) => eventDays(e).includes(key)); }

  // ---------- 쓰기 ----------
  // 늘 최신 파일을 받아서 고친 다음 올린다(다른 기기에서 고친 내용을 덮어쓰지 않게).
  // mine: Taylor가 글을 쓴 변경(더하기 · 고치기 · 칸 쓰기)이면 author에 Taylor를 더한다. 체크 · 지우기는 아니다.
  async function mutate(id, fn, mine) {
    const fresh = await G.readText(id);
    let next = MD.touchModified(fn(fresh), stamp());
    if (mine) next = MD.addAuthor(next, 'Taylor');
    const res = await G.writeText(id, next);
    putFile(id, next, res.modifiedTime);
    saveCache();
  }

  let creating = null;
  async function ensureToday() {
    const have = logByDate(S.today);
    if (have) return have.id;
    if (creating) return creating;
    creating = (async () => {
      // 그사이 옵시디언이나 Claude가 만들었을 수 있어서 목록을 다시 본다.
      const now = (await G.listLogs()).find((l) => l.date === S.today);
      if (now) {
        putFile(now.id, await G.readText(now.id), now.modifiedTime);
        S.logs.unshift(now);
        return now.id;
      }
      const tpl = await G.readText(S.folders.template);
      const text = MD.fillTemplate(tpl, S.today, timeHM(new Date()));
      const f = await G.createLog(S.today + '.md', text);
      const l = { id: f.id, name: f.name, date: S.today, modifiedTime: f.modifiedTime };
      S.logs.unshift(l);
      putFile(f.id, text, f.modifiedTime);
      saveCache();
      return f.id;
    })();
    try { return await creating; } finally { creating = null; }
  }

  // 「남은 일」의 할 일을 체크하면 오늘 로그 「한 일」로 옮긴다(지난 날짜면 「(MM/DD 남은 일)」을 붙여서).
  // 「한 일」의 끝낸 할 일을 풀면 원래 날짜의 「남은 일」로 돌려보낸다. 다른 칸의 체크박스는 그 자리에서 체크만.
  async function toggle(logId, line) {
    const p = S.files[logId] && S.files[logId].parsed;
    const task = p && p.tasks.find((t) => t.line === line);
    if (!task) return;
    const key = logId + ':' + line;
    S.busy.add(key); renderTodos(); renderLogs();
    try {
      if (!task.done && task.section === '남은 일') await completeTask(logId, task);
      else if (task.done && task.section === '한 일') await reopenTask(logId, task);
      else await mutate(logId, (text) => MD.toggleTask(text, task));
    }
    catch (e) { fail(e); }
    finally { S.busy.delete(key); renderAll(); }
  }

  const DONE_BEFORE = ['내가 내린 결정', '남은 일', '새로운 아이디어', '오늘의 일기'];

  // 다른 파일로 옮길 때는 먼저 더하고 그다음 뺀다 — 중간에 실패해도 할 일이 사라지지 않게(겹칠 수는 있다).
  async function moveTask(fromId, task, toId, sec, line, before) {
    if (fromId === toId) return mutate(fromId, (t) => MD.appendToSection(MD.editBullet(t, task, null), sec, line, before), true);
    await mutate(toId, (t) => MD.appendToSection(t, sec, line, before), true);
    await mutate(fromId, (t) => MD.editBullet(t, task, null));
  }

  async function completeTask(logId, task) {
    const from = S.logs.find((l) => l.id === logId);
    const toId = await ensureToday();
    const tag = from.date === S.today ? '' : ' (' + md(from.date) + ' 남은 일)';
    await moveTask(logId, task, toId, '한 일', '- [x] ' + task.text + tag, DONE_BEFORE);
    toast('오늘 「한 일」로 옮겼어요.');
  }

  async function reopenTask(logId, task) {
    const here = S.logs.find((l) => l.id === logId);
    const o = MD.splitOrigin(task.text);
    let date = here.date;
    if (o.md) {
      date = here.date.slice(0, 4) + '-' + o.md.replace('/', '-');
      if (date > here.date) date = (Number(here.date.slice(0, 4)) - 1) + date.slice(4);
    }
    const target = logByDate(date);
    await moveTask(logId, task, target ? target.id : logId, '남은 일', '- [ ] ' + o.text, LISTS['남은 일'].before);
    toast(md(target ? date : here.date) + ' 「남은 일」로 돌려보냈어요.');
  }

  // 로그 상세에서 고치고 지우고 더할 수 있는 목록 칸. before: 칸이 없을 때 그 앞에 만든다.
  const LISTS = {
    '남은 일': { word: '할 일', line: (v) => '- [ ] ' + v, before: ['새로운 아이디어', '오늘의 일기'] },
    '새로운 아이디어': { word: '아이디어', line: (v) => '- ' + v, before: ['오늘의 일기'] }
  };

  function itemRef(key) {
    const i = key.lastIndexOf(':');
    const id = key.slice(0, i);
    const line = Number(key.slice(i + 1));
    const p = S.files[id] && S.files[id].parsed;
    if (!p) return null;
    for (const sec of p.sections) {
      const it = sec.items.find((x) => x.line === line);
      if (it) return { id, it, word: it.kind === 'task' ? '할 일' : (LISTS[sec.name] ? LISTS[sec.name].word : '항목') };
    }
    return null;
  }

  // newText가 null이면 지운다.
  async function changeItem(key, newText) {
    const r = itemRef(key);
    S.editItem = null;
    if (!r) { renderLogs(); return; }
    S.busy.add(key); renderTodos(); renderLogs();
    try {
      await mutate(r.id, (t) => MD.editBullet(t, r.it, newText), newText != null);
      toast(r.word + (newText == null ? '을 지웠어요.' : '을 고쳤어요.'));
    } catch (e) { fail(e); }
    finally { S.busy.delete(key); renderAll(); }
  }

  async function quickAdd(value) {
    const v = value.replace(/\s+/g, ' ').trim();
    if (!v) return false;
    try {
      const id = await ensureToday();
      const sec = S.kind === 'todo' ? '남은 일' : '새로운 아이디어';
      await mutate(id, (t) => MD.appendToSection(t, sec, LISTS[sec].line(v), LISTS[sec].before), true);
      toast(S.kind === 'todo' ? '오늘 로그 「남은 일」에 넣었어요.' : '오늘 로그 「새로운 아이디어」에 넣었어요.');
      renderAll();
      return true;
    } catch (e) { fail(e); return false; }
  }

  // 오늘 로그의 내 한 줄 · 오늘의 일기: 쓰다가 1.2초 멈추면 저장.
  const timers = {};
  function onField(name, value) {
    S.drafts[name] = value;
    setSave('입력 중');
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => saveField(name), 1200);
  }
  let saving = Promise.resolve();
  function saveField(name) {
    saving = saving.then(() => doSaveField(name)).catch(fail);
    return saving;
  }
  async function doSaveField(name) {
    if (!(name in S.drafts)) return;
    const value = S.drafts[name];
    setSave('저장 중…');
    const id = await ensureToday();
    const fresh = await G.readText(id);
    const remote = MD.getSectionText(fresh, name);
    const base = name in S.base ? S.base[name] : MD.getSectionText(S.files[id].text, name);
    if (remote !== base && remote !== value.trim()) {
      setSave('저장 안 함');
      toast('「' + name + '」 칸이 다른 곳에서 바뀌었어요. 덮어쓰지 않았어요 — 쓴 내용을 복사해 두고 새로고침해 주세요.');
      return;
    }
    const before = name === '내 한 줄' ? ['한 줄 요약', '한 일', '남은 일'] : [];
    const next = MD.addAuthor(MD.touchModified(MD.setSectionText(fresh, name, value, before), stamp()), 'Taylor');
    const res = await G.writeText(id, next);
    putFile(id, next, res.modifiedTime);
    saveCache();
    S.base[name] = MD.getSectionText(next, name);
    if (S.drafts[name] === value) delete S.drafts[name];
    setSave('저장됨 · ' + timeHM(new Date()));
    renderTodos(); renderCalendar();
  }
  function flushFields() { Object.keys(timers).forEach((n) => { clearTimeout(timers[n]); if (n in S.drafts) saveField(n); }); return saving; }
  function setSave(t) { S.saveLabel = t; const el = $('#save-label'); if (el) el.textContent = t; }

  // ---------- 그리기 ----------
  // 데일리 로그와 미팅 노트의 체크박스를 날짜 내림차순으로. 미팅 할 일은 그 노트 안에서 체크된다(toggle의 else).
  function allTasks() {
    const out = [];
    S.logs.concat(S.meetings)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .forEach((l) => {
        const p = parsedOf(l);
        if (p) p.tasks.forEach((t) => out.push({ log: l, t }));
      });
    return out;
  }

  // 미팅의 날짜 · 시각은 meeting_at이 먼저, 없으면 파일 이름(YYYY-MM-DD HHmm_주제)에서.
  function meetingInfo(m) {
    const fm = (S.files[m.id] && S.files[m.id].fm) || {};
    const at = typeof fm.meeting_at === 'string' ? fm.meeting_at.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/) : null;
    const nm = m.title.match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2})(\d{2}))?_?\s*(.*)$/);
    const p = parsedOf(m);
    return {
      date: at ? at[1] : m.date,
      time: at && at[2] ? at[2] : nm && nm[2] ? nm[2] + ':' + nm[3] : '',
      topic: (nm && nm[4]) || m.title,
      who: Array.isArray(fm.attendees) ? fm.attendees : [],
      open: p ? p.tasks.filter((t) => !t.done).length : 0
    };
  }
  const meetingsOn = (date) => S.meetings.map((m) => Object.assign({ m }, meetingInfo(m))).filter((x) => x.date === date)
    .sort((a, b) => (a.time < b.time ? -1 : 1));

  function sourceChip(log) {
    if (log.meeting) {
      return '<a class="chip meet" href="' + h(obsidianUrl(log.title, C.MEETINGS_PATH)) + '" title="' + h(log.title) + ' — 옵시디언에서 열기">미팅' +
        (log.date ? ' ' + md(log.date) : '') + ICON.out + '</a>';
    }
    return '<button type="button" class="chip' + (log.date === S.today ? ' today' : '') + '" data-open="' + log.date + '" title="' + h(log.date) + ' 데일리 로그 보기">' + md(log.date) + ICON.out + '</button>';
  }

  function renderHeader() {
    $('#eyebrow').textContent = '옵시디언 대시보드 · ' + S.today.replace(/-/g, ' · ');
    $('#today-title').textContent = kor(S.today);
    document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === S.kind)));
    const narrow = window.matchMedia('(max-width: 760px)').matches;
    $('#quick-input').placeholder = S.kind === 'todo'
      ? (narrow ? '할 일 한 줄' : '할 일 한 줄 — 엔터로 오늘 로그 「남은 일」에 추가')
      : (narrow ? '아이디어 한 줄' : '아이디어 한 줄 — 엔터로 오늘 로그 「새로운 아이디어」에 추가');
    document.body.dataset.tab = S.tab;
    document.querySelectorAll('[data-tab-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tabBtn === S.tab)));
  }

  function renderTodos() {
    const all = allTasks();
    const open = all.filter((x) => !x.t.done);
    const list = S.showDone ? all : open;
    const rows = list.map(({ log, t }) => {
      const key = log.id + ':' + t.line;
      if (S.editItem === key && S.editWhere === 'todos') return '<div class="todo editing">' + editFormHtml(key, t.text, '할 일') + '</div>';
      return '<div class="todo' + (t.done ? ' done' : '') + (S.busy.has(key) ? ' busy' : '') + '">' +
        '<label><input type="checkbox" data-toggle="' + h(log.id) + '" data-line="' + t.line + '"' + (t.done ? ' checked' : '') + (S.busy.has(key) ? ' disabled' : '') + '>' +
        '<span class="txt" style="padding-left:' + Math.min(t.indent, 8) * 4 + 'px">' + show(t.text) + (t.by === 'claude' ? ' <span class="who">Claude</span>' : '') + '</span></label>' +
        itemButtons(key, '할 일') +
        sourceChip(log) +
        '</div>';
    }).join('');
    $('#todos').innerHTML =
      '<div class="card-head"><h2 id="todos-h">할 일</h2>' +
      '<div class="seg small" role="group" aria-label="보기">' +
      '<button type="button" data-done="0" aria-pressed="' + !S.showDone + '">안 한 것 ' + open.length + '</button>' +
      '<button type="button" data-done="1" aria-pressed="' + S.showDone + '">완료 포함 ' + all.length + '</button></div></div>' +
      '<div class="todo-list">' + (rows || '<div class="empty">' + (S.showDone ? '할 일이 없어요.' : '안 한 할 일이 없어요.') + '</div>') + '</div>';
  }

  function evTime(e) {
    if (e.allDay) return '종일';
    const s = timeHM(new Date(e.start));
    return e.end ? s + ' – ' + timeHM(new Date(e.end)) : s;
  }
  function renderEvents() {
    let body;
    if (S.eventsError) body = '<div class="empty">캘린더를 불러오지 못했어요.</div>';
    else if (!S.todayEvents) body = '<div class="empty">불러오는 중…</div>';
    else {
      const today = eventsOn(S.todayEvents, S.today);
      const tmr = eventsOn(S.todayEvents, addDays(S.today, 1));
      body = (today.length ? today.map((e) =>
        '<div class="ev"><div class="bar"' + (e.color ? ' style="background:' + h(e.color) + '"' : '') + '></div><div><div class="time">' + evTime(e) + '</div><div class="title">' + h(e.title) + '</div></div></div>').join('')
        : '<div class="empty">오늘 일정이 없어요.</div>') +
        '<div class="ev-foot">내일 · ' + (tmr.length ? h(tmr[0].title) + (tmr.length > 1 ? ' 외 ' + (tmr.length - 1) + '개' : '') : '일정 없음') + '</div>';
    }
    $('#events').innerHTML = '<div class="card-head"><h2 id="events-h">오늘 일정</h2><span class="sub">구글 캘린더</span></div>' + body;
  }

  // 기본은 로그 한 장(열어 둔 날, 없으면 오늘). 「전체 로그」를 누르면 있는 로그 전부를 날짜 내림차순 목록으로.
  function renderLogs() {
    const el = $('#logs');
    if (!S.showList) { el.innerHTML = detailHtml(S.openDate || S.today); return; }
    const rows = [];
    const dates = S.logs.map((l) => l.date);
    if (!dates.includes(S.today)) dates.unshift(S.today);
    for (const d of dates) {
      const l = logByDate(d);
      const p = parsedOf(l);
      const isToday = d === S.today;
      const openN = p ? p.tasks.filter((t) => !t.done).length : 0;
      const ideaN = p ? p.ideas.length : 0;
      let line = p && p.oneLine ? p.oneLine.split('\n')[0] : '';
      let dim = false;
      if (!line && p && p.summary) { line = '요약 · ' + p.summary.split('\n')[0]; dim = true; }
      if (!line) { line = isToday ? '아직 안 씀 · 눌러서 쓰기' : '내 한 줄 없음'; dim = true; }
      rows.push('<button type="button" class="log-row' + (isToday ? ' today' : '') + '" data-open="' + d + '">' +
        '<span class="when"><b>' + md(d) + '</b><span>' + (isToday ? '오늘' : WD[weekday(d)]) + '</span></span>' +
        '<span class="line' + (dim ? ' dim' : '') + '">' + show(line) + '</span>' +
        '<span class="badges"><span class="badge' + (openN ? '' : ' zero') + '">할 일 ' + openN + '</span><span class="badge idea' + (ideaN ? '' : ' zero') + '">아이디어 ' + ideaN + '</span></span>' +
        ICON.right + '</button>');
    }
    el.innerHTML = '<div class="card-head"><h2 id="logs-h">데일리 로그 · 전체 ' + S.logs.length + '개</h2>' +
      '<button type="button" class="btn" data-open="' + S.today + '">오늘 로그</button></div><div>' + rows.join('') + '</div>';
  }

  function detailHtml(date) {
    const l = logByDate(date);
    const p = parsedOf(l);
    const isToday = date === S.today;
    let secs = p ? p.sections.slice() : [];
    if (isToday && !p) secs = ['내 한 줄', '남은 일', '새로운 아이디어', '오늘의 일기'].map((name) => ({ name, text: '', isList: false, items: [] }));
    if (isToday) EDITABLE.forEach((n) => { if (!secs.some((s) => s.name === n)) secs.push({ name: n, text: '', isList: false, items: [] }); });
    const body = secs.map((s) => secHtml(s, l, isToday)).filter(Boolean).join('');
    return '<div class="detail">' +
      '<div class="detail-top"><span class="nav"><button type="button" class="btn" data-back>' + ICON.left + '전체 로그</button>' +
      (isToday ? '' : '<button type="button" class="btn" data-open="' + S.today + '">오늘</button>') + '</span>' +
      '<div class="meta">' + (isToday ? '<span id="save-label">' + h(S.saveLabel || (l ? '' : '아직 파일 없음')) + '</span>' : '') +
      (l ? '<a href="' + h(obsidianUrl(date)) + '">옵시디언에서 열기</a>' : '') + '</div></div>' +
      '<h2 class="big" id="logs-h">' + kor(date) + (isToday ? ' · 오늘' : '') + '</h2>' +
      (isToday && !l ? '<div class="notice">오늘 로그가 아직 없어요. 첫 글자를 쓰면 양식으로 ' + S.today + '.md를 만들어요.</div>' : '') +
      (!p && !isToday ? '<div class="empty">이 날은 데일리 로그가 없어요.</div>' : '') +
      body + '</div>';
  }

  // 로그에서 쓰는 칸은 오늘의 「내 한 줄」 · 「오늘의 일기」뿐. 할 일 · 아이디어는 위 빠른 입력으로만 더하고,
  // 할 일 고치기 · 지우기는 할 일 카드에서 한다(여기서는 체크만). 아이디어는 다른 데 보이지 않아 여기서 고치고 지운다.
  const KEEP_EMPTY = ['남은 일', '새로운 아이디어'];
  function secHtml(s, l, isToday) {
    const head = '<h3>' + h(s.name) + '</h3>';
    if (s.name === '새로운 아이디어' && s.isList && l) return listSecHtml(s, l);
    if (isToday && EDITABLE.includes(s.name)) {
      const v = s.name in S.drafts ? S.drafts[s.name] : s.text;
      if (!(s.name in S.base)) S.base[s.name] = s.text;
      const id = 'f-' + (s.name === '내 한 줄' ? 'oneline' : 'diary');
      const input = s.name === '내 한 줄'
        ? '<input class="field" id="' + id + '" type="text" data-field="내 한 줄" value="' + h(v) + '" placeholder="오늘을 한 줄로">'
        : '<textarea class="field" id="' + id + '" data-field="오늘의 일기" placeholder="있었던 일, 만난 사람, 든 생각">' + h(v) + '</textarea>';
      return '<div class="sec"><label for="' + id + '"><h3>' + h(s.name) + '</h3></label>' + input + '</div>';
    }
    if (!s.text) {
      if (!KEEP_EMPTY.includes(s.name)) return '';
      const hint = isToday ? (s.name === '남은 일' ? '위 입력칸에서 「할 일」로 쓰면 여기에 들어가요.' : '위 입력칸에서 「아이디어」로 쓰면 여기에 들어가요.') : '비어 있음';
      return '<div class="sec">' + head + '<div class="hint">' + hint + '</div></div>';
    }
    if (!s.isList) {
      const parts = (s.parts && s.parts.length ? s.parts : [{ text: s.text }]).map((pt) =>
        (pt.by === 'claude' ? byClaude(pt) : '') + '<p' + (pt.by === 'claude' ? ' class="claude"' : '') + '>' + show(pt.text) + '</p>').join('');
      return '<div class="sec">' + head + parts + '</div>';
    }
    const items = s.items.map((it) => {
      const pad = ' style="padding-left:' + it.depth * 20 + 'px"';
      if (it.kind === 'callout') return it.type === 'claude' ? byClaude(it) : '';
      if (it.kind === 'task') return taskHtml(it, l);
      return '<div class="li"' + pad + '><span class="b">·</span><span>' + show(it.text) + '</span></div>';
    }).join('');
    return '<div class="sec">' + head + '<div>' + items + '</div></div>';
  }

  const byClaude = (it) => '<div class="by-claude">Claude가 씀' + (it.title ? ' · ' + h(it.title) : '') + '</div>';

  function taskHtml(it, l) {
    const pad = ' style="padding-left:' + it.depth * 20 + 'px"';
    const busy = S.busy.has(l.id + ':' + it.line);
    return '<label class="tk' + (it.done ? ' done' : '') + '"' + pad + '><input type="checkbox" data-toggle="' + h(l.id) + '" data-line="' + it.line + '"' + (it.done ? ' checked' : '') + (busy ? ' disabled' : '') + '><span>' + show(it.text) + '</span></label>';
  }

  // 고치기 · 지우기 버튼과 고치는 입력칸(할 일 목록과 로그 상세가 같이 쓴다).
  function itemButtons(key, word) {
    return '<button type="button" class="icon-btn sm" data-item-edit="' + h(key) + '" aria-label="이 ' + word + ' 고치기">' + ICON.edit + '</button>' +
      '<button type="button" class="icon-btn sm" data-item-del="' + h(key) + '" aria-label="이 ' + word + ' 지우기">' + ICON.trash + '</button>';
  }
  function editFormHtml(key, text, word, pad) {
    return '<form class="item-edit" data-item-save="' + h(key) + '"' + (pad || '') + '><label for="item-edit-input" class="sr-only">' + word + ' 고치기</label>' +
      '<input class="field" id="item-edit-input" type="text" value="' + h(text) + '" data-item-input enterkeyhint="done">' +
      '<button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-item-cancel>취소</button></form>';
  }

  // 새로운 아이디어: 어느 날짜든 고치기 · 지우기.
  function listSecHtml(s, l) {
    const L = LISTS[s.name];
    const isIdea = s.name === '새로운 아이디어';
    const rows = (s.isList ? s.items : []).map((it) => {
      if (it.kind === 'callout') return it.type === 'claude' ? byClaude(it) : '';
      const key = l.id + ':' + it.line;
      const pad = it.depth ? ' style="margin-left:' + it.depth * 20 + 'px"' : '';
      if (S.editItem === key && S.editWhere === 'logs') return editFormHtml(key, it.text, L.word, pad);
      const buttons = itemButtons(key, L.word);
      const busy = S.busy.has(key);
      if (it.kind === 'task') {
        return '<div class="tk-row' + (busy ? ' busy' : '') + '"' + pad + '><label class="tk' + (it.done ? ' done' : '') + '">' +
          '<input type="checkbox" data-toggle="' + h(l.id) + '" data-line="' + it.line + '"' + (it.done ? ' checked' : '') + (busy ? ' disabled' : '') + '>' +
          '<span>' + show(it.text) + '</span></label>' + buttons + '</div>';
      }
      return '<div class="' + (isIdea ? 'idea-item' : 'tk-row plain') + (busy ? ' busy' : '') + '"' + pad + '><span class="t">' + show(it.text) + '</span>' + buttons + '</div>';
    }).join('');
    return '<div class="sec"><h3>' + h(s.name) + '</h3>' +
      (rows ? '<div class="' + (isIdea ? 'idea-list' : 'tk-list') + '">' + rows + '</div>' : '<div class="hint">아직 없어요.</div>') + '</div>';
  }

  function renderCalendar() {
    const [y, m] = S.month;
    const first = y + '-' + String(m).padStart(2, '0') + '-01';
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = weekday(first);
    const todoDays = new Set(allTasks().filter((x) => !x.t.done).map((x) => x.log.date));
    const meetDays = new Set(S.meetings.map((x) => meetingInfo(x).date));
    const evDays = new Set();
    (S.monthEvents || []).forEach((e) => eventDays(e).forEach((d) => evDays.add(d)));
    let cells = WD.map((w, i) => '<div class="wd' + (i === 0 ? ' sun' : '') + '">' + w + '</div>').join('');
    const total = Math.ceil((lead + days) / 7) * 7;
    for (let i = 0; i < total; i++) {
      const n = i - lead + 1;
      if (n < 1 || n > days) { cells += '<span class="day out" aria-hidden="true"></span>'; continue; }
      const d = y + '-' + String(m).padStart(2, '0') + '-' + String(n).padStart(2, '0');
      const cls = 'day' + (d === S.today ? ' today' : '') + (d === S.selDate && d !== S.today ? ' sel' : '');
      const label = m + '월 ' + n + '일' + (todoDays.has(d) ? ', 안 한 할 일 있음' : '') + (evDays.has(d) ? ', 일정 있음' : '') + (meetDays.has(d) ? ', 미팅 노트 있음' : '');
      cells += '<button type="button" class="' + cls + '" data-day="' + d + '" aria-label="' + label + '">' + n +
        '<span class="marks">' + (todoDays.has(d) ? '<span class="m"></span>' : '') + (evDays.has(d) ? '<span class="m evm"></span>' : '') + (meetDays.has(d) ? '<span class="m mtm"></span>' : '') + '</span></button>';
    }
    const sel = S.selDate;
    let sum = '';
    if (sel) {
      const evs = eventsOn(S.monthEvents, sel);
      const ms = meetingsOn(sel);
      sum = '<div class="day-sum"><div class="hd">' + kor(sel) + '</div>' +
        (evs.length ? evs.map((e) => '<div><span class="mono">' + evTime(e) + '</span> ' + h(e.title) + '</div>').join('') : '<div class="hint">일정 없음</div>') +
        '<div class="hd sub">미팅 노트</div>' +
        (ms.length ? ms.map((x) => '<a class="meet-row" href="' + h(obsidianUrl(x.m.title, C.MEETINGS_PATH)) + '" title="옵시디언에서 열기">' +
          '<span class="mono">' + (x.time || '--:--') + '</span><span class="mt"><b>' + h(x.topic) + '</b>' +
          (x.who.length || x.open ? '<small>' + h(x.who.join(' · ')) + (x.who.length && x.open ? ' · ' : '') + (x.open ? '할 일 ' + x.open : '') + '</small>' : '') +
          '</span>' + ICON.out + '</a>').join('') : '<div class="hint">미팅 노트 없음</div>') +
        '</div>';
    }
    $('#calendar').innerHTML =
      '<div class="card-head"><h2 id="cal-h">' + y + '년 ' + m + '월</h2><div class="cal-nav">' +
      '<button type="button" class="icon-btn" data-month="-1" aria-label="이전 달">' + ICON.left + '</button>' +
      '<button type="button" class="icon-btn" data-month="1" aria-label="다음 달">' + ICON.right + '</button></div></div>' +
      '<div class="cal">' + cells + '</div>' +
      '<div class="legend"><span><i></i>안 한 할 일이 남은 날</span><span><i class="evm"></i>일정</span><span><i class="mtm"></i>미팅 노트</span></div>' + sum;
  }

  function renderAll() { renderHeader(); renderTodos(); renderEvents(); renderLogs(); renderCalendar(); }

  // ---------- 조작 ----------
  function openLog(date) {
    flushFields();
    S.openDate = date; S.showList = false; S.tab = 'log';
    renderHeader(); renderLogs();
    $('#logs').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.kind) { S.kind = t.dataset.kind; renderHeader(); $('#quick-input').focus(); }
      else if (t.dataset.done) { S.showDone = t.dataset.done === '1'; renderTodos(); }
      else if (t.dataset.open) openLog(t.dataset.open);
      else if ('back' in t.dataset) { flushFields(); S.openDate = null; S.showList = true; S.editItem = null; renderTodos(); renderLogs(); }
      else if (t.dataset.itemEdit) {
        S.editItem = t.dataset.itemEdit; S.editWhere = t.closest('#todos') ? 'todos' : 'logs';
        renderTodos(); renderLogs();
        const inp = $('#item-edit-input');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      }
      else if ('itemCancel' in t.dataset) { S.editItem = null; renderTodos(); renderLogs(); }
      else if (t.dataset.itemDel) {
        const r = itemRef(t.dataset.itemDel);
        if (r && window.confirm('이 ' + r.word + '을 지울까요?')) changeItem(t.dataset.itemDel, null);
      }
      else if (t.dataset.tabBtn) { S.tab = t.dataset.tabBtn; if (S.tab !== 'log') { flushFields(); } renderHeader(); window.scrollTo(0, 0); }
      else if (t.dataset.month) {
        const [y, m] = S.month; const n = m + Number(t.dataset.month);
        S.month = n < 1 ? [y - 1, 12] : n > 12 ? [y + 1, 1] : [y, n];
        S.monthEvents = null; renderCalendar();
        loadEvents().then(renderCalendar).catch(fail);
      }
      else if (t.dataset.day) { S.selDate = t.dataset.day; renderCalendar(); }
      else if (t.dataset.action === 'refresh') refresh();
      else if (t.dataset.action === 'logout') { flushFields().then(() => { G.logout(); showLogin('로그아웃했어요.'); }); }
    });
    document.addEventListener('change', (e) => {
      const c = e.target;
      if (c.matches('input[data-toggle]')) toggle(c.dataset.toggle, Number(c.dataset.line));
    });
    document.addEventListener('input', (e) => {
      const f = e.target;
      if (f.dataset && f.dataset.field) onField(f.dataset.field, f.value);
    });
    document.addEventListener('focusout', (e) => {
      const f = e.target;
      if (f.dataset && f.dataset.field && f.dataset.field in S.drafts) { clearTimeout(timers[f.dataset.field]); saveField(f.dataset.field); }
    });
    document.addEventListener('submit', (e) => {
      const f = e.target;
      if (f.dataset.itemSave) {
        e.preventDefault();
        const r = itemRef(f.dataset.itemSave);
        const v = f.querySelector('input').value.replace(/\s+/g, ' ').trim();
        if (!r || v === r.it.text) { S.editItem = null; renderTodos(); renderLogs(); return; }
        if (!v) { if (window.confirm('비워 두면 이 ' + r.word + '을 지워요. 지울까요?')) changeItem(f.dataset.itemSave, null); return; }
        changeItem(f.dataset.itemSave, v);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.matches && e.target.matches('[data-item-input]')) { S.editItem = null; renderTodos(); renderLogs(); }
    });
    $('#quick').addEventListener('submit', async (e) => {
      e.preventDefault();
      const inp = $('#quick-input');
      const v = inp.value;
      inp.disabled = true;
      const done = await quickAdd(v);
      inp.disabled = false;
      if (done) inp.value = '';
      inp.focus();
    });
    // 다른 기기에서 고친 것을 보려고, 화면에 돌아왔을 때 1분이 지났으면 다시 불러온다.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - S.lastLoad > 60000) refresh();
      if (document.visibilityState === 'hidden') flushFields();
    });
    window.addEventListener('pagehide', flushFields);
    $('#login-btn').addEventListener('click', () => G.login());
  }

  async function refresh() {
    await flushFields();
    S.today = dateKey(new Date());
    try {
      await loadVault();
      S.base = {};
      renderAll();
      await loadEvents();
      renderEvents(); renderCalendar();
    } catch (e) { fail(e); }
  }

  function showLogin(msg) {
    $('#app').hidden = true; $('#login').hidden = false;
    if (msg) $('#login-msg').textContent = msg;
  }

  async function start() {
    bind();
    if (/여기에_/.test(C.CLIENT_ID)) {
      showLogin('js/config.js에 구글 OAuth 클라이언트 ID를 넣어 주세요. (README의 1단계)');
      $('#login-btn').disabled = true;
      return;
    }
    try { G.takeTokenFromUrl(); } catch (e) { showLogin(e.message); return; }
    if (!G.token()) { showLogin(); return; }
    $('#login').hidden = true; $('#app').hidden = false;
    S.today = dateKey(new Date());
    S.selDate = S.today;
    S.month = [Number(S.today.slice(0, 4)), Number(S.today.slice(5, 7))];
    renderHeader();
    await refresh();
  }

  start();
})();
