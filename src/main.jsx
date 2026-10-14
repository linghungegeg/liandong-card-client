import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  Select,
  Input,
  InputNumber,
  Table,
  Tag,
  Switch,
  Modal,
  Message,
  Empty,
  Radio,
  Checkbox,
  Alert,
  Spin,
} from "@arco-design/web-react";
import {
  IconDashboard,
  IconUser,
  IconApps,
  IconPlus,
  IconFile,
  IconClockCircle,
  IconList,
  IconRefresh,
  IconLaunch,
  IconSafe,
  IconCheckCircle,
  IconExclamationCircle,
} from "@arco-design/web-react/icon";
import { Editor, Toolbar } from "@wangeditor/editor-for-react";
import "@arco-design/web-react/dist/css/arco.css";
import "@wangeditor/editor/dist/css/style.css";
import "./style.css";
const api = window.liandong;
const pages = [
  ["仪表盘", IconDashboard],
  ["账号管理", IconUser],
  ["卡密商品", IconApps],
  ["商品发布", IconPlus],
  ["手动加卡", IconPlus],
  ["卡密来源", IconFile],
  ["库存监控", IconClockCircle],
  ["补货记录", IconList],
];
const fresh = {
  accounts: [],
  goods: [],
  sources: [],
  rules: [],
  batches: [],
  publishes: [],
};
const labels = {
  online: "已登录",
  offline: "需登录",
  unknown: "未检查",
  sending: "提交中",
  cancelled: "已取消",
  pending: "待确认",
  success: "已确认",
  failed: "失败",
};
const colors = {
  online: "green",
  success: "green",
  offline: "orange",
  pending: "orange",
  failed: "red",
  sending: "blue",
  unknown: "gray",
};
const stamp = (s) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "未同步";
const stock = (g) =>
  Number.isSafeInteger(Number(g?.extend?.stock_count)) &&
  g?.extend?.stock_count !== undefined &&
  g?.extend?.stock_count !== null &&
  g?.extend?.stock_count !== ""
    ? Number(g.extend.stock_count)
    : null;
