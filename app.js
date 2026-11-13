const STORAGE_KEY = "shopping-list";

const form = document.getElementById("add-form");
const input = document.getElementById("item-input");
const errorEl = document.getElementById("error");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const clearDoneBtn = document.getElementById("clear-done");
const statusEl = document.getElementById("status");

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

let items = loadItems();

function loadItems() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(data)) return [];
    // 모양이 잘못된 항목은 버려서 render()가 멈추지 않게 함
    return data
      .filter((i) => i && typeof i.id === "string" && typeof i.name === "string")
      .map((i) => ({ id: i.id, name: i.name, done: Boolean(i.done) }));
  } catch {
    return [];
  }
}

function saveItems() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 저장소를 쓸 수 없는 환경(시크릿 모드 등)에서도 앱은 계속 동작
  }
}

function addItem(name) {
  items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2), name, done: false });
  saveItems();
  render();
  announce(`${name} 추가됨${progressText()}`);
}

function toggleItem(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  item.done = !item.done;

  // 체크를 풀었는데 완료하지 않은 같은 이름이 이미 있으면, 풀린 항목을 지워 하나로 합침
  if (!item.done) {
    const key = item.name.toLocaleLowerCase();
    const existing = items.find((i) => i !== item && !i.done && i.name.toLocaleLowerCase() === key);
    if (existing) {
      items = items.filter((i) => i !== item);
      saveItems();
      render();
      announce(`${existing.name}이(가) 이미 있어 하나로 합쳤습니다${progressText()}`);
      focusById("item-" + existing.id); // 사라진 체크박스 대신 남은 항목으로 포커스 이동
      return;
    }
  }

  saveItems();
  render();
  announce(`${item.name} ${item.done ? "완료" : "완료 취소"}${progressText()}`);
}

function deleteItem(id) {
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return;
  const [removed] = items.splice(index, 1);
  saveItems();
  render();
  announce(items.length ? `${removed.name} 삭제됨${progressText()}` : `${removed.name} 삭제됨. 목록이 비었습니다`);
  // 지운 자리의 다음(없으면 이전) 항목으로 포커스를 옮기고, 비었으면 입력창으로
  const next = items[index] || items[index - 1];
  focusById(next ? "item-" + next.id : "item-input");
}

function clearDone() {
  const before = items.length;
  items = items.filter((i) => !i.done);
  saveItems();
  render();
  announce(`완료 항목 ${before - items.length}개를 지웠습니다${progressText()}`);
  input.focus(); // 버튼이 비활성화되면 포커스가 사라지므로 입력창으로 옮김
}

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
  const key = name.toLocaleLowerCase();
  if (items.some((i) => !i.done && i.name.toLocaleLowerCase() === key)) {
    showError(`"${name}"은(는) 이미 목록에 있어요.`);
    input.select();
    return;
  }
  clearError();
  addItem(name);
  input.value = "";
  input.focus();
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

// 다른 탭에서 목록을 바꾸면 이 탭도 최신 내용으로 갱신 (덮어쓰기 방지)
window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY && e.key !== null) return;
  items = loadItems();
  render();
  announce("다른 탭에서 목록이 바뀌었습니다");
});

render();
