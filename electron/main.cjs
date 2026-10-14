const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
} = require("electron");
const path = require("node:path"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto"),
  { pathToFileURL } = require("node:url");
const { Store } = require("./store.cjs"),
  { ORIGIN, expression, validateProduct } = require("./protocol.cjs"),
  { StockService, parseLines, sheetLines } = require("./stock.cjs");
let main,
  store,
  stock,
  quitting = false;
const contexts = new Map(),
  files = new Map(),
  accountQueues = new Map();
if (process.env.LIANDONG_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.LIANDONG_DATA_DIR));
const indexPath = path.resolve(__dirname, "../dist/index.html");
const devUrl = process.env.LIANDONG_DEV_URL || "";
if (devUrl && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(devUrl))
  throw new Error("开发页面仅允许本机地址");
const officialAllowed = (url) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};
async function accountWindow(id, show = false) {
  store.account(id);
  let entry = contexts.get(id);
  if (!entry || entry.win.isDestroyed()) {
    const win = new BrowserWindow({
      title: "链动官方 · " + store.account(id).label,
      width: 1200,
      height: 850,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: "persist:liandong-" + id,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.session.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (officialAllowed(url))
        win
          .loadURL(url)
          .catch((e) => store.invalidate(id, "官网跳转失败：" + e.message));
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (!officialAllowed(url)) event.preventDefault();
    });
    win.on("close", (e) => {
      if (!quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    entry = {
      win,
      ready: win.loadURL(ORIGIN + "/merchant/goods/list?is_proxy=0"),
    };
    contexts.set(id, entry);
    try {
      await entry.ready;
    } catch {
      contexts.delete(id);
      win.destroy();
      throw new Error("官网加载失败，请检查网络");
    }
  }
  await entry.ready;
  if (show) {
    entry.win.show();
    entry.win.focus();
  }
  return entry.win;
}
async function request(id, action, data = {}, control = {}) {
  const prev = accountQueues.get(id) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const win = await accountWindow(id);
      if (!officialAllowed(win.webContents.getURL()))
        throw new Error("账号不在官方环境");
      let timeout;
      let posted = action !== "add";
      try {
        const perform = async () => {
          let payload = data;
          if (action === "add") {
            const preflight = await win.webContents.executeJavaScript(
              expression(
                "info",
                { id: Number(data.goods_id) },
                store.account(id).remote_id,
              ),
            );
            if (preflight.code !== 1) return { ...preflight, notSent: true };
            if (control.guard && !control.guard())
              return { code: 0, notSent: true, msg: "监控已暂停或规则已修改" };
            if (control.prepare) payload = control.prepare(preflight.data);
            if (!payload)
              return { code: 1, notSent: true, msg: "最终库存已满足补货条件" };
            if (control.guard && !control.guard())
              return { code: 0, notSent: true, msg: "监控已暂停或规则已修改" };
          }
          posted = true;
          return win.webContents.executeJavaScript(
            expression(action, payload, store.account(id).remote_id, {
              identityChecked: action === "add",
            }),
          );
        };
        const result = await Promise.race([
          perform(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              if (!win.isDestroyed()) win.destroy();
              contexts.delete(id);
              reject(new Error("官方请求超时，写入结果须回读核实"));
            }, 45000);
          }),
        ]);
        if (!result || typeof result.code !== "number")
          throw new Error("官方响应结构异常");
        if (result.identityMismatch) store.invalidate(id, result.msg);
        if (
          result.code === 401 ||
          (!["login", "identity", "safeMode"].includes(action) &&
            /登录|token.*(失效|过期)/i.test(result.msg || ""))
        )
          store.invalidate(id, "登录失效，请打开官网重新登录");
        return result;
      } catch (error) {
        if (!posted) error.notSent = true;
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    });
  accountQueues.set(id, next);
  try {
    return await next;
  } finally {
    if (accountQueues.get(id) === next) accountQueues.delete(id);
  }
}
async function identify(id) {
  const me = await request(id, "user");
  if (me.code !== 1) {
    store.invalidate(id, "请登录官方账号");
    throw new Error("账号未登录或登录已失效");
  }
  store.setIdentity(id, me.data);
  return me.data;
}
async function sync(id) {
  await identify(id);
  const goods = [];
  for (let current = 1; current <= 1000; current++) {
    const r = await request(id, "goods", {
      current,
      pageSize: 100,
      goods_type: "card",
      status: 999,
      name: "",
      is_proxy: 0,
    });
    if (r.code !== 1 || !Array.isArray(r.data?.list))
      throw new Error(r.msg || "商品读取失败");
    goods.push(...r.data.list);
    if (goods.length >= Number(r.data.total)) {
      store.sync(id, goods);
      return { total: goods.length };
    }
    if (!r.data.list.length) throw new Error("商品分页不完整");
  }
  throw new Error("商品数量超出同步上限");
}
async function withIdentity(id, fn) {
  await identify(id);
  return fn();
}
function fileEntry(token) {
  const file = files.get(token);
  if (!file) throw new Error("请重新选择文件");
  return file;
}
function readFileRows(token, sheet) {
  const file = fileEntry(token),
    ext = path.extname(file).toLowerCase();
  if (ext === ".txt") {
    const bytes = fs.readFileSync(file);
    let text;
    if (bytes[0] === 255 && bytes[1] === 254)
      text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
    else
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("gb18030", { fatal: true }).decode(bytes);
      }
    return {
      name: path.basename(file),
      sheets: ["文本"],
      rows: text
        .replace(/^\uFEFF/, "")
        .split(/\r\n|\n|\r/)
        .map((s) => [s]),
    };
  }
  const XLSX = require("@e965/xlsx"),
    wb = XLSX.readFile(file, {
      cellText: true,
      cellDates: false,
      dense: false,
      raw: ext === ".csv",
    });
  const name = sheet || wb.SheetNames[0];
  if (!wb.Sheets[name]) throw new Error("工作表不存在");
  return {
    name: path.basename(file),
    sheets: wb.SheetNames,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }),
  };
}
function extract(p) {
  if (!p.fileToken) return parseLines(p.text || "");
  const file = readFileRows(p.fileToken, p.sheet),
    cols = p.columns || [0];
  if (
    cols.length < 1 ||
    cols.length > 2 ||
    cols.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 255)
  )
    throw new Error("请选择一列卡密或两列卡号/密码");
  return sheetLines(
    file.rows,
    cols,
    p.separator ?? "    ",
    p.skipHeader === true,
  );
}
const handlers = {
  snapshot: () => store.snapshot(),
  records: (p) => store.records(p),
  sessionCheck: async (p) => {
    const me = await request(p.accountId, "session");
    if (me.code !== 1) {
      store.invalidate(p.accountId, me.msg || "会话已失效，请登录");
      throw new Error(me.msg || "会话失效");
    }
    store.setIdentity(p.accountId, me.data);
    store.run(
      "UPDATE accounts SET session_checked_at=? WHERE id=?",
      new Date().toISOString(),
      p.accountId,
    );
    return { valid: true };
  },
  addAccount: (p) => ({ id: store.addAccount(p.label) }),
  login: async (p) => {
    store.account(p.accountId);
    if (!p.username?.trim() || !p.password) throw new Error("请输入账号和密码");
    const r = await request(p.accountId, "login", {
      username: p.username.trim(),
      password: p.password,
    });
    if (r.code !== 1) {
      if (r.needsManual) await accountWindow(p.accountId, true);
      throw new Error(r.msg || "登录失败");
    }
    store.setIdentity(p.accountId, r.data);
    await sync(p.accountId);
    return r.data;
  },
  openOfficial: async (p) => {
    await accountWindow(p.accountId, true);
    return true;
  },
  sync: (p) => sync(p.accountId),
  categories: (p) =>
    withIdentity(p.accountId, async () => {
      const r = await request(p.accountId, "categories", {
        goods_type: "card",
      });
      if (r.code !== 1) throw new Error(r.msg || "分类读取失败");
      return r.data;
    }),
  publish: async (p) => {
    const product = validateProduct(p.product),
      id = randomUUID(),
      aid = p.accountId;
    store.account(aid);
    if (
      store.one(
        "SELECT id FROM publishes WHERE account_id=? AND state IN ('sending','pending')",
        aid,
      )
    )
      throw new Error("存在待确认发布，请先核对商品列表");
    store.run(
      "INSERT INTO publishes(id,account_id,name,state,created_at) VALUES(?,?,?,'sending',?)",
      id,
      aid,
      product.name,
      new Date().toISOString(),
    );
    let sent = false;
    store.run(
      "UPDATE publishes SET product_json=? WHERE id=?",
      JSON.stringify(product),
      id,
    );
    try {
      return await withIdentity(aid, async () => {
        await sync(aid);
        const before = new Set(
          store
            .all("SELECT id FROM goods WHERE account_id=?", aid)
            .map((g) => g.id),
        );
        store.run(
          "UPDATE publishes SET product_json=? WHERE id=?",
          JSON.stringify({ product, before: [...before] }),
          id,
        );
        sent = true;
        const r = await request(aid, "publish", product);
        if (r.code !== 1) {
          store.run(
            "UPDATE publishes SET state=?,error=? WHERE id=?",
            r.uncertain ? "pending" : "failed",
            r.msg || "发布失败",
            id,
          );
          throw new Error(r.msg || "发布失败");
        }
        await sync(aid);
        const matches = store
          .snapshot()
          .goods.filter(
            (g) =>
              g.account_id === aid &&
              !before.has(g.id) &&
              g.name === product.name,
          );
        if (matches.length !== 1)
          throw new Error("提交成功但回读未唯一匹配，禁止重复发布");
        const detail = await request(aid, "info", { id: matches[0].id });
        if (detail.code !== 1 || detail.data?.name !== product.name)
          throw new Error("发布详情尚未核实");
        store.run(
          "UPDATE publishes SET state='success',remote_id=? WHERE id=?",
          matches[0].id,
          id,
        );
        return { id: matches[0].id, message: "官方提交与回读确认成功" };
      });
    } catch (e) {
      store.run(
        "UPDATE publishes SET state=?,error=? WHERE id=? AND state='sending'",
        sent ? "pending" : "failed",
        e.message,
        id,
      );
      throw e;
    }
  },
  uploadImage: async (p) =>
    withIdentity(p.accountId, async () => {
      const picked = await dialog.showOpenDialog(main, {
        title: "选择商品封面",
        properties: ["openFile"],
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (picked.canceled) return null;
      const file = picked.filePaths[0];
      if (fs.statSync(file).size > 10 * 1024 * 1024)
        throw new Error("图片不得超过10MB");
      const ext = path.extname(file).toLowerCase(),
        r = await request(p.accountId, "upload", {
          name: path.basename(file),
          base64: fs.readFileSync(file).toString("base64"),
          type:
            ext === ".png"
              ? "image/png"
              : ext === ".webp"
                ? "image/webp"
                : "image/jpeg",
        });
      if (r.code !== 1) throw new Error(r.msg || "上传失败");
      return r.data.url;
    }),
  chooseFile: async () => {
    const p = await dialog.showOpenDialog(main, {
      title: "选择本地卡密来源",
      properties: ["openFile"],
      filters: [{ name: "卡密文件", extensions: ["txt", "xlsx", "csv"] }],
    });
    if (p.canceled) return null;
    const file = p.filePaths[0];
    if (fs.statSync(file).size > 30 * 1024 * 1024)
      throw new Error("文件不得超过30MB");
    const token = randomUUID();
    files.set(token, file);
    const r = readFileRows(token);
    return {
      token,
      name: r.name,
      sheets: r.sheets,
      rows: r.rows.slice(0, 8),
      total: r.rows.length,
    };
  },
  previewFile: (p) => {
    if (p.previewSheet) {
      const r = readFileRows(p.fileToken, p.sheet);
      return {
        name: r.name,
        sheets: r.sheets,
        rows: r.rows.slice(0, 8),
        total: r.rows.length,
      };
    }
    const r = extract(p);
    return { ...r, lines: r.lines.slice(0, 5), count: r.lines.length };
  },
  importCards: (p) => {
    const r = extract(p);
    return {
      ...store.addCards(
        p.accountId,
        p.goodsId,
        r.lines,
        p.name ||
          (p.fileToken ? path.basename(fileEntry(p.fileToken)) : "手动粘贴"),
      ),
      blank: r.blank,
    };
  },
  addCards: (p) =>
    withIdentity(p.accountId, () =>
      stock.submit(
        p.accountId,
        Number(p.goodsId),
        p.sourceId,
        Number(p.count),
        "manual",
        p.first === true,
      ),
    ),
  saveRule: (p) => ({ id: store.saveRule(p) }),
  toggleRule: (p) => {
    store.toggleRule(p.id, p.enabled === true);
    return true;
  },
  reconcile: (p) => {
    const b = store.one("SELECT * FROM batches WHERE id=?", p.id);
    if (!b) throw new Error("批次不存在");
    return withIdentity(b.account_id, () => stock.reconcile(p.id));
  },
  reconcilePublish: async (p) => {
    const record = store.one("SELECT * FROM publishes WHERE id=?", p.id);
    if (!record || record.state !== "pending")
      throw new Error("发布记录不存在或无需核实");
    const saved = JSON.parse(record.product_json || "{}");
    if (!saved.product || !Array.isArray(saved.before))
      throw new Error("缺少提交前商品清单，请在官网人工核对，不能自动重发");
    await sync(record.account_id);
    const matches = store
      .snapshot()
      .goods.filter(
        (g) =>
          g.account_id === record.account_id &&
          !saved.before.includes(g.id) &&
          g.name === saved.product.name,
      );
    if (matches.length !== 1)
      throw new Error("官方新增商品尚未唯一匹配，继续保留待确认");
    const r = await request(record.account_id, "info", { id: matches[0].id });
    if (r.code !== 1) throw new Error(r.msg || "发布详情回读失败");
    for (const key of [
      "name",
      "price",
      "category_id",
      "status",
      "show",
      "description",
    ])
      if (String(r.data[key]) !== String(saved.product[key]))
        throw new Error("平台商品字段未匹配：" + key + "，继续保留待确认");
    if (r.data.extend?.instructions !== saved.product.extend.instructions)
      throw new Error("平台使用说明未匹配，继续保留待确认");
    store.run(
      "UPDATE publishes SET state='success',remote_id=?,error='' WHERE id=? AND state='pending'",
      matches[0].id,
      p.id,
    );
    return { id: matches[0].id, message: "发布记录已由官方详情回读确认" };
  },
  cardList: (p) =>
    withIdentity(p.accountId, async () => {
      store.goods(p.accountId, p.goodsId);
      const r = await request(p.accountId, "cards", {
        goods_id: Number(p.goodsId),
        current: Math.max(1, Number(p.current) || 1),
        pageSize: 20,
        status: "",
        first: "",
        keywords: p.keywords || "",
      });
      if (r.code !== 1) throw new Error(r.msg || "库存读取失败");
      return r.data;
    }),
};
function register() {
  for (const [method, handler] of Object.entries(handlers))
    ipcMain.handle("client:" + method, async (event, p) => {
      if (
        event.sender !== main?.webContents ||
        event.senderFrame !== main.webContents.mainFrame ||
        !(devUrl
          ? event.senderFrame.url === new URL("/", devUrl).href
          : event.senderFrame.url === pathToFileURL(indexPath).href)
      )
        throw new Error("不可信调用来源");
      try {
        return { ok: true, data: await handler(p || {}) };
      } catch (e) {
        return { ok: false, error: e.message || "操作失败" };
      }
    });
}
async function boot() {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("系统凭据加密不可用，拒绝保存卡密");
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  store = new Store(path.join(dir, "client.sqlite"), {
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(Buffer.from(b)),
  });
  stock = new StockService(store, (a, op, data, control) =>
    op === "add"
      ? request(a, op, data, control)
      : withIdentity(a, () => request(a, op, data, control)),
  );
  stock.onTick = async () => {
    for (const a of store.snapshot().accounts) {
      if (a.status !== "online") continue;
      const entry = contexts.get(a.id);
      if (entry && Date.now() - (entry.sessionCheckAt || 0) < 300000) continue;
      if (entry) entry.sessionCheckAt = Date.now();
      try {
        await handlers.sessionCheck({ accountId: a.id });
        const current = contexts.get(a.id);
        if (current) current.sessionCheckAt = Date.now();
      } catch (error) {
        if (!quitting) store.invalidate(a.id, "会话检查失败：" + error.message);
      }
    }
  };
  register();
  main = new BrowserWindow({
    title: "链动卡密客户端",
    width: 1440,
    height: 940,
    minWidth: 1050,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  main.webContents.on("will-navigate", (event) => event.preventDefault());
  main.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      app.quit();
    }
  });
  if (devUrl) await main.loadURL(devUrl);
  else await main.loadFile(indexPath);
  main.show();
  stock.start();
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    stock.stop();
    for (const { win } of contexts.values()) win.destroy();
  });
  app.on("will-quit", () => store.close());
  for (const a of store.snapshot().accounts)
    sync(a.id).catch((e) => store.invalidate(a.id, e.message));
  return { app, store, stock, request, handlers, contexts, main, files };
}
if (require.main === module) {
  if (!app.requestSingleInstanceLock()) app.quit();
  else
    app
      .whenReady()
      .then(boot)
      .catch((e) => {
        dialog.showErrorBox("链动客户端启动失败", e.message);
        app.quit();
      });
}
module.exports = { boot };
