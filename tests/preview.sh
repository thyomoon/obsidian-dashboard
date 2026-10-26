#!/bin/zsh
# 구글 연결 없이 화면 미리보기. 볼트의 실제 데일리 로그를 임시 폴더로 복사해 가짜 구글(fake-google.js)로 띄운다.
# 서버를 띄우지 않고 파일(file://)로 연다. 로그 내용은 임시 폴더에만 생기고 저장소에는 들어가지 않는다.
#   tests/preview.sh           → 크롬에서 미리보기 열기
#   tests/preview.sh shot DIR  → 데스크톱 · 폰 화면을 DIR에 png로 찍기
HERE="${0:A:h}"; ROOT="${HERE:h}"
VAULT="$HOME/Library/CloudStorage/GoogleDrive-hyobeen.moon@gmail.com/My Drive/Taylor 2 Brain"
TMP="${TMPDIR:-/tmp}/od-preview"; rm -rf "$TMP"; mkdir -p "$TMP"
cp -R "$ROOT/css" "$ROOT/js" "$ROOT/index.html" "$ROOT/icon.svg" "$ROOT/icon-180.png" "$TMP/"
cp "$HERE/fake-google.js" "$TMP/js/google.js"
sed -i '' "s|CLIENT_ID: '[^']*'|CLIENT_ID: 'demo'|" "$TMP/js/config.js"
sed -i '' 's|<link rel="manifest" href="manifest.webmanifest">||; s|<script src="js/google.js"></script>|<script src="js/fixtures.js"></script><script src="js/google.js"></script>|' "$TMP/index.html"
python3 - "$VAULT" "$TMP/js/fixtures.js" <<'EOF'
import json, sys, pathlib, unicodedata
v = pathlib.Path(sys.argv[1])
logs = sorted((v / '2. Area of Responsibility/My Think/0. 데일리 로그').glob('20*.md'))
data = {'template': (v / 'Templates/데일리 로그.md').read_text(encoding='utf-8'),
        'logs': [{'name': unicodedata.normalize('NFC', p.name), 'text': p.read_text(encoding='utf-8')} for p in logs]}
pathlib.Path(sys.argv[2]).write_text('window.FIXTURES = ' + json.dumps(data, ensure_ascii=False) + ';', encoding='utf-8')
EOF
# ?click=선택자|선택자 … 로 화면을 눌러 본 상태를 찍을 수 있게 한다(미리보기 전용).
cat > "$TMP/js/clicks.js" <<'JS'
(function () {
  const q = new URLSearchParams(location.search).get('click');
  if (!q) return;
  const steps = q.split('|');
  let i = 0;
  // 단계: "선택자" → 누르기, "선택자=>글" → 글 넣기, "submit:선택자" → 제출, "dump[:YYYY-MM-DD]" → 그날(기본 오늘) 로그 파일 내용만 화면에 보이기
  (function next() {
    if (i >= steps.length) return;
    const st = steps[i++];
    if (st.startsWith('dump')) {
      const day = st.slice(5) || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      const f = Object.values(G._files).filter((x) => x.name.startsWith(day));
      const pre = document.createElement('pre'); pre.id = 'dump'; pre.style.cssText = 'white-space:pre-wrap;font-size:12px;background:#fff;padding:12px;margin:16px';
      pre.textContent = f.length ? f[0].text : '(오늘 파일 없음)'; document.body.innerHTML = ''; document.body.appendChild(pre);
    } else if (st.startsWith('submit:')) document.querySelector(st.slice(7)).requestSubmit();
    else if (st.includes('=>')) { const [sel, v] = st.split('=>'); const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
    else { const el = document.querySelector(st); if (el) el.click(); }
    setTimeout(next, 1600);
  })();
})();
JS
sed -i '' 's|<script src="js/app.js"></script>|<script src="js/app.js"></script><script>setTimeout(function(){var s=document.createElement("script");s.src="js/clicks.js";document.body.appendChild(s)},1200)</script>|' "$TMP/index.html"
# 폰 화면: 헤드리스 크롬은 창 최소 폭이 있어서 390px 프레임 안에 띄운다.
cat > "$TMP/phone.html" <<'HTML'
<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="f" style="border:0;width:390px;height:1300px"></iframe>
<script>document.getElementById('f').src='index.html'+location.search;</script>
HTML
URL="file://$TMP/index.html"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ "$1" == "shot" ]]; then
  OUT="${2:-.}"
  "$CH" --headless=new --hide-scrollbars --window-size=1440,1500 --virtual-time-budget=${BUDGET:-6000} --screenshot="$OUT/desktop$4.png" "$URL$3" 2>/dev/null
  "$CH" --headless=new --hide-scrollbars --window-size=600,1300 --virtual-time-budget=${BUDGET:-6000} --screenshot="$OUT/phone$4.png" "file://$TMP/phone.html$3" 2>/dev/null
  ls "$OUT"/*.png
else
  open -a "Google Chrome" "$URL"
fi
