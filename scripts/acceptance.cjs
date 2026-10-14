// Run with Electron. Only explicitly marked test products are written.
const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { boot } = require("../electron/main.cjs"),
  { defaultProduct } = require("../electron/protocol.cjs");
if (process.env.LIANDONG_CDP_PORT)
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    String(process.env.LIANDONG_CDP_PORT),
  );
app.whenReady().then(async () => {
  const ctx = await boot(),
    { store, handlers, request, stock, contexts, main, files } = ctx;
  stock.stop();
  try {
    let aid = store
      .snapshot()
      .accounts.find((a) => a.label === "协议验收账号")?.id;
    if (!aid) aid = store.addAccount("协议验收账号");
    const persisted = store.account(aid).remote_id
      ? await request(aid, "user")
      : null;
    if (persisted) assert.equal(persisted.code, 1, "账号持久化登录恢复失败");
    await handlers.login({
      accountId: aid,
      username: process.env.LIANDONG_TEST_USER,
      password: process.env.LIANDONG_TEST_PASSWORD,
    });
    console.log("ACCEPTANCE login and goods sync passed");
    files.set(
      "csv-fixture",
      path.resolve(__dirname, "../tests/fixtures/cards.csv"),
    );
    const csv = await handlers.previewFile({
      fileToken: "csv-fixture",
      columns: [0, 1],
      separator: "----",
      skipHeader: true,
    });
    assert.deepEqual(csv.lines, ["000001----001234", "000002----005678"]);
    files.set(
      "txt-fixture",
      path.resolve(__dirname, "../tests/fixtures/cards.txt"),
    );
    const txt = await handlers.previewFile({
      fileToken: "txt-fixture",
      columns: [0],
    });
    assert.deepEqual(txt.lines, csv.lines);
    console.log("ACCEPTANCE TXT and CSV text columns preserve leading zeroes");
    const XLSX = require("@e965/xlsx"),
      wb = XLSX.utils.book_new(),
      sheet = XLSX.utils.aoa_to_sheet([
        ["卡号", "密码"],
        ["000001", "001234"],
        ["000002", "005678"],
      ]);
    XLSX.utils.book_append_sheet(wb, sheet, "测试卡密");
    const xlsxPath = path.join(app.getPath("userData"), "fixture.xlsx");
    XLSX.writeFile(wb, xlsxPath);
    files.set("xlsx-fixture", xlsxPath);
    const xlsx = await handlers.previewFile({
      fileToken: "xlsx-fixture",
      sheet: "测试卡密",
      columns: [0, 1],
      separator: "----",
      skipHeader: true,
    });
    assert.deepEqual(xlsx.lines, csv.lines);
    console.log("ACCEPTANCE XLSX worksheet/columns preserve leading zeroes");
    const me = store.account(aid),
      all = store.snapshot().goods.filter((g) => g.account_id === aid);
    assert.ok(me.remote_id);
    assert.ok(all.length);
    const categories = await handlers.categories({ accountId: aid });
    assert.ok(categories.length);
    const image = await request(aid, "upload", {
      name: "protocol-test.png",
      type: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHj8AAAAASUVORK5CYII=",
    });
    assert.equal(image.code, 1, "官方图片上传失败：" + image.msg);
    assert.ok(image.data?.url?.startsWith("https://"));
    console.log("ACCEPTANCE image upload passed");
    console.log("CATEGORIES SHAPE", JSON.stringify(categories.slice(0, 2)));
    const marker = "客户端协议验收勿购买1014";
    let good = all.find((g) => g.name === marker);
    if (!good) {
      const product = defaultProduct();
      Object.assign(product, {
        name: marker,
        category_id: categories[0].value ?? categories[0].id,
        price: 99999,
        show: 0,
        status: 0,
        description: "<p>客户端协议验收测试，不提供实际商品，请勿购买。</p>",
      });
      product.extend.instructions = "<p>仅供测试。</p>";
      const created = await handlers.publish({ accountId: aid, product });
      good = store.goods(aid, created.id);
    }
    assert.equal(good.show === undefined ? 0 : Number(good.show), 0);
    const detail = await request(aid, "info", { id: good.id });
    assert.equal(detail.code, 1);
    console.log("ACCEPTANCE product published and read back", good.id);
    const existing = await handlers.cardList({
      accountId: aid,
      goodsId: good.id,
      current: 1,
    });
    let manual = store
      .snapshot()
      .batches.find(
        (b) =>
          b.account_id === aid && b.goods_id === good.id && b.kind === "manual",
      );
    if (!manual) {
      const source = store.addCards(
        aid,
        good.id,
        ["TEST-CLIENT-1014-0001-NOVALUE", "TEST-CLIENT-1014-0002-NOVALUE"],
        "协议验收手动卡密",
      );
      if (source.added) {
        manual = await handlers.addCards({
          accountId: aid,
          goodsId: good.id,
          sourceId: source.id,
          count: source.added,
        });
      }
    } else if (manual.state === "pending")
      manual = await handlers.reconcile({ id: manual.id });
    assert.equal(manual?.state, "success");
    console.log(
      "ACCEPTANCE manual add and exact secret readback passed",
      manual.accepted,
    );
    // Publishing test remains hidden even when made active for the monitor test.
    const info = (await request(aid, "info", { id: good.id })).data;
    if (Number(info.status) !== 1) {
      const active = { ...info, status: 1, show: 0 };
      const r = await request(aid, "publish", active);
      assert.equal(r.code, 1);
      await handlers.sync({ accountId: aid });
    }
    let auto = store
      .snapshot()
      .batches.find(
        (b) =>
          b.account_id === aid && b.goods_id === good.id && b.kind === "auto",
      );
    if (!auto) {
      const current = (await request(aid, "info", { id: good.id })).data.extend
        .stock_count;
      const source = store.addCards(
        aid,
        good.id,
        [
          "TEST-CLIENT-1014-AUTO-0001-NOVALUE",
          "TEST-CLIENT-1014-AUTO-0002-NOVALUE",
        ],
        "协议验收自动卡密",
      );
      const id = store.saveRule({
        accountId: aid,
        goodsId: good.id,
        sourceId: source.id,
        threshold: Number(current) + 1,
        mode: "target",
        amount: Number(current) + 2,
        intervalSec: 60,
      });
      store.toggleRule(id, true);
      await stock.runRule(id);
      store.toggleRule(id, false);
      auto = store
        .snapshot()
        .batches.find(
          (b) =>
            b.account_id === aid && b.goods_id === good.id && b.kind === "auto",
        );
    }
    assert.equal(auto?.state, "success");
    console.log("ACCEPTANCE automatic threshold refill passed", auto.accepted);
    let other = store
      .snapshot()
      .accounts.find((a) => a.label === "隔离验收未登录账号")?.id;
    if (!other) other = store.addAccount("隔离验收未登录账号");
    const noLogin = await request(other, "user");
    assert.notEqual(noLogin.code, 1);
    assert.notEqual(
      contexts.get(other).win.webContents.session,
      contexts.get(aid).win.webContents.session,
    );
    for (const { win } of contexts.values())
      assert.equal(win.isVisible(), false);
    const identity = await request(aid, "identity");
    const wc = contexts.get(aid).win.webContents;
    wc.debugger.attach("1.3");
    let capturedHeaders = null;
    const observe = (_event, method, params) => {
      if (
        method === "Network.requestWillBeSent" &&
        params.request?.url?.includes("/merchantApi/Goods/list")
      ) {
        const h = params.request.headers;
        capturedHeaders = {
          ua: h["User-Agent"] || h["user-agent"],
          language: h["Accept-Language"] || h["accept-language"],
          platform: h["sec-ch-ua-platform"],
          clientHints: h["sec-ch-ua"],
        };
      }
    };
    wc.debugger.on("message", observe);
    await wc.debugger.sendCommand("Network.enable");
    await request(aid, "goods", {
      current: 1,
      pageSize: 20,
      goods_type: "card",
      status: 999,
      is_proxy: 0,
    });
    wc.debugger.removeListener("message", observe);
    wc.debugger.detach();
    assert.equal(capturedHeaders?.ua, identity.data.ua);
    const currentProduct = await request(aid, "info", { id: good.id });
    if (currentProduct.code !== 1) throw new Error("测试商品复检失败");
    if (Number(currentProduct.data.status) !== 0) {
      const rest = await request(aid, "publish", {
        ...currentProduct.data,
        status: 0,
        show: 0,
      });
      if (rest.code !== 1) throw new Error("无法将测试商品恢复仓库");
      const read = await request(aid, "info", { id: good.id });
      assert.equal(Number(read.data.status), 0);
      assert.equal(Number(read.data.show), 0);
    }
    await handlers.sync({ accountId: aid });
    const expectedProduct = (await request(aid, "info", { id: good.id })).data;
    expectedProduct.id = 0;
    const recoveryId = require("node:crypto").randomUUID();
    store.run(
      "INSERT INTO publishes(id,account_id,name,state,created_at,product_json) VALUES(?,?,?,'pending',?,?)",
      recoveryId,
      aid,
      expectedProduct.name,
      new Date().toISOString(),
      JSON.stringify({
        product: expectedProduct,
        before: store
          .snapshot()
          .goods.filter((g) => g.account_id === aid && g.id !== good.id)
          .map((g) => g.id),
      }),
    );
    const recovered = await handlers.reconcilePublish({ id: recoveryId });
    assert.equal(recovered.id, good.id);
    console.log(
      "ACCEPTANCE pending publish recovery verified against official detail",
    );
    const report = {
      imageUpload: true,
      fileParsing: { txt: true, csv: true, xlsx: true },
      persistedSession: !!persisted,
      publishRecovery: true,
      time: new Date().toISOString(),
      goodsId: good.id,
      manual: { accepted: manual.accepted, state: manual.state },
      auto: { accepted: auto.accepted, state: auto.state },
      isolation: true,
      hidden: true,
      identity: identity.data,
      protocolHeaders: capturedHeaders,
    };
    const dir = path.join(app.getPath("userData"), "acceptance");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "report.json"),
      JSON.stringify(report, null, 2),
    );
    await main.webContents
      .executeJavaScript(
        'document.querySelector("#root")?.textContent.includes("仪表盘")',
      )
      .then((ok) => assert.equal(ok, true));
    const screenshot = await main.webContents.capturePage();
    fs.writeFileSync(path.join(dir, "dashboard.png"), screenshot.toPNG());
    console.log("ACCEPTANCE report", JSON.stringify(report));
    const uiErrors = [];
    main.webContents.on("console-message", (_e, level, message) => {
      if (level === 3) uiErrors.push(message);
    });
    for (const name of [
      "账号管理",
      "卡密商品",
      "商品发布",
      "手动加卡",
      "卡密来源",
      "库存监控",
      "补货记录",
      "仪表盘",
    ]) {
      await main.webContents.executeJavaScript(
        'Array.from(document.querySelectorAll("aside button")).find(b=>b.textContent.trim()===' +
          JSON.stringify(name) +
          ")?.click()",
      );
      await new Promise((resolve) =>
        setTimeout(resolve, name === "商品发布" ? 4500 : 350),
      );
      const content = await main.webContents.executeJavaScript(
        'document.getElementById("root").textContent',
      );
      assert.ok(content.includes(name), "栏目未渲染：" + name);
      if (name === "商品发布") {
        assert.ok(content.includes("商品标题"), "发布表单未加载");
        const shot = await main.webContents.capturePage();
        fs.writeFileSync(path.join(dir, "publish.png"), shot.toPNG());
      }
    }
    assert.equal(
      uiErrors.length,
      0,
      "客户端出现渲染错误：" + uiErrors.join(";"),
    );
    console.log("ACCEPTANCE eight views and rich editor rendered");
    const finalScreenshot = await main.webContents.capturePage();
    fs.writeFileSync(path.join(dir, "dashboard.png"), finalScreenshot.toPNG());
    report.viewsRendered = true;
    report.testProductWarehouse = true;
    fs.writeFileSync(
      path.join(dir, "report.json"),
      JSON.stringify(report, null, 2),
    );
    if (process.env.LIANDONG_ACCEPTANCE_HOLD === "1") {
      setInterval(() => {}, 1000);
      console.log("ACCEPTANCE HOLD");
    }
    process.exitCode = 0;
  } catch (e) {
    console.error("ACCEPTANCE FAILED", e.stack);
    process.exitCode = 1;
  } finally {
    if (process.env.LIANDONG_ACCEPTANCE_HOLD !== "1")
      app.exit(process.exitCode || 0);
  }
});
