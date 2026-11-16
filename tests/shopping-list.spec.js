// @ts-check
const { test, expect } = require("@playwright/test");

const { useFakeSupabase, SUPABASE_CDN } = require("./use-fake-supabase");

const STORAGE_KEY = "shopping-list";
// 가짜 Supabase(tests/fake-supabase.js)가 쓰는 localStorage 키
const DB_KEY = "fake-supabase-db";
const SIGNED_OUT_KEY = "fake-supabase-signed-out";
const FAIL_KEY = "fake-supabase-fail";

// ---------- 도우미 ----------

/** 페이지 공통 요소 */
function ui(page) {
  return {
    input: page.getByRole("textbox", { name: "추가할 아이템" }),
    addBtn: page.getByRole("button", { name: "추가", exact: true }),
    error: page.locator("#error"),
    status: page.locator("#status"),
    empty: page.locator("#empty"),
    count: page.locator("#count"),
    clearDone: page.getByRole("button", { name: "완료 항목 지우기" }),
    checkboxes: page.locator(".item input[type=checkbox]"),
    labels: page.locator(".item label"),
  };
}

/** 입력창에 값을 넣고 Enter로 추가 */
async function add(page, name) {
  const { input } = ui(page);
  await input.fill(name);
  await input.press("Enter");
}

/** 화면의 목록을 ["이름", "이름(완료)"] 형태로 읽음 */
function readList(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".item")].map(
      (li) => li.querySelector("label").textContent + (li.classList.contains("done") ? "(완료)" : "")
    )
  );
}

/** 현재 포커스된 요소의 id */
function activeId(page) {
  return page.evaluate(() => document.activeElement?.id ?? "");
}

/** 앱이 로그인 상태를 확인하고 목록을 다 불러올 때까지 기다림 */
async function ready(page) {
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#list-section[aria-busy]")).toHaveCount(0);
}

/** 서버(가짜 DB)에 목록을 미리 넣고 새로고침 */
async function seed(page, items) {
  const rows = items.map((i, n) => ({ id: n + 1, name: i.name, done: Boolean(i.done) }));
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [DB_KEY, JSON.stringify(rows)]);
  await page.reload();
  await ready(page);
}

/** 서버(가짜 DB)에 저장된 목록을 ["이름", "이름(완료)"] 형태로 읽음 */
function readDb(page) {
  return page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key) || "[]").map(
        (/** @type {any} */ r) => r.name + (r.done ? "(완료)" : "")
      ),
    DB_KEY
  );
}

function hasHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

// 콘솔 오류·페이지 오류·404·alert 등이 생기면 테스트 실패로 처리
// (각 워커는 테스트를 하나씩 순서대로 실행하므로 모듈 변수로 보관해도 안전)
/** @type {string[]} */
let problems = [];

// 각 테스트는 새 브라우저 컨텍스트에서 실행되므로 localStorage(가짜 DB 포함)가 비어 있는 상태로 시작함
test.beforeEach(async ({ page, context }) => {
  problems = [];
  // 실제 Supabase 대신 가짜 클라이언트를 내려보냄 (로그인된 상태로 시작)
  await useFakeSupabase(context);
  await context.route("https://*.supabase.co/**", (route) => {
    problems.push(`실제 Supabase 요청: ${route.request().url()}`);
    return route.abort();
  });
  // 다른 탭(page)도 감시하도록 컨텍스트 단위로 등록
  context.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  context.on("weberror", (e) => problems.push(`pageerror: ${e.error().message}`));
  context.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  context.on("dialog", (d) => {
    problems.push(`dialog: ${d.message()}`);
    d.dismiss();
  });
  await page.goto("/");
  await ready(page);
});

test.afterEach(() => {
  expect(problems, "콘솔/네트워크 오류가 없어야 함").toEqual([]);
});

// ---------- 초기 상태 ----------

test("처음 화면: 빈 목록 안내, 비활성 버튼, 빈 카운트", async ({ page }) => {
  const { empty, clearDone, count } = ui(page);
  await expect(empty).toBeVisible();
  await expect(clearDone).toBeDisabled();
  await expect(count).toHaveText("");
});

