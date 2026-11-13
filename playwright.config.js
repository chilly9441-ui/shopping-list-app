// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// 다른 프로젝트 서버와 겹치면 PORT 환경변수로 바꿀 수 있음 (예: PORT=9000 npm test)
const PORT = Number(process.env.PORT || 8765);
// 테스트 서버가 127.0.0.1에만 열리므로 주소도 localhost 대신 127.0.0.1로 맞춤
// (localhost는 PC에 따라 IPv6 ::1로 먼저 연결될 수 있음)
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // 정적 파일 앱이므로 테스트 전에 Node 내장 모듈로 만든 간단한 서버를 띄움 (OS·Python 설치와 무관)
  webServer: {
    command: `node tests/static-server.js ${PORT}`,
    url: BASE_URL,
    // 이미 그 포트에 다른 서버(다른 폴더의 앱 등)가 떠 있으면 재사용하지 않고 바로 오류를 냄
    // → 엉뚱한 페이지를 검사하는 일을 막음
    reuseExistingServer: false,
  },
});
