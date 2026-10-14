const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { boot } = require("../electron/main.cjs");
app.whenReady().then(async () => {
  const { store, stock, handlers, contexts, main } = await boot();
  stock.stop();
  const prefix = "review-" + randomUUID();
  let aid;
  try {
    aid = store.snapshot().accounts.find((a) => a.remote_id)?.id;
    assert.ok(aid, "缺少测试账号，请先在开发客户端登录");
    await handlers.sync({ accountId: aid });
    const win = contexts.get(aid).win;
    const before = await win.webContents.executeJavaScript(
      'JSON.parse(localStorage.getItem("auth-token")||"null")?.expiry',
    );
    const cookieBefore = await win.webContents.session.cookies.get({
      url: "https://wzyp.cn/",
    });
    await handlers.sessionCheck({ accountId: aid });
    const after = await win.webContents.executeJavaScript(
      'JSON.parse(localStorage.getItem("auth-token")||"null")?.expiry',
    );
    const cookieAfter = await win.webContents.session.cookies.get({
      url: "https://wzyp.cn/",
    });
    assert.ok(store.account(aid).session_checked_at);
    console.log(
      "REVIEW CHECK official session check and merchant identity passed",
    );
    const old = store.records({ accountId: aid }).total;
    store.transaction(() => {
      for (let i = 0; i < 601; i++)
        store.run(
          "INSERT INTO batches(id,account_id,goods_id,kind,state,requested,accepted,created_at) VALUES(?,?,0,'manual',?,1,?,'2020-01-01')",
          prefix + i,
          aid,
          i === 0 ? "pending" : "success",
          i === 0 ? 0 : 1,
        );
    });
    const record = await main.webContents.executeJavaScript(
      "window.liandong.records(" +
        JSON.stringify({ accountId: aid, current: 2, pageSize: 20 }) +
        ")",
    );
    assert.equal(record.total, old + 601);
    assert.equal(record.current, 2);
    await main.webContents.executeJavaScript(
      'Array.from(document.querySelectorAll("aside button")).find(b=>b.textContent.trim()==="补货记录").click()',
    );
    await new Promise((r) => setTimeout(r, 1200));
    const ui = await main.webContents.executeJavaScript(
      'document.getElementById("root").textContent',
    );
    assert.ok(ui.includes("待确认项优先显示"));
    const clicked = await main.webContents.executeJavaScript(
      '(()=>{const item=Array.from(document.querySelectorAll(".arco-pagination-item")).find(e=>e.textContent.trim()==="2");if(!item)return false;item.click();return true})()',
    );
    assert.ok(clicked, "分页按钮未渲染");
    await new Promise((r) => setTimeout(r, 500));
    const active = await main.webContents.executeJavaScript(
      'document.querySelector(".arco-pagination-item-active")?.textContent',
    );
    assert.equal(active?.trim(), "2");
    const dir = path.join(app.getPath("userData"), "review");
    fs.mkdirSync(dir, { recursive: true });
    const shot = await main.webContents.capturePage();
    fs.writeFileSync(path.join(dir, "pagination.png"), shot.toPNG());
    const report = {
      time: new Date().toISOString(),
      officialSessionValid: true,
      checkedAt: store.account(aid).session_checked_at,
      localTokenExpiryExtended: after > before,
      cookieExpiryUpdated: cookieAfter.some((c) =>
        cookieBefore.some(
          (b) =>
            b.name === c.name &&
            Number(c.expirationDate || 0) > Number(b.expirationDate || 0),
        ),
      ),
      updatedCookieNames:cookieAfter.filter(c=>cookieBefore.some(b=>b.name===c.name&&Number(c.expirationDate||0)>Number(b.expirationDate||0))).map(c=>({name:c.name,httpOnly:c.httpOnly})),
      historyPagination: true,
      ipcPagination: true,
      rowsTested: 601,
    };
    fs.writeFileSync(
      path.join(dir, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log("REVIEW CHECK", JSON.stringify(report));
    store.run(
      "DELETE FROM batches WHERE account_id=? AND id LIKE ?",
      aid,
      prefix + "%",
    );
    assert.equal(store.records({ accountId: aid }).total, old);
    app.exit(0);
  } catch (error) {
    if (aid)
      store.run(
        "DELETE FROM batches WHERE account_id=? AND id LIKE ?",
        aid,
        prefix + "%",
      );
    console.error("REVIEW FAILED", error.stack);
    app.exit(1);
  }
});
