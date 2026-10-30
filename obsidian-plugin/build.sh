#!/bin/zsh
# 옵시디언 플러그인 만들기 — js/markdown.js를 앞에 붙여 main.js 하나로 만들고 볼트에 넣는다.
# markdown.js를 고치면 다시 돌린다. 옵시디언에서는 플러그인을 껐다 켜거나 앱을 다시 열면 바뀐다.
HERE="${0:A:h}"
OUT="$HOME/Library/CloudStorage/GoogleDrive-hyobeen.moon@gmail.com/My Drive/Taylor 2 Brain/.obsidian/plugins/log-task-mover"
mkdir -p "$OUT"
{
  echo "// 만든 파일 — 고치지 말 것. 원본: Obsidian Dashboard 저장소 obsidian-plugin/plugin.js + js/markdown.js (build.sh)"
  echo "const MD = (function () { const window = {};"
  cat "$HERE/../js/markdown.js"
  echo "return window.MD; })();"
  cat "$HERE/plugin.js"
} > "$OUT/main.js"
cp "$HERE/manifest.json" "$OUT/manifest.json"
echo "$OUT"
