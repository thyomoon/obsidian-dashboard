// 옵시디언에서 데일리 로그 할 일을 체크하면 대시보드와 똑같이 옮긴다.
// 「남은 일」에서 체크 → 체크한 날(오늘) 로그 「한 일」로(지난 날짜면 「(MM/DD 남은 일)」을 붙여서).
// 「한 일」에서 체크를 풀면 → 원래 날짜의 「남은 일」로. 볼트 Rules/작업 규칙.md 24.
// 위에 붙은 MD는 대시보드 js/markdown.js 그대로다(build.sh가 붙인다).
const { Plugin, TFile, Notice } = require('obsidian');

const LOG_DIR = '2. Area of Responsibility/My Think/0. 데일리 로그';
const TEMPLATE = 'Templates/데일리 로그.md';
const DONE_BEFORE = ['내가 내린 결정', '남은 일', '새로운 아이디어', '오늘의 일기'];
const OPEN_BEFORE = ['새로운 아이디어', '오늘의 일기'];
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const timeHM = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const md = (date) => date.slice(5).replace('-', '/');

// 이전 글과 지금 글을 비교해서, 새로 체크된 「남은 일」과 새로 풀린 「한 일」을 찾는다.
function changes(prev, next) {
  const before = MD.parseLog(prev || '').tasks;
  const was = (sec, done) => new Set(before.filter((t) => t.section === sec && t.done === done).map((t) => t.text));
  const open = was('남은 일', false);
  const closed = was('한 일', true);
  const now = MD.parseLog(next).tasks;
  return {
    done: now.filter((t) => t.section === '남은 일' && t.done && open.has(t.text)),
    reopen: now.filter((t) => t.section === '한 일' && !t.done && closed.has(t.text))
  };
}

// 「(10/25 남은 일)」에서 원래 날짜를 찾는다. 해가 넘어가면 작년으로.
function originDate(here, mmdd) {
  if (!mmdd) return here;
  let date = here.slice(0, 4) + '-' + mmdd.replace('/', '-');
  if (date > here) date = (Number(here.slice(0, 4)) - 1) + date.slice(4);
  return date;
}

class LogTaskMover extends Plugin {
  async onload() {
    this.snap = new Map();
    this.timers = new Map();
    this.app.workspace.onLayoutReady(async () => {
      for (const f of this.logs()) this.snap.set(f.path, await this.app.vault.read(f));
      this.registerEvent(this.app.vault.on('modify', (f) => this.later(f)));
      this.registerEvent(this.app.vault.on('create', async (f) => { if (this.isLog(f)) this.snap.set(f.path, await this.app.vault.read(f)); }));
      this.registerEvent(this.app.vault.on('rename', (f, old) => { this.snap.set(f.path, this.snap.get(old)); this.snap.delete(old); }));
    });
  }

  onunload() { for (const t of this.timers.values()) clearTimeout(t); }

  isLog(f) { return f instanceof TFile && f.parent && f.parent.path === LOG_DIR && /^\d{4}-\d{2}-\d{2}$/.test(f.basename); }
  logs() { return this.app.vault.getMarkdownFiles().filter((f) => this.isLog(f)); }
  logOf(date) { const f = this.app.vault.getAbstractFileByPath(LOG_DIR + '/' + date + '.md'); return f instanceof TFile ? f : null; }

  // 저장이 몰려 들어오므로 잠깐 기다렸다가 한 번만 본다.
  later(f) {
    if (!this.isLog(f)) return;
    clearTimeout(this.timers.get(f.path));
    this.timers.set(f.path, setTimeout(() => this.check(f).catch((e) => new Notice('할 일 옮기기 실패: ' + e.message)), 700));
  }

  async check(f) {
    const text = await this.app.vault.read(f);
    const prev = this.snap.get(f.path);
    this.snap.set(f.path, text);
    if (prev === text) return;
    const { done, reopen } = changes(prev, text);
    for (const t of done) await this.complete(f, t);
    for (const t of reopen) await this.reopen(f, t);
  }

  // 고친 뒤 스냅숏도 같이 바꿔서, 내가 쓴 변경으로 다시 옮기지 않게 한다. ref는 지금 글에서 같은 줄을 다시 찾는다.
  async edit(f, fn, mine) {
    const stamp = dateKey(new Date()) + 'T' + timeHM(new Date());
    const out = await this.app.vault.process(f, (t) => {
      let n = MD.touchModified(fn(t), stamp);
      if (mine) n = MD.addAuthor(n, 'Taylor');
      return n;
    });
    this.snap.set(f.path, out);
  }

  async move(from, task, to, sec, line, before) {
    const drop = (t) => MD.editBullet(t, task, null);
    if (from === to) return this.edit(from, (t) => MD.appendToSection(drop(t), sec, line, before), true);
    await this.edit(to, (t) => MD.appendToSection(t, sec, line, before), true);
    await this.edit(from, drop);
  }

  async today() {
    const date = dateKey(new Date());
    const have = this.logOf(date);
    if (have) return have;
    const tpl = this.app.vault.getAbstractFileByPath(TEMPLATE);
    const text = MD.fillTemplate(tpl instanceof TFile ? await this.app.vault.read(tpl) : '', date, timeHM(new Date()));
    const f = await this.app.vault.create(LOG_DIR + '/' + date + '.md', text);
    this.snap.set(f.path, text);
    return f;
  }

  async complete(f, task) {
    const to = await this.today();
    const tag = f.basename === to.basename ? '' : ' (' + md(f.basename) + ' 남은 일)';
    await this.move(f, task, to, '한 일', '- [x] ' + task.text + tag, DONE_BEFORE);
    new Notice('오늘 「한 일」로 옮겼어요.');
  }

  async reopen(f, task) {
    const o = MD.splitOrigin(task.text);
    const target = this.logOf(originDate(f.basename, o.md)) || f;
    await this.move(f, task, target, '남은 일', '- [ ] ' + o.text, OPEN_BEFORE);
    new Notice(md(target.basename) + ' 「남은 일」로 돌려보냈어요.');
  }
}

module.exports = LogTaskMover;
module.exports.changes = changes;
module.exports.originDate = originDate;
