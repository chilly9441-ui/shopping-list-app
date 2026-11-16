// 목록은 Supabase의 shopping_items 테이블에 저장되고, RLS로 로그인한 본인 항목만 읽고 쓸 수 있음
const TABLE = "shopping_items";
const COLUMNS = "id, name, done";
const UNIQUE_VIOLATION = "23505"; // 미완료 항목 이름 중복(DB 고유 인덱스)

// 로그인 전 이 기기의 localStorage에 쓰던 목록. 로그인하면 계정으로 옮기고 지움
const STORAGE_KEY = "shopping-list";
// 더 이전 버전 앱이 쓰던 저장 키 ({ id, text, checked } 형식)
const LEGACY_STORAGE_KEY = "shopping-list-items";
// 이전 목록을 이미 옮겼는지 표시하는 키
const LEGACY_MIGRATED_KEY = "shopping-list-migrated";
const MAX_NAME_LENGTH = 100; // index.html 입력창의 maxlength, DB 제약과 같게

const loadingEl = document.getElementById("loading");

// CDN이 막혔거나(광고 차단기·방화벽·오프라인) 무결성 검사에 걸려 supabase-js를 못 불러오면 null
const db = window.supabase && window.SUPABASE_CONFIG
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.publishableKey)
  : null;
const authEl = document.getElementById("auth");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email-input");
const loginBtn = document.getElementById("login-btn");
const loginMessageEl = document.getElementById("login-message");
const loginErrorEl = document.getElementById("login-error");
const userBarEl = document.getElementById("user-bar");
const userEmailEl = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout");
const listSectionEl = document.getElementById("list-section");
const form = document.getElementById("add-form");
const input = document.getElementById("item-input");
const errorEl = document.getElementById("error");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const clearDoneBtn = document.getElementById("clear-done");
const syncErrorEl = document.getElementById("sync-error");
const statusEl = document.getElementById("status");

/** @type {{ id: number, name: string, done: boolean }[]} */
let items = [];
let userId; // undefined: 아직 확인 전, null: 로그아웃 상태

// 화면 읽기 프로그램에 변경 내용을 알림.
// 같은 문구가 연달아 와도 다시 읽히도록 한 번 비운 뒤 잠시 후 채움.
let announceTimer;
function announce(message) {
  clearTimeout(announceTimer);
  statusEl.textContent = "";
  announceTimer = setTimeout(() => {
    statusEl.textContent = message;
  }, 50);
}

function progressText() {
  const doneCount = items.filter((i) => i.done).length;
  return items.length ? ` (${doneCount} / ${items.length} 완료)` : "";
}

const sameName = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

// ---------- 서버 작업 ----------

// 서버 작업을 하나씩 순서대로 실행 → 빠르게 여러 번 눌러도 순서가 꼬이지 않음.
// 실패하면 안내를 보여 주고 서버의 실제 목록으로 화면을 되돌림
let queue = Promise.resolve();
function run(task) {
  queue = queue
    .then(async () => {
      await task();
      syncErrorEl.textContent = "";
    })
    .catch(async (err) => {
      console.warn("Supabase 작업 실패:", err);
      syncErrorEl.textContent = "저장하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
      try {
        await reloadItems();
      } catch {
        // 다시 불러오기도 실패하면 지금 화면을 그대로 둠
      }
    });
  return queue;
}

async function fetchItems() {
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data;
}

async function reloadItems() {
  items = await fetchItems();
  render();
}

function addItem(name) {
  return run(async () => {
    const { data, error } = await db.from(TABLE).insert({ name }).select(COLUMNS);
    if (error?.code === UNIQUE_VIOLATION) {
      // 다른 탭·기기에서 같은 이름을 먼저 추가한 경우
      await reloadItems();
      if (!input.value) input.value = name;
      showError(`"${name}"은(는) 이미 목록에 있어요.`);
      input.select();
      return;
    }
    if (error) {
      if (!input.value) input.value = name; // 입력한 글자를 잃지 않도록 되돌려 둠
      throw error;
    }
    items.push(data[0]);
    render();
    announce(`${name} 추가됨${progressText()}`);
  });
}

function toggleItem(id) {
  return run(async () => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const done = !item.done;

    // 체크를 풀었는데 완료하지 않은 같은 이름이 이미 있으면, 풀린 항목을 지워 하나로 합침
    if (!done) {
      const existing = items.find((i) => i !== item && !i.done && sameName(i.name, item.name));
      if (existing) {
        const { error } = await db.from(TABLE).delete().eq("id", id);
        if (error) throw error;
        items = items.filter((i) => i !== item);
        render();
        announce(`${existing.name}이(가) 이미 있어 하나로 합쳤습니다${progressText()}`);
        focusById("item-" + existing.id); // 사라진 체크박스 대신 남은 항목으로 포커스 이동
        return;
      }
    }

    const { error } = await db.from(TABLE).update({ done }).eq("id", id);
    if (error) throw error;
    item.done = done;
    render();
    announce(`${item.name} ${done ? "완료" : "완료 취소"}${progressText()}`);
  });
}

