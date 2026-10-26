// 데일리 로그 md를 읽고 고치는 순수 함수들. 브라우저와 테스트(jsc)에서 같이 쓴다.
// 원칙: Taylor가 쓴 문장은 건드리지 않는다. 바꾸는 것은 체크 표시, 지정한 칸의 내용, modified 시각, author 목록뿐.
// Claude가 쓴 내용은 > [!claude] 콜아웃 안에 있다(볼트 Rules/작업 규칙.md 20). 콜아웃 안의 줄도 같은 할 일 · 목록으로 읽는다.
(function (global) {
  'use strict';

  const HEADING = /^##\s+(.+?)\s*$/;
  const TASK = /^(\s*)[-*+] \[( |x|X)\]\s?(.*)$/;
  const BULLET = /^(\s*)[-*+]\s+(.*)$/;
  const QUOTE = /^((?:[ \t]*>[ \t]?)+)/;
  const CALLOUT = /^[ \t]*>[ \t]*\[!([\w-]+)\][+-]?[ \t]*(.*)$/;

  // 인용 · 콜아웃 접두(>)를 떼고 본문만.
  function unquote(line) {
    const m = line.match(QUOTE);
    return m ? { q: m[1], body: line.slice(m[1].length) } : { q: '', body: line };
  }

  function splitLines(text) {
    const eol = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    return { lines: text.split(/\r?\n/), eol };
  }

  // 프론트매터 끝 다음 줄 번호. 프론트매터가 없으면 0.
  function bodyStart(lines) {
    if (lines[0] !== '---') return 0;
    for (let i = 1; i < lines.length; i++) if (lines[i] === '---') return i + 1;
    return 0;
  }

  // 각 줄이 HTML 주석 안에 있는지 표시한다(여러 줄 주석 포함).
  function commentMask(lines) {
    const mask = new Array(lines.length).fill(false);
    let open = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (open) { mask[i] = true; if (l.indexOf('-->') >= 0) open = false; continue; }
      const t = l.trim();
      if (t.startsWith('<!--')) {
        mask[i] = true;
        if (t.indexOf('-->') < 0) open = true;
      }
    }
    return mask;
  }

  // 양식의 빈 자리 표시 줄: "- [ ] ", "- ", "- 신규: ", 괄호 안내문.
  function isPlaceholder(line) {
    const t = unquote(line).body.trim();
    if (t === '-' || t === '- [ ]' || t === '- [x]') return true;
    if (/^- (신규|수정):\s*$/.test(t)) return true;
    if (/^\(내가 쓴다.*\)$/.test(t)) return true;
    return false;
  }

  function sections(lines) {
    const out = [];
    const start = bodyStart(lines);
    let cur = null;
    for (let i = start; i < lines.length; i++) {
      const m = lines[i].match(HEADING);
      if (m) {
        if (cur) cur.end = i;
        cur = { name: m[1].normalize('NFC'), heading: i, start: i + 1, end: lines.length };
        out.push(cur);
      }
    }
    return out;
  }

  function findSection(lines, name) {
    const n = name.normalize('NFC');
    return sections(lines).find((s) => s.name === n) || null;
  }

  // 칸의 실제 내용(주석 · 자리 표시 제외), 앞뒤 빈 줄 제거.
  function contentRows(lines, sec, mask) {
    const out = [];
    for (let i = sec.start; i < sec.end; i++) {
      if (mask[i] || isPlaceholder(lines[i])) continue;
      out.push({ i, l: lines[i] });
    }
    while (out.length && !out[0].l.trim()) out.shift();
    while (out.length && !out[out.length - 1].l.trim()) out.pop();
    return out;
  }

  function contentLines(lines, sec, mask) {
    return contentRows(lines, sec, mask).map((r) => r.l);
  }

  // before: 칸 이름 하나 또는 여러 개 — 있는 것 중 첫 칸 앞에 넣는다.
  function insertAt(lines, before) {
    const names = [].concat(before || []);
    for (const n of names) { const b = findSection(lines, n); if (b) return b.heading; }
    return lines.length;
  }

  function getSectionText(text, name) {
    const { lines } = splitLines(text);
    const sec = findSection(lines, name);
    if (!sec) return '';
    return contentLines(lines, sec, commentMask(lines)).join('\n');
  }

  function parseLog(text) {
    const { lines } = splitLines(text);
    const mask = commentMask(lines);
    const secs = sections(lines);
    const tasks = [];
    const start = bodyStart(lines);
    const by = calloutOwners(lines, start);
    for (let i = start; i < lines.length; i++) {
      if (mask[i]) continue;
      const m = unquote(lines[i]).body.match(TASK);
      if (!m || !m[3].trim()) continue;
      const sec = secs.find((s) => i >= s.start && i < s.end);
      tasks.push({ line: i, raw: lines[i], indent: m[1].replace(/\t/g, '    ').length, done: m[2] !== ' ', text: m[3], section: sec ? sec.name : '', by: by[i] });
    }
    // 칸마다: 글(text, 콜아웃 머리줄과 > 는 뺌), 목록이면 items, 그리고 누가 쓴 덩어리인지(parts).
    // 콜아웃 머리줄은 items에 { kind: 'callout' }로 남겨 화면이 「Claude가 씀」 표시를 붙이게 한다.
    const view = secs.map((s) => {
      const rows = contentRows(lines, s, mask);
      const items = [];
      const parts = [];
      const body = [];
      let isList = rows.length > 0;
      for (const { i, l } of rows) {
        const head = l.match(CALLOUT);
        const owner = by[i] || null;
        const last = parts[parts.length - 1];
        if (head) {
          items.push({ kind: 'callout', type: head[1].toLowerCase(), title: head[2] });
          parts.push({ by: owner, title: head[2], lines: [] });
          continue;
        }
        const u = unquote(l).body;
        body.push(u);
        if (!last || last.by !== owner) parts.push({ by: owner, title: '', lines: [u] });
        else last.lines.push(u);
        if (!u.trim()) continue;
        const t = u.match(TASK);
        const b = u.match(BULLET);
        if (t) items.push({ kind: 'task', line: i, raw: l, depth: depthOf(t[1]), done: t[2] !== ' ', text: t[3], by: owner });
        else if (b) items.push({ kind: 'bullet', line: i, raw: l, depth: depthOf(b[1]), text: b[2], by: owner });
        else isList = false;
      }
      while (body.length && !body[0].trim()) body.shift();
      while (body.length && !body[body.length - 1].trim()) body.pop();
      const textParts = parts.map((p) => ({ by: p.by, title: p.title, text: p.lines.join('\n').trim() })).filter((p) => p.text);
      return { name: s.name, text: body.join('\n'), isList: isList && items.some((x) => x.kind !== 'callout'), items: isList ? items : [], parts: textParts };
    });
    const get = (n) => { const v = view.find((s) => s.name === n); return v ? v.text : ''; };
    const ideaSec = view.find((s) => s.name === '새로운 아이디어');
    return {
      tasks,
      sections: view,
      oneLine: get('내 한 줄'),
      summary: get('한 줄 요약'),
      diary: get('오늘의 일기'),
      ideas: ideaSec ? ideaSec.items.filter((x) => x.kind === 'bullet').map((x) => x.text) : (ideaSec && ideaSec.text ? [ideaSec.text] : [])
    };
  }

  // 줄 번호 → 그 줄을 감싼 콜아웃 종류(claude 등). 콜아웃은 머리줄부터 > 로 시작하는 줄이 끊길 때까지.
  function calloutOwners(lines, start) {
    const by = [];
    let cur = null;
    for (let i = start; i < lines.length; i++) {
      const head = lines[i].match(CALLOUT);
      if (head) cur = head[1].toLowerCase();
      else if (!QUOTE.test(lines[i])) cur = null;
      by[i] = cur;
    }
    return by;
  }

  function depthOf(indent) {
    const w = indent.replace(/\t/g, '    ').length;
    return Math.floor(w / 4) || (w >= 2 ? 1 : 0);
  }

  // 읽을 때 본 줄(ref: {line, raw})을 지금 파일에서 찾는다. 줄 번호가 어긋났으면 같은 줄이 하나뿐일 때만 그 줄을 쓴다.
  function locate(lines, ref, what) {
    if (lines[ref.line] === ref.raw) return ref.line;
    const hits = [];
    lines.forEach((l, i) => { if (l === ref.raw) hits.push(i); });
    if (hits.length === 1) return hits[0];
    throw new Error('파일이 그사이 바뀌어서 이 ' + what + '을 찾지 못했어요. 새로고침해 주세요.');
  }

  // 체크 표시만 뒤집는다.
  function toggleTask(text, task) {
    const { lines, eol } = splitLines(text);
    const idx = locate(lines, task, '할 일');
    lines[idx] = lines[idx].replace(/\[( |x|X)\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
    return lines.join(eol);
  }

  // 목록 한 줄의 글만 바꾼다(들여쓰기 · 글머리표 · 체크 표시는 그대로). newText가 null이면 그 줄을 지운다.
  function editBullet(text, ref, newText) {
    const { lines, eol } = splitLines(text);
    const idx = locate(lines, ref, '줄');
    if (newText == null) lines.splice(idx, 1);
    else lines[idx] = lines[idx].match(/^((?:[ \t]*>[ \t]?)*)\s*[-*+]\s+(\[( |x|X)\]\s?)?/)[0] + newText;
    return lines.join(eol);
  }

  // 칸 끝(마지막 내용 줄 다음)에 한 줄을 넣는다. 빈 자리 표시 줄이 있으면 그 줄을 대신한다(콜아웃 안의 것은 빼고).
  // 마지막 줄이 콜아웃(>)이면 빈 줄을 하나 두어 Claude 콜아웃 밖에 들어가게 한다.
  // 칸이 없으면 before 칸 앞(없으면 파일 끝)에 칸을 새로 만든다.
  function appendToSection(text, name, newLine, before) {
    const { lines, eol } = splitLines(text);
    const mask = commentMask(lines);
    let sec = findSection(lines, name);
    if (!sec) {
      const at = insertAt(lines, before);
      const block = ['## ' + name, newLine, ''];
      if (at > 0 && lines[at - 1].trim()) block.unshift('');
      lines.splice(at, 0, ...block);
      return lines.join(eol);
    }
    for (let i = sec.start; i < sec.end; i++) {
      if (!mask[i] && !QUOTE.test(lines[i]) && isPlaceholder(lines[i]) && lines[i].trim().startsWith('-')) {
        lines[i] = newLine;
        return lines.join(eol);
      }
    }
    let last = sec.heading;
    for (let i = sec.start; i < sec.end; i++) if (lines[i].trim()) last = i;
    lines.splice(last + 1, 0, ...(QUOTE.test(lines[last]) ? ['', newLine] : [newLine]));
    return lines.join(eol);
  }

  // 칸의 내용을 바꾼다. 칸 안의 주석 줄은 그대로 맨 위에 남긴다.
  function setSectionText(text, name, value, before) {
    const { lines, eol } = splitLines(text);
    const mask = commentMask(lines);
    const valueLines = value.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');
    let sec = findSection(lines, name);
    if (!sec) {
      const at = insertAt(lines, before);
      const block = ['## ' + name].concat(value ? valueLines : []).concat(['']);
      if (at > 0 && lines[at - 1].trim()) block.unshift('');
      lines.splice(at, 0, ...block);
      return lines.join(eol);
    }
    const keep = [];
    for (let i = sec.start; i < sec.end; i++) if (mask[i]) keep.push(lines[i]);
    const isLast = sec.end === lines.length;
    const repl = keep.concat(value ? valueLines : []);
    if (!isLast) repl.push('');
    else if (lines[lines.length - 1] === '' || value) repl.push('');
    lines.splice(sec.start, sec.end - sec.start, ...repl);
    return lines.join(eol);
  }

  function touchModified(text, stamp) {
    const { lines, eol } = splitLines(text);
    if (lines[0] !== '---') return text;
    for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
      if (/^modified:/.test(lines[i])) { lines[i] = 'modified: ' + stamp; return lines.join(eol); }
    }
    return text;
  }

  // author 목록에 이름을 더한다(이미 있으면 그대로). 볼트 규칙: author는 [Taylor, Claude] 같은 목록.
  // 예전 형식(author: Taylor, 또는 줄마다 - 이름)도 읽어서 목록으로 바꿔 쓴다.
  function addAuthor(text, name) {
    const { lines, eol } = splitLines(text);
    if (lines[0] !== '---') return text;
    let end = lines.indexOf('---', 1);
    if (end < 0) return text;
    let at = -1;
    for (let i = 1; i < end; i++) if (/^author:/.test(lines[i])) { at = i; break; }
    let names = [];
    let span = 1;
    if (at >= 0) {
      const v = lines[at].slice(7).trim();
      if (v.startsWith('[')) names = v.replace(/^\[|\]$/g, '').split(',');
      else if (v) names = [v];
      else while (at + span < end && /^\s+-\s/.test(lines[at + span])) { names.push(lines[at + span].replace(/^\s+-\s*/, '')); span++; }
      names = names.map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    if (names.includes(name)) return text;
    names.push(name);
    const line = 'author: [' + names.join(', ') + ']';
    if (at >= 0) lines.splice(at, span, line);
    else lines.splice(end, 0, line);
    return lines.join(eol);
  }

  // 양식 채우기. 대시보드로 만든 로그는 Taylor가 쓰기 시작한 것이므로 author: [Taylor], model 줄은 뺀다.
  function fillTemplate(tpl, date, time) {
    let t = tpl.replace(/\{\{date(:[^}]*)?\}\}/g, date).replace(/\{\{time(:[^}]*)?\}\}/g, time);
    t = t.replace(/^author:.*\r?\n(?:[ \t]+-.*\r?\n)*/m, 'author: [Taylor]\n').replace(/^model:.*\r?\n/m, '');
    return t;
  }

  // 화면 표시용: [[링크|별칭]] → 별칭, [[링크]] → 링크, `코드` → 코드.
  function display(s) {
    return String(s)
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
  }

  const api = { parseLog, getSectionText, toggleTask, editBullet, appendToSection, setSectionText, touchModified, addAuthor, fillTemplate, display, splitLines };
  global.MD = api;
})(typeof window !== 'undefined' ? window : this);