// ---------- 입력 검사 ----------

test.describe("입력 검사", () => {
  test("빈 입력이면 에러를 보여 주고 입력창을 잘못됨으로 표시", async ({ page }) => {
    const { input, addBtn, error } = ui(page);
    await addBtn.click();
    await expect(error).toHaveText("아이템 이름을 입력해 주세요.");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", "error");
    expect(await activeId(page)).toBe("item-input");
  });

  test("다시 타이핑하면 에러가 사라짐", async ({ page }) => {
    const { input, addBtn, error } = ui(page);
    await addBtn.click();
    await input.pressSequentially("a");
    await expect(error).toHaveText("");
    await expect(input).not.toHaveAttribute("aria-invalid");
  });

  test("공백만 입력해도 에러", async ({ page }) => {
    await add(page, "   ");
    await expect(ui(page).error).toHaveText("아이템 이름을 입력해 주세요.");
    expect(await readList(page)).toEqual([]);
  });

  test("최대 100자까지만 입력됨", async ({ page }) => {
    const { input } = ui(page);
    await input.fill("가".repeat(150));
    expect((await input.inputValue()).length).toBe(100);
  });
});

// ---------- 추가 ----------

test.describe("추가", () => {
  test("앞뒤 공백을 지우고 추가, 입력창 비우고 포커스 유지", async ({ page }) => {
    const { input, empty, status, count } = ui(page);
    await add(page, "  우유  ");
    expect(await readList(page)).toEqual(["우유"]);
    await expect(input).toHaveValue("");
    expect(await activeId(page)).toBe("item-input");
    await expect(empty).toBeHidden();
    await expect(count).toHaveText("0 / 1 완료");
    await expect(status).toHaveText("우유 추가됨 (0 / 1 완료)");
  });

  test("HTML을 넣어도 실행되지 않고 글자로 표시 (XSS 방지)", async ({ page }) => {
    const payload = "<img src=x onerror=alert(1)>";
    await add(page, payload);
    await expect(page.locator(".item img")).toHaveCount(0);
    await expect(ui(page).labels).toHaveText([payload]);
  });

  test("빠르게 연속 추가해도 항목 ID가 겹치지 않음", async ({ page }) => {
    for (let i = 0; i < 20; i++) await add(page, "x" + i);
    const ids = await ui(page).checkboxes.evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });
});

// ---------- 중복 검사 ----------

test.describe("중복 검사", () => {
  test("완료하지 않은 같은 이름은 막고, 입력값을 남겨 전체 선택", async ({ page }) => {
    const { input, error } = ui(page);
    await add(page, "우유");
    await add(page, " 우유 ");
    await expect(error).toHaveText('"우유"은(는) 이미 목록에 있어요.');
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveValue(" 우유 ");
    const selectedAll = await input.evaluate(
      (el) => el.selectionStart === 0 && el.selectionEnd === el.value.length
    );
    expect(selectedAll).toBe(true);
    expect(await readList(page)).toEqual(["우유"]);
  });

  test("대소문자를 구분하지 않음", async ({ page }) => {
    await add(page, "Bread");
    await add(page, "bread");
    await expect(ui(page).error).toContainText("이미 목록에 있어요");
    expect(await readList(page)).toEqual(["Bread"]);
  });

  test("완료된 항목과 같은 이름은 새로 추가할 수 있음", async ({ page }) => {
    await add(page, "우유");
    await ui(page).labels.first().click();
    await add(page, "우유");
    await expect(ui(page).error).toHaveText("");
    expect(await readList(page)).toEqual(["우유(완료)", "우유"]);
  });
});

// ---------- 완료 체크 ----------

