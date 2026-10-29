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
sed -i '' 's|<link rel="manifest" href="manifest.webmanifest">||; s|<script src="js/google.js[^"]*"></script>|<script src="js/fixtures.js"></script><script src="js/google.js"></script>|' "$TMP/index.html"
python3 - "$VAULT" "$TMP/js/fixtures.js" <<'EOF'
import json, sys, pathlib, unicodedata
v = pathlib.Path(sys.argv[1])
logs = sorted((v / '2. Area of Responsibility/My Think/0. 데일리 로그').glob('20*.md'))
meets = sorted(p for p in (v / '2. Area of Responsibility/Meetings').glob('20*.md'))
import datetime, zoneinfo
today = datetime.datetime.now(zoneinfo.ZoneInfo('America/Los_Angeles')).strftime('%Y-%m-%d')
# 미리보기 전용 예시 회의록 — 마크다운 문법이 어떻게 보이는지 확인용(볼트에는 없다)
DEMO = r'''---
type: meeting
description: "미리보기용 예시 — 볼트에는 없음"
author: [Taylor]
tags: []
meeting_at: TODAYT09:00
attendees: ["[[Kris Yu]]", "[[Paul]]"]
area: 회사
project: "[[Webster 리스]]"
related: ["[[Webster]]"]
---
<!-- 미리보기 전용 예시 회의록 -->

# 1부 — 리스 조건 검토

## Summary

### 임대 조건
* Base rent는 **연 3% 인상**, 첫 해는 ==무상 3개월==
	* 무상 기간 동안 CAM은 tenant 부담
* 자세한 내용은 [[2026-10-22 대화 회의록 — Legal Work 프로젝트]] 참고 #webster

| 항목 | 현재 | 제안 | 차이 |
|---|---|---|--:|
| Base Rent ($/sf) | 42.00 | 44.50 | +2.50 |
| TI Allowance | $60 | $85 | +$25 |
| 무상 기간 | 없음 | 3개월 | +3 |

### 진행 순서
1. Tenant 측 LOI 회신 받기
2. 내부 IC 보고
   1. 재무 모델 업데이트
   2. 리스크 메모
3. 계약서 초안

> [!warning] 주의
> 보증금 조건이 바뀌면 lender 동의가 필요할 수 있음 — `Section 10(h)` 확인

> [!note] 참고
> 지난 회의와 같은 조건이면 승인 절차를 줄일 수 있다고 함

> Kris: "가격보다 기간이 더 중요하다"

---

# 2부 — 다음 단계

> [!claude] 2026-10-29T10:51
> Claude가 녹취를 바탕으로 정리한 칸 예시. 안쪽 체크박스도 누를 수 있다.
> - [ ] Claude 콜아웃 안의 할 일

```
Base rent 계산: 12,500 sf × $44.50 = $556,250 / year
```

![[평면도.png]]

## Next Steps
- [ ] LOI 회신 기한 확인 (2026-11-03)
- [x] 재무 모델 초안 공유
- Paul이 lender에 보증금 조건 문의 (Paul 몫이라 불릿)
'''
data = {'template': (v / 'Templates/데일리 로그.md').read_text(encoding='utf-8'),
        'meetTemplate': (v / 'Templates/Meeting Minutes.md').read_text(encoding='utf-8'),
        'meetings': [{'name': today + ' 0900_예시 회의록 — 마크다운 미리보기.md', 'text': DEMO.replace('TODAY', today)}] +
                    [{'name': unicodedata.normalize('NFC', p.name), 'text': p.read_text(encoding='utf-8')} for p in meets],
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
sed -i '' 's|<script src="js/app.js[^"]*"></script>|<script src="js/app.js"></script><script>setTimeout(function(){var s=document.createElement("script");s.src="js/clicks.js";document.body.appendChild(s)},1200)</script>|' "$TMP/index.html"
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
