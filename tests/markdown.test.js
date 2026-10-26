// 실행: tests/run.sh  (macOS 내장 jsc 사용, 설치 필요 없음)
// 인자: markdown.js 경로, 양식 경로, 로그 파일들
const [mdPath, tplPath, ...logPaths] = arguments;
load(mdPath);
const MD = this.MD;
let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; print('FAIL ' + msg); } else print('ok   ' + msg); }

// 실제 로그 파싱
for (const p of logPaths) {
  const text = read(p);
  const log = MD.parseLog(text);
  const open = log.tasks.filter((t) => !t.done).length;
  print('-- ' + p.split('/').pop() + ': 할 일 ' + log.tasks.length + '개 (안 한 것 ' + open + '), 칸 ' + log.sections.map((s) => s.name).join(' | '));
  print('   내 한 줄: ' + (log.oneLine || '(없음)').slice(0, 40));
  print('   아이디어: ' + log.ideas.length + ', 일기 글자 수: ' + log.diary.length);
  // 체크 두 번 = 원래대로
  if (log.tasks.length) {
    const t = log.tasks[0];
    const once = MD.toggleTask(text, t);
    const changed = MD.splitLines(once).lines.filter((l, i) => l !== MD.splitLines(text).lines[i]);
    ok(changed.length === 1, '체크하면 한 줄만 바뀐다');
    const t2 = MD.parseLog(once).tasks[0];
    ok(MD.toggleTask(once, t2) === text, '두 번 체크하면 원래 파일과 똑같다');
  }
}

