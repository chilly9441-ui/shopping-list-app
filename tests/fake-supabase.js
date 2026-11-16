// 테스트용 가짜 Supabase 클라이언트 (실제 서버에 접속하지 않음)
// 테스트에서 CDN의 supabase-js 대신 이 파일을 내려보내, 앱이 쓰는 기능만 흉내 냄.
// 데이터는 이 페이지 주소의 localStorage에 저장 → 새로고침·다른 탭에서도 유지됨.
//   fake-supabase-db       : [{ id, name, done, created_at }]
//   fake-supabase-signed-out: 있으면 로그아웃 상태로 시작
//   fake-supabase-fail     : 있으면 모든 쓰기 요청이 실패
(() => {
  const DB_KEY = "fake-supabase-db";
  const SIGNED_OUT_KEY = "fake-supabase-signed-out";
  const FAIL_KEY = "fake-supabase-fail";
  const USER = { id: "user-1", email: "tester@example.com" };

  const readRows = () => JSON.parse(localStorage.getItem(DB_KEY) || "[]");
  const writeRows = (rows) => localStorage.setItem(DB_KEY, JSON.stringify(rows));
  const pick = (row) => ({ id: row.id, name: row.name, done: row.done });
  const failing = () => localStorage.getItem(FAIL_KEY) !== null;
  const conflict = { code: "23505", message: "duplicate key value violates unique constraint" };

  // DB의 고유 인덱스(미완료 항목 이름 중복 금지)와 같은 검사
  function violatesUnique(rows) {
    const seen = new Set();
    for (const r of rows) {
      if (r.done) continue;
      const key = r.name.toLowerCase();
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }

  function query() {
    let op = "select";
    let payload;
    let returning = false;
    const filters = [];

    function execute() {
      const rows = readRows();
      const match = (r) => filters.every(([col, val]) => r[col] === val);
      if (op !== "select" && failing()) return { data: null, error: { message: "network error" } };

      if (op === "select") {
        return { data: rows.filter(match).sort((a, b) => a.id - b.id).map(pick), error: null };
      }
      if (op === "insert") {
        let nextId = rows.reduce((m, r) => Math.max(m, r.id), 0);
        const added = [].concat(payload).map((p) => ({
          id: ++nextId,
          name: p.name,
          done: Boolean(p.done),
          created_at: new Date().toISOString(),
        }));
        const next = rows.concat(added);
        if (violatesUnique(next)) return { data: null, error: conflict };
        writeRows(next);
        return { data: returning ? added.map(pick) : null, error: null };
      }
      if (op === "update") {
        const next = rows.map((r) => (match(r) ? { ...r, ...payload } : r));
        if (violatesUnique(next)) return { data: null, error: conflict };
        writeRows(next);
        return { data: null, error: null };
      }
      if (op === "delete") {
        writeRows(rows.filter((r) => !match(r)));
        return { data: null, error: null };
      }
      throw new Error("unsupported op " + op);
    }

    const builder = {
      select() {
        if (op === "select") return builder;
        returning = true;
        return builder;
      },
      insert(rows) {
        op = "insert";
        payload = rows;
        return builder;
      },
      update(patch) {
        op = "update";
        payload = patch;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order() {
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve().then(execute).then(resolve, reject);
      },
    };
    return builder;
  }

  function createClient() {
    const listeners = [];
    const session = () => (localStorage.getItem(SIGNED_OUT_KEY) === null ? { user: USER } : null);
    const emit = (event) => listeners.forEach((cb) => cb(event, session()));

    return {
      from: () => query(),
      auth: {
        onAuthStateChange(cb) {
          listeners.push(cb);
          setTimeout(() => cb("INITIAL_SESSION", session()), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        async signInWithOtp({ email }) {
          window.__lastOtpEmail = email;
          return failing() ? { error: { status: 429, message: "rate limit" } } : { error: null };
        },
        async signOut(options) {
          window.__lastSignOutScope = options?.scope;
          localStorage.setItem(SIGNED_OUT_KEY, "1");
          emit("SIGNED_OUT");
          return { error: null };
        },
      },
    };
  }

  window.supabase = { createClient };
})();
