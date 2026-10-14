const { spawn } = require("node:child_process"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  url = "http://127.0.0.1:5188";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "5188",
    "--strictPort",
  ],
  { cwd: root, env, stdio: "inherit", windowsHide: true },
);
let desktop,
  stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server.kill();
  desktop?.kill();
  process.exitCode = code;
}
server.on("error", (error) => {
  console.error(error.message);
  stop(1);
});
server.on("exit", (code) => {
  if (!stopping) stop(code || 0);
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
(async () => {
  let ready = false;
  for (let n = 0; n < 200 && !stopping; n++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) {
    if (!stopping) console.error("开发服务启动失败");
    stop(1);
    return;
  }
  desktop = spawn(require("electron"), [root], {
    cwd: root,
    env: { ...env, LIANDONG_DEV_URL: url },
    stdio: "inherit",
    windowsHide: false,
  });
  desktop.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  desktop.on("exit", (code) => stop(code || 0));
  console.log("链动开发客户端已启动：" + url);
})();