// 양식 → 새 로그 → 빠른 입력 → 칸 쓰기
const tpl = read(tplPath);
let doc = MD.fillTemplate(tpl, '2026-10-26', '09:30');
ok(!/\{\{(date|time)/.test(doc), '양식의 날짜 · 시각 칸이 모두 채워진다');
ok(/^author: \[Taylor\]$/m.test(doc) && !/^model:/m.test(doc), 'author: [Taylor], model 줄 없음');
let p = MD.parseLog(doc);
ok(p.tasks.length === 0 && p.ideas.length === 0 && p.oneLine === '' && p.diary === '', '빈 양식에는 할 일 · 아이디어 · 글이 없다');

doc = MD.appendToSection(doc, '남은 일', '- [ ] 첫 할 일');
doc = MD.appendToSection(doc, '남은 일', '- [ ] 둘째 할 일');
doc = MD.appendToSection(doc, '새로운 아이디어', '- 아이디어 하나');
p = MD.parseLog(doc);
ok(p.tasks.length === 2 && p.tasks[0].text === '첫 할 일', '할 일 두 개가 순서대로 들어간다');
ok(doc.indexOf('- [ ] \n') < 0 && doc.indexOf('- [ ] ' + '\r') < 0, '빈 자리 표시 줄이 첫 할 일로 바뀐다');
ok(p.ideas.length === 1 && p.ideas[0] === '아이디어 하나', '아이디어가 들어간다');

doc = MD.setSectionText(doc, '내 한 줄', '오늘은 좋았다');
doc = MD.setSectionText(doc, '오늘의 일기', '첫 문단\n\n둘째 문단');
p = MD.parseLog(doc);
ok(p.oneLine === '오늘은 좋았다', '내 한 줄이 써진다');
ok(p.diary === '첫 문단\n\n둘째 문단', '일기가 문단째 써진다');
ok(doc.indexOf('<!-- Taylor가 직접 씀 — 오늘을 한 줄로 -->') >= 0, '칸 안의 주석은 남는다');
ok(p.summary === '', '다른 칸은 그대로');
doc = MD.setSectionText(doc, '오늘의 일기', '고친 일기');
ok(MD.parseLog(doc).diary === '고친 일기', '일기를 다시 쓰면 바뀐다');
ok(MD.parseLog(doc).oneLine === '오늘은 좋았다', '일기를 고쳐도 내 한 줄은 그대로');

const stamped = MD.touchModified(doc, '2026-10-26T10:00');
ok(/^modified: 2026-10-26T10:00$/m.test(stamped) && /^created: 2026-10-26T09:30$/m.test(stamped), 'modified만 바뀐다');

// 칸이 없는 옛 로그에 아이디어 넣기 → 오늘의 일기 앞에 칸 생성
let old = '# x\n\n## 남은 일\n- [ ] a\n\n## 오늘의 일기\n일기\n';
old = MD.appendToSection(old, '새로운 아이디어', '- 새 생각', '오늘의 일기');
ok(old === '# x\n\n## 남은 일\n- [ ] a\n\n## 새로운 아이디어\n- 새 생각\n\n## 오늘의 일기\n일기\n', '없는 칸은 오늘의 일기 앞에 만든다');

// 아이디어 고치기 · 지우기
let ideaDoc = '# x\n\n## 새로운 아이디어\n- 하나\n\t- 둘(들여씀)\n- 셋\n\n## 오늘의 일기\n일기\n';
let ideaSec = MD.parseLog(ideaDoc).sections.find((x) => x.name === '새로운 아이디어');
ok(ideaSec.items.length === 3 && ideaSec.items[1].line === 4, '아이디어마다 줄 번호가 있다');
let edited = MD.editBullet(ideaDoc, ideaSec.items[1], '둘 고침');
ok(edited.indexOf('\t- 둘 고침\n') >= 0 && edited.indexOf('- 하나\n') >= 0, '고치면 그 줄 글만 바뀌고 들여쓰기는 남는다');
let removed = MD.editBullet(ideaDoc, ideaSec.items[0], null);
ok(removed === '# x\n\n## 새로운 아이디어\n\t- 둘(들여씀)\n- 셋\n\n## 오늘의 일기\n일기\n', '지우면 그 줄만 빠진다');
let shifted = '첫 줄 추가\n' + ideaDoc;
ok(MD.editBullet(shifted, ideaSec.items[2], '셋!').indexOf('- 셋!') >= 0, '줄 번호가 밀려도 같은 줄을 찾아 고친다');
let dup = '## 새로운 아이디어\n- 같음\n- 같음\n';
let threw = false; try { MD.editBullet(dup, { line: 9, raw: '- 같음' }, 'x'); } catch (e) { threw = true; }
ok(threw, '어느 줄인지 모호하면 고치지 않는다');

// 할 일 고치기 · 지우기 — 체크 표시는 그대로
let taskDoc = '## 남은 일\n- [ ] 안 한 것\n- [x] 한 것\n';
let taskSec = MD.parseLog(taskDoc).sections[0];
ok(taskSec.items[1].raw === '- [x] 한 것', '할 일에도 원래 줄이 붙는다');
ok(MD.editBullet(taskDoc, taskSec.items[0], '안 한 것 고침') === '## 남은 일\n- [ ] 안 한 것 고침\n- [x] 한 것\n', '안 한 할 일을 고쳐도 [ ]가 남는다');
ok(MD.editBullet(taskDoc, taskSec.items[1], '한 것 고침') === '## 남은 일\n- [ ] 안 한 것\n- [x] 한 것 고침\n', '한 할 일을 고쳐도 [x]가 남는다');
ok(MD.editBullet(taskDoc, taskSec.items[0], null) === '## 남은 일\n- [x] 한 것\n', '할 일을 지우면 그 줄만 빠진다');

// Claude 콜아웃 안의 할 일 · 목록
const co = [
  '---', 'author: [Claude]', 'model: claude-opus-5-5', '---', '# x', '',
  '## 한 줄 요약', '> [!claude] 2026-10-26T14:00', '> 대시보드를 만들었다.', '',
  '## 남은 일', '- [ ] 내가 쓴 할 일', '', '> [!claude] 2026-10-26T14:00', '> - [ ] Claude 할 일 하나', '> - [x] Claude 할 일 둘', '',
  '## 오늘의 일기', '일기'
].join('\n');
const cp = MD.parseLog(co);
ok(cp.tasks.length === 3, '콜아웃 안의 할 일도 센다');
ok(cp.tasks[1].text === 'Claude 할 일 하나' && cp.tasks[1].by === 'claude' && !cp.tasks[0].by, '누가 쓴 할 일인지 안다');
ok(cp.summary === '대시보드를 만들었다.', '콜아웃 안 글은 > 와 머리줄을 떼고 읽는다');
const csec = cp.sections.find((x) => x.name === '남은 일');
ok(csec.isList && csec.items.some((x) => x.kind === 'callout'), '목록 칸에 Claude 덩어리 표시가 남는다');
let ct = MD.toggleTask(co, cp.tasks[1]);
ok(ct.indexOf('> - [x] Claude 할 일 하나') >= 0, '콜아웃 안 할 일을 체크하면 > 가 남는다');
ok(MD.editBullet(co, cp.tasks[2], '고침').indexOf('> - [x] 고침') >= 0, '콜아웃 안 할 일을 고쳐도 > 와 [x]가 남는다');
let ca = MD.appendToSection(co, '남은 일', '- [ ] 대시보드로 더함');
ok(ca.indexOf('> - [x] Claude 할 일 둘\n\n- [ ] 대시보드로 더함\n') >= 0, '콜아웃 뒤에 더하면 빈 줄을 두고 콜아웃 밖에 넣는다');
ok(MD.parseLog(ca).tasks.find((t) => t.text === '대시보드로 더함').by == null, '더한 할 일은 Claude 것이 아니다');

// author 목록
const fm = (a) => '---\ntype: daily-log\n' + a + '\nmodel: claude-opus-5-5\n---\n본문\n';
ok(MD.addAuthor(fm('author: Claude'), 'Taylor') === fm('author: [Claude, Taylor]'), '예전 형식 author에 Taylor를 더한다');
ok(MD.addAuthor(fm('author: [Claude]'), 'Taylor') === fm('author: [Claude, Taylor]'), '목록 author에 Taylor를 더한다');
ok(MD.addAuthor(fm('author:\n  - Claude'), 'Taylor') === fm('author: [Claude, Taylor]'), '줄마다 쓴 author도 읽는다');
ok(MD.addAuthor(fm('author: [Taylor, Claude]'), 'Taylor') === fm('author: [Taylor, Claude]'), '이미 있으면 그대로');
ok(MD.addAuthor('---\ntype: x\n---\n', 'Taylor') === '---\ntype: x\nauthor: [Taylor]\n---\n', 'author 칸이 없으면 만든다');

ok(MD.display('[[CT]]와 [[a|별칭]] `code`') === 'CT와 별칭 code', '위키링크 표시');

print(fails ? fails + '개 실패' : '모두 통과');
