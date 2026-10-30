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
    meetings: [],      // [{id, name, title, date, modifiedTime, meeting: true}] Meetings 폴더의 미팅 미닛
    files: {},         // id → {text, modifiedTime, parsed}
    showDone: false, kind: 'todo', tab: 'home',
    openDate: null, showList: false, selDate: null, month: null,
    todayEvents: null, monthEvents: null, eventsError: false,
    busy: new Set(), drafts: {}, base: {}, saveLabel: '', lastLoad: 0, editItem: null, editWhere: null,
    openMeeting: null, meetFrom: null, meetFilter: 'open', meetEdit: false, newMeeting: null /* {date, where: 'cal' | 'events'} */, mdrafts: {}, mbase: {}
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
    const pid = await G.findPractice(S.folders.vault);
    S.practice = pid ? await G.readText(pid) : null;
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
    '새로운 아이디어': { word: '아이디어', line: (v) => '- ' + v, before: ['오늘의 일기'] },
    'Next Steps': { word: '할 일', line: (v) => '- [ ] ' + v, before: [] }
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
  function flushFields() {
    Object.keys(timers).forEach((n) => { clearTimeout(timers[n]); if (n in S.drafts) saveField(n); });
    Object.keys(mtimers).forEach(saveMeetField);
    return saving;
  }
  function setSave(t) { S.saveLabel = t; const el = $('#save-label'); if (el) el.textContent = t; }

  // ---------- 미팅 노트 ----------
  // 만들기: 파일 이름은 만든 시각(YYYY-MM-DD HHmm_주제), 실제 회의 시각은 meeting_at(작업 규칙 23).
  const MEET_BEFORE = { Summary: ['Takeaways', 'Next Steps'], Takeaways: ['Next Steps'] };
  const fileSafe = (s) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const wiki = (n) => '"[[' + n.replace(/"/g, '') + ']]"';
  const names = (v) => v.split(/[,，]/).map((x) => x.replace(/\[\[|\]\]/g, '').trim()).filter(Boolean);

  async function createMeeting(date, topic, time, who) {
    const t = fileSafe(topic);
    if (!t) { toast('주제를 써 주세요.'); return; }
    if (!S.folders.meetTemplate) throw new Error('드라이브에서 Templates/Meeting Minutes.md를 찾지 못했어요.');
    const now = new Date();
    const name = dateKey(now) + ' ' + timeHM(now).replace(':', '') + '_' + t + '.md';
    let text = MD.fillTemplate(await G.readText(S.folders.meetTemplate), date, time || timeHM(now));
    const ppl = names(who || '');
    if (ppl.length) text = MD.setFrontmatter(text, 'attendees', '[' + ppl.map(wiki).join(', ') + ']');
    const f = await G.createMeeting(name, text);
    S.meetings.unshift({ id: f.id, name, title: name.replace(/\.md$/, ''), date: name.slice(0, 10), modifiedTime: f.modifiedTime, meeting: true });
    putFile(f.id, text, f.modifiedTime);
    saveCache();
    S.newMeeting = null;
    toast('미팅 미닛을 만들었어요.');
    renderEvents(); renderCalendar(); renderMeetings();
    openMeeting(f.id);
  }

  async function addNextStep(id, value) {
    const v = value.replace(/\s+/g, ' ').trim();
    if (!v) return;
    try {
      await mutate(id, (t) => MD.appendToSection(t, 'Next Steps', '- [ ] ' + v, []), true);
      renderAll();
      const inp = $('#meet-add-input');
      if (inp) inp.focus();
    } catch (e) { fail(e); }
  }

  // 미팅 노트 칸(속성 · Summary · Takeaways): 쓰다가 1.2초 멈추면 저장. key = 파일 id|fm 또는 sec|칸 이름
  const mtimers = {};
  function onMeetField(key, value) {
    S.mdrafts[key] = value;
    setSave('입력 중');
    clearTimeout(mtimers[key]);
    mtimers[key] = setTimeout(() => saveMeetField(key), 1200);
  }
  function saveMeetField(key) {
    clearTimeout(mtimers[key]); delete mtimers[key];
    saving = saving.then(() => doSaveMeetField(key)).catch(fail);
    return saving;
  }
  function fmValue(name, v) {
    v = v.trim();
    if (name === 'attendees' || name === 'related') { const p = names(v); return p.length ? '[' + p.map(wiki).join(', ') + ']' : '[]'; }
    if (name === 'project') { const p = names(v); return p.length > 1 ? '[' + p.map(wiki).join(', ') + ']' : p.length ? wiki(p[0]) : ''; }
    return v;
  }
  async function doSaveMeetField(key) {
    if (!(key in S.mdrafts)) return;
    const value = S.mdrafts[key];
    const [id, kind, name] = key.split('|');
    setSave('저장 중…');
    const fresh = await G.readText(id);
    let next;
    if (kind === 'sec') {
      const remote = MD.getSectionText(fresh, name);
      const base = key in S.mbase ? S.mbase[key] : MD.getSectionText(S.files[id].text, name);
      if (remote !== base && remote !== value.trim()) {
        setSave('저장 안 함');
        toast('「' + name + '」 칸이 다른 곳에서 바뀌었어요. 덮어쓰지 않았어요 — 쓴 내용을 복사해 두고 새로고침해 주세요.');
        return;
      }
      next = MD.setSectionText(fresh, name, value, MEET_BEFORE[name] || []);
    } else next = MD.setFrontmatter(fresh, name, fmValue(name, value));
    next = MD.addAuthor(MD.touchModified(next, stamp()), 'Taylor');
    const res = await G.writeText(id, next);
    putFile(id, next, res.modifiedTime);
    saveCache();
    if (kind === 'sec') S.mbase[key] = MD.getSectionText(next, name);
    if (S.mdrafts[key] === value) delete S.mdrafts[key];
    setSave('저장됨 · ' + timeHM(new Date()));
    renderTodos(); renderCalendar(); renderMeetings();
  }

  function openMeeting(id) {
    flushFields();
    if (!S.openMeeting) S.meetFrom = S.tab;
    S.openMeeting = id; S.meetEdit = false; S.editItem = null; S.saveLabel = ''; S.tab = 'log';
    renderHeader(); renderLogs();
    $('#logs').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function closeMeeting() {
    flushFields();
    S.tab = S.meetFrom || 'log';
    S.openMeeting = null; S.meetFrom = null; S.editItem = null; S.saveLabel = '';
    renderHeader(); renderLogs();
  }

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
      return '<button type="button" class="chip meet" data-meeting="' + h(log.id) + '" title="' + h(log.title) + ' 미팅 미닛 보기">미팅' +
        (log.date ? ' ' + md(log.date) : '') + ICON.out + '</button>';
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

  // 데일리 로그 「새로운 아이디어」의 불릿을 날짜 내림차순으로.
  function allIdeas() {
    const out = [];
    S.logs.forEach((l) => {
      const p = parsedOf(l);
      const sec = p && p.sections.find((s) => s.name === '새로운 아이디어');
      if (sec) sec.items.filter((it) => it.kind === 'bullet' && it.text.trim()).forEach((it) => out.push({ log: l, it }));
    });
    return out;
  }

  // 위 토글이 「아이디어」면 같은 카드에 아이디어 목록을 보인다(고치기 · 지우기).
  function renderIdeas() {
    const all = allIdeas();
    const rows = all.map(({ log, it }) => {
      const key = log.id + ':' + it.line;
      if (S.editItem === key && S.editWhere === 'todos') return '<div class="todo editing">' + editFormHtml(key, it.text, '아이디어') + '</div>';
      return '<div class="todo idea' + (S.busy.has(key) ? ' busy' : '') + '">' +
        '<span class="txt" style="padding-left:' + Math.min(it.depth, 4) * 16 + 'px">' + show(it.text) + '</span>' +
        itemButtons(key, '아이디어') + sourceChip(log) + '</div>';
    }).join('');
    $('#todos').innerHTML =
      '<div class="card-head"><h2 id="todos-h">아이디어</h2><span class="sub">전체 ' + all.length + '개</span></div>' +
      '<div class="todo-list">' + (rows || '<div class="empty">아직 아이디어가 없어요.</div>') + '</div>';
  }

  function renderTodos() {
    if (S.kind === 'idea') return renderIdeas();
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
  // 일정에 맞는 미팅 노트: 같은 날이고, 주제가 일정 제목과 같거나 시작 시각이 같으면 그 노트로 본다.
  function noteForEvent(e) {
    const t = e.allDay ? '' : timeHM(new Date(e.start));
    const topic = fileSafe(e.title);
    const hit = meetingsOn(S.today).find((x) => x.topic === topic || (t && x.time === t));
    return hit ? hit.m : null;
  }
  function eventNoteButton(e, i) {
    const m = noteForEvent(e);
    return m
      ? '<button type="button" class="btn sm ev-note has" data-meeting="' + h(m.id) + '">노트 열기</button>'
      : '<button type="button" class="btn sm ev-note" data-event-note="' + i + '" aria-label="' + h(e.title) + ' 미팅 미닛 만들기">+ 노트</button>';
  }

  function renderEvents() {
    let body;
    if (S.eventsError) body = '<div class="empty">캘린더를 불러오지 못했어요.</div>';
    else if (!S.todayEvents) body = '<div class="empty">불러오는 중…</div>';
    else {
      const today = eventsOn(S.todayEvents, S.today);
      const tmr = eventsOn(S.todayEvents, addDays(S.today, 1));
      const canMeet = !!(S.folders && S.folders.meetings);
      body = (today.length ? today.map((e, i) => {
        const note = canMeet ? eventNoteButton(e, i) : '';
        return '<div class="ev"><div class="bar"' + (e.color ? ' style="background:' + h(e.color) + '"' : '') + '></div><div class="ev-body"><div class="time">' + evTime(e) + '</div><div class="title">' + h(e.title) + '</div></div>' + note + '</div>';
      }).join('') : '<div class="empty">오늘 일정이 없어요.</div>') +
        (!canMeet ? '' : S.newMeeting && S.newMeeting.where === 'events' ? '<div class="ev-new">' + newMeetingForm(S.today) + '</div>' :
          '<button type="button" class="btn ev-add" data-new-meeting="' + S.today + '">+ 일정에 없는 미팅 미닛</button>') +
        '<div class="ev-foot">내일 · ' + (tmr.length ? h(tmr[0].title) + (tmr.length > 1 ? ' 외 ' + (tmr.length - 1) + '개' : '') : '일정 없음') + '</div>';
    }
    $('#events').innerHTML = '<div class="card-head"><h2 id="events-h">오늘 일정</h2><span class="sub">구글 캘린더</span></div>' + body;
  }

  // 기본은 로그 한 장(열어 둔 날, 없으면 오늘). 「전체 로그」를 누르면 날짜 내림차순 목록 — 날짜마다 그날 로그 한 줄,
  // 그 아래에 그날 미팅 미닛(회의 시각순). 미팅만 있는 날도 날짜 줄이 생긴다.
  function renderLogs() {
    const el = $('#logs');
    if (S.openMeeting) {
      const m = S.meetings.find((x) => x.id === S.openMeeting);
      if (m) { el.innerHTML = meetingHtml(m); return; }
      S.openMeeting = null;
    }
    if (!S.showList) { el.innerHTML = detailHtml(S.openDate || S.today); return; }
    const rows = [];
    const dates = new Set(S.logs.map((l) => l.date).concat([S.today]));
    S.meetings.forEach((m) => { const d = meetingInfo(m).date; if (d) dates.add(d); });
    for (const d of Array.from(dates).sort().reverse()) {
      const l = logByDate(d);
      const p = parsedOf(l);
      const isToday = d === S.today;
      const openN = p ? p.tasks.filter((t) => !t.done).length : 0;
      const ideaN = p ? p.ideas.length : 0;
      let line = p && p.oneLine ? p.oneLine.split('\n')[0] : '';
      let dim = false;
      if (!line && p && p.summary) { line = '요약 · ' + p.summary.split('\n')[0]; dim = true; }
      if (!line) { line = isToday ? '아직 안 씀 · 눌러서 쓰기' : l ? '내 한 줄 없음' : '데일리 로그 없음'; dim = true; }
      rows.push('<button type="button" class="log-row' + (isToday ? ' today' : '') + '" data-open="' + d + '">' +
        '<span class="when"><b>' + md(d) + '</b><span>' + (isToday ? '오늘' : WD[weekday(d)]) + '</span></span>' +
        '<span class="line' + (dim ? ' dim' : '') + '">' + show(line) + '</span>' +
        '<span class="badges"><span class="badge' + (openN ? '' : ' zero') + '">할 일 ' + openN + '</span><span class="badge idea' + (ideaN ? '' : ' zero') + '">아이디어 ' + ideaN + '</span></span>' +
        ICON.right + '</button>');
      meetingsOn(d).forEach((x) => rows.push('<button type="button" class="log-meet" data-meeting="' + h(x.m.id) + '">' +
        '<span class="mono">' + (x.time || '--:--') + '</span><span class="mt">' + h(x.topic) + '</span>' +
        (x.open ? '<span class="badge">할 일 ' + x.open + '</span>' : '<span class="badge zero">끝남</span>') + ICON.right + '</button>'));
    }
    el.innerHTML = '<div class="card-head"><h2 id="logs-h">데일리 로그 ' + S.logs.length + ' · 미팅 미닛 ' + S.meetings.length + '</h2>' +
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
  // 미팅 미닛 한 장. 처음에는 읽기(본문 전체를 제목 · 불릿 · 체크박스로), 「편집」을 누르면 고치기 화면.
  function meetingHtml(m) {
    return S.meetEdit ? meetingEditHtml(m) : meetingReadHtml(m);
  }

  function meetingReadHtml(m) {
    const f = S.files[m.id] || {};
    const fm = f.fm || {};
    const info = meetingInfo(m);
    const str = (v) => (Array.isArray(v) ? v.join(' · ') : v || '');
    const facts = [['영역', str(fm.area)], ['시각', info.time ? info.time : ''], ['참석자', str(fm.attendees)], ['프로젝트', str(fm.project)], ['관련', str(fm.related) || str(fm.asset)]]
      .filter((x) => x[1]).map((x) => '<span><i>' + x[0] + '</i>' + h(x[1]) + '</span>').join('');
    const body = blocksHtml(MD.blocks(f.text || ''), m);
    return '<div class="detail meet-read">' +
      '<div class="detail-top"><span class="nav"><button type="button" class="btn" data-meet-close>' + ICON.left + '닫기</button>' +
      '<button type="button" class="btn" data-meet-edit>' + ICON.edit + '편집</button></span>' +
      '<div class="meta"><a href="' + h(obsidianUrl(m.title, C.MEETINGS_PATH)) + '">옵시디언에서 열기</a></div></div>' +
      '<div><div class="eyebrow">미팅 미닛' + (info.date ? ' · ' + h(kor(info.date)) : '') + '</div><h2 class="big" id="logs-h">' + h(info.topic) + '</h2></div>' +
      (facts ? '<div class="facts">' + facts + '</div>' : '') +
      '<div class="sec mbody">' + (body || '<div class="hint">아직 내용이 없어요. 「편집」을 눌러 써 주세요.</div>') + '</div></div>';
  }

  // 영역: 주간 검토의 영역 태그와 같은 목록. 목록에 없는 값이 이미 있으면 그대로 보여 준다.
  const AREAS = ['회사', '개인', '학교', 'SideHustle', 'CPA', 'AI'];
  function areaSelect(m, cur) {
    const opts = AREAS.concat(cur && !AREAS.includes(cur) ? [cur] : []);
    return '<label class="mf"><span>영역</span><select class="field" data-mfield="' + h(m.id + '|fm|area') + '">' +
      (cur ? '' : '<option value="" selected>—</option>') + opts.map((a) => '<option' + (a === cur ? ' selected' : '') + '>' + h(a) + '</option>').join('') + '</select></label>';
  }

  // 마크다운 덩어리 → 읽기용 HTML(옵시디언 읽기 화면 비슷하게). 체크박스는 file 안의 줄 번호로 체크된다.
  const CALLOUT_TITLE = { claude: 'Claude가 씀', note: 'Note', info: 'Info', tip: 'Tip', warning: 'Warning', caution: 'Caution', danger: 'Danger', question: 'Question', todo: 'Todo', example: 'Example', quote: 'Quote', success: 'Success' };
  const CALLOUT_TONE = { warning: 'warn', caution: 'warn', danger: 'warn', bug: 'warn', failure: 'warn', claude: 'plain', quote: 'plain' };
  function blocksHtml(list, file) {
    let out = '';
    let gap = false;
    list.forEach((b) => {
      if (b.kind === 'blank') { gap = true; return; }
      const pad = b.depth ? ' style="padding-left:' + Math.min(b.depth, 6) * 18 + 'px"' : '';
      if (b.kind === 'h') out += '<div class="mh mh' + Math.min(b.level, 4) + '">' + show(b.text) + '</div>';
      else if (b.kind === 'task') out += taskHtml(b, file);
      else if (b.kind === 'bullet') out += '<div class="li"' + pad + '><span class="b">·</span><span>' + show(b.text) + '</span></div>';
      else if (b.kind === 'ol') out += '<div class="li ol"' + pad + '><span class="b">' + b.n + '.</span><span>' + show(b.text) + '</span></div>';
      else if (b.kind === 'hr') out += '<hr class="mhr">';
      else if (b.kind === 'code') out += '<pre class="mcode"><code>' + h(b.text) + '</code></pre>';
      else if (b.kind === 'quote') out += '<blockquote class="mquote">' + blocksHtml(b.children, file) + '</blockquote>';
      else if (b.kind === 'callout') {
        const name = CALLOUT_TITLE[b.type] || b.type.charAt(0).toUpperCase() + b.type.slice(1);
        const title = b.type === 'claude' ? name + (b.title ? ' · ' + b.title : '') : (b.title || name);
        out += '<div class="mcallout ' + (CALLOUT_TONE[b.type] || 'info') + '"><div class="ct">' + show(title) + '</div>' +
          (b.children.length ? '<div class="cb">' + blocksHtml(b.children, file) + '</div>' : '') + '</div>';
      } else if (b.kind === 'table') {
        const td = (tag, c, j) => '<' + tag + (b.align[j] ? ' style="text-align:' + b.align[j] + '"' : '') + '>' + show(c) + '</' + tag + '>';
        out += '<div class="mtable"><table><thead><tr>' + b.head.map((c, j) => td('th', c, j)).join('') + '</tr></thead><tbody>' +
          b.rows.map((r) => '<tr>' + b.head.map((x, j) => td('td', r[j] || '', j)).join('') + '</tr>').join('') + '</tbody></table></div>';
      } else out += '<p' + (gap ? ' class="gap"' : '') + '>' + show(b.text) + '</p>';
      gap = false;
    });
    return out;
  }

  // 고치기: 속성 · Summary · Takeaways는 바로 고치고, Next Steps는 체크 · 고치기 · 지우기 · 더하기.
  // 그 밖의 칸(예: 유의사항)은 읽기만 — 옵시디언에서 고친다.
  function meetingEditHtml(m) {
    const f = S.files[m.id] || {};
    const fm = f.fm || {};
    const secs = f.parsed ? f.parsed.sections : [];
    const info = meetingInfo(m);
    const str = (v) => (Array.isArray(v) ? v.join(', ') : v || '');
    const val = (kind, name, cur) => {
      const k = m.id + '|' + kind + '|' + name;
      if (kind === 'sec' && !(k in S.mbase)) S.mbase[k] = cur;
      return k in S.mdrafts ? S.mdrafts[k] : cur;
    };
    const input = (name, label, type, cur, ph, wide) => '<label class="mf' + (wide ? ' wide' : '') + '"><span>' + label + '</span><input class="field" type="' + type + '" data-mfield="' + h(m.id + '|fm|' + name) + '" value="' + h(val('fm', name, cur)) + '"' + (ph ? ' placeholder="' + h(ph) + '"' : '') + '></label>';
    const fields = '<div class="mf-grid">' +
      input('meeting_at', '회의 시각', 'datetime-local', typeof fm.meeting_at === 'string' ? fm.meeting_at.slice(0, 16) : '') +
      areaSelect(m, val('fm', 'area', str(fm.area))) +
      input('attendees', '참석자', 'text', str(fm.attendees), '쉼표로 나눠서 — Kris Yu, Paul', true) +
      input('project', '프로젝트', 'text', str(fm.project), '쉼표로 — lease, Construction') +
      input('related', '관련', 'text', str(fm.related) || str(fm.asset), '쉼표로 — 300 Grant, Webster') + '</div>';
    const textSec = (name) => {
      const id = 'mt-' + name.toLowerCase();
      return '<div class="sec"><label for="' + id + '"><h3>' + name + '</h3></label><textarea class="field short" id="' + id + '" data-mfield="' + h(m.id + '|sec|' + name) + '">' +
        h(val('sec', name, MD.getSectionText(f.text || '', name))) + '</textarea></div>';
    };
    const ns = secs.find((s) => s.name === 'Next Steps') || { name: 'Next Steps', isList: false, items: [] };
    const next = listSecHtml(ns, m).replace(/<\/div>$/, '') +
      '<form class="item-add" data-meet-add="' + h(m.id) + '"><label for="meet-add-input" class="sr-only">Next Step 추가</label>' +
      '<input class="field" id="meet-add-input" type="text" placeholder="할 일 추가" enterkeyhint="done"><button class="btn" type="submit">추가</button></form></div>';
    const rest = secs.filter((s) => !['Summary', 'Takeaways', 'Next Steps'].includes(s.name)).map((s) => secHtml(s, m, false)).filter(Boolean).join('');
    return '<div class="detail">' +
      '<div class="detail-top"><span class="nav"><button type="button" class="btn" data-meet-close>' + ICON.left + '닫기</button>' +
      '<button type="button" class="btn primary" data-meet-done>다 됐어요</button></span>' +
      '<div class="meta"><span id="save-label">' + h(S.saveLabel) + '</span><a href="' + h(obsidianUrl(m.title, C.MEETINGS_PATH)) + '">옵시디언에서 열기</a></div></div>' +
      '<div><div class="eyebrow">미팅 미닛' + (info.date ? ' · ' + h(kor(info.date)) : '') + '</div><h2 class="big" id="logs-h">' + h(info.topic) + '</h2></div>' +
      fields + textSec('Summary') + textSec('Takeaways') + next + rest + '</div>';
  }

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
    // 읽는 칸은 미팅 미닛과 같은 그리기(콜아웃 상자 · 표 · 번호 목록 …). 체크박스는 그 줄 그대로 체크된다.
    const bs = l ? sectionBlocks(l)[s.name] : null;
    return '<div class="sec mbody">' + head + (bs ? blocksHtml(bs, l) : '<p>' + show(s.text) + '</p>') + '</div>';
  }

  // 파일을 ## 칸마다 덩어리 목록으로 나눈다(읽기 화면용). 파일이 바뀌면 putFile이 새로 만들어서 다시 나눈다.
  function sectionBlocks(l) {
    const f = S.files[l.id];
    if (!f) return {};
    if (f.secBlocks) return f.secBlocks;
    const out = {};
    let cur = null;
    MD.blocks(f.text).forEach((b) => {
      if (b.kind === 'h' && b.level === 2) { cur = b.text; out[cur] = []; } else if (cur) out[cur].push(b);
    });
    return (f.secBlocks = out);
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
      const label = m + '월 ' + n + '일' + (todoDays.has(d) ? ', 안 한 할 일 있음' : '') + (evDays.has(d) ? ', 일정 있음' : '') + (meetDays.has(d) ? ', 미팅 미닛 있음' : '');
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
        '<div class="hd sub">미팅 미닛</div>' +
        (ms.length ? ms.map((x) => '<button type="button" class="meet-row" data-meeting="' + h(x.m.id) + '" title="미팅 미닛 보기">' +
          '<span class="mono">' + (x.time || '--:--') + '</span><span class="mt"><b>' + h(x.topic) + '</b>' +
          (x.who.length || x.open ? '<small>' + h(x.who.join(' · ')) + (x.who.length && x.open ? ' · ' : '') + (x.open ? '할 일 ' + x.open : '') + '</small>' : '') +
          '</span>' + ICON.right + '</button>').join('') : '<div class="hint">미팅 미닛 없음</div>') +
        (!S.folders || !S.folders.meetings ? '' : S.newMeeting && S.newMeeting.where === 'cal' && S.newMeeting.date === sel ? newMeetingForm(sel) :
          '<button type="button" class="btn" data-new-meeting="' + sel + '">+ 미팅 미닛 쓰기</button>') +
        '</div>';
    }
    $('#calendar').innerHTML =
      '<div class="card-head"><h2 id="cal-h">' + y + '년 ' + m + '월</h2><div class="cal-nav">' +
      '<button type="button" class="icon-btn" data-month="-1" aria-label="이전 달">' + ICON.left + '</button>' +
      '<button type="button" class="icon-btn" data-month="1" aria-label="다음 달">' + ICON.right + '</button></div></div>' +
      '<div class="cal">' + cells + '</div>' +
      '<div class="legend"><span><i></i>안 한 할 일이 남은 날</span><span><i class="evm"></i>일정</span><span><i class="mtm"></i>미팅 미닛</span></div>' + sum;
  }

  function newMeetingForm(date) {
    const t = date === S.today ? timeHM(new Date()) : '09:00';
    return '<form class="meet-new" data-meet-new="' + date + '">' +
      '<input class="field" name="topic" id="meet-topic" type="text" placeholder="주제 — 파일 이름이 돼요" aria-label="미팅 주제" required>' +
      '<div class="row"><input class="field" name="time" type="time" value="' + t + '" aria-label="회의 시각">' +
      '<input class="field" name="who" type="text" placeholder="참석자 (쉼표로)" aria-label="참석자"></div>' +
      '<div class="row"><button class="btn primary" type="submit">만들기</button><button class="btn" type="button" data-meet-cancel>취소</button></div></form>';
  }

  // 미팅 미닛 목록: 회의 날짜 · 시각 내림차순. 상태 칸은 쓰지 않고, 안 끝낸 Next Steps가 있으면 「할 일 남음」.
  function renderMeetings() {
    const el = $('#meetings');
    if (!el) return;
    if (!S.folders || !S.folders.meetings) { el.innerHTML = ''; return; }
    const all = S.meetings.map((m) => {
      const fm = (S.files[m.id] && S.files[m.id].fm) || {};
      const one = (v) => (Array.isArray(v) ? v[0] || '' : v || '');
      return Object.assign({ m, area: one(fm.area), tag: one(fm.project) || one(fm.related) || one(fm.asset) }, meetingInfo(m));
    }).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
    const open = all.filter((x) => x.open > 0);
    const list = S.meetFilter === 'all' ? all : open;
    const rows = list.map((x) =>
      '<button type="button" class="mrow" data-meeting="' + h(x.m.id) + '">' +
      '<span class="when"><b>' + (x.date ? md(x.date) : '--/--') + '</b><span>' + (x.time || '') + '</span></span>' +
      '<span class="body"><b>' + h(x.topic) + '</b>' +
      '<small>' + (x.area ? '<em class="area">' + h(x.area) + '</em>' : '') + h(x.who.join(' · ')) + (x.who.length && x.tag ? ' · ' : '') + (x.tag ? '<i>' + h(x.tag) + '</i>' : '') + '</small></span>' +
      '<span class="badges">' + (x.open ? '<span class="badge">할 일 ' + x.open + '</span>' : '<span class="badge zero">끝남</span>') + '</span>' +
      ICON.right + '</button>').join('');
    el.innerHTML = '<div class="card-head"><h2 id="meet-h">미팅 미닛</h2>' +
      '<div class="seg small" role="group" aria-label="미팅 보기">' +
      '<button type="button" data-meet-filter="open" aria-pressed="' + (S.meetFilter !== 'all') + '">할 일 남음 ' + open.length + '</button>' +
      '<button type="button" data-meet-filter="all" aria-pressed="' + (S.meetFilter === 'all') + '">전체 ' + all.length + '</button></div></div>' +
      (S.newMeeting && S.newMeeting.where === 'meetings' ? '<div class="ev-new">' + newMeetingForm(S.today) + '</div>' :
        '<button type="button" class="btn ev-add top" data-new-meeting="' + S.today + '">+ 새 미팅 미닛</button>') +
      '<div class="mlist">' + (rows || '<div class="empty">' + (S.meetFilter === 'all' ? '미팅 미닛이 없어요.' : '할 일이 남은 미팅이 없어요.') + '</div>') + '</div>';
  }

  // 연습 카드: 「기억할 말」 중 하루 한 줄을 크게 보이고, 아래에 다른 칸을 목록으로. 읽기만 한다 — 고치는 건 옵시디언에서.
  function renderPractice() {
    const el = $('#practice');
    if (!el) return;
    el.hidden = !S.practice;
    if (!S.practice) { el.innerHTML = ''; return; }
    const items = (s) => s.items.filter((x) => x.kind === 'bullet' || x.kind === 'task');
    const secs = MD.parseLog(S.practice).sections.filter((s) => s.name !== '출처' && items(s).length);
    const words = secs.find((s) => s.name === '기억할 말');
    const pool = words ? items(words).filter((x) => x.depth === 0) : [];
    const day = Math.floor(Date.parse(S.today + 'T00:00:00Z') / 864e5);
    const pick = pool.length ? pool[day % pool.length] : null;
    const list = (s) => '<ul class="plist">' + items(s).map((x) => '<li' + (x.depth ? ' class="sub"' : '') + '>' + MD.inlineHtml(x.text) + '</li>').join('') + '</ul>';
    const file = C.PRACTICE_PATH[C.PRACTICE_PATH.length - 1].replace(/\.md$/, '');
    el.innerHTML = '<div class="card-head"><h2 id="practice-h">연습 카드</h2>' +
      '<a class="sub" href="' + h(obsidianUrl(file, C.PRACTICE_PATH.slice(0, -1))) + '">옵시디언에서 고치기</a></div>' +
      (pick ? '<blockquote class="pquote"><small>오늘의 한 줄</small>' + MD.inlineHtml(pick.text) + '</blockquote>' : '') +
      '<div class="pbody" tabindex="0" aria-label="연습 카드 목록">' + secs.map((s) => s === words
        ? '<details class="psec"><summary>' + h(s.name) + ' ' + pool.length + '</summary>' + list(s) + '</details>'
        : '<div class="psec"><h3>' + h(s.name) + '</h3>' + list(s) + '</div>').join('') + '</div>';
  }

  function renderAll() { renderHeader(); renderTodos(); renderEvents(); renderLogs(); renderCalendar(); renderMeetings(); renderPractice(); }

  // ---------- 조작 ----------
  function openLog(date) {
    flushFields();
    S.openDate = date; S.showList = false; S.tab = 'log'; S.openMeeting = null;
    renderHeader(); renderLogs();
    $('#logs').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.kind) { S.kind = t.dataset.kind; S.editItem = null; renderHeader(); renderTodos(); $('#quick-input').focus(); }
      else if (t.dataset.done) { S.showDone = t.dataset.done === '1'; renderTodos(); }
      else if (t.dataset.open) openLog(t.dataset.open);
      else if (t.dataset.meeting) openMeeting(t.dataset.meeting);
      else if ('meetClose' in t.dataset) closeMeeting();
      else if ('meetEdit' in t.dataset) { S.meetEdit = true; renderLogs(); }
      else if ('meetDone' in t.dataset) { flushFields().then(() => { S.meetEdit = false; S.editItem = null; renderLogs(); }); }
      else if (t.dataset.newMeeting) {
        S.newMeeting = { date: t.dataset.newMeeting, where: t.closest('#events') ? 'events' : t.closest('#meetings') ? 'meetings' : 'cal' };
        renderEvents(); renderCalendar(); renderMeetings();
        const i = $('#meet-topic'); if (i) i.focus();
      }
      else if ('meetCancel' in t.dataset) { S.newMeeting = null; renderEvents(); renderCalendar(); renderMeetings(); }
      else if (t.dataset.meetFilter) { S.meetFilter = t.dataset.meetFilter; renderMeetings(); }
      else if (t.dataset.eventNote) {
        const ev = eventsOn(S.todayEvents, S.today)[Number(t.dataset.eventNote)];
        if (ev) { t.disabled = true; createMeeting(S.today, ev.title, ev.allDay ? '' : timeHM(new Date(ev.start)), (ev.who || []).join(', ')).catch(fail).finally(() => { t.disabled = false; }); }
      }
      else if ('back' in t.dataset) { flushFields(); S.openDate = null; S.openMeeting = null; S.showList = true; S.editItem = null; renderTodos(); renderLogs(); }
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
      else if (t.dataset.tabBtn) {
        S.tab = t.dataset.tabBtn; flushFields();
        if (S.openMeeting) { S.openMeeting = null; S.meetFrom = null; renderLogs(); }
        renderHeader(); window.scrollTo(0, 0);
      }
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
      else if (f.dataset && f.dataset.mfield) onMeetField(f.dataset.mfield, f.value);
    });
    document.addEventListener('focusout', (e) => {
      const f = e.target;
      if (f.dataset && f.dataset.field && f.dataset.field in S.drafts) { clearTimeout(timers[f.dataset.field]); saveField(f.dataset.field); }
      if (f.dataset && f.dataset.mfield && f.dataset.mfield in S.mdrafts) saveMeetField(f.dataset.mfield);
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
      } else if (f.dataset.meetNew) {
        e.preventDefault();
        const btn = f.querySelector('[type=submit]');
        btn.disabled = true;
        createMeeting(f.dataset.meetNew, f.elements.topic.value, f.elements.time.value, f.elements.who.value)
          .catch(fail).finally(() => { btn.disabled = false; });
      } else if (f.dataset.meetAdd) {
        e.preventDefault();
        const inp = f.querySelector('input');
        const v = inp.value;
        inp.value = '';
        addNextStep(f.dataset.meetAdd, v);
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
      S.base = {}; S.mbase = {};
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
