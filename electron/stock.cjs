function parseLines(text) {
  if (typeof text !== "string") throw new Error("请输入卡密文本");
  const all = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/),
    lines = [],
    seen = new Set();
  let blank = 0,
    duplicates = 0;
  for (const s of all) {
    if (!s.trim()) {
      blank++;
      continue;
    }
    if (s.length > 5600) throw new Error("单条卡密超过5600字符");
    if (seen.has(s)) {
      duplicates++;
      continue;
    }
    seen.add(s);
    lines.push(s);
  }
  if (lines.length > 50000) throw new Error("单次最多50000条卡密");
  return { lines, blank, duplicates, total: all.length };
}
function stockOf(g) {
  const n = g?.extend?.stock_count;
  if (n === null || n === undefined || n === "")
    throw new Error("官方未返回可售库存，停止补货");
  const v = Number(n);
  if (!Number.isSafeInteger(v) || v < 0) throw new Error("官方库存格式异常");
  return v;
}
function refillAmount(stock, rule) {
  if (stock >= rule.threshold) return 0;
  return Math.min(
    50000,
    rule.mode === "target" ? Math.max(0, rule.amount - stock) : rule.amount,
  );
}
function sheetLines(rows, columns, separator = "    ", skipHeader = false) {
  const selected = rows
    .slice(skipHeader ? 1 : 0)
    .map((row) => columns.map((c) => String(row[c] ?? "")));
  const blank = selected.filter((row) => row.every((s) => !s.trim())).length;
  const result = parseLines(
    selected
      .filter((row) => row.some((s) => s.trim()))
      .map((row) => row.join(separator))
      .join(String.fromCharCode(10)),
  );
  return { ...result, blank };
}
class StockService {
  constructor(store, request) {
    this.store = store;
    this.request = request;
    this.busy = new Set();
    this.timer = null;
    this.tickRunning = false;
  }
  async locked(a, g, fn) {
    const key = a + ":" + g;
    if (this.busy.has(key)) throw new Error("该商品正在处理，请勿重复提交");
    this.busy.add(key);
    try {
      return await fn();
    } finally {
      this.busy.delete(key);
    }
  }
  async readGood(a, g) {
    this.store.goods(a, g);
    const r = await this.request(a, "info", { id: Number(g) });
    if (r.code !== 1) throw new Error(r.msg || "商品读取失败");
    if (
      Number(r.data?.id) !== Number(g) ||
      r.data.goods_type !== "card" ||
      Number(r.data.parent_id || 0) !== 0
    )
      throw new Error("商品身份或类型不匹配");
    this.store.updateGood(a, r.data);
    return r.data;
  }
  async findSecrets(a, g, wanted) {
    const found = new Set();
    let visited = 0;
    for (let current = 1; current <= 3001; current++) {
      const r = await this.request(a, "cards", {
        goods_id: Number(g),
        current,
        pageSize: 100,
        status: "",
        first: "",
        keywords: "",
      });
      if (r.code !== 1 || !Array.isArray(r.data?.list))
        throw new Error("卡密记录回读失败");
      const rows = r.data.list,
        total = Number(r.data.total);
      if (!Number.isSafeInteger(total) || total < 0 || total > 300000)
        throw new Error("卡密记录数量异常，保留待确认");
      for (const row of rows) if (wanted.has(row.secret)) found.add(row.secret);
      visited += rows.length;
      if (found.size === wanted.size || visited >= total) return found;
      if (!rows.length) throw new Error("卡密记录分页不完整，保留待确认");
    }
    throw new Error("回读超过分页上限，保留待确认");
  }
  async reconcile(id) {
    const b = this.store.one("SELECT * FROM batches WHERE id=?", id);
    if (!b) throw new Error("批次不存在");
    return this.locked(b.account_id, b.goods_id, () => this.verify(b));
  }
  async verify(b) {
    try {
      const cards = this.store.batchCards(b.id),
        found = await this.findSecrets(
          b.account_id,
          b.goods_id,
          new Set(cards.map((c) => c.secret)),
        );
      const ids = new Set(
        cards.filter((c) => found.has(c.secret)).map((c) => c.id),
      );
      const rejected = Boolean(
        this.store.one("SELECT rejected FROM batches WHERE id=?", b.id)
          ?.rejected,
      );
      this.store.settle(
        b.id,
        ids,
        rejected,
        ids.size === cards.length
          ? ""
          : rejected
            ? "官方明确拒绝，未接收卡密已释放"
            : "部分或全部卡密尚未回读到，禁止自动重发",
      );
      try {
        await this.readGood(b.account_id, b.goods_id);
      } catch (e) {
        this.store.run(
          "UPDATE batches SET error=? WHERE id=? AND state IN ('success','failed')",
          "卡密结果已核实；库存刷新失败：" + e.message,
          b.id,
        );
      }
    } catch (e) {
      this.store.run(
        "UPDATE batches SET state='pending',error=? WHERE id=? AND state NOT IN ('success','failed')",
        e.message,
        b.id,
      );
      throw e;
    }
    return this.store.one("SELECT * FROM batches WHERE id=?", b.id);
  }
  async submitUnlocked(
    a,
    g,
    s,
    count,
    kind,
    first = false,
    guard = null,
    rule = null,
  ) {
    const good = await this.readGood(a, g);
    if (rule) {
      if (Number(good.status) !== 1) throw new Error("商品已停止销售");
      count = refillAmount(stockOf(good), rule);
      if (!count) return { state: "cancelled" };
    }
    if (stockOf(good) + count > 300000)
      throw new Error("补货后将超过官方30万待售库存上限");
    if (guard && !guard()) return { state: "cancelled" };
    const b = this.store.reserve(a, g, s, count, kind);
    let sent = false;
    try {
      const existing = await this.findSecrets(
        a,
        g,
        new Set(b.cards.map((c) => c.secret)),
      );
      const pending = b.cards.filter((c) => !existing.has(c.secret));
      if (pending.length) {
        if (guard && !guard()) {
          this.store.settle(
            b.id,
            new Set(
              b.cards.filter((c) => existing.has(c.secret)).map((c) => c.id),
            ),
            true,
            "提交前已暂停",
          );
          return this.store.one("SELECT * FROM batches WHERE id=?", b.id);
        }
        sent = true;
        const r = await this.request(
          a,
          "add",
          {
            goods_id: Number(g),
            content: pending.map((c) => c.secret).join(String.fromCharCode(10)),
            first: first ? 1 : 0,
            remove_repeat: 1,
          },
          {
            guard,
            prepare: (fresh) => {
              if (Number(fresh.id) !== Number(g) || fresh.goods_type !== "card")
                throw new Error("最终商品身份不匹配");
              this.store.updateGood(a, fresh);
              if (rule && Number(fresh.status) !== 1)
                throw new Error("商品已停止销售");
              const finalCount = rule
                ? refillAmount(stockOf(fresh), rule)
                : count;
              if (!finalCount) return null;
              if (stockOf(fresh) + finalCount > 300000)
                throw new Error("最终库存超过官方上限");
              b.cards = this.store.resizeBatch(b.id, finalCount);
              const content = b.cards
                .filter((c) => !existing.has(c.secret))
                .map((c) => c.secret)
                .join(String.fromCharCode(10));
              return content
                ? {
                    goods_id: Number(g),
                    content,
                    first: first ? 1 : 0,
                    remove_repeat: 1,
                  }
                : null;
            },
          },
        );
        if (r.notSent) {
          this.store.settle(
            b.id,
            new Set(
              b.cards.filter((c) => existing.has(c.secret)).map((c) => c.id),
            ),
            true,
            r.msg || "提交前已取消",
          );
          this.store.run(
            "UPDATE batches SET state='cancelled' WHERE id=? AND state='failed'",
            b.id,
          );
          return this.store.one("SELECT * FROM batches WHERE id=?", b.id);
        }
        if (r.code !== 1)
          this.store.run(
            "UPDATE batches SET error=?,rejected=? WHERE id=?",
            r.msg || "响应未确认",
            !r.uncertain && !r.identityMismatch ? 1 : 0,
            b.id,
          );
      }
      return await this.verify({ ...b, account_id: a, goods_id: g });
    } catch (e) {
      if (!sent || e.notSent) {
        this.store.settle(b.id, new Set(), true, "尚未提交：" + e.message);
        throw e;
      }
      this.store.run(
        "UPDATE batches SET state='pending',error=? WHERE id=? AND state NOT IN ('success','failed')",
        e.message,
        b.id,
      );
      throw new Error("批次待确认：" + e.message);
    }
  }
  async submit(a, g, s, count, kind = "manual", first = false) {
    return this.locked(a, g, () =>
      this.submitUnlocked(a, g, s, count, kind, first),
    );
  }
  async runRule(id) {
    const r = this.store.one("SELECT * FROM rules WHERE id=?", id);
    if (!r?.enabled) return;
    if (this.busy.has(r.account_id + ":" + r.goods_id)) return;
    return this.locked(r.account_id, r.goods_id, async () => {
      const active = () => {
        const latest = this.store.one(
          "SELECT enabled,revision FROM rules WHERE id=?",
          id,
        );
        return Boolean(latest?.enabled && latest.revision === r.revision);
      };
      try {
        let g = await this.readGood(r.account_id, r.goods_id);
        if (Number(g.status) !== 1) throw new Error("商品已停止销售");
        let n = refillAmount(stockOf(g), r);
        if (n && active()) {
          g = await this.readGood(r.account_id, r.goods_id);
          if (Number(g.status) !== 1) throw new Error("商品已停止销售");
          n = refillAmount(stockOf(g), r);
          if (n && active()) {
            const result = await this.submitUnlocked(
              r.account_id,
              r.goods_id,
              r.source_id,
              n,
              "auto",
              false,
              active,
              r,
            );
            if (result.state === "pending")
              throw new Error("补货结果待确认，已暂停此任务");
            if (result.state === "failed")
              throw new Error(result.error || "官方拒绝补货，已暂停此任务");
          }
        }
        this.store.run(
          "UPDATE rules SET last_at=?,next_at=?,error=? WHERE id=? AND revision=?",
          new Date().toISOString(),
          Date.now() + r.interval_sec * 1000,
          "",
          id,
          r.revision,
        );
      } catch (e) {
        this.store.run(
          "UPDATE rules SET enabled=0,last_at=?,error=? WHERE id=? AND revision=?",
          new Date().toISOString(),
          e.message,
          id,
          r.revision,
        );
      }
    });
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(
      () =>
        this.tick().catch((e) => {
          this.store.run(
            "UPDATE rules SET enabled=0,error=? WHERE enabled=1",
            "监控执行异常：" + e.message,
          );
        }),
      1000,
    );
    this.timer.unref();
  }
  async tick() {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      if (this.onTick) await this.onTick();
      for (const r of this.store.all(
        "SELECT id FROM rules WHERE enabled=1 AND next_at<=?",
        Date.now(),
      ))
        await this.runRule(r.id);
    } finally {
      this.tickRunning = false;
    }
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
module.exports = {
  parseLines,
  sheetLines,
  stockOf,
  refillAmount,
  StockService,
};
