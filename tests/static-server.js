// 테스트용 정적 파일 서버 (Node 내장 모듈만 사용 → Python 등 추가 설치 불필요)
// 사용법: node tests/static-server.js [포트]
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end("Bad Request");
      return;
    }
    // 널 문자(%00)가 섞인 경로는 fs가 예외를 던져 서버가 죽으므로 미리 거절
    if (pathname.includes("\0")) {
      res.writeHead(400).end("Bad Request");
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";

    // 프로젝트 폴더 밖의 파일은 읽지 못하게 막음 (경로 순회 방지)
    const filePath = path.resolve(ROOT, "." + pathname);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404).end("Not Found");
        return;
      }
      const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(data);
    });
  })
  // 이 PC 안에서만 접속 가능하도록 127.0.0.1에만 묶음 (같은 와이파이의 다른 기기 차단)
  .listen(PORT, HOST, () => console.log(`static server: http://${HOST}:${PORT}`));
