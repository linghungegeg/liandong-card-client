const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { Store } = require("../electron/store.cjs"),
  {
    StockService,
    parseLines,
    stockOf,
    refillAmount,
  } = require("../electron/stock.cjs"),
  {
    expression,
    defaultProduct,
    validateProduct,
  } = require("../electron/protocol.cjs");
const codec = {
  encrypt: (s) => Buffer.from(s),
  decrypt: (b) => Buffer.from(b).toString(),
};
function fixture() {
  const s = new Store(":memory:", codec),
    a = s.addAccount("测试A"),
    b = s.addAccount("测试B");
  s.setIdentity(a, { id: 1 });
  s.setIdentity(b, { id: 2 });
  s.sync(a, [
    {
      id: 10,
      goods_type: "card",
      name: "A",
      status: 1,
      extend: { stock_count: 0 },
    },
  ]);
  s.sync(b, [
    {
      id: 20,
      goods_type: "card",
      name: "B",
      status: 1,
      extend: { stock_count: 0 },
    },
  ]);
  const source = s.addCards(a, 10, ["00001", "00002", "00003"], "来源");
  return { s, a, b, source };
}
test("文本保留前导零、空格，忽略空行与完全重复", () => {
  const r = parseLines("\uFEFF0001\r\n 002 \n0001\n\n");
  assert.deepEqual(r.lines, ["0001", " 002 "]);
  assert.equal(r.duplicates, 1);
  assert.throws(() => parseLines("x".repeat(5601)));
});
test("阈值相等不补，未知库存不当零", () => {
  assert.equal(
    refillAmount(20, { threshold: 20, mode: "target", amount: 100 }),
    0,
  );
  assert.equal(
    refillAmount(19, { threshold: 20, mode: "target", amount: 100 }),
    81,
  );
  assert.throws(() => stockOf({ extend: {} }));
  assert.equal(stockOf({ extend: { stock_count: 0 } }), 0);
});
test("隔离账号归属、商户身份变化与重复绑定", () => {
  const { s, a, b } = fixture();
  assert.throws(() => s.goods(a, 20));
  assert.throws(() => s.setIdentity(b, { id: 1 }));
  assert.throws(() => s.setIdentity(a, { id: 99 }));
  assert.equal(s.account(a).status, "offline");
  s.close();
});
test("重复导入不重新分配已存在卡密", () => {
  const { s, a, source } = fixture();
  assert.equal(s.addCards(a, 10, ["00001"], "重复").added, 0);
  const r = s.reserve(a, 10, source.id, 2, "manual");
  assert.throws(() => s.reserve(a, 10, source.id, 1, "manual"));
  s.settle(r.id, new Set(r.cards.map((c) => c.id)));
  assert.equal(s.snapshot().batches[0].state, "success");
  assert.equal(s.snapshot().sources.find((x) => x.id === source.id).unused, 1);
  s.close();
});
test("来源不足及跨账号来源不创建批次", () => {
  const { s, a, b, source } = fixture();
  assert.throws(() => s.reserve(a, 10, source.id, 4, "manual"));
  assert.throws(() => s.reserve(b, 20, source.id, 1, "manual"));
  assert.equal(s.snapshot().batches.length, 0);
  s.close();
});
test("实际加卡与回读确认共用流程", async () => {
  const { s, a, source } = fixture(),
    remote = [];
  let adds = 0;
  const service = new StockService(s, async (_, op, p) => {
    if (op === "info")
      return {
        code: 1,
        data: {
          id: 10,
          goods_type: "card",
          status: 1,
          extend: { stock_count: remote.length },
        },
      };
    if (op === "cards")
      return {
        code: 1,
        data: {
          list: remote.map((secret) => ({ secret })),
          total: remote.length,
        },
      };
    if (op === "add") {
      adds++;
      remote.push(...p.content.split(String.fromCharCode(10)));
      return { code: 1 };
    }
  });
  const r = await service.submit(a, 10, source.id, 2);
  assert.equal(r.state, "success");
  assert.equal(r.accepted, 2);
  assert.equal(adds, 1);
  s.close();
});
test("超时保留预留并禁止盲重发，后续回读可确认", async () => {
  const { s, a, source } = fixture();
  let exists = false;
  const svc = new StockService(s, async (_, op) => {
    if (op === "info")
      return {
        code: 1,
        data: {
          id: 10,
          goods_type: "card",
          status: 1,
          extend: { stock_count: 0 },
        },
      };
    if (op === "cards")
      return {
        code: 1,
        data: {
          list: exists ? [{ secret: "00001" }] : [],
          total: exists ? 1 : 0,
        },
      };
    throw new Error("timeout");
  });
  await assert.rejects(() => svc.submit(a, 10, source.id, 1));
  const b = s.snapshot().batches[0];
  assert.equal(b.state, "pending");
  assert.throws(() => s.reserve(a, 10, source.id, 1, "manual"));
  exists = true;
  assert.equal((await svc.reconcile(b.id)).state, "success");
  s.close();
});
test("自动监控按目标补货、停止后不提交", async () => {
  const { s, a, source } = fixture(),
    remote = [];
  const id = s.saveRule({
    accountId: a,
    goodsId: 10,
    sourceId: source.id,
    threshold: 1,
    mode: "target",
    amount: 2,
    intervalSec: 30,
  });
  s.toggleRule(id, true);
  const svc = new StockService(s, async (_, op, p) =>
    op === "info"
      ? {
          code: 1,
          data: {
            id: 10,
            goods_type: "card",
            status: 1,
            extend: { stock_count: remote.length },
          },
        }
      : op === "cards"
        ? {
            code: 1,
            data: {
              list: remote.map((secret) => ({ secret })),
              total: remote.length,
            },
          }
        : (remote.push(...p.content.split(String.fromCharCode(10))),
          { code: 1 }),
  );
  await svc.runRule(id);
  assert.equal(remote.length, 2);
  await svc.runRule(id);
  assert.equal(remote.length, 2);
  s.toggleRule(id, false);
  await svc.runRule(id);
  assert.equal(remote.length, 2);
  s.close();
});
test("来源不足自动暂停，规则边界检查", async () => {
  const { s, a, source } = fixture();
  assert.throws(() =>
    s.saveRule({
      accountId: a,
      goodsId: 10,
      sourceId: source.id,
      threshold: 20,
      mode: "target",
      amount: 20,
      intervalSec: 30,
    }),
  );
  const id = s.saveRule({
    accountId: a,
    goodsId: 10,
    sourceId: source.id,
    threshold: 1,
    mode: "fixed",
    amount: 4,
    intervalSec: 30,
  });
  s.toggleRule(id, true);
  const svc = new StockService(s, async () => ({
    code: 1,
    data: { id: 10, goods_type: "card", status: 1, extend: { stock_count: 0 } },
  }));
  await svc.runRule(id);
  assert.equal(s.one("SELECT enabled FROM rules WHERE id=?", id).enabled, 0);
  s.close();
});
test("协议入口白名单与发布类型边界", () => {
  assert.throws(() => expression("delete"));
  assert.ok(expression("goods").includes("await import(script.src)"));
  const p = defaultProduct();
  assert.throws(() => validateProduct(p));
  Object.assign(p, { name: "测试", category_id: 1, description: "说明" });
  p.extend.instructions = "使用";
  assert.equal(validateProduct(p), p);
  p.goods_type = "article";
  assert.throws(() => validateProduct(p));
});
test("官方明确拒绝并完成回读后释放未接收卡密", async () => {
  const { s, a, source } = fixture();
  const svc = new StockService(s, async (_, op) =>
    op === "info"
      ? {
          code: 1,
          data: {
            id: 10,
            goods_type: "card",
            status: 1,
            extend: { stock_count: 0 },
          },
        }
      : op === "cards"
        ? { code: 1, data: { list: [], total: 0 } }
        : { code: 0, msg: "官方明确拒绝" },
  );
  const b = await svc.submit(a, 10, source.id, 2);
  assert.equal(b.state, "failed");
  assert.equal(s.snapshot().sources.find((x) => x.id === source.id).unused, 3);
  assert.equal(s.reserve(a, 10, source.id, 1, "manual").cards.length, 1);
  s.close();
});
test("加卡前读取失败不会占用卡密", async () => {
  const { s, a, source } = fixture();
  const svc = new StockService(s, async (_, op) =>
    op === "info"
      ? {
          code: 1,
          data: {
            id: 10,
            goods_type: "card",
            status: 1,
            extend: { stock_count: 0 },
          },
        }
      : { code: 0 },
  );
  await assert.rejects(() => svc.submit(a, 10, source.id, 1));
  assert.equal(s.snapshot().sources.find((x) => x.id === source.id).unused, 3);
  s.close();
});
test("官方拒绝且库存刷新失败时保留失败终态，不重新锁住卡密", async () => {
  const { s, a, source } = fixture();
  let reads = 0;
  const service = new StockService(s, async (_, op) => {
    if (op === "info") {
      if (++reads > 1) throw new Error("库存读取断网");
      return {
        code: 1,
        data: {
          id: 10,
          goods_type: "card",
          status: 1,
          extend: { stock_count: 0 },
        },
      };
    }
    if (op === "cards") return { code: 1, data: { list: [], total: 0 } };
    return { code: 0, msg: "禁止添加" };
  });
  const batch = await service.submit(a, 10, source.id, 1);
  assert.equal(batch.state, "failed");
  assert.equal(s.snapshot().sources[0].unused, 3);
  assert.ok(s.reserve(a, 10, source.id, 1, "manual").id);
  s.close();
});
test("自动补卡遇到官方明确拒绝就暂停，下一轮不重试", async () => {
  const { s, a, source } = fixture();
  let adds = 0;
  const id = s.saveRule({
    accountId: a,
    goodsId: 10,
    sourceId: source.id,
    threshold: 1,
    mode: "fixed",
    amount: 1,
    intervalSec: 30,
  });
  s.toggleRule(id, true);
  const service = new StockService(s, async (_, op) => {
    if (op === "info")
      return {
        code: 1,
        data: {
          id: 10,
          goods_type: "card",
          status: 1,
          extend: { stock_count: 0 },
        },
      };
    if (op === "cards") return { code: 1, data: { list: [], total: 0 } };
    adds++;
    return { code: 0, msg: "禁止添加" };
  });
  await service.runRule(id);
  await service.runRule(id);
  assert.equal(adds, 1);
  assert.equal(s.one("SELECT enabled FROM rules WHERE id=?", id).enabled, 0);
  s.close();
});
test("部分接收只确认已回读卡密，余下预留直到核实", async () => {
  const { s, a, source } = fixture();
  let remote = [];
  const service = new StockService(s, async (_, op) =>
    op === "info"
      ? {
          code: 1,
          data: {
            id: 10,
            goods_type: "card",
            status: 1,
            extend: { stock_count: remote.length },
          },
        }
      : op === "cards"
        ? {
            code: 1,
            data: {
              list: remote.map((secret) => ({ secret })),
              total: remote.length,
            },
          }
        : ((remote = ["00001"]), { code: 1 }),
  );
  const batch = await service.submit(a, 10, source.id, 2);
  assert.equal(batch.state, "pending");
  assert.equal(batch.accepted, 1);
  assert.equal(s.snapshot().sources[0].reserved, 1);
  remote.push("00002");
  assert.equal((await service.reconcile(batch.id)).state, "success");
  s.close();
});
test("重启将已发出批次转为待确认，不释放卡密", () => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liandong-stock-test-")),
    file = path.join(dir, "test.sqlite");
  try {
    let s = new Store(file, codec);
    const a = s.addAccount("重启验收");
    s.setIdentity(a, { id: 1 });
    s.sync(a, [
      { id: 10, goods_type: "card", status: 1, extend: { stock_count: 0 } },
    ]);
    const source = s.addCards(a, 10, ["00001"], "卡密");
    s.reserve(a, 10, source.id, 1, "manual");
    s.close();
    s = new Store(file, codec);
    assert.equal(s.snapshot().batches[0].state, "pending");
    assert.equal(s.snapshot().sources[0].reserved, 1);
    assert.throws(() => s.reserve(a, 10, source.id, 1, "manual"));
    s.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
