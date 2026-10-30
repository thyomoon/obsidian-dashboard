// 미리보기용 가짜 구글: 실제 앱 코드를 그대로 돌리되 드라이브 · 캘린더 대신 메모리의 파일을 쓴다.
// 로그 내용(window.FIXTURES)은 tests/preview.sh가 임시 폴더에만 만든다 — 저장소에 들어가지 않는다.
(function () {
  'use strict';
  const files = {};
  (window.FIXTURES.logs || []).forEach((f, i) => { files['log' + i] = { name: f.name, text: f.text, modifiedTime: '2026-01-01T00:00:00Z' }; });
  files.tpl = { name: '데일리 로그.md', text: window.FIXTURES.template, modifiedTime: '2026-01-01T00:00:00Z' };
  files.mtpl = { name: 'Meeting Minutes.md', text: window.FIXTURES.meetTemplate, modifiedTime: '2026-01-01T00:00:00Z' };
  (window.FIXTURES.meetings || []).forEach((f, i) => { files['meet' + i] = { name: f.name, text: f.text, modifiedTime: '2026-01-01T00:00:00Z', meeting: true }; });
  if (window.FIXTURES.practice) files.practice = { name: '연습 카드.md', text: window.FIXTURES.practice, modifiedTime: '2026-01-01T00:00:00Z' };
  const isLog = (id) => /^\d{4}-\d{2}-\d{2}\.md$/.test(files[id].name);
  class AuthError extends Error {}
  const tick = () => new Date().toISOString();
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 30));
  window.G = {
    AuthError,
    login() {}, logout() {}, takeTokenFromUrl() {}, token: () => 'demo', forgetFolders() {},
    findLogFolder: () => wait({ template: 'tpl', meetings: 'meet', meetTemplate: 'mtpl' }),
    findPractice: () => wait(window.FIXTURES.practice ? 'practice' : null),
    listLogs: () => wait(Object.keys(files).filter(isLog).map((id) => ({ id, name: files[id].name, date: files[id].name.slice(0, 10), modifiedTime: files[id].modifiedTime }))),
    meta: (id) => wait({ id, modifiedTime: files[id].modifiedTime }),
    readText: (id) => wait(files[id].text),
    writeText(id, text) { files[id].text = text; files[id].modifiedTime = tick(); window.WRITES = (window.WRITES || 0) + 1; return wait({ id, modifiedTime: files[id].modifiedTime }); },
    listMeetings: () => wait(Object.keys(files).filter((id) => files[id].meeting).map((id) => {
      const title = files[id].name.replace(/\.md$/, '');
      return { id, name: files[id].name, title, date: title.slice(0, 10), modifiedTime: files[id].modifiedTime, meeting: true };
    })),
    createMeeting(name, text) { const id = 'm' + Date.now(); files[id] = { name, text, modifiedTime: tick(), meeting: true }; window.CREATED = name; return wait({ id, name, modifiedTime: files[id].modifiedTime }); },
    createLog(name, text) { const id = 'new' + Date.now(); files[id] = { name, text, modifiedTime: tick() }; return wait({ id, name, modifiedTime: files[id].modifiedTime }); },
    events() {
      // 오늘 · 내일(샌프란시스코 날짜)에 예시 일정을 둔다. 오프셋 -07:00은 미리보기용 근사값.
      const key = (off) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(Date.now() + off * 864e5));
      const at = (off, hm) => new Date(key(off) + 'T' + hm + ':00-07:00').toISOString();
      return wait([
        { title: '[예시] 아침 일정', allDay: false, start: at(0, '09:00'), end: at(0, '10:00'), who: ['Kris Yu', 'Paul'] },
        { title: '[예시] 오후 일정', allDay: false, start: at(0, '13:30'), end: at(0, '14:30'), color: '#0F6E66' },
        { title: '[예시] 하루 종일', allDay: true, start: key(1), end: key(2) },
        { title: '[예시] 내일 일정', allDay: false, start: at(1, '19:00'), end: at(1, '20:00') }
      ]);
    },
    _files: files
  };
})();
