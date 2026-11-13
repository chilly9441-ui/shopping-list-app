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

const PORT_IN_USE_MESSAGE =
  `포트 ${PORT}을(를) 이미 다른 프로그램이 쓰고 있습니다. ` +
  `다른 포트로 실행해 주세요. 예: PORT=9000 npm run screenshot`;

// 한 번의 요청이 응답 없이 오래 걸리지 않도록 시간 제한을 둠
// (연결만 받고 아무 말도 안 하는 프로그램이 포트를 쓰면 기본값으로는 약 5분을 기다림)
const REQUEST_TIMEOUT_MS = 1000;

function request() {
  return fetch(URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

// 이 포트를 이미 누가 쓰고 있는지 확인
async function isPortTaken() {
  try {
    await request();
    return true; // 어떤 응답이든 왔다면 다른 서버가 떠 있음
  } catch (e) {
    // 연결은 됐는데 시간 안에 응답이 없으면 무언가 포트를 잡고 있는 것
    return e instanceof Error && e.name === "TimeoutError";
  }
}

// 우리가 띄운 정적 서버가 응답할 때까지 기다림 (최대 10초)
// 서버가 먼저 종료되면(포트 충돌 등) 다른 서버의 응답을 받기 전에 바로 실패시킴
async function waitForServer(server) {
  let exitCode = null;
  server.once("exit", (code) => (exitCode = code ?? -1));

  for (let i = 0; i < 50; i++) {
    if (exitCode !== null) {
      throw new Error(`정적 서버가 시작되지 못했습니다(종료 코드 ${exitCode}). ${PORT_IN_USE_MESSAGE}`);
    }
    try {
      const res = await request();
      if (res.ok) return;
    } catch {
      // 아직 서버가 안 떴으면 잠시 후 다시 시도
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${URL} 서버가 10초 안에 응답하지 않습니다.`);
}

(async () => {
  // 이미 누가 이 포트를 쓰고 있으면, 그 서버의 엉뚱한 화면을 찍지 않도록 시작 전에 중단
  if (await isPortTaken()) throw new Error(PORT_IN_USE_MESSAGE);

  const server = spawn(process.execPath, [path.join(ROOT, "tests", "static-server.js"), String(PORT)], {
    stdio: ["ignore", "ignore", "pipe"], // 서버 에러 메시지는 받아 두었다가 실패 시 보여 줌
  });
  let serverErrors = "";
  server.stderr.on("data", (chunk) => (serverErrors += chunk));

  let browser;
  try {
    await waitForServer(server).catch((e) => {
      if (serverErrors) e.message += `\n\n[정적 서버 출력]\n${serverErrors.trim()}`;
      throw e;
    });
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