test.describe("완료 체크", () => {
  test("라벨 클릭으로 완료, 카운트·버튼·안내 갱신", async ({ page }) => {
    const { labels, count, clearDone, status } = ui(page);
    await add(page, "우유");
    await add(page, "빵");
    await labels.first().click();
    expect(await readList(page)).toEqual(["우유(완료)", "빵"]);
    await expect(count).toHaveText("1 / 2 완료");
    await expect(clearDone).toBeEnabled();
    await expect(status).toHaveText("우유 완료 (1 / 2 완료)");
  });

  test("키보드로 체크/해제해도 포커스가 유지됨", async ({ page }) => {
    const { checkboxes, status } = ui(page);
    await add(page, "우유");
    await add(page, "빵");
    const target = checkboxes.nth(1);
    const id = await target.getAttribute("id");
    await target.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");
    expect(await readList(page)).toEqual(["우유", "빵"]);
    expect(await activeId(page)).toBe(id);
    await expect(status).toHaveText(/^빵 완료 취소/);
  });

  test("체크를 풀 때 같은 이름이 있으면 하나로 합침", async ({ page }) => {
    const { checkboxes, status } = ui(page);
    await add(page, "우유");
    await add(page, "빵");
    await checkboxes.first().check();
    await add(page, "우유");
    expect(await readList(page)).toEqual(["우유(완료)", "빵", "우유"]);

    const keptId = await checkboxes.nth(2).getAttribute("id");
    await checkboxes.first().focus();
    await page.keyboard.press("Space");

    expect(await readList(page)).toEqual(["빵", "우유"]);
    expect(await activeId(page)).toBe(keptId);
    await expect(status).toContainText("하나로 합쳤습니다");

    await page.reload();
    await ready(page);
    expect(await readList(page)).toEqual(["빵", "우유"]);
  });
});

// ---------- 삭제 ----------

test.describe("삭제", () => {
  test("삭제 후 포커스가 다음 → 이전 → 입력창 순으로 이동", async ({ page }) => {
    const { checkboxes, empty, status } = ui(page);
    for (const n of ["A", "B", "C"]) await add(page, n);

    const cId = await checkboxes.nth(2).getAttribute("id");
    await page.getByRole("button", { name: "B 삭제" }).click();
    expect(await readList(page)).toEqual(["A", "C"]);
    expect(await activeId(page)).toBe(cId);

    const aId = await checkboxes.nth(0).getAttribute("id");
    await page.getByRole("button", { name: "C 삭제" }).click();
    expect(await activeId(page)).toBe(aId);

    await page.getByRole("button", { name: "A 삭제" }).click();
    expect(await activeId(page)).toBe("item-input");
    await expect(empty).toBeVisible();
    await expect(status).toContainText("목록이 비었습니다");
  });
});

// ---------- 완료 항목 지우기 ----------

test("완료 항목 지우기: 완료 항목만 지우고 버튼 비활성, 입력창 포커스", async ({ page }) => {
  const { checkboxes, clearDone, status } = ui(page);
  for (const n of ["사과", "배", "귤"]) await add(page, n);
  await checkboxes.nth(0).check();
  await checkboxes.nth(2).check();
  await clearDone.click();
  expect(await readList(page)).toEqual(["배"]);
  await expect(clearDone).toBeDisabled();
  expect(await activeId(page)).toBe("item-input");
  await expect(status).toHaveText("완료 항목 2개를 지웠습니다 (0 / 1 완료)");
});

// ---------- 서버 저장 ----------

test.describe("서버 저장", () => {
  test("추가·완료·삭제가 서버에 저장되고 새로고침 후에도 유지", async ({ page }) => {
    const { checkboxes } = ui(page);
    for (const n of ["사과", "배", "귤"]) await add(page, n);
    await checkboxes.nth(0).check();
    await checkboxes.nth(2).check();
    await page.getByRole("button", { name: "배 삭제" }).click();
    expect(await readDb(page)).toEqual(["사과(완료)", "귤(완료)"]);

    await page.reload();
    await ready(page);
    expect(await readList(page)).toEqual(["사과(완료)", "귤(완료)"]);
  });

  test("저장에 실패하면 안내하고 서버 목록으로 되돌림, 다음 성공 때 안내가 사라짐", async ({ page }) => {
    const syncError = page.locator("#sync-error");
    await add(page, "우유");
    await page.evaluate((key) => localStorage.setItem(key, "1"), FAIL_KEY);

    await ui(page).checkboxes.first().click(); // 실패 후 체크가 풀리므로 check() 대신 click()
    await expect(syncError).toContainText("저장하지 못했어요");
    expect(await readList(page)).toEqual(["우유"]); // 체크 표시가 되돌아감

    await add(page, "빵");
    expect(await readList(page)).toEqual(["우유"]);
    await expect(ui(page).input).toHaveValue("빵"); // 입력한 글자가 사라지지 않음

    await page.evaluate((key) => localStorage.removeItem(key), FAIL_KEY);
    await add(page, "빵");
    expect(await readList(page)).toEqual(["우유", "빵"]);
    await expect(syncError).toHaveText("");
  });

  test("다른 곳에서 먼저 같은 이름을 추가했으면 중복 안내", async ({ page }) => {
    // 화면에는 없지만 서버에는 이미 있는 상태 (다른 기기에서 추가)
    await page.evaluate(
      (key) => localStorage.setItem(key, JSON.stringify([{ id: 1, name: "우유", done: false }])),
      DB_KEY
    );
    await add(page, "우유");
    await expect(ui(page).error).toHaveText('"우유"은(는) 이미 목록에 있어요.');
    await expect(ui(page).input).toHaveValue("우유");
    expect(await readList(page)).toEqual(["우유"]); // 서버 목록을 다시 불러옴
  });
});

