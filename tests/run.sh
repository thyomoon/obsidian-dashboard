#!/bin/zsh
# markdown.js 테스트 — 볼트의 실제 데일리 로그를 임시 폴더로 복사해서 읽는다(볼트는 고치지 않음).
# jsc가 한글 경로를 못 열어서 영문 이름으로 복사한다.
HERE="${0:A:h}"
VAULT="$HOME/Library/CloudStorage/GoogleDrive-hyobeen.moon@gmail.com/My Drive/Taylor 2 Brain"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$HERE/markdown.test.js" "$TMP/test.js"
cp "$HERE/../js/markdown.js" "$TMP/markdown.js"
cp "$VAULT/Templates/데일리 로그.md" "$TMP/template.md"
logs=()
for f in "$VAULT/2. Area of Responsibility/My Think/0. 데일리 로그/"20*.md; do
  cp "$f" "$TMP/${f:t}"; logs+=("$TMP/${f:t}")
done
"$JSC" "$TMP/test.js" -- "$TMP/markdown.js" "$TMP/template.md" "${logs[@]}"
