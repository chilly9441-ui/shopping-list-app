# 🛒 쇼핑리스트

HTML·CSS·순수 JavaScript로 만든 간단한 쇼핑리스트 웹 앱입니다. 빌드 과정 없이 브라우저에서 바로 동작하며, 이메일로 로그인하면 목록이 [Supabase](https://supabase.com/)에 저장되어 어느 기기에서든 같은 목록을 쓸 수 있습니다.

**🔗 배포 사이트: https://shopping-list-app-pt9i.vercel.app/**

<p align="center">
  <img src="docs/screenshot.png" alt="쇼핑리스트 앱 화면: 위쪽에 로그인한 이메일과 '로그아웃' 버튼, 아이템 5개 중 '계란 한 판'과 '식빵'이 완료로 체크되어 취소선이 그어져 있고, 아래에 '2 / 5 완료'와 '완료 항목 지우기' 버튼이 보임" width="440" />
</p>

## 주요 기능

- **이메일 로그인** — 이메일로 받은 로그인 링크(매직링크)를 누르면 로그인됩니다. 비밀번호가 필요 없습니다.
- **아이템 추가** — 앞뒤 공백은 자동으로 지우고, 최대 100자까지 입력할 수 있습니다.
- **입력 검사** — 빈 입력이나 공백만 입력하면 에러 메시지를 보여 줍니다.
- **중복 방지** — 아직 완료하지 않은 같은 이름(대소문자 무시)은 다시 추가되지 않습니다. 완료된 항목과 같은 이름은 다시 살 수 있도록 추가할 수 있습니다.
- **완료 체크** — 체크박스나 이름을 눌러 완료/취소합니다. 체크를 풀 때 같은 이름의 미완료 항목이 있으면 하나로 합칩니다.
- **삭제 / 완료 항목 지우기** — 항목을 하나씩 지우거나, 완료한 항목을 한 번에 지울 수 있습니다.
- **진행 상황 표시** — `완료 수 / 전체 수`를 아래쪽에 보여 줍니다.
- **서버 저장** — 바꾼 내용은 바로 Supabase에 저장됩니다. 저장에 실패하면 안내를 보여 주고 서버의 실제 목록으로 되돌립니다.
- **기기·탭 간 동기화** — 다른 탭이나 기기에서 바꾼 내용은 이 탭으로 돌아올 때 반영됩니다.
- **기존 목록 옮기기** — 로그인 전 버전에서 이 기기에 저장해 둔 목록은 처음 로그인할 때 계정으로 옮겨집니다.

## 접근성과 안전성

- 화면 읽기 프로그램이 추가·완료·삭제 같은 변경 내용을 읽어 줍니다(`aria-live`).
- 에러는 입력창과 연결되어(`aria-invalid`, `aria-describedby`) 입력창에서도 이유를 들을 수 있습니다.
- 삭제나 체크 후에도 키보드 포커스가 자연스러운 위치로 이동합니다.
- 누르는 영역이 24px 이상이고, 키보드로 이동할 때 포커스 테두리가 보입니다.
- 아이템 이름은 `textContent`로 넣어 HTML이 실행되지 않습니다(XSS 방지).
- DB의 RLS(행 단위 보안)로 로그인한 본인 항목만 읽고 쓸 수 있습니다. `config.js`의 publishable 키는 브라우저 공개용이라 저장소에 있어도 안전하며, secret 키는 코드에 넣지 않습니다.
- 좁은 화면에서도 가로 스크롤이 생기지 않는 반응형 레이아웃입니다.

## 실행 방법

설치 없이 [배포 사이트](https://shopping-list-app-pt9i.vercel.app/)에서 바로 써 볼 수 있습니다.

내 컴퓨터에서 실행하려면 `index.html` 파일을 브라우저로 열면 됩니다.

로컬 서버로 띄우고 싶다면 함께 들어 있는 정적 서버를 사용하세요(Node.js 필요).

```bash
node tests/static-server.js 8765
# 브라우저에서 http://127.0.0.1:8765 접속
```

## Supabase 설정

목록은 Supabase의 `shopping_items` 테이블(`id`, `user_id`, `name`, `done`, `created_at`)에 저장됩니다. 로그인 링크가 배포 사이트로 돌아오게 하려면 Supabase 대시보드의 **Authentication → URL Configuration**에서 아래처럼 설정해야 합니다.

- **Site URL**: `https://shopping-list-app-pt9i.vercel.app`
- **Redirect URLs**: `https://shopping-list-app-pt9i.vercel.app/**`, `http://127.0.0.1:8765/**` (로컬에서 시험할 때)

## 배포

이 저장소는 [Vercel](https://vercel.com/)과 연결되어 있어, `main` 브랜치에 push하면 자동으로 [배포 사이트](https://shopping-list-app-pt9i.vercel.app/)에 반영됩니다. 빌드 과정이 없는 정적 사이트라 별도 설정은 필요 없습니다.

## 테스트

[Playwright](https://playwright.dev/)로 작성한 E2E 테스트가 들어 있습니다. 테스트를 실행하면 정적 서버가 자동으로 켜집니다.

```bash
npm install
npx playwright install chromium   # 처음 한 번만
npm test                          # 테스트 실행
npm run test:headed               # 브라우저 창을 띄워서 실행
npm run test:report               # HTML 리포트 열기
```

테스트와 스크린샷은 실제 Supabase 대신 `tests/fake-supabase.js`를 써서, 인터넷 연결이나 로그인 없이 돌아갑니다.

기본 포트는 `8765`입니다. 다른 서버와 겹치면 `PORT` 환경 변수로 바꿀 수 있습니다(예: `PORT=9000 npm test`).

## 스크린샷 다시 찍기

화면 디자인을 바꾼 뒤에는 아래 명령으로 README의 스크린샷(`docs/screenshot.png`)을 새로 만들 수 있습니다. 예시 아이템 5개를 넣고 2개를 완료 처리한 화면을 찍습니다.

```bash
npm run screenshot
```

## 파일 구성

```
├── index.html             # 화면 구조
├── style.css              # 스타일 (반응형, 포커스 표시)
├── config.js              # Supabase 주소와 공개용(publishable) 키
├── app.js                 # 앱 동작 (로그인·추가·완료·삭제·서버 저장·동기화)
├── playwright.config.js   # 테스트 설정
├── package.json
├── docs/
│   └── screenshot.png     # README용 앱 스크린샷
├── scripts/
│   └── screenshot.js      # 스크린샷 자동 촬영 스크립트
└── tests/
    ├── shopping-list.spec.js  # E2E 테스트
    ├── fake-supabase.js       # 테스트용 가짜 Supabase 클라이언트 (실제 서버에 접속하지 않음)
    ├── use-fake-supabase.js   # 테스트·스크린샷에서 가짜 클라이언트로 바꿔 끼우는 도우미
    └── static-server.js       # 테스트용 정적 파일 서버 (Node 내장 모듈만 사용)
```