// ---------- 로그인 ----------

test.describe("로그인", () => {
  /** 로그아웃 상태로 다시 엶 */
  async function signOut(page) {
    await page.evaluate((key) => localStorage.setItem(key, "1"), SIGNED_OUT_KEY);
    await page.reload();
    await expect(page.locator("#loading")).toBeHidden();
  }

  test("로그인 전에는 이메일 입력만 보이고 목록은 숨김", async ({ page }) => {
    await signOut(page);
    await expect(page.getByRole("textbox", { name: "이메일 주소" })).toBeVisible();
    await expect(ui(page).input).toBeHidden();
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeHidden();
  });

  test("이메일을 넣으면 로그인 링크를 보내고 안내", async ({ page }) => {
    await signOut(page);
    const email = page.getByRole("textbox", { name: "이메일 주소" });
    await email.fill("  me@example.com ");
    await email.press("Enter");
    await expect(page.locator("#login-message")).toHaveText(
      "me@example.com로 로그인 링크를 보냈어요. 메일함을 확인해 주세요."
    );
    expect(await page.evaluate(() => /** @type {any} */ (window).__lastOtpEmail)).toBe("me@example.com");
  });

  test("잘못된 이메일이면 에러, 전송 실패도 안내", async ({ page }) => {
    await signOut(page);
    const email = page.getByRole("textbox", { name: "이메일 주소" });
    const error = page.locator("#login-error");

    await email.fill("not-an-email");
    await email.press("Enter");
    await expect(error).toHaveText("올바른 이메일 주소를 입력해 주세요.");
    await expect(email).toHaveAttribute("aria-invalid", "true");

    await page.evaluate((key) => localStorage.setItem(key, "1"), FAIL_KEY);
    await email.fill("me@example.com");
    await expect(error).toHaveText("");
    await email.press("Enter");
    await expect(error).toHaveText("요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
    await expect(page.locator("#login-message")).toHaveText("");
  });

  test("로그인하면 이메일과 로그아웃 버튼, 로그아웃하면 목록을 숨김", async ({ page }) => {
    await add(page, "우유");
    await expect(page.locator("#user-email")).toHaveText("tester@example.com");
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page.getByRole("textbox", { name: "이메일 주소" })).toBeVisible();
    await expect(ui(page).labels).toHaveCount(0);
    // 다른 기기는 로그인 상태를 유지하도록 이 기기만 로그아웃
    expect(await page.evaluate(() => /** @type {any} */ (window).__lastSignOutScope)).toBe("local");
  });

  test("supabase-js를 불러오지 못하면 안내를 보여 줌", async ({ page }) => {
    await page.route(SUPABASE_CDN, (route) => route.abort());
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "앱을 불러오지 못했어요" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "이메일 주소" })).toBeHidden();
    // 일부러 막은 CDN 요청의 콘솔 오류는 이 테스트에서 예상된 것이므로 제외
    problems = problems.filter((p) => !p.includes("Failed to load resource"));
  });
});

// ---------- 이 기기 목록을 계정으로 옮기기 ----------

