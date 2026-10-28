// 이 파일은 공개된다(GitHub Pages). 비밀번호 · 토큰은 넣지 않는다.
// CLIENT_ID는 비밀이 아니다 — 구글 클라우드에서 허용한 주소에서만 로그인이 된다.
window.CONFIG = {
  CLIENT_ID: '428480129048-s0kneq0r2tpuj55jpv7inumjb56nk3a8.apps.googleusercontent.com',

  // 구글 드라이브 "내 드라이브" 아래 볼트 경로
  VAULT_PATH: ['Taylor 2 Brain'],
  LOG_PATH: ['2. Area of Responsibility', 'My Think', '0. 데일리 로그'],
  TEMPLATE_PATH: ['Templates', '데일리 로그.md'],
  // 미팅 노트 폴더 — 「Next Steps」 체크박스를 할 일에 함께 보여 주고, 체크는 그 노트에서 한다
  MEETINGS_PATH: ['2. Area of Responsibility', 'Meetings'],

  // 옵시디언 앱에서 쓰는 볼트 이름 — "옵시디언에서 열기" 링크용
  OBSIDIAN_VAULT: 'Taylor 2 Brain',

  // 볼트 규칙: 시각은 샌프란시스코 현지 시각
  TIME_ZONE: 'America/Los_Angeles',

  SCOPES: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar.readonly'
  ]
};