function deleteItem(id) {
  return run(async () => {
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) return;
    const { error } = await db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
    const [removed] = items.splice(index, 1);
    render();
    announce(items.length ? `${removed.name} 삭제됨${progressText()}` : `${removed.name} 삭제됨. 목록이 비었습니다`);
    // 지운 자리의 다음(없으면 이전) 항목으로 포커스를 옮기고, 비었으면 입력창으로
    const next = items[index] || items[index - 1];
    focusById(next ? "item-" + next.id : "item-input");
  });
}

function clearDone() {
  return run(async () => {
    // RLS 때문에 본인 항목만 지워짐
    const { error } = await db.from(TABLE).delete().eq("done", true);
    if (error) throw error;
    const before = items.length;
    items = items.filter((i) => !i.done);
    render();
    announce(`완료 항목 ${before - items.length}개를 지웠습니다${progressText()}`);
    input.focus(); // 버튼이 비활성화되면 포커스가 사라지므로 입력창으로 옮김
  });
}

// ---------- 이 기기에 저장돼 있던 목록을 계정으로 옮기기 ----------

// 더 이전 버전 앱의 목록을 STORAGE_KEY 형식으로 옮겨 옴.
// 이미 있는 목록 뒤에 붙이고, 다 옮긴 뒤 이전 키를 지워 한 번만 실행되게 함.
function migrateLegacyItems() {
  let legacy;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return; // 옮길 것이 없음
    // 이미 한 번 옮겼는데 이전 키가 또 있으면, 업데이트 전에 열어 둔 이전 버전 탭이 다시 저장한 것.
    // 다시 옮기면 완료 항목이 중복되고 지운 항목이 되살아나므로 옮기지 않고 지움
    if (localStorage.getItem(LEGACY_MIGRATED_KEY) !== null) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    legacy = JSON.parse(raw);
  } catch {
    return; // 저장소를 쓸 수 없거나 데이터가 깨졌으면 건드리지 않음
  }

  const merged = loadLocalItems();
  for (const old of Array.isArray(legacy) ? legacy : []) {
    if (!old || typeof old.text !== "string") continue;
    merged.push({ name: old.text, done: Boolean(old.checked) });
  }

  try {
    // 순서 중요: 새 목록 저장 → 옮김 표시 → 이전 키 삭제
    // (중간에 실패해도 데이터를 잃지 않도록 지우는 일은 맨 마지막에)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // 저장에 실패하면 이전 키를 남겨 두어 다음에 열 때 다시 시도
  }
}

function loadLocalItems() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(data)) return [];
    // 모양이 잘못된 항목은 버림
    return data
      .filter((i) => i && typeof i.name === "string")
      .map((i) => ({ name: i.name, done: Boolean(i.done) }));
  } catch {
    return [];
  }
}

// 로그인 직후 한 번: 이 기기에 남아 있던 목록을 계정 목록 뒤에 붙이고 기기에서는 지움
async function uploadLocalItems() {
  migrateLegacyItems();
  const local = loadLocalItems();
  if (!local.length) return;

  // 앱 규칙과 같게, 완료하지 않은 같은 이름(대소문자 무시)은 하나만 남김
  const undoneNames = new Set(
    (await fetchItems()).filter((i) => !i.done).map((i) => i.name.toLocaleLowerCase())
  );
  const rows = [];
  for (const { name: rawName, done } of local) {
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH).trim();
    if (!name) continue;
    if (!done) {
      const key = name.toLocaleLowerCase();
      if (undoneNames.has(key)) continue;
      undoneNames.add(key);
    }
    rows.push({ name, done });
  }

  if (rows.length) {
    const { error } = await db.from(TABLE).insert(rows);
    if (error) throw error; // 실패하면 기기 목록을 남겨 두어 다음 로그인 때 다시 시도
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장소를 쓸 수 없는 환경
  }
  if (rows.length) announce(`이 기기에 있던 항목 ${rows.length}개를 계정으로 옮겼습니다`);
}

// ---------- 화면 ----------

function focusById(id) {
  const el = document.getElementById(id);
  if (el) el.focus();
}

