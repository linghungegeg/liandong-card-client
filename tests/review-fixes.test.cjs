const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { createRequire } = require("node:module");
const { Store } = require("../electron/store.cjs"),
  { StockService, sheetLines } = require("../electron/stock.cjs");
function fixture() {
  const s = new Store(":memory:", {
      encrypt: (v) => Buffer.from(v),
      decrypt: (v) => Buffer.from(v).toString(),
    }),
    a = s.addAccount("测试账号");
  s.setIdentity(a, { id: 1 });
  s.sync(a, [
    { id: 10, goods_type: "card", status: 1, extend: { stock_count: 0 } },
  ]);
  const source = s.addCards(
    a,
    10,
    Array.from({ length: 200 }, (_, i) => "TEST-" + i),
    "测试来源",
  );
  const rule = s.saveRule({
    accountId: a,
    goodsId: 10,
    sourceId: source.id,
    threshold: 20,
    mode: "target",
    amount: 100,
    intervalSec: 60,
  });
  s.toggleRule(rule, true);
  return { s, a, source, rule };
}
function pipeline(stockSequence, pauseFinal = false) {
  const f = fixture(),
    module = { exports: {} },
    mainPath = path.resolve(__dirname, "../electron/main.cjs"),
    req = createRequire(mainPath);
  const source = fs.readFileSync(mainPath, "utf8");
  vm.runInNewContext(
    source +
      ";module.exports.hooks={request,withIdentity,contexts,handlers,setStore:s=>store=s};",
    {
      require: (n) => (n === "electron" ? { app: {} } : req(n)),
      module,
      __dirname: path.dirname(mainPath),
      process: { env: {} },
      URL,
      TextDecoder,
      Buffer,
      console,
      setTimeout,
      clearTimeout,
    },
  );
  const hooks = module.exports.hooks;
  hooks.setStore(f.s);
  let reads = 0,
    adds = 0,
    remote = [],
    reached,
    release;
  const waiting = new Promise((r) => (reached = r)),
    gate = new Promise((r) => (release = r));
  hooks.contexts.set(f.a, {
    ready: Promise.resolve(),
    win: {
      isDestroyed: () => false,
      destroy() {},
      webContents: {
        getURL: () => "https://wzyp.cn/merchant/goods/list",
        executeJavaScript: async (expression) => {
          const input = JSON.parse(
            expression.slice(expression.lastIndexOf(")(") + 2, -1),
          );
          if (input.action === "user") return { code: 1, data: { id: 1 } };
          if (input.action === "info") {
            reads++;
            if (pauseFinal && reads === 4) {
              reached();
              await gate;
            }
            return {
              code: 1,
              data: {
                id: 10,
                goods_type: "card",
                status: 1,
                extend: {
                  stock_count:
                    stockSequence[
                      Math.min(reads - 1, stockSequence.length - 1)
                    ],
                },
              },
            };
          }
          if (input.action === "cards")
            return {
              code: 1,
              data: {
                list: remote.map((secret) => ({ secret })),
                total: remote.length,
              },
            };
          if (input.action === "add") {
            adds++;
            remote = input.data.content.split(String.fromCharCode(10));
            return { code: 1 };
          }
          if (input.action === "session") return { code: 1, data: { id: 1 } };
          throw new Error("unexpected operation " + input.action);
        },
      },
    },
  });
  const service = new StockService(f.s, (a, op, data, control) =>
    op === "add"
      ? hooks.request(a, op, data, control)
      : hooks.withIdentity(a, () => hooks.request(a, op, data, control)),
  );
  return {
    ...f,
    service,
    hooks,
    waiting,
    release: () => release(),
    sent: () => ({ adds, count: remote.length }),
  };
}
test("表格空白行在拼接前剔除，保留前导零和非空内容", () => {
  const r = sheetLines(
    [["卡号", "密码"], ["0001", "0012"], [], ["", ""], ["0002", "0034"]],
    [0, 1],
    "----",
    true,
  );
  assert.deepEqual(r.lines, ["0001----0012", "0002----0034"]);
  assert.equal(r.blank, 2);
});
test("界面未知库存不转零且与后端含义一致", () => {
  const ui = fs.readFileSync(
    path.resolve(__dirname, "../src/main.jsx"),
    "utf8",
  );
  const stock = vm.runInNewContext(
    "(" +
      ui.slice(
        ui.indexOf("const stock =") + 13,
        ui.indexOf(";", ui.indexOf("const stock =")),
      ) +
      ")",
  );
  for (const value of [null, undefined, ""])
    assert.equal(stock({ extend: { stock_count: value } }), null);
  assert.equal(stock({ extend: { stock_count: 0 } }), 0);
});
test("最终提交点库存已满足目标，零提交并释放来源", async () => {
  const f = pipeline([0, 0, 0, 100]);
  try {
    await f.service.runRule(f.rule);
    assert.equal(f.sent().adds, 0);
    assert.equal(f.s.snapshot().sources[0].unused, 200);
    assert.equal(f.s.snapshot().batches[0].state, "cancelled");
  } finally {
    f.s.close();
  }
});
test("最终库存变化后按最新库存缩减到81条", async () => {
  const f = pipeline([0, 0, 0, 19]);
  try {
    await f.service.runRule(f.rule);
    assert.equal(f.sent().count, 81);
    assert.equal(f.s.snapshot().batches[0].requested, 81);
    assert.equal(f.s.snapshot().sources[0].unused, 119);
  } finally {
    f.s.close();
  }
});
test("最终库存下降后重新认领足量卡密补到目标", async () => {
  const f = pipeline([19, 19, 19, 0]);
  try {
    await f.service.runRule(f.rule);
    assert.equal(f.sent().count, 100);
    assert.equal(f.s.snapshot().batches[0].accepted, 100);
  } finally {
    f.s.close();
  }
});
test("暂停等待身份/库存检查中的加卡，不发出请求", async () => {
  const f = pipeline([0, 0, 0, 0], true);
  try {
    const task = f.service.runRule(f.rule);
    await f.waiting;
    f.s.toggleRule(f.rule, false);
    f.release();
    await task;
    assert.equal(f.sent().adds, 0);
    assert.equal(f.s.snapshot().sources[0].unused, 200);
  } finally {
    f.s.close();
  }
});
test("暂停后重新启用也不会复活旧版本任务", async () => {
  const f = pipeline([0, 0, 0, 0], true);
  try {
    const task = f.service.runRule(f.rule);
    await f.waiting;
    f.s.toggleRule(f.rule, false);
    f.s.toggleRule(f.rule, true);
    f.release();
    await task;
    assert.equal(f.sent().adds, 0);
    assert.equal(f.s.snapshot().rules[0].enabled, 1);
  } finally {
    f.s.close();
  }
});
test("会话检查更新状态时间，身份变化立即停止监控", async () => {
  const f = pipeline([0]);
  try {
    await f.hooks.handlers.sessionCheck({ accountId: f.a });
    assert.ok(f.s.account(f.a).session_checked_at);
    assert.equal(f.s.account(f.a).status, "online");
    f.s.setIdentity(f.a, { id: 1 });
    assert.throws(() => f.s.setIdentity(f.a, { id: 2 }));
    assert.equal(f.s.snapshot().rules[0].enabled, 0);
  } finally {
    f.s.close();
  }
});
test('官方会话过期立即暂停账号规则并提示重新登录',async()=>{
  const f=pipeline([0]);try{
    f.hooks.contexts.get(f.a).win.webContents.executeJavaScript=async()=>({code:0,msg:'会话过期，请重新登录'});
    await assert.rejects(()=>f.hooks.handlers.sessionCheck({accountId:f.a}));
    assert.equal(f.s.account(f.a).status,'offline');assert.equal(f.s.snapshot().rules[0].enabled,0);
  }finally{f.s.close();}
});
test("补货和发布记录超过旧上限仍可分页和筛选核实", () => {
  const { s, a } = fixture();
  try {
    s.run(
      "INSERT INTO batches(id,account_id,goods_id,kind,state,requested,created_at) VALUES('old',?,10,'manual','pending',1,'2020-01-01')",
      a,
    );
    for (let i = 0; i < 600; i++)
      s.run(
        "INSERT INTO batches(id,account_id,goods_id,kind,state,requested,created_at) VALUES(?,?,10,'manual','success',1,'2026-10-14')",
        "b" + i,
        a,
      );
    const first = s.records({ kind: "batches", accountId: a });
    assert.equal(first.total, 601);
    assert.equal(first.list[0].id, "old");
    assert.equal(first.list.length, 20);
    const tail = s.records({ kind: "batches", accountId: a, current: 31 });
    assert.equal(tail.list.length, 1);
    assert.equal(
      s.records({ kind: "batches", accountId: a, state: "pending" }).total,
      1,
    );
    for (let i = 0; i < 120; i++)
      s.run(
        "INSERT INTO publishes(id,account_id,name,state,created_at) VALUES(?,?,'测试','success','2026-10-14')",
        "p" + i,
        a,
      );
    s.run(
      "INSERT INTO publishes(id,account_id,name,state,created_at) VALUES('old-p',?,'测试','pending','2020-01-01')",
      a,
    );
    assert.equal(s.records({ kind: "publishes", accountId: a }).total, 121);
    assert.equal(
      s.records({ kind: "publishes", state: "pending" }).list[0].id,
      "old-p",
    );
    assert.throws(() => s.records({ kind: "accounts" }));
    assert.throws(() => s.records({ pageSize: 1000 }));
  } finally {
    s.close();
  }
});
