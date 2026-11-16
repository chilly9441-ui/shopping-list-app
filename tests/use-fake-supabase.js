// 테스트·스크린샷에서 실제 Supabase 대신 가짜 클라이언트(fake-supabase.js)를 쓰게 함
const path = require("node:path");

const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@*/**";
const FAKE_PATH = path.join(__dirname, "fake-supabase.js");

/**
 * @param {import("@playwright/test").BrowserContext | import("@playwright/test").Page} target
 */
async function useFakeSupabase(target) {
  await target.route(SUPABASE_CDN, (route) => route.fulfill({ path: FAKE_PATH }));
  // index.html의 integrity(SRI)는 실제 CDN 파일의 해시라 가짜 파일은 막힘 → 테스트에서만 속성을 뺌
  await target.route(
    (url) => url.pathname === "/" || url.pathname.endsWith(".html"),
    async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(/\s+integrity="[^"]*"/g, "");
      await route.fulfill({ response, body });
    }
  );
}

module.exports = { useFakeSupabase, SUPABASE_CDN };