const LEGACY_KEY = "shopping-list-items";

/** 로그인 전 버전의 기기 저장 데이터(와 필요하면 서버 목록)를 넣고 새로고침 */
async function seedLocal(page, { legacy, local, server } = {}) {
  await page.evaluate(
    ([entries]) => {
      for (const [k, v] of entries) if (v !== null) localStorage.setItem(k, v);
    },
    [
      [
        [LEGACY_KEY, legacy === undefined ? null : typeof legacy === "string" ? legacy : JSON.stringify(legacy)],
        [STORAGE_KEY, local === undefined ? null : JSON.stringify(local)],
        [DB_KEY, server === undefined ? null : JSON.stringify(server)],
      ],
    ]
  );
  await page.reload();
  await ready(page);
}

function readLocalKeys(page) {
  return page.evaluate(([a, b]) => [localStorage.getItem(a), localStorage.getItem(b)], [LEGACY_KEY, STORAGE_KEY]);
}

test.describe("이 기기 목록을 계정으로 옮기기", () => {
  test("기기 목록을 서버로 옮기고 기기에서는 지움, 새로고침해도 한 번만 옮김", async ({ page }) => {
    await seedLocal(page, {
      local: [
        { id: "a", name: "우유", done: false },
        { id: "b", name: "빵", done: true },
      ],
    });
    expect(await readList(page)).toEqual(["우유", "빵(완료)"]);
    expect(await readDb(page)).toEqual(["우유", "빵(완료)"]);
    expect(await readLocalKeys(page)).toEqual([null, null]);
    await expect(ui(page).status).toHaveText("이 기기에 있던 항목 2개를 계정으로 옮겼습니다");

    await page.reload();
    await ready(page);
    expect(await readList(page)).toEqual(["우유", "빵(완료)"]);
  });

  test("더 이전 버전 목록도 옮기고, 서버 목록 뒤에 붙이며 미완료 같은 이름은 하나만 남김", async ({ page }) => {
    await seedLocal(page, {
      server: [{ id: 1, name: "우유", done: false }],
      legacy: [
        { id: 1, text: "우유", checked: false }, // 서버에 이미 있음 → 빠짐
        { id: 2, text: "  계란  ", checked: false },
        { id: 3, text: "계란", checked: false }, // 이전 목록 안의 중복 → 빠짐
        { id: 4, text: "우유", checked: true }, // 완료된 항목은 남김
      ],
    });
    expect(await readList(page)).toEqual(["우유", "계란", "우유(완료)"]);
    expect(await readLocalKeys(page)).toEqual([null, null]);
  });

  test("이미 옮긴 뒤 이전 버전 탭이 다시 저장해도 다시 옮기지 않고 지움", async ({ page }) => {
    await seedLocal(page, { legacy: [{ id: 1, text: "우유", checked: true }] });
    expect(await readList(page)).toEqual(["우유(완료)"]);

    // 새 앱에서 지운 뒤, 열려 있던 이전 버전 탭이 자기 목록을 다시 저장한 상황
    await page.getByRole("button", { name: "우유 삭제" }).click();
    await seedLocal(page, { legacy: [{ id: 1, text: "우유", checked: true }, { id: 2, text: "빵" }] });

    await expect(ui(page).empty).toBeVisible(); // 지운 우유가 되살아나지 않음
    expect((await readLocalKeys(page))[0]).toBeNull();
  });

  test("잘못된 항목은 버리고 긴 이름은 100자로 자름", async ({ page }) => {
    await seedLocal(page, {
      legacy: [null, "s", { text: 3 }, { text: "   " }, { text: "가".repeat(150), checked: false }],
      local: [null, { id: 1 }, { name: 5 }, { name: "ok", done: "yes" }],
    });
    expect(await readList(page)).toEqual(["ok(완료)", "가".repeat(100)]);
  });

  test("이전 데이터의 JSON이 깨져 있으면 건드리지 않음", async ({ page }) => {
    await seedLocal(page, { legacy: "{bad", server: [{ id: 1, name: "우유", done: false }] });
    expect(await readList(page)).toEqual(["우유"]);
    expect((await readLocalKeys(page))[0]).toBe("{bad");
  });

  test("서버로 옮기기에 실패하면 기기 목록을 남겨 둠", async ({ page }) => {
    await page.evaluate((key) => localStorage.setItem(key, "1"), FAIL_KEY);
    await seedLocal(page, { local: [{ id: "a", name: "우유", done: false }] });
    await expect(page.locator("#sync-error")).toContainText("저장하지 못했어요");
    expect((await readLocalKeys(page))[1]).not.toBeNull();
  });
});