function StateTag({ value }) {
  return <Tag color={colors[value] || "gray"}>{labels[value] || value}</Tag>;
}
function Field({ label, help, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div>
        {children}
        {help && <div className="help">{help}</div>}
      </div>
    </div>
  );
}
function RichText({ value, onChange, placeholder }) {
  const [editor, setEditor] = useState(null);
  useEffect(() => () => editor?.destroy(), [editor]);
  return (
    <div className="rich">
      <Toolbar
        editor={editor}
        defaultConfig={{
          toolbarKeys: [
            "headerSelect",
            "bold",
            "italic",
            "underline",
            "through",
            "color",
            "bgColor",
            "fontSize",
            "fontFamily",
            "lineHeight",
            "bulletedList",
            "numberedList",
            "justifyLeft",
            "justifyCenter",
            "justifyRight",
            "undo",
            "redo",
            "fullScreen",
          ],
        }}
        mode="default"
      />
      <Editor
        defaultConfig={{ placeholder, MENU_CONF: {} }}
        value={value}
        onCreated={setEditor}
        onChange={(e) => onChange(e.getHtml())}
        mode="default"
        style={{ height: 180 }}
      />
    </div>
  );
}
function App() {
  const [data, setData] = useState(fresh),
    [page, setPage] = useState("仪表盘"),
    [account, setAccount] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [clock, setClock] = useState(Date.now());
  const [accountDialog, setAccountDialog] = useState(null),
    [accountForm, setAccountForm] = useState({
      label: "",
      username: "",
      password: "",
    });
  const [inventory, setInventory] = useState(null);
  const [history, setHistory] = useState({
    kind: "batches",
    state: "all",
    current: 1,
    pageSize: 20,
  });
  const [historyRows, setHistoryRows] = useState({
    list: [],
    total: 0,
    current: 1,
    pageSize: 20,
  });
  const current = data.accounts.find((a) => a.id === account),
    scope = (r) => account === "all" || r.account_id === account;
  const goods = data.goods.filter(scope),
    sources = data.sources.filter(scope),
    rules = data.rules.filter(scope),
    batches = data.batches.filter(scope);
  async function reload() {
    if (!api) {
      setError("请通过桌面客户端打开，网页预览无法调用账号会话");
      return;
    }
    try {
      setData(await api.snapshot());
      setClock(Date.now());
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (page !== "补货记录") return;
    let active = true;
    const load = async () => {
      try {
        const r = await api.records({
          ...history,
          accountId: account || "all",
        });
        if (active) setHistoryRows(r);
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    load();
    const interval = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [page, account, history]);
  useEffect(
    () =>
      setHistoryRows({
        list: [],
        total: 0,
        current: 1,
        pageSize: history.pageSize,
      }),
    [account, history.kind, history.state],
  );
  useEffect(() => {
    if (page !== "仪表盘" && account === "all")
      setAccount(data.accounts[0]?.id || "");
  }, [page, data.accounts.length, account]);
  async function run(fn, success) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      await reload();
      if (success)
        Message.success(
          typeof success === "function" ? success(result) : success,
        );
      return result;
    } catch (e) {
      setError(e.message);
      Message.error(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const selectedGoods = data.goods.filter((g) => g.account_id === account),
    selectedSources = data.sources.filter((s) => s.account_id === account);
  function go(target, g) {
    if (g) setAccount(g.account_id);
    setPage(target);
  }
  async function showInventory(g) {
    const r = await run(() =>
      api.cardList({ accountId: g.account_id, goodsId: g.id, current: 1 }),
    );
    if (r) setInventory({ goods: g, ...r, current: 1 });
  }
  const goodsColumns = [
    {
      title: "商品信息",
      dataIndex: "name",
      width: 300,
      render: (_, g) => (
        <div className="goods-info">
          {g.image && <img src={g.image} />}
          <div>
            <Tag size="small" color="blue">
              卡密
            </Tag>
            <div>{g.name}</div>
            <span className="muted">ID {g.id}</span>
          </div>
        </div>
      ),
    },
    { title: "售价(元)", dataIndex: "price", width: 100 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (s) => (
        <Tag color={Number(s) === 1 ? "green" : "gray"}>
          {Number(s) === 1 ? "销售中" : "仓库中"}
        </Tag>
      ),
    },
    { title: "销量", dataIndex: "sell_count", width: 80 },
    {
      title: "库存",
      width: 150,
      render: (_, g) => (
        <div>
          <strong className={stock(g) === 0 ? "orange" : ""}>
            {stock(g) === null
              ? "未返回"
              : stock(g) === 0
                ? "缺货"
                : stock(g) + "张"}
          </strong>
          <div className="rowlinks">
            <Button
              type="text"
              size="mini"
              onClick={() => {
                go("手动加卡", g);
                setChosen(g.id);
              }}
            >
              加卡
            </Button>
            <Button type="text" size="mini" onClick={() => showInventory(g)}>
              库存
            </Button>
          </div>
        </div>
      ),
    },
    {
      title: "创建时间",
      width: 180,
      render: (_, g) => stamp(g.create_time * 1000),
    },
  ];
  const accountName = (id) =>
    data.accounts.find((a) => a.id === id)?.label || "账号";
  const goodName = (a, id) =>
    data.goods.find((g) => g.account_id === a && g.id === id)?.name ||
    String(id);
  const batchColumns = [
    { title: "时间", dataIndex: "created_at", width: 175, render: stamp },
    { title: "账号", dataIndex: "account_id", render: accountName },
    { title: "商品", render: (_, b) => goodName(b.account_id, b.goods_id) },
    {
      title: "方式",
      dataIndex: "kind",
      width: 80,
      render: (k) => (k === "auto" ? "自动" : "手动"),
    },
    {
      title: "确认/请求",
      width: 100,
      render: (_, b) => b.accepted + " / " + b.requested,
    },
    {
      title: "状态",
      dataIndex: "state",
      width: 100,
      render: (s) => <StateTag value={s} />,
    },
    { title: "结果", dataIndex: "error", render: (e) => e || "官方记录确认" },
    {
      title: "操作",
      width: 100,
      render: (_, b) =>
        b.state === "pending" ? (
          <Button
            type="text"
            size="small"
            onClick={() =>
              run(
                () => api.reconcile({ id: b.id }),
                (r) => (r.state === "success" ? "回读确认成功" : "仍待确认"),
              )
            }
          >
            重新核实
          </Button>
        ) : null,
    },
  ];
  const [filter, setFilter] = useState(""),
    [status, setStatus] = useState(999),
    [chosen, setChosen] = useState(null);
  const [sourceId, setSourceId] = useState(""),
    [count, setCount] = useState(1),
    [first, setFirst] = useState(false);
  const [text, setText] = useState(""),
    [file, setFile] = useState(null),
    [sheet, setSheet] = useState(""),
    [columns, setColumns] = useState([0]),
    [skipHeader, setSkipHeader] = useState(false),
    [separator, setSeparator] = useState("    "),
    [preview, setPreview] = useState(null);
  const [threshold, setThreshold] = useState(20),
    [mode, setMode] = useState("target"),
    [amount, setAmount] = useState(100),
    [intervalSec, setIntervalSec] = useState(60);
  const [categories, setCategories] = useState([]),
    [product, setProduct] = useState(null);
  useEffect(() => {
    setChosen(null);
    setSourceId("");
    setFile(null);
    setPreview(null);
    setText("");
    setCategories([]);
    setProduct(null);
  }, [account]);
  const inputArgs = () => ({
    accountId: account,
    goodsId: chosen,
    fileToken: file?.token,
    sheet,
    columns,
    skipHeader,
    separator,
    text,
  });
  async function chooseFile() {
    const f = await run(() => api.chooseFile());
    if (f) {
      setFile(f);
      setSheet(f.sheets[0]);
      setColumns([0]);
      setPreview(null);
    }
  }
  async function importInput() {
    if (!chosen) {
      Message.error("请选择商品");
      return;
    }
    const r = await run(
      () => api.importCards(inputArgs()),
      (r) => "导入 " + r.added + " 条，已存在 " + r.duplicates + " 条",
    );
    if (r) {
      setSourceId(r.id);
      setText("");
      setFile(null);
      setPreview(null);
    }
  }
  async function preparePublish() {
    if (!current) return;
    const c = await run(() => api.categories({ accountId: account }));
    if (c) {
      setCategories(c);
      setProduct({
        goods_type: "card",
        id: 0,
        name: "",
        image: "",
        category_id: "",
        price: 0,
        market_price: 0,
        description: "",
        sort: 0,
        coupon_status: 1,
        status: 0,
        fee_payer: -1,
        show: 1,
        contact_format: "any",
        agent_status: 0,
        agent_price1: 0,
        agent_price2: 0,
        agent_price3: 0,
        agent_price_limit: 0,
        description_sync: 0,
        name_sync: 0,
        parent_id: 0,
        cost_price: 0,
        add_type: 1,
        add_rate: 0,
        add_price: 0,
        extend: {
          instructions: "",
          stock_notice: 0,
          lock_card: 0,
          limit_count: 1,
          limit_count_max: 0,
          show_stock_type: 0,
          send_order: 0,
          query_password_status: 0,
        },
      });
    }
  }
  useEffect(() => {
    if (page === "商品发布" && current && !product) preparePublish();
  }, [page, account]);
  const patch = (k, v) => setProduct((p) => ({ ...p, [k]: v })),
    ext = (k, v) =>
      setProduct((p) => ({ ...p, extend: { ...p.extend, [k]: v } }));
  const productPicker = (
    <Select
      placeholder="选择卡密商品"
      value={chosen}
      onChange={(v) => {
        setChosen(v);
        setSourceId("");
        setPreview(null);
      }}
      options={selectedGoods.map((g) => ({
        value: g.id,
        label: g.name + " · " + g.id,
      }))}
      showSearch
    />
  );
  const sourcePicker = (
    <Select
      placeholder="选择绑定来源"
      value={sourceId || undefined}
      onChange={setSourceId}
      options={selectedSources
        .filter((s) => s.goods_id === chosen)
        .map((s) => ({
          value: s.id,
          label: s.name + " · 待用 " + s.unused + " 条",
        }))}
    />
  );
  const importPanel = (
    <>
      <Field label="选择商品">{productPicker}</Field>
      <Field label="卡密来源">
        <div className="inline">
          <Button onClick={chooseFile}>选择 TXT / XLSX / CSV</Button>
          {file ? (
            <>
              <span>{file.name}</span>
              <Button
                type="text"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                }}
              >
                改用粘贴
              </Button>
            </>
          ) : (
            <span className="muted">或在下方粘贴卡密</span>
          )}
        </div>
      </Field>
      {file ? (
        <>
          <Field label="工作表">
            <Select
              value={sheet}
              onChange={async (s) => {
                setSheet(s);
                setPreview(null);
                const f = await run(() =>
                  api.previewFile({
                    fileToken: file.token,
                    sheet: s,
                    previewSheet: true,
                  }),
                );
                if (f) setFile({ ...file, ...f });
              }}
              options={file.sheets.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="卡密列">
            <div className="inline">
              <InputNumber
                min={1}
                max={256}
                value={columns[0] + 1}
                onChange={(v) => {
                  setColumns([Math.max(0, (v || 1) - 1), ...columns.slice(1)]);
                  setPreview(null);
                }}
              />
              <Checkbox
                checked={columns.length === 2}
                onChange={(v) => {
                  setColumns(v ? [columns[0], 1] : [columns[0]]);
                  setPreview(null);
                }}
              >
                拼接密码列
              </Checkbox>
              {columns.length === 2 && (
                <>
                  <InputNumber
                    min={1}
                    max={256}
                    value={columns[1] + 1}
                    onChange={(v) => {
                      setColumns([columns[0], Math.max(0, (v || 1) - 1)]);
                      setPreview(null);
                    }}
                  />
                  <Input
                    value={separator}
                    onChange={(v) => {
                      setSeparator(v);
                      setPreview(null);
                    }}
                    placeholder="分隔符"
                  />
                </>
              )}
            </div>
          </Field>
          <Field label="表头">
            <Checkbox
              checked={skipHeader}
              onChange={(v) => {
                setSkipHeader(v);
                setPreview(null);
              }}
            >
              跳过第一行
            </Checkbox>
          </Field>
          <div className="file-preview">
            {file.rows.map((r, i) => (
              <div key={i}>
                <span>{i + 1}</span>
                <code>{r.slice(0, 6).join(" │ ") || "空行"}</code>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Field
          label="卡密内容"
          help="一行一条，空行忽略；保留有效内容及前导零。"
        >
          <Input.TextArea
            value={text}
            onChange={(v) => {
              setText(v);
              setPreview(null);
            }}
            autoSize={{ minRows: 7, maxRows: 16 }}
            placeholder="卡密1&#10;卡密2"
          />
        </Field>
      )}
      <Field label="预览">
        <Button
          onClick={() =>
            run(() => api.previewFile(inputArgs())).then(
              (r) => r && setPreview(r),
            )
          }
        >
          检查有效数量
        </Button>
        {preview && (
          <div className="preview-result">
            <Tag color="blue">有效 {preview.count} 条</Tag>
            <Tag>空行 {preview.blank}</Tag>
            <Tag>重复 {preview.duplicates}</Tag>
            <pre>{preview.lines.join(String.fromCharCode(10))}</pre>
          </div>
        )}
      </Field>
      <div className="form-footer">
        <Button
          type="primary"
          disabled={!preview?.count || !chosen || !current}
          onClick={importInput}
        >
          确认导入本地来源
        </Button>
      </div>
    </>
  );
  function dashboard() {
    const accounts = data.accounts.filter(
        (a) => account === "all" || a.id === account,
      ),
      synced = accounts.filter((a) => a.synced_at).length,
      known = goods.filter((g) => stock(g) !== null),
      totalStock = known.reduce((n, g) => n + stock(g), 0);
    const low = goods.filter((g) => {
      const r = rules.find(
        (r) => r.account_id === g.account_id && r.goods_id === g.id,
      );
      return stock(g) !== null && (r ? stock(g) < r.threshold : stock(g) === 0);
    });
    const metrics = [
      [
        "账号登录",
        accounts.filter((a) => a.status === "online").length +
          " / " +
          accounts.length,
        "独立账号会话",
      ],
      [
        "卡密商品",
        synced ? goods.length : "—",
        synced + " / " + accounts.length + " 个账号已同步",
      ],
      [
        "平台可售库存",
        synced && known.length === goods.length ? totalStock : "—",
        "本地待用 " +
          sources.reduce((n, s) => n + Number(s.unused || 0), 0) +
          " 条",
      ],
      [
        "运行中监控",
        rules.filter((r) => r.enabled).length,
        "共 " + rules.length + " 条规则",
      ],
      [
        "待确认补货",
        (data.batchStats || [])
          .filter(scope)
          .filter((b) => b.state === "pending" || b.state === "sending")
          .reduce((n, b) => n + Number(b.count), 0),
        "先核实，避免重复上传",
      ],
    ];
    return (
      <>
        <div className="welcome">
          <div>
            <h2>今天的库存，心中有数</h2>
            <span className="muted">
              {account === "all" ? "全部账号" : current?.label || "未选择账号"}{" "}
              · 本地视图更新时间 {stamp(clock)}
            </span>
          </div>
          <Button
            icon={<IconRefresh />}
            disabled={!accounts.length}
            onClick={() =>
              run(async () => {
                const results = await Promise.allSettled(
                  accounts.map((a) => api.sync({ accountId: a.id })),
                );
                const failures = results.filter((r) => r.status === "rejected");
                if (failures.length)
                  throw new Error(
                    failures.length + " 个账号同步失败，请检查账号状态",
                  );
              }, "商品库存已同步")
            }
          >
            同步库存
          </Button>
        </div>
        {synced < accounts.length && (
          <Alert
            type="warning"
            content="部分账号尚未同步，商品与库存汇总不代表全部账号。"
          />
        )}
        <div className="stats">
          {metrics.map(([title, value, note]) => (
            <section key={title}>
              <span>{title}</span>
              <strong>{value}</strong>
              <small>{note}</small>
            </section>
          ))}
        </div>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-head">
              账号状态 <span className="muted">持久化会话独立隔离</span>
            </div>
            {!accounts.length ? (
              <Empty description="先添加账号，仪表盘将展示真实数据" />
            ) : (
              accounts.map((a) => (
                <div className="account-row" key={a.id}>
                  <div>
                    <strong>{a.label}</strong>
                    <div className="muted">
                      {a.error || "最近同步：" + stamp(a.synced_at)}
                    </div>
                  </div>
                  <StateTag value={a.status} />
                  <Button
                    size="small"
                    onClick={() => {
                      setAccount(a.id);
                      setPage("账号管理");
                    }}
                  >
                    管理
                  </Button>
                </div>
              ))
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              库存预警{" "}
              <Tag color={low.length ? "orange" : "green"}>
                {low.length} 个商品
              </Tag>
            </div>
            {!low.length ? (
              <Empty
                description={
                  synced ? "当前已同步商品无缺货预警" : "同步后显示缺货商品"
                }
              />
            ) : (
              low.slice(0, 6).map((g) => (
                <div className="account-row" key={g.account_id + g.id}>
                  <div>
                    <strong>{g.name}</strong>
                    <div className="muted">{accountName(g.account_id)}</div>
                  </div>
                  <span className="orange">剩余 {stock(g)} 张</span>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => {
                      go("库存监控", g);
                      setChosen(g.id);
                    }}
                  >
                    监控设置
                  </Button>
                </div>
              ))
            )}
          </section>
        </div>
        <section className="panel">
          <div className="panel-head">
            最近补货{" "}
            <Button type="text" onClick={() => setPage("补货记录")}>
              查看全部
            </Button>
          </div>
          <Table
            rowKey="id"
            columns={batchColumns}
            data={batches.slice(0, 6)}
            pagination={false}
            border={false}
            noDataElement={<Empty description="尚无补货记录" />}
          />
        </section>
        {rules.some((r) => r.error) && (
          <section className="panel">
            <div className="panel-head">需要处理的监控</div>
            {rules
              .filter((r) => r.error)
              .map((r) => (
                <Alert
                  key={r.id}
                  type="warning"
                  content={goodName(r.account_id, r.goods_id) + "：" + r.error}
                />
              ))}
          </section>
        )}
      </>
    );
  }
  return (
    <div className="app">
      <header>
        <div className="brand">
          <span>LD</span>
          <div>
            链动小铺<small>卡密客户端</small>
          </div>
        </div>
        <div className="header-center">仅卡密商品 · 多账号独立会话</div>
        <Select
          className="account-select"
          placeholder="选择账号"
          value={account || undefined}
          onChange={setAccount}
          options={[
            ...(page === "仪表盘" ? [{ value: "all", label: "全部账号" }] : []),
            ...data.accounts.map((a) => ({ value: a.id, label: a.label })),
          ]}
        />
        <Button
          icon={<IconLaunch />}
          disabled={!current}
          onClick={() => run(() => api.openOfficial({ accountId: account }))}
        >
          打开官网
        </Button>
      </header>
      <aside>
        {pages.map(([name, Icon]) => (
          <button
            key={name}
            className={name === page ? "active" : ""}
            onClick={() => setPage(name)}
          >
            <Icon />
            <span>{name}</span>
          </button>
        ))}
        <div className="nav-bottom">
          <IconSafe /> 账号独立隔离
        </div>
      </aside>
      <main>
        <div className="page-title">
          <h1>{page}</h1>
          {page !== "仪表盘" && (
            <span className="muted">
              {current?.label || "请添加或选择账号"}
              {current && " · " + labels[current.status]}
            </span>
          )}
        </div>
        {error && (
          <Alert
            type="error"
            content={error}
            closable
            onClose={() => setError("")}
          />
        )}
        <Spin loading={busy} style={{ display: "block" }}>
          {page === "仪表盘" && dashboard()}
          {page === "账号管理" && (
            <section className="panel">
              <div className="panel-head">
                账号列表
                <Button
                  type="primary"
                  icon={<IconPlus />}
                  onClick={() => {
                    setAccountForm({ label: "", username: "", password: "" });
                    setAccountDialog("new");
                  }}
                >
                  添加账号
                </Button>
              </div>
              <Table
                rowKey="id"
                border={false}
                data={data.accounts}
                columns={[
                  { title: "账号", dataIndex: "label" },
                  {
                    title: "商户ID",
                    dataIndex: "remote_id",
                    render: (v) => v || "未绑定",
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    render: (v) => <StateTag value={v} />,
                  },
                  { title: "最近同步", dataIndex: "synced_at", render: stamp },
                  {
                    title: "会话检查",
                    dataIndex: "session_checked_at",
                    render: (value) => (value ? stamp(value) : "尚未检查"),
                  },
                  { title: "说明", dataIndex: "error" },
                  {
                    title: "操作",
                    render: (_, a) => (
                      <div className="inline">
                        <Button
                          type="text"
                          onClick={() => {
                            setAccount(a.id);
                            setAccountForm({
                              label: a.label,
                              username: "",
                              password: "",
                            });
                            setAccountDialog(a.id);
                          }}
                        >
                          登录
                        </Button>
                        <Button
                          type="text"
                          onClick={() =>
                            run(() => api.sync({ accountId: a.id }), "已同步")
                          }
                        >
                          检查/同步
                        </Button>
                        <Button
                          type="text"
                          onClick={() =>
                            run(() => api.openOfficial({ accountId: a.id }))
                          }
                        >
                          官网
                        </Button>
                      </div>
                    ),
                  },
                ]}
                pagination={{ pageSize: 20, sizeCanChange: true }}
              />
            </section>
          )}
          {page === "卡密商品" && (
            <section className="panel">
              <div className="type-tab">
                卡密 <span>({selectedGoods.length})</span>
              </div>
              <div className="filters">
                <Radio.Group type="button" value={status} onChange={setStatus}>
                  <Radio value={999}>全部</Radio>
                  <Radio value={1}>售卖中</Radio>
                  <Radio value={0}>仓库中</Radio>
                </Radio.Group>
                <Input
                  placeholder="商品名称"
                  value={filter}
                  onChange={setFilter}
                />
                <Button
                  disabled={!current}
                  onClick={() =>
                    run(() => api.sync({ accountId: account }), "商品已同步")
                  }
                  icon={<IconRefresh />}
                >
                  同步商品
                </Button>
                <Button
                  type="primary"
                  disabled={!current}
                  onClick={() => setPage("商品发布")}
                >
                  商品发布
                </Button>
              </div>
              <Table
                rowKey="id"
                border={false}
                columns={goodsColumns}
                data={selectedGoods.filter(
                  (g) =>
                    (status === 999 || Number(g.status) === status) &&
                    g.name.includes(filter),
                )}
                pagination={{ pageSize: 20 }}
                scroll={{ x: 950 }}
              />
            </section>
          )}
          {page === "商品发布" && (
            <section className="panel">
              <div className="panel-head">
                创建卡密商品{" "}
                <Button
                  type="text"
                  disabled={!current}
                  onClick={preparePublish}
                >
                  读取官方分类
                </Button>
              </div>
              {product ? (
                <div className="form">
                  <Field label="商品标题">
                    <Input
                      maxLength={60}
                      value={product.name}
                      onChange={(v) => patch("name", v)}
                      placeholder="最多60个字符"
                    />
                  </Field>
                  <Field label="商品分类">
                    <Select
                      showSearch
                      value={product.category_id || undefined}
                      onChange={(v) => patch("category_id", v)}
                      options={categories.map((c) => ({
                        value: c.value ?? c.id,
                        label: c.label ?? c.name,
                      }))}
                    />
                  </Field>
                  {[
                    ["price", "销售价格"],
                    ["market_price", "参考价"],
                    ["cost_price", "成本价"],
                  ].map(([k, l]) => (
                    <Field label={l} key={k}>
                      <InputNumber
                        min={0}
                        max={99999}
                        precision={2}
                        value={product[k]}
                        onChange={(v) => patch(k, v || 0)}
                        suffix="元"
                      />
                    </Field>
                  ))}
                  <Field label="封面图">
                    <div className="inline">
                      {product.image && (
                        <img className="cover" src={product.image} />
                      )}
                      <Button
                        onClick={() =>
                          run(() =>
                            api.uploadImage({ accountId: account }),
                          ).then((url) => url && patch("image", url))
                        }
                      >
                        选择并上传图片
                      </Button>
                    </div>
                  </Field>
                  <Field label="商品描述">
                    <RichText
                      value={product.description}
                      onChange={(v) => patch("description", v)}
                      placeholder="商品描述会在买家购买时展示"
                    />
                  </Field>
                  <Field label="使用说明">
                    <RichText
                      value={product.extend.instructions}
                      onChange={(v) => ext("instructions", v)}
                      placeholder="商品使用说明"
                    />
                  </Field>
                  <Field label="库存预警">
                    <InputNumber
                      min={0}
                      precision={0}
                      value={product.extend.stock_notice}
                      onChange={(v) => ext("stock_notice", v || 0)}
                    />
                  </Field>
                  <details>
                    <summary>展开更多设置</summary>
                    {[
                      [
                        "fee_payer",
                        "手续费承担方",
                        [
                          [-1, "使用店铺设置"],
                          [0, "商家承担"],
                          [1, "买家承担"],
                        ],
                      ],
                      [
                        "show",
                        "是否显示在店铺",
                        [
                          [1, "显示"],
                          [0, "隐藏"],
                        ],
                      ],
                      [
                        "contact_format",
                        "联系方式要求",
                        [
                          ["any", "不限制"],
                          ["mobile", "手机号"],
                          ["qq", "QQ号"],
                          ["wechat", "微信号"],
                          ["email", "邮箱"],
                        ],
                      ],
                      [
                        "coupon_status",
                        "可使用优惠券",
                        [
                          [1, "是"],
                          [0, "否"],
                        ],
                      ],
                    ].map(([k, l, options]) => (
                      <Field label={l} key={k}>
                        <Radio.Group
                          value={product[k]}
                          onChange={(v) => patch(k, v)}
                        >
                          {options.map(([v, n]) => (
                            <Radio key={v} value={v}>
                              {n}
                            </Radio>
                          ))}
                        </Radio.Group>
                      </Field>
                    ))}
                    {[
                      [
                        "show_stock_type",
                        "库存显示方式",
                        [
                          [0, "库存范围"],
                          [1, "实际库存"],
                        ],
                      ],
                      [
                        "lock_card",
                        "减库存方式",
                        [
                          [0, "支付完成减库存"],
                          [1, "拍下减库存"],
                        ],
                      ],
                      [
                        "send_order",
                        "发卡顺序",
                        [
                          [0, "顺序发卡"],
                          [1, "随机发卡"],
                          [2, "买家选号"],
                        ],
                      ],
                      [
                        "query_password_status",
                        "强制查单密码",
                        [
                          [0, "关闭"],
                          [1, "开启"],
                        ],
                      ],
                    ].map(([k, l, options]) => (
                      <Field label={l} key={k}>
                        <Radio.Group
                          value={product.extend[k]}
                          onChange={(v) => ext(k, v)}
                        >
                          {options.map(([v, n]) => (
                            <Radio key={v} value={v}>
                              {n}
                            </Radio>
                          ))}
                        </Radio.Group>
                      </Field>
                    ))}
                    {[
                      ["limit_count", "起购数量", 1],
                      ["limit_count_max", "每人最多限购", 0],
                    ].map(([k, l, min]) => (
                      <Field key={k} label={l}>
                        <InputNumber
                          min={min}
                          precision={0}
                          value={product.extend[k]}
                          onChange={(v) => ext(k, v ?? min)}
                        />
                      </Field>
                    ))}
                    <Field label="显示顺序">
                      <InputNumber
                        min={0}
                        precision={0}
                        value={product.sort}
                        onChange={(v) => patch("sort", v || 0)}
                      />
                    </Field>
                  </details>
                  <div className="form-footer">
                    <Button
                      onClick={() =>
                        run(
                          () =>
                            api.publish({
                              accountId: account,
                              product: { ...product, status: 0 },
                            }),
                          (r) => r.message,
                        ).then((r) => r && setPage("卡密商品"))
                      }
                    >
                      存入仓库
                    </Button>
                    <Button
                      type="primary"
                      onClick={() =>
                        Modal.confirm({
                          title: "发布卡密商品",
                          content:
                            "确认按当前内容发布到链动？提交后将核对官方商品记录。",
                          onOk: () =>
                            run(
                              () =>
                                api.publish({
                                  accountId: account,
                                  product: { ...product, status: 1 },
                                }),
                              (r) => r.message,
                            ).then((r) => r && setPage("卡密商品")),
                        })
                      }
                    >
                      发布商品
                    </Button>
                  </div>
                </div>
              ) : (
                <Empty description="请先登录账号并读取官方分类" />
              )}
            </section>
          )}
          {page === "手动加卡" && (
            <section className="panel">
              <div className="panel-head">添加卡密</div>
              <Alert
                type="info"
                content="单次最多5万张，待售库存不超过30万张，单条内容最长5600字符。"
              />
              <div className="form">
                <Field label="选择商品">{productPicker}</Field>
                <Field label="卡密来源">{sourcePicker}</Field>
                <Field label="添加数量">
                  <InputNumber
                    min={1}
                    max={50000}
                    precision={0}
                    value={count}
                    onChange={(v) => setCount(v || 1)}
                  />
                </Field>
                <Field label="发卡选项">
                  <Checkbox checked={first} onChange={setFirst}>
                    本次添加的卡密优先卖
                  </Checkbox>
                  <div className="help">
                    已存在的卡密会在提交前核对；相同卡密不会重复提交。
                  </div>
                </Field>
                <div className="form-footer">
                  <Button onClick={() => setPage("卡密来源")}>
                    粘贴或导入卡密
                  </Button>
                  <Button
                    type="primary"
                    disabled={!chosen || !sourceId}
                    onClick={() =>
                      Modal.confirm({
                        title: "确认添加卡密",
                        content:
                          "将从当前账号商品的绑定来源提交 " +
                          count +
                          " 条卡密。",
                        onOk: () =>
                          run(
                            () =>
                              api.addCards({
                                accountId: account,
                                goodsId: chosen,
                                sourceId,
                                count,
                                first,
                              }),
                            (r) =>
                              r.state === "success"
                                ? "加卡与官方回读确认成功"
                                : "结果待确认，请查看补货记录",
                          ),
                      })
                    }
                  >
                    添加卡密
                  </Button>
                </div>
              </div>
            </section>
          )}
          {page === "卡密来源" && (
            <>
              <section className="panel">
                <div className="panel-head">导入卡密来源</div>
                <div className="form">{importPanel}</div>
              </section>
              <section className="panel">
                <div className="panel-head">已绑定来源</div>
                <Table
                  rowKey="id"
                  border={false}
                  data={sources}
                  pagination={{ pageSize: 20, sizeCanChange: true }}
                  columns={[
                    { title: "来源", dataIndex: "name" },
                    {
                      title: "账号",
                      dataIndex: "account_id",
                      render: accountName,
                    },
                    {
                      title: "商品",
                      render: (_, s) => goodName(s.account_id, s.goods_id),
                    },
                    { title: "本地待用", dataIndex: "unused" },
                    { title: "待确认", dataIndex: "reserved" },
                    { title: "确认已上传", dataIndex: "uploaded" },
                    {
                      title: "导入时间",
                      dataIndex: "created_at",
                      render: stamp,
                    },
                  ]}
                />
              </section>
            </>
          )}
          {page === "库存监控" && (
            <>
              <section className="panel">
                <div className="panel-head">设置自动补卡</div>
                <div className="form">
                  <Field label="商品">{productPicker}</Field>
                  <Field label="来源">{sourcePicker}</Field>
                  <Field
                    label="低库存阈值"
                    help="严格低于此数量才触发，等于阈值不会补货。"
                  >
                    <InputNumber
                      min={1}
                      max={300000}
                      precision={0}
                      value={threshold}
                      onChange={(v) => setThreshold(v || 1)}
                      suffix="张"
                    />
                  </Field>
                  <Field label="补货方式">
                    <Radio.Group value={mode} onChange={setMode}>
                      <Radio value="target">补到目标库存</Radio>
                      <Radio value="fixed">每次固定补货</Radio>
                    </Radio.Group>
                  </Field>
                  <Field label={mode === "target" ? "目标库存" : "每次添加"}>
                    <InputNumber
                      min={1}
                      max={50000}
                      precision={0}
                      value={amount}
                      onChange={(v) => setAmount(v || 1)}
                      suffix="张"
                    />
                  </Field>
                  <Field label="检查间隔">
                    <InputNumber
                      min={30}
                      max={86400}
                      precision={0}
                      value={intervalSec}
                      onChange={(v) => setIntervalSec(v || 60)}
                      suffix="秒"
                    />
                  </Field>
                  <div className="form-footer">
                    <Button
                      type="primary"
                      disabled={!chosen || !sourceId}
                      onClick={() =>
                        run(
                          () =>
                            api.saveRule({
                              accountId: account,
                              goodsId: chosen,
                              sourceId,
                              threshold,
                              mode,
                              amount,
                              intervalSec,
                            }),
                          "规则已保存，启用后开始监控",
                        )
                      }
                    >
                      保存规则
                    </Button>
                  </div>
                </div>
              </section>
              <section className="panel">
                <div className="panel-head">监控任务</div>
                <Table
                  rowKey="id"
                  border={false}
                  data={rules}
                  pagination={{ pageSize: 20, sizeCanChange: true }}
                  columns={[
                    {
                      title: "账号",
                      dataIndex: "account_id",
                      render: accountName,
                    },
                    {
                      title: "商品",
                      render: (_, r) => goodName(r.account_id, r.goods_id),
                    },
                    {
                      title: "触发条件",
                      render: (_, r) => "库存 < " + r.threshold,
                    },
                    {
                      title: "补货",
                      render: (_, r) =>
                        (r.mode === "target" ? "补到 " : "添加 ") +
                        r.amount +
                        " 张",
                    },
                    {
                      title: "间隔",
                      dataIndex: "interval_sec",
                      render: (v) => v + "秒",
                    },
                    {
                      title: "最近检查",
                      dataIndex: "last_at",
                      render: (v) => (v ? stamp(v) : "尚未检查"),
                    },
                    {
                      title: "状态",
                      render: (_, r) => (
                        <div>
                          <Switch
                            checked={Boolean(r.enabled)}
                            onChange={(enabled) =>
                              run(() => api.toggleRule({ id: r.id, enabled }))
                            }
                          />
                          <div className={r.error ? "orange" : "muted"}>
                            {r.error || (r.enabled ? "运行中" : "已暂停")}
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </section>
            </>
          )}
          {page === "补货记录" && (
            <section className="panel">
              <div className="panel-head">
                补货与发布记录
                <Radio.Group
                  type="button"
                  value={history.kind}
                  onChange={(kind) =>
                    setHistory({ ...history, kind, current: 1 })
                  }
                >
                  <Radio value="batches">加卡记录</Radio>
                  <Radio value="publishes">发布记录</Radio>
                </Radio.Group>
              </div>
              <div className="filters">
                <Select
                  style={{ width: 180 }}
                  value={history.state}
                  onChange={(state) =>
                    setHistory({ ...history, state, current: 1 })
                  }
                  options={[
                    { value: "all", label: "全部记录" },
                    { value: "pending", label: "待确认 / 提交中" },
                    { value: "success", label: "已确认" },
                    { value: "failed", label: "失败" },
                    { value: "cancelled", label: "已取消" },
                  ]}
                />
                <span className="muted">
                  共 {historyRows.total} 条，待确认项优先显示
                </span>
              </div>
              <Table
                rowKey="id"
                border={false}
                data={historyRows.list}
                columns={
                  history.kind === "batches"
                    ? batchColumns
                    : [
                        {
                          title: "时间",
                          dataIndex: "created_at",
                          render: stamp,
                        },
                        {
                          title: "账号",
                          dataIndex: "account_id",
                          render: accountName,
                        },
                        { title: "商品", dataIndex: "name" },
                        { title: "平台ID", dataIndex: "remote_id" },
                        {
                          title: "状态",
                          dataIndex: "state",
                          render: (v) => <StateTag value={v} />,
                        },
                        { title: "结果", dataIndex: "error" },
                        {
                          title: "核实",
                          render: (_, record) =>
                            record.state === "pending" ? (
                              <Button
                                type="text"
                                onClick={() =>
                                  run(
                                    () =>
                                      api.reconcilePublish({ id: record.id }),
                                    (r) => r.message,
                                  )
                                }
                              >
                                重新核实
                              </Button>
                            ) : null,
                        },
                      ]
                }
                scroll={{ x: 1000 }}
                pagination={{
                  current: historyRows.current,
                  total: historyRows.total,
                  pageSize: historyRows.pageSize,
                  sizeCanChange: true,
                  sizeOptions: [10, 20, 50, 100],
                }}
                onChange={(p) =>
                  setHistory({
                    ...history,
                    current: p.current,
                    pageSize: p.pageSize,
                  })
                }
              />
            </section>
          )}
        </Spin>
      </main>
      <Modal
        title={accountDialog === "new" ? "添加账号" : "登录账号"}
        visible={!!accountDialog}
        onCancel={() => {
          setAccountDialog(null);
          setAccountForm({ label: "", username: "", password: "" });
        }}
        confirmLoading={busy}
        onOk={async () => {
          if (accountDialog === "new") {
            const r = await run(
              () => api.addAccount({ label: accountForm.label }),
              "账号已添加",
            );
            if (r) {
              setAccount(r.id);
              setAccountDialog(r.id);
            }
          } else {
            const r = await run(
              () =>
                api.login({
                  accountId: accountDialog,
                  username: accountForm.username,
                  password: accountForm.password,
                }),
              "登录与同步成功",
            );
            if (r) {
              setAccountDialog(null);
              setAccountForm({ label: "", username: "", password: "" });
            }
          }
        }}
      >
        {accountDialog === "new" ? (
          <Field label="账号名称">
            <Input
              value={accountForm.label}
              onChange={(v) => setAccountForm({ ...accountForm, label: v })}
            />
          </Field>
        ) : (
          <>
            <Field label="官方账号">
              <Input
                autoComplete="off"
                value={accountForm.username}
                onChange={(v) =>
                  setAccountForm({ ...accountForm, username: v })
                }
              />
            </Field>
            <Field label="密码">
              <Input.Password
                autoComplete="off"
                value={accountForm.password}
                onChange={(v) =>
                  setAccountForm({ ...accountForm, password: v })
                }
              />
            </Field>
            <Alert
              type="info"
              content="密码仅用于本次官方登录；需要验证时将打开账号官网窗口。"
            />
          </>
        )}
      </Modal>
      <Modal
        title={inventory?.goods?.name + " · 库存"}
        visible={!!inventory}
        footer={null}
        onCancel={() => setInventory(null)}
        style={{ width: 850 }}
      >
        {inventory && (
          <Table
            rowKey="id"
            data={inventory.list || []}
            columns={[
              { title: "卡密", dataIndex: "secret" },
              {
                title: "状态",
                dataIndex: "status",
                render: (v) => (Number(v) === 0 ? "未售出" : "已售出"),
              },
              {
                title: "添加时间",
                dataIndex: "create_time",
                render: (v) => stamp(v * 1000),
              },
            ]}
            pagination={{
              current: inventory.current,
              total: inventory.total,
              pageSize: 20,
            }}
            onChange={async (pagination) => {
              const r = await run(() =>
                api.cardList({
                  accountId: inventory.goods.account_id,
                  goodsId: inventory.goods.id,
                  current: pagination.current,
                }),
              );
              if (r)
                setInventory({
                  ...inventory,
                  ...r,
                  current: pagination.current,
                });
            }}
          />
        )}
      </Modal>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
