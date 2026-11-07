// 구글 로그인 · 드라이브 · 캘린더. 서버 없이 브라우저에서 바로 구글 API를 부른다.
// 쓰기는 데일리 로그 · Meetings · 1. Project · 3. Resource/research 폴더 안의 파일에만 허용한다(writable 목록에 없는 파일은 거절).
(function () {
  'use strict';
  const C = window.CONFIG;
  const TOKEN_KEY = 'od.token';
  const HINT_KEY = 'od.hint';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const CAL = 'https://www.googleapis.com/calendar/v3';
  const FOLDER = 'application/vnd.google-apps.folder';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 동작은 한다 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  };

  // ---------- 로그인 (리디렉트 방식: 아이폰 홈 화면 앱에서도 팝업 없이 된다) ----------
  function redirectUri() { return location.origin + location.pathname; }

  // silent: 구글에 이미 로그인돼 있고 권한을 준 적이 있으면 화면 없이 새 토큰을 받아 온다(prompt=none).
  // 토큰은 1시간짜리라, 끝나면 이걸로 조용히 다시 받는다. 안 되면 구글이 #error로 돌려보낸다.
  function login(opts) {
    const silent = !!(opts && opts.silent);
    const state = Math.random().toString(36).slice(2);
    try {
      sessionStorage.setItem('od.state', state);
      if (silent) sessionStorage.setItem('od.silentAt', String(Date.now()));
    } catch (e) { /* 무시 */ }
    const q = new URLSearchParams({
      client_id: C.CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: C.SCOPES.join(' '),
      include_granted_scopes: 'true',
      state
    });
    if (silent) q.set('prompt', 'none');
    const hint = store.get(HINT_KEY);
    if (hint) q.set('login_hint', hint);
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
  }

  // 조용한 로그인을 30초 안에 이미 해 봤으면 다시 하지 않는다(실패하면 되풀이하지 않게).
  function canSilent() {
    let at = 0;
    try { at = Number(sessionStorage.getItem('od.silentAt')) || 0; } catch (e) { return false; }
    return Date.now() - at > 30000;
  }

  // 여러 구글 계정이 로그인된 브라우저에서도 조용한 로그인이 되게, 어느 계정인지 이 기기에 적어 둔다.
  async function rememberUser() {
    if (store.get(HINT_KEY)) return;
    try {
      const j = await (await call(DRIVE + '/about?fields=user(emailAddress)')).json();
      if (j.user && j.user.emailAddress) store.set(HINT_KEY, j.user.emailAddress);
    } catch (e) { /* 없어도 로그인은 된다 */ }
  }

  // 로그인에서 돌아왔으면 주소의 #access_token을 꺼내 저장한다. 조용한 로그인이 안 됐으면(#error) 주소만 지운다.
  function takeTokenFromUrl() {
    if (location.hash.includes('error=')) { history.replaceState(null, '', redirectUri()); return; }
    if (!location.hash.includes('access_token')) return;
    const h = new URLSearchParams(location.hash.slice(1));
    let expected = null;
    try { expected = sessionStorage.getItem('od.state'); } catch (e) { /* 무시 */ }
    if (expected && h.get('state') !== expected) throw new Error('로그인 응답이 맞지 않아요. 다시 로그인해 주세요.');
    store.set(TOKEN_KEY, { token: h.get('access_token'), exp: Date.now() + (Number(h.get('expires_in')) - 60) * 1000 });
    history.replaceState(null, '', redirectUri());
  }

  function token() {
    const t = store.get(TOKEN_KEY);
    return t && t.exp > Date.now() ? t.token : null;
  }

  function logout() { store.del(TOKEN_KEY); }

  class AuthError extends Error {}

  async function call(url, opts) {
    const t = token();
    if (!t) throw new AuthError('로그인이 필요해요.');
    const res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, (opts && opts.headers) || {}) }));
    if (res.status === 401) { logout(); throw new AuthError('로그인이 만료됐어요.'); }
    if (!res.ok) {
      let msg = res.status + '';
      try { const j = await res.json(); msg += ' ' + ((j.error && j.error.message) || ''); } catch (e) { /* 무시 */ }
      throw new Error('구글 요청 실패: ' + msg);
    }
    return res;
  }

  // ---------- 드라이브 ----------
  const nfc = (s) => s.normalize('NFC');
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function list(q, fields) {
    let out = [];
    let pageToken = '';
    do {
      const p = new URLSearchParams({ q, fields: 'nextPageToken,files(' + fields + ')', pageSize: '1000', spaces: 'drive' });
      if (pageToken) p.set('pageToken', pageToken);
      const j = await (await call(DRIVE + '/files?' + p)).json();
      out = out.concat(j.files || []);
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  // 맥에서 올린 한글 이름은 자모가 풀린(NFD) 채로 있을 수 있어서, 이름 검색 대신 목록을 받아 NFC로 비교한다.
  async function child(parentId, name, wantFolder) {
    const q = "'" + esc(parentId) + "' in parents and trashed=false" + (wantFolder ? " and mimeType='" + FOLDER + "'" : '');
    const files = await list(q, 'id,name,mimeType');
    const hit = files.find((f) => nfc(f.name) === nfc(name));
    if (!hit) throw new Error('드라이브에서 「' + name + '」을 찾지 못했어요.');
    return hit.id;
  }

  const writable = new Set();
  let logFolderId = null;
  let meetingFolderId = null;
  let projectFolderId = null;
  let researchFolderId = null;

  async function findLogFolder() {
    const cached = store.get('od.folders');
    if (cached && cached.client === C.CLIENT_ID && 'research' in cached) {
      logFolderId = cached.logs; meetingFolderId = cached.meetings; projectFolderId = cached.projects; researchFolderId = cached.research; return cached;
    }
    const vault = await childPath('root', C.VAULT_PATH, false);
    const logs = await childPath(vault, C.LOG_PATH, false);
    const template = await childPath(vault, C.TEMPLATE_PATH, true);
    // Meetings 폴더는 없어도 된다 — 없으면 미팅 할 일만 빠진다.
    let meetings = null;
    let meetTemplate = null;
    try { meetings = await childPath(vault, C.MEETINGS_PATH, false); }
    catch (e) { if (e instanceof AuthError) throw e; }
    try { meetTemplate = await childPath(vault, C.MEETING_TEMPLATE_PATH, true); }
    catch (e) { if (e instanceof AuthError) throw e; }
    // 1. Project · 3. Resource/research 폴더도 없어도 된다 — 없으면 노트 탭에서 그 칸만 빠진다.
    let projects = null;
    let research = null;
    try { projects = await childPath(vault, C.PROJECT_PATH, false); }
    catch (e) { if (e instanceof AuthError) throw e; }
    try { research = await childPath(vault, C.RESEARCH_PATH, false); }
    catch (e) { if (e instanceof AuthError) throw e; }
    const f = { client: C.CLIENT_ID, vault, logs, template, meetings, meetTemplate, projects, research };
    store.set('od.folders', f);
    logFolderId = logs; meetingFolderId = meetings; projectFolderId = projects; researchFolderId = research;
    return f;
  }

  async function childPath(from, path, lastIsFile) {
    let id = from;
    for (let i = 0; i < path.length; i++) id = await child(id, path[i], !(lastIsFile && i === path.length - 1));
    return id;
  }

  function forgetFolders() { store.del('od.folders'); }

  // 연습 카드는 없어도 된다 — 없으면 null. 나중에 생길 수 있어서 캐시하지 않는다. 대시보드는 읽기만 한다.
  async function findPractice(vault) {
    try { return await childPath(vault, C.PRACTICE_PATH, true); }
    catch (e) { if (e instanceof AuthError) throw e; return null; }
  }

  async function listLogs() {
    const files = await list("'" + esc(logFolderId) + "' in parents and trashed=false and mimeType!='" + FOLDER + "'", 'id,name,modifiedTime');
    const logs = files
      .map((f) => ({ id: f.id, name: nfc(f.name), modifiedTime: f.modifiedTime }))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f.name))
      .map((f) => Object.assign(f, { date: f.name.slice(0, 10) }));
    logs.forEach((f) => writable.add(f.id));
    return logs;
  }

  // 미팅 노트: 「YYYY-MM-DD HHmm_주제.md」. readme.md는 뺀다.
  async function listMeetings() {
    if (!meetingFolderId) return [];
    const files = await list("'" + esc(meetingFolderId) + "' in parents and trashed=false and mimeType!='" + FOLDER + "'", 'id,name,modifiedTime');
    const out = files
      .map((f) => ({ id: f.id, name: nfc(f.name), modifiedTime: f.modifiedTime }))
      .filter((f) => /\.md$/.test(f.name) && f.name.toLowerCase() !== 'readme.md')
      .map((f) => {
        const title = f.name.replace(/\.md$/, '');
        const d = title.match(/^\d{4}-\d{2}-\d{2}/);
        return Object.assign(f, { title, date: d ? d[0] : '', meeting: true });
      });
    out.forEach((f) => writable.add(f.id));
    return out;
  }

  // 프로젝트 · 리서치 노트: 1. Project와 3. Resource/research 아래 하위 폴더까지의 .md 전부(readme.md는 뺀다).
  // kind는 'project' | 'research', base는 볼트 안의 시작 폴더, path는 그 아래 폴더 경로.
  async function listProjectNotes() {
    const roots = [[projectFolderId, 'project', C.PROJECT_PATH], [researchFolderId, 'research', C.RESEARCH_PATH]];
    return [].concat(...await Promise.all(roots.filter((r) => r[0]).map((r) => listNotesUnder(r[0], r[1], r[2]))));
  }
  async function listNotesUnder(rootId, kind, base) {
    const out = [];
    let level = [{ id: rootId, path: [] }];
    while (level.length) {
      const next = [];
      await Promise.all(level.map(async (d) => {
        const files = await list("'" + esc(d.id) + "' in parents and trashed=false", 'id,name,mimeType,modifiedTime');
        files.forEach((f) => {
          const name = nfc(f.name);
          if (f.mimeType === FOLDER) next.push({ id: f.id, path: d.path.concat(name) });
          else if (/\.md$/i.test(name) && name.toLowerCase() !== 'readme.md') {
            out.push({ id: f.id, name, title: name.replace(/\.md$/i, ''), kind, base, path: d.path, modifiedTime: f.modifiedTime });
          }
        });
      }));
      level = next;
    }
    out.forEach((f) => writable.add(f.id));
    return out;
  }

  async function meta(id) {
    return (await call(DRIVE + '/files/' + encodeURIComponent(id) + '?fields=id,modifiedTime')).json();
  }

  async function readText(id) {
    const res = await call(DRIVE + '/files/' + encodeURIComponent(id) + '?alt=media');
    return res.text();
  }

  async function writeText(id, text) {
    if (!writable.has(id)) throw new Error('이 파일은 대시보드에서 고칠 수 없게 막혀 있어요.');
    const res = await call(UPLOAD + '/files/' + encodeURIComponent(id) + '?uploadType=media&fields=id,modifiedTime', {
      method: 'PATCH', headers: { 'Content-Type': 'text/markdown; charset=UTF-8' }, body: text
    });
    return res.json();
  }

  function createLog(name, text) {
    if (!logFolderId) throw new Error('데일리 로그 폴더를 아직 못 찾았어요.');
    return create(logFolderId, name, text);
  }
  function createMeeting(name, text) {
    if (!meetingFolderId) throw new Error('Meetings 폴더를 아직 못 찾았어요.');
    return create(meetingFolderId, name, text);
  }

  async function create(folderId, name, text) {
    const boundary = 'od' + Math.random().toString(36).slice(2);
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name, parents: [folderId], mimeType: 'text/markdown' }) +
      '\r\n--' + boundary + '\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n' + text + '\r\n--' + boundary + '--';
    const res = await call(UPLOAD + '/files?uploadType=multipart&fields=id,name,modifiedTime', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    });
    const f = await res.json();
    writable.add(f.id);
    return f;
  }

  // ---------- 캘린더 (읽기만) ----------
  async function events(timeMin, timeMax) {
    const cals = (await (await call(CAL + '/users/me/calendarList?minAccessRole=reader')).json()).items || [];
    const shown = cals.filter((c) => c.selected !== false && !c.hidden);
    const all = await Promise.all(shown.map(async (c) => {
      const p = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      try {
        const j = await (await call(CAL + '/calendars/' + encodeURIComponent(c.id) + '/events?' + p)).json();
        return (j.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
          title: e.summary || '(제목 없음)',
          allDay: !!(e.start && e.start.date),
          start: e.start.dateTime || e.start.date,
          end: e.end ? (e.end.dateTime || e.end.date) : null,
          color: c.backgroundColor || null,
          // 참석자: 나와 회의실(resource)은 빼고, 이름이 없으면 메일 주소 앞부분
          who: (e.attendees || []).filter((a) => !a.self && !a.resource && a.responseStatus !== 'declined')
            .map((a) => a.displayName || (a.email || '').split('@')[0]).filter(Boolean)
        }));
      } catch (err) {
        if (err instanceof AuthError) throw err;
        return [];
      }
    }));
    // 캘린더마다 시간대 표기(-08:00 · Z 등)가 달라 글자로 비교하면 순서가 틀린다 — 실제 시각으로, 종일 일정은 먼저.
    const at = (e) => (e.allDay ? -Infinity : Date.parse(e.start));
    return [].concat(...all).sort((a, b) => at(a) - at(b) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  window.G = { login, canSilent, rememberUser, logout, token, takeTokenFromUrl, AuthError, findLogFolder, forgetFolders, listLogs, listMeetings, listProjectNotes, findPractice, meta, readText, writeText, createLog, createMeeting, events };
})();
