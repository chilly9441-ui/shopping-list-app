// README용 앱 스크린샷(docs/screenshot.png)을 다시 찍는 스크립트
// 사용법: npm run screenshot   (다른 포트를 쓰려면 PORT=9000 npm run screenshot)
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8799);
const URL = `http://127.0.0.1:${PORT}`;
const OUTPUT = path.join(ROOT, "docs", "screenshot.png");

const SAMPLE_ITEMS = ["우유", "계란 한 판", "식빵", "사과", "주방 세제"];
const DONE_ITEMS = ["계란 한 판", "식빵"];

// 정적 서버가 응답할 때까지 기다림 (최대 10초)
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      // 아직 서버가 안 떴으면 잠시 후 다시 시도
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${URL} 서버가 응답하지 않습니다. 포트가 이미 사용 중인지 확인해 주세요.`);
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, "tests", "static-server.js"), String(PORT)], {
    stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    // 고해상도 화면에서도 선명하도록 2배율로 찍음
    const page = await browser.newPage({ viewport: { width: 480, height: 560 }, deviceScaleFactor: 2 });
    await page.goto(URL);

    for (const name of SAMPLE_ITEMS) {
      await page.fill("#item-input", name);
      await page.press("#item-input", "Enter");
    }
    for (const name of DONE_ITEMS) {
      await page.getByText(name, { exact: true }).click();
    }

    // 포커스 테두리·마우스 hover가 사진에 남지 않게 정리
    await page.locator("#item-input").blur();
    await page.mouse.move(0, 0);

    await page.locator(".app").screenshot({ path: OUTPUT });
    console.log(`저장됨: ${path.relative(ROOT, OUTPUT)}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