function render() {
  // 목록을 새 요소로 다시 그려도 포커스가 유지되도록 기억해 둠
  const focusedId = listEl.contains(document.activeElement) ? document.activeElement.id : "";

  listEl.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.className = "item" + (item.done ? " done" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = "item-" + item.id;
      checkbox.checked = item.done;
      checkbox.addEventListener("change", () => toggleItem(item.id));

      const label = document.createElement("label");
      label.htmlFor = checkbox.id;
      label.textContent = item.name; // textContent로 넣어 XSS 방지

      const del = document.createElement("button");
      del.type = "button";
      del.className = "delete-btn";
      del.textContent = "✕";
      del.setAttribute("aria-label", `${item.name} 삭제`);
      del.addEventListener("click", () => deleteItem(item.id));

      li.append(checkbox, label, del);
      return li;
    })
  );

  const doneCount = items.filter((i) => i.done).length;
  emptyEl.hidden = items.length > 0;
  countEl.textContent = items.length ? `${doneCount} / ${items.length} 완료` : "";
  clearDoneBtn.disabled = doneCount === 0;

  if (focusedId) focusById(focusedId);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = input.value.trim();
  if (!name) {
    showError("아이템 이름을 입력해 주세요.");
    input.focus();
    return;
  }
  // 아직 완료하지 않은 항목 중에 같은 이름(대소문자 무시)이 있으면 중복 추가하지 않음
  // (완료된 항목은 다시 사야 할 수 있으므로 검사에서 제외)
  if (items.some((i) => !i.done && sameName(i.name, name))) {
    showError(`"${name}"은(는) 이미 목록에 있어요.`);
    input.select();
    return;
  }
  clearError();
  input.value = "";
  input.focus();
  addItem(name);
});

// 에러를 입력창과 연결해서, 화면 읽기 프로그램이 입력창에서도 "잘못됨 + 이유"를 읽게 함
function showError(message) {
  errorEl.textContent = message;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", "error");
}

function clearError() {
  errorEl.textContent = "";
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
}

input.addEventListener("input", clearError);
clearDoneBtn.addEventListener("click", clearDone);

// 다른 탭·기기에서 바꾼 내용을, 이 탭으로 돌아올 때 다시 불러와 반영
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && userId) run(reloadItems);
});

// ---------- 로그인 ----------

function showLoginError(message) {
  loginMessageEl.textContent = "";
  loginErrorEl.textContent = message;
  emailInput.setAttribute("aria-invalid", "true");
  emailInput.setAttribute("aria-describedby", "login-error");
}

function clearLoginError() {
  loginErrorEl.textContent = "";
  emailInput.removeAttribute("aria-invalid");
  emailInput.removeAttribute("aria-describedby");
}

emailInput.addEventListener("input", clearLoginError);

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (!email || !emailInput.checkValidity()) {
    showLoginError("올바른 이메일 주소를 입력해 주세요.");
    emailInput.focus();
    return;
  }
  clearLoginError();
  loginBtn.disabled = true;
  loginMessageEl.textContent = "로그인 링크를 보내는 중…";
  const { error } = await db.auth.signInWithOtp({
    email,
    // 메일의 링크를 누르면 지금 보고 있는 주소(로컬 또는 배포 사이트)로 돌아옴
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  loginBtn.disabled = false;
  if (error) {
    console.warn("로그인 링크 전송 실패:", error);
    showLoginError(
      error.status === 429
        ? "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."
        : "로그인 링크를 보내지 못했어요. 잠시 후 다시 시도해 주세요."
    );
    return;
  }
  loginMessageEl.textContent = `${email}로 로그인 링크를 보냈어요. 메일함을 확인해 주세요.`;
});

logoutBtn.addEventListener("click", async () => {
  // scope: "local" → 이 기기만 로그아웃 (기본값 global은 같은 계정의 모든 기기를 로그아웃시킴)
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) {
    console.warn("로그아웃 실패:", error);
    syncErrorEl.textContent = "로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
});

async function applySession(session) {
  const nextUserId = session?.user?.id ?? null;
  if (nextUserId === userId) return; // 토큰 갱신 등 같은 사용자면 다시 불러오지 않음
  userId = nextUserId;
  loadingEl.hidden = true;

  items = [];
  render();
  clearError();
  syncErrorEl.textContent = "";

  const signedIn = Boolean(session);
  authEl.hidden = signedIn;
  listSectionEl.hidden = !signedIn;
  userBarEl.hidden = !signedIn;

  if (!signedIn) {
    userEmailEl.textContent = "";
    return;
  }
  userEmailEl.textContent = session.user.email ?? "";
  loginMessageEl.textContent = "";
  listSectionEl.setAttribute("aria-busy", "true"); // 목록을 불러오는 중임을 알림
  await run(async () => {
    await uploadLocalItems();
    await reloadItems();
  });
  listSectionEl.removeAttribute("aria-busy");
}

// 로그인 상태가 바뀔 때마다(처음 열 때, 링크로 돌아왔을 때, 다른 탭에서 로그아웃했을 때) 화면 전환.
// 콜백 안에서 Supabase를 바로 다시 부르면 멈출 수 있어 setTimeout으로 한 박자 뒤에 처리
if (db) {
  db.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => applySession(session), 0);
  });
} else {
  loadingEl.setAttribute("role", "alert");
  loadingEl.textContent = "앱을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 새로고침해 주세요.";
}
