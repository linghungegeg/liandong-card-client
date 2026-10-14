const { DatabaseSync } = require("node:sqlite");
const { randomUUID, createHash } = require("node:crypto");
class Store {
  constructor(file, codec) {
    this.db = new DatabaseSync(file);
    this.codec = codec;
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,label TEXT NOT NULL,remote_id TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'unknown',error TEXT NOT NULL DEFAULT '',synced_at TEXT);
      CREATE TABLE IF NOT EXISTS goods(account_id TEXT NOT NULL REFERENCES accounts(id),id INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(account_id,id));
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),goods_id INTEGER NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),goods_id INTEGER NOT NULL,source_id TEXT,kind TEXT NOT NULL,state TEXT NOT NULL,requested INTEGER NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cards(id INTEGER PRIMARY KEY,source_id TEXT,account_id TEXT NOT NULL REFERENCES accounts(id),goods_id INTEGER NOT NULL,hash TEXT NOT NULL,secret BLOB NOT NULL,state TEXT NOT NULL DEFAULT 'unused',batch_id TEXT,UNIQUE(account_id,hash));
      CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),goods_id INTEGER NOT NULL,source_id TEXT NOT NULL REFERENCES sources(id),threshold INTEGER NOT NULL,mode TEXT NOT NULL,amount INTEGER NOT NULL,interval_sec INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,last_at TEXT,error TEXT NOT NULL DEFAULT '',UNIQUE(account_id,goods_id));
      CREATE TABLE IF NOT EXISTS publishes(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),name TEXT NOT NULL,state TEXT NOT NULL,remote_id INTEGER,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);`);
    if (
      !this.all("PRAGMA table_info(batches)").some((c) => c.name === "rejected")
    )
      this.db.exec(
        "ALTER TABLE batches ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0",
      );
    if (
      !this.all("PRAGMA table_info(publishes)").some(
        (c) => c.name === "product_json",
      )
    )
      this.db.exec(
        "ALTER TABLE publishes ADD COLUMN product_json TEXT NOT NULL DEFAULT ''",
      );
    if (
      !this.all("PRAGMA table_info(rules)").some((c) => c.name === "revision")
    )
      this.db.exec(
        "ALTER TABLE rules ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
      );
    if (
      !this.all("PRAGMA table_info(accounts)").some(
        (c) => c.name === "session_checked_at",
      )
    )
      this.db.exec("ALTER TABLE accounts ADD COLUMN session_checked_at TEXT");
    this.db.exec(
      "UPDATE batches SET state='pending',error='进程中断，需回读核实' WHERE state='sending'; UPDATE publishes SET state='pending',error='进程中断，请核对官方商品列表' WHERE state='sending'",
    );
  }
  all(sql, ...p) {
    return this.db.prepare(sql).all(...p);
  }
  one(sql, ...p) {
    return this.db.prepare(sql).get(...p);
  }
  run(sql, ...p) {
    return this.db.prepare(sql).run(...p);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  account(id) {
    const a = this.one("SELECT * FROM accounts WHERE id=?", id);
    if (!a) throw new Error("账号不存在");
    return a;
  }
  addAccount(label) {
    if (!label?.trim() || label.length > 60)
      throw new Error("账号名称须为 1–60 个字符");
    const id = randomUUID();
    this.run("INSERT INTO accounts(id,label) VALUES(?,?)", id, label.trim());
    return id;
  }
  setIdentity(id, me) {
    const current = this.account(id);
    if (!me.id) throw new Error("官方未返回账号身份");
    if (
      this.one(
        "SELECT id FROM accounts WHERE remote_id=? AND id<>?",
        String(me.id),
        id,
      )
    ) {
      this.invalidate(id, "该商户已绑定其他分区");
      throw new Error("该商户已绑定其他账号分区");
    }
    if (current.remote_id && current.remote_id !== String(me.id)) {
      this.invalidate(id, "窗口身份改变，已停止监控");
      throw new Error("账号身份改变，禁止沿用原规则");
    }
    this.run(
      "UPDATE accounts SET remote_id=?,status='online',error='' WHERE id=?",
      String(me.id),
      id,
    );
  }
  invalidate(id, error) {
    this.run(
      "UPDATE accounts SET status='offline',error=? WHERE id=?",
      error,
      id,
    );
    this.run(
      "UPDATE rules SET enabled=0,revision=revision+1,error=? WHERE account_id=?",
      error,
      id,
    );
  }
  goods(id, gid) {
    this.account(id);
    const g = this.one(
      "SELECT json FROM goods WHERE account_id=? AND id=?",
      id,
      Number(gid),
    );
    if (!g) throw new Error("商品不属于该账号或尚未同步");
    return JSON.parse(g.json);
  }
  sync(id, goods) {
    this.account(id);
    this.transaction(() => {
      this.run("DELETE FROM goods WHERE account_id=?", id);
      for (const g of goods) {
        if (g.goods_type !== "card" || Number(g.parent_id || 0) !== 0) continue;
        this.run(
          "INSERT INTO goods VALUES(?,?,?)",
          id,
          g.id,
          JSON.stringify(g),
        );
      }
      this.run(
        "UPDATE accounts SET synced_at=? WHERE id=?",
        new Date().toISOString(),
        id,
      );
    });
  }
  updateGood(id, g) {
    this.goods(id, g.id);
    this.run(
      "UPDATE goods SET json=? WHERE account_id=? AND id=?",
      JSON.stringify(g),
      id,
      g.id,
    );
  }
  addCards(aid, gid, lines, name) {
    this.goods(aid, gid);
    if (!Array.isArray(lines) || !lines.length || lines.length > 50000)
      throw new Error("每次导入 1–50000 条卡密");
    if (
      lines.some(
        (s) =>
          typeof s !== "string" ||
          !s.trim() ||
          /[\r\n]/.test(s) ||
          s.length > 5600,
      )
    )
      throw new Error("卡密不能为空、跨行或超过5600字符");
    const id = randomUUID();
    let added = 0;
    this.transaction(() => {
      this.run(
        "INSERT INTO sources VALUES(?,?,?,?,?)",
        id,
        aid,
        Number(gid),
        String(name || "手动输入").slice(0, 200),
        new Date().toISOString(),
      );
      for (const s of lines) {
        const hash = createHash("sha256").update(s).digest("hex");
        added += Number(
          this.run(
            "INSERT OR IGNORE INTO cards(source_id,account_id,goods_id,hash,secret) VALUES(?,?,?,?,?)",
            id,
            aid,
            Number(gid),
            hash,
            this.codec.encrypt(s),
          ).changes,
        );
      }
    });
    return { id, added, duplicates: lines.length - added };
  }
  reserve(aid, gid, sid, count, kind) {
    this.goods(aid, gid);
    if (!Number.isSafeInteger(count) || count < 1 || count > 50000)
      throw new Error("单次加卡数量须为1–50000");
    return this.transaction(() => {
      if (
        this.one(
          "SELECT id FROM batches WHERE account_id=? AND goods_id=? AND state IN ('sending','pending')",
          aid,
          Number(gid),
        )
      )
        throw new Error("商品存在待确认批次，先核实再补货");
      if (
        !this.one(
          "SELECT id FROM sources WHERE id=? AND account_id=? AND goods_id=?",
          sid,
          aid,
          Number(gid),
        )
      )
        throw new Error("来源与账号或商品不匹配");
      const cards = this.all(
        "SELECT * FROM cards WHERE source_id=? AND state='unused' ORDER BY id LIMIT ?",
        sid,
        count,
      );
      if (cards.length < count) throw new Error("本地待用卡密不足，请补充来源");
      const id = randomUUID();
      this.run(
        "INSERT INTO batches(id,account_id,goods_id,source_id,kind,state,requested,created_at) VALUES(?,?,?,?,?,'sending',?,?)",
        id,
        aid,
        Number(gid),
        sid,
        kind,
        count,
        new Date().toISOString(),
      );
      for (const c of cards)
        this.run(
          "UPDATE cards SET state='reserved',batch_id=? WHERE id=? AND state='unused'",
          id,
          c.id,
        );
      return {
        id,
        cards: cards.map((c) => ({
          id: c.id,
          secret: this.codec.decrypt(c.secret),
        })),
      };
    });
  }
  settle(id, found, rejected = false, error = "") {
    this.transaction(() => {
      const b = this.one("SELECT * FROM batches WHERE id=?", id);
      if (!b) throw new Error("批次不存在");
      for (const c of this.all("SELECT id FROM cards WHERE batch_id=?", id)) {
        if (found.has(c.id))
          this.run("UPDATE cards SET state='uploaded' WHERE id=?", c.id);
        else if (rejected)
          this.run(
            "UPDATE cards SET state='unused',batch_id=NULL WHERE id=? AND state='reserved'",
            c.id,
          );
      }
      const n = this.one(
        "SELECT count(*) n FROM cards WHERE batch_id=? AND state='uploaded'",
        id,
      ).n;
      this.run(
        "UPDATE batches SET state=?,accepted=?,rejected=?,error=? WHERE id=?",
        n === b.requested ? "success" : rejected ? "failed" : "pending",
        n,
        rejected ? 1 : 0,
        error,
        id,
      );
    });
  }
  resizeBatch(id, count) {
    return this.transaction(() => {
      const b = this.one("SELECT * FROM batches WHERE id=?", id);
      if (
        !b ||
        b.state !== "sending" ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > 50000
      )
        throw new Error("批次数量调整不合法");
      let rows = this.all(
        "SELECT * FROM cards WHERE batch_id=? ORDER BY id",
        id,
      );
      if (count > rows.length) {
        const extra = this.all(
          "SELECT * FROM cards WHERE source_id=? AND state='unused' ORDER BY id LIMIT ?",
          b.source_id,
          count - rows.length,
        );
        if (extra.length !== count - rows.length)
          throw new Error("最终库存变化后来源不足，已取消本次补货");
        for (const c of extra)
          this.run(
            "UPDATE cards SET state='reserved',batch_id=? WHERE id=?",
            id,
            c.id,
          );
      } else
        for (const c of rows.slice(count))
          this.run(
            "UPDATE cards SET state='unused',batch_id=NULL WHERE id=?",
            c.id,
          );
      this.run("UPDATE batches SET requested=? WHERE id=?", count, id);
      rows = this.all(
        "SELECT id,secret FROM cards WHERE batch_id=? ORDER BY id",
        id,
      );
      return rows.map((c) => ({
        id: c.id,
        secret: this.codec.decrypt(c.secret),
      }));
    });
  }
  batchCards(id) {
    return this.all("SELECT id,secret FROM cards WHERE batch_id=?", id).map(
      (c) => ({ id: c.id, secret: this.codec.decrypt(c.secret) }),
    );
  }
  saveRule(p) {
    const {
      accountId: a,
      goodsId: g,
      sourceId: s,
      threshold: t,
      mode: m,
      amount: n,
      intervalSec: i,
    } = p;
    if (Number(this.goods(a, g).status) !== 1)
      throw new Error("仅对销售中商品启用监控");
    if (
      !this.one(
        "SELECT id FROM sources WHERE id=? AND account_id=? AND goods_id=?",
        s,
        a,
        Number(g),
      )
    )
      throw new Error("请选择该商品的来源");
    if (
      ![t, n, i].every(Number.isSafeInteger) ||
      t < 1 ||
      t > 300000 ||
      n < 1 ||
      n > 50000 ||
      i < 30 ||
      i > 86400
    )
      throw new Error("阈值至少1，补货量1–50000，间隔30–86400秒");
    if (!["target", "fixed"].includes(m) || (m === "target" && n <= t))
      throw new Error("目标库存须高于阈值");
    const id =
      this.one(
        "SELECT id FROM rules WHERE account_id=? AND goods_id=?",
        a,
        Number(g),
      )?.id || randomUUID();
    this.run(
      `INSERT INTO rules(id,account_id,goods_id,source_id,threshold,mode,amount,interval_sec) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account_id,goods_id) DO UPDATE SET source_id=excluded.source_id,threshold=excluded.threshold,mode=excluded.mode,amount=excluded.amount,interval_sec=excluded.interval_sec,enabled=0,revision=rules.revision+1,error=''`,
      id,
      a,
      Number(g),
      s,
      t,
      m,
      n,
      i,
    );
    return id;
  }
  toggleRule(id, on) {
    const r = this.one("SELECT * FROM rules WHERE id=?", id);
    if (!r) throw new Error("规则不存在");
    if (on && this.account(r.account_id).status !== "online")
      throw new Error("请先确认账号登录并同步");
    this.run(
      "UPDATE rules SET enabled=?,revision=revision+1,error='',next_at=0 WHERE id=?",
      on ? 1 : 0,
      id,
    );
  }
  snapshot() {
    return {
      accounts: this.all("SELECT * FROM accounts ORDER BY rowid"),
      goods: this.all("SELECT account_id,json FROM goods").map((r) => ({
        ...JSON.parse(r.json),
        account_id: r.account_id,
      })),
      sources: this.all(
        `SELECT s.*,sum(CASE WHEN c.state='unused' THEN 1 ELSE 0 END) unused,sum(CASE WHEN c.state='reserved' THEN 1 ELSE 0 END) reserved,sum(CASE WHEN c.state='uploaded' THEN 1 ELSE 0 END) uploaded,count(c.id) total FROM sources s LEFT JOIN cards c ON c.source_id=s.id GROUP BY s.id ORDER BY s.created_at DESC`,
      ),
      rules: this.all("SELECT * FROM rules"),
      batchStats: this.all(
        "SELECT account_id,state,count(*) count FROM batches GROUP BY account_id,state",
      ),
      batches: this.all(
        "SELECT * FROM batches ORDER BY CASE WHEN state IN ('pending','sending') THEN 0 ELSE 1 END,created_at DESC LIMIT 20",
      ),
      publishes: this.all(
        "SELECT id,account_id,name,state,remote_id,error,created_at FROM publishes ORDER BY CASE WHEN state IN ('pending','sending') THEN 0 ELSE 1 END,created_at DESC LIMIT 20",
      ),
      now: new Date().toISOString(),
    };
  }
  records({
    kind = "batches",
    accountId = "all",
    state = "all",
    current = 1,
    pageSize = 20,
  } = {}) {
    if (!["batches", "publishes"].includes(kind))
      throw new Error("记录类型不合法");
    if (
      !["all", "pending", "success", "failed", "cancelled", "sending"].includes(
        state,
      )
    )
      throw new Error("记录状态不合法");
    if (
      !Number.isSafeInteger(current) ||
      current < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new Error("分页参数不合法");
    const conditions = [],
      params = [];
    if (accountId !== "all") {
      this.account(accountId);
      conditions.push("account_id=?");
      params.push(accountId);
    }
    if (state === "pending") conditions.push("state IN ('pending','sending')");
    else if (state !== "all") {
      conditions.push("state=?");
      params.push(state);
    }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const total = this.one(
      "SELECT count(*) count FROM " + kind + where,
      ...params,
    ).count;
    current = Math.min(current, Math.max(1, Math.ceil(total / pageSize)));
    const fields =
      kind === "publishes"
        ? "id,account_id,name,state,remote_id,error,created_at"
        : "*";
    const list = this.all(
      "SELECT " +
        fields +
        " FROM " +
        kind +
        where +
        " ORDER BY CASE WHEN state IN ('pending','sending') THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT ? OFFSET ?",
      ...params,
      pageSize,
      (current - 1) * pageSize,
    );
    return { list, total, current, pageSize };
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store };