// ---------- 탭 동기화 ----------

test("다른 탭에서 바꾼 내용이 돌아올 때 반영되고 중복 검사에도 쓰임", async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto("/");
  await ready(other);
  await add(other, "탭2");

  const comeBack = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await comeBack();
  await expect(ui(page).labels).toHaveText(["탭2"]);
  await add(page, "탭2");
  await expect(ui(page).error).toContainText("이미 목록에 있어요");

  await other.getByRole("button", { name: "탭2 삭제" }).click();
  await comeBack();
  await expect(ui(page).labels).toHaveCount(0);
  await other.close();
});

// ---------- 반응형 ----------

test.describe("반응형", () => {
  for (const width of [320, 360, 768]) {
    test(`${width}px: "추가" 버튼이 한 줄이고 가로 스크롤 없음`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      const box = await ui(page).addBtn.boundingBox();
      expect(box?.height).toBeLessThanOrEqual(46);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }

  test("공백 없는 긴 이름의 중복 안내도 줄바꿈되어 가로 스크롤 없음", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    for (const v of ["A".repeat(100), "가".repeat(100)]) {
      await add(page, v);
      await add(page, v);
      await expect(ui(page).error).toContainText("이미 목록에 있어요");
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
  });
});

// ---------- 접근성 ----------

test.describe("접근성", () => {
  test("누르는 영역이 24px 이상이고, 완료 항목 지우기 글자는 목록 오른쪽 끝에 맞음", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await seed(page, [{ name: "우유", done: true }]);

    const clear = await ui(page).clearDone.boundingBox();
    const del = await page.locator(".delete-btn").first().boundingBox();
    expect(clear?.height).toBeGreaterThanOrEqual(24);
    expect(del?.width).toBeGreaterThanOrEqual(24);
    expect(del?.height).toBeGreaterThanOrEqual(24);

    const diff = await page.evaluate(() => {
      const btn = document.getElementById("clear-done").getBoundingClientRect();
      const item = document.querySelector(".item").getBoundingClientRect();
      return Math.round(btn.right - 8 - item.right); // 8 = 버튼 오른쪽 안쪽 여백
    });
    expect(diff).toBe(0);
  });

  test("Tab 순서와 키보드 포커스 시 파란 테두리", async ({ page }) => {
    await seed(page, [{ name: "A", done: true }]);
    await page.locator("h1").click();

    const seen = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          const s = getComputedStyle(el);
          return {
            // id → aria-label → 보이는 글자 순으로, 요소마다 서로 다른 이름이 나오게 기록
            name: el.id || el.getAttribute("aria-label") || el.textContent.trim(),
            ring: s.outlineStyle === "solid" && s.outlineWidth === "2px" && s.outlineColor === "rgb(37, 99, 235)",
          };
        })
      );
    }
    expect(seen.map((s) => s.name)).toEqual(["logout", "item-input", "추가", "item-1", "A 삭제", "clear-done"]);
    expect(seen.every((s) => s.ring)).toBe(true);
  });

  test("마우스로 누를 때 버튼·체크박스는 테두리 없음, 입력창은 파란 테두리", async ({ page }) => {
    await seed(page, [{ name: "A", done: false }]);
    const outline = () => page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);

    await ui(page).checkboxes.first().click();
    expect(await outline()).toBe("none");

    await page.locator(".delete-btn").first().hover();
    await page.mouse.down();
    expect(await outline()).toBe("none");
    await page.mouse.up();

    await ui(page).input.click();
    const color = await page.evaluate(() => getComputedStyle(document.activeElement).outlineColor);
    expect(color).toBe("rgb(37, 99, 235)");
  });
});
