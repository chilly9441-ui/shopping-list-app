// @ts-check
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "shopping-list";

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

/** 저장소에 목록을 미리 넣고 새로고침 */
async function seed(page, items) {
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, typeof items === "string" ? items : JSON.stringify(items)]
  );
  await page.reload();
}

function hasHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

// 콘솔 오류·페이지 오류·404·alert 등이 생기면 테스트 실패로 처리
// (각 워커는 테스트를 하나씩 순서대로 실행하므로 모듈 변수로 보관해도 안전)
/** @type {string[]} */
let problems = [];

// 각 테스트는 새 브라우저 컨텍스트에서 실행되므로 localStorage가 비어 있는 상태로 시작함
test.beforeEach(async ({ page, context }) => {
  problems = [];
  // 다른 탭(page)도 감시하도록 컨텍스트 단위로 등록
  context.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  context.on("weberror", (e) => problems.push(`pageerror: ${e.error().message}`));
  context.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  context.on("dialog", (d) => {
    problems.push(`dialog: ${d.message()}`);
    d.dismiss();
  });
  await page.goto("/");
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

// ---------- 저장 ----------

test.describe("저장", () => {
  test("새로고침 후에도 목록과 완료 상태 유지", async ({ page }) => {
    const { checkboxes } = ui(page);
    for (const n of ["사과", "배", "귤"]) await add(page, n);
    await checkboxes.nth(0).check();
    await checkboxes.nth(2).check();
    await page.reload();
    expect(await readList(page)).toEqual(["사과(완료)", "배", "귤(완료)"]);
  });

  test("잘못된 모양의 저장 항목은 걸러냄", async ({ page }) => {
    await seed(page, '[{"id":1,"name":"x"},null,"s",{"id":"a","name":"ok","done":"yes"}]');
    expect(await readList(page)).toEqual(["ok(완료)"]);
  });

  test("JSON이 깨져 있으면 빈 목록으로 시작", async ({ page }) => {
    await seed(page, "{bad");
    await expect(ui(page).empty).toBeVisible();
  });
});

// ---------- 이전 버전 목록 옮기기 ----------

const LEGACY_KEY = "shopping-list-items";

/** 이전 버전 앱의 저장 데이터(와 필요하면 새 앱 데이터)를 넣고 새로고침 */
async function seedLegacy(page, legacy, current) {
  await page.evaluate(
    ([legacyKey, legacyValue, key, value]) => {
      localStorage.setItem(legacyKey, legacyValue);
      if (value !== null) localStorage.setItem(key, value);
    },
    [
      LEGACY_KEY,
      typeof legacy === "string" ? legacy : JSON.stringify(legacy),
      STORAGE_KEY,
      current === undefined ? null : JSON.stringify(current),
    ]
  );
  await page.reload();
}

function readStorage(page) {
  return page.evaluate(([legacyKey, key]) => [localStorage.getItem(legacyKey), JSON.parse(localStorage.getItem(key))], [
    LEGACY_KEY,
    STORAGE_KEY,
  ]);
}

test.describe("이전 버전 목록 옮기기", () => {
  test("이름·완료 상태를 옮기고 이전 키를 지움, 새로고침해도 한 번만 옮김", async ({ page }) => {
    await seedLegacy(page, [
      { id: 1.5, text: "우유", checked: false },
      { id: 2.5, text: "  빵  ", checked: true },
    ]);
    expect(await readList(page)).toEqual(["우유", "빵(완료)"]);

    const [legacy, saved] = await readStorage(page);
    expect(legacy).toBeNull();
    expect(saved.map((/** @type {any} */ i) => typeof i.id)).toEqual(["string", "string"]);

    await page.reload();
    expect(await readList(page)).toEqual(["우유", "빵(완료)"]);
  });

  test("새 앱 목록 뒤에 붙이고, 완료하지 않은 같은 이름은 하나만 남김", async ({ page }) => {
    await seedLegacy(
      page,
      [
        { id: 1, text: "우유", checked: false }, // 새 목록에 이미 있음 → 빠짐
        { id: 2, text: "계란", checked: false },
        { id: 3, text: "계란", checked: false }, // 이전 목록 안의 중복 → 빠짐
        { id: 4, text: "우유", checked: true }, // 완료된 항목은 남김
      ],
      [{ id: "a", name: "우유", done: false }]
    );
    expect(await readList(page)).toEqual(["우유", "계란", "우유(완료)"]);
  });

  test("이미 옮긴 뒤 이전 버전 탭이 다시 저장해도 다시 옮기지 않고 지움", async ({ page }) => {
    await seedLegacy(page, [{ id: 1, text: "우유", checked: true }]);
    expect(await readList(page)).toEqual(["우유(완료)"]);

    // 새 앱에서 지운 뒤, 열려 있던 이전 버전 탭이 자기 목록을 다시 저장한 상황
    await page.getByRole("button", { name: "우유 삭제" }).click();
    await page.evaluate(
      (key) => localStorage.setItem(key, JSON.stringify([{ id: 1, text: "우유", checked: true }, { id: 2, text: "빵" }])),
      LEGACY_KEY
    );
    await page.reload();

    await expect(ui(page).empty).toBeVisible(); // 지운 우유가 되살아나지 않음
    expect((await readStorage(page))[0]).toBeNull();
  });

  test("잘못된 항목은 버리고 긴 이름은 100자로 자름", async ({ page }) => {
    await seedLegacy(page, [null, "s", { text: 3 }, { text: "   " }, { text: "가".repeat(150), checked: false }]);
    expect(await readList(page)).toEqual(["가".repeat(100)]);
  });

  test("이전 데이터의 JSON이 깨져 있으면 건드리지 않음", async ({ page }) => {
    await seedLegacy(page, "{bad", [{ id: "a", name: "우유", done: false }]);
    expect(await readList(page)).toEqual(["우유"]);
    expect((await readStorage(page))[0]).toBe("{bad");
  });
});

// ---------- 탭 동기화 ----------

test("다른 탭에서 바꾼 내용이 반영되고 중복 검사에도 쓰임", async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto("/");
  await add(other, "탭2");

  await expect(ui(page).labels).toHaveText(["탭2"]);
  await add(page, "탭2");
  await expect(ui(page).error).toContainText("이미 목록에 있어요");

  await other.evaluate(() => localStorage.clear());
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
    await seed(page, [{ id: "a", name: "우유", done: true }]);

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
    await seed(page, [{ id: "a", name: "A", done: true }]);
    await page.locator("h1").click();

    const seen = [];
    for (let i = 0; i < 5; i++) {
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
    expect(seen.map((s) => s.name)).toEqual(["item-input", "추가", "item-a", "A 삭제", "clear-done"]);
    expect(seen.every((s) => s.ring)).toBe(true);
  });

  test("마우스로 누를 때 버튼·체크박스는 테두리 없음, 입력창은 파란 테두리", async ({ page }) => {
    await seed(page, [{ id: "a", name: "A", done: false }]);
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
