const ORIGIN = "https://wzyp.cn";
const ROUTES = Object.freeze({
  goods: "/merchantApi/Goods/list",
  info: "/merchantApi/Goods/info",
  categories: "/merchantApi/GoodsCategory/listAll",
  publish: "/merchantApi/Goods/update",
  add: "/merchantApi/GoodsCardStorage/add",
  cards: "/merchantApi/goodsCardStorage/list",
  upload: "/merchantApi/Upload/file",
  user: "/merchantApi/user/userinfo",
  safeMode: "/merchantApi/user/checkSafeMode",
});
function defaultProduct() {
  return {
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
  };
}
function validateProduct(p) {
  if (
    p.goods_type !== "card" ||
    Number(p.id) !== 0 ||
    Number(p.parent_id) !== 0
  )
    throw new Error("仅允许创建自营卡密商品");
  if (!p.name?.trim() || p.name.length > 60)
    throw new Error("商品标题须为 1–60 个字符");
  if (!Number.isSafeInteger(Number(p.category_id)) || Number(p.category_id) < 1)
    throw new Error("请选择官方分类");
  for (const k of ["price", "market_price", "cost_price"])
    if (
      !Number.isFinite(Number(p[k])) ||
      Number(p[k]) < 0 ||
      Number(p[k]) > 99999
    )
      throw new Error("价格须为 0–99999 元");
  if (!p.description?.trim() || !p.extend?.instructions?.trim())
    throw new Error("请填写商品描述和使用说明");
  if (![0, 1].includes(p.status) || ![0, 1].includes(p.show))
    throw new Error("商品状态不合法");
  return p;
}
// Executed in the official account renderer, using its original request module.
function rendererRequest({
  action,
  data,
  routes,
  expectedRemoteId,
  identityChecked,
}) {
  return (async () => {
    if (location.origin !== "https://wzyp.cn")
      throw new Error("账号页面不在官方域名");
    const script = [...document.scripts].find((s) =>
      /\/package\/merchant\/assets\/index\.[a-z0-9]+\.js/.test(s.src),
    );
    if (!script) throw new Error("官方请求模块尚未加载");
    const official = await import(script.src),
      http = official.b;
    if (typeof http?.post !== "function")
      throw new Error("官方请求封装已变化，请停止并核对");
    const boundId = () => String(official.u()?.userInfo?.id || "");
    if (
      !["login", "identity", "user", "session"].includes(action) &&
      expectedRemoteId
    ) {
      if (!identityChecked) await official.u().userinfo();
      if (boundId() !== String(expectedRemoteId))
        return {
          code: 0,
          msg: "账号分区身份已变化，拒绝协议操作",
          identityMismatch: true,
          notSent: true,
        };
    }
    if (action === "login") {
      const safe = await http.post(routes.safeMode, data);
      if (safe.code !== 1) return { code: 0, msg: safe.msg || "验证检查失败" };
      if (Number(safe.data?.safe_mode || 0) !== 0)
        return {
          code: 0,
          msg: "需要人工验证，请打开官网登录",
          needsManual: true,
        };
      await official.u().login(data);
      const me = await http.post(routes.user);
      if (
        expectedRemoteId &&
        String(me.data?.id || "") !== String(expectedRemoteId)
      )
        return {
          code: 0,
          msg: "登录凭据指向另一个商户，分区已锁定",
          identityMismatch: true,
        };
      return {
        code: me.code,
        msg: me.msg,
        data: {
          id: me.data?.id,
          nickname: me.data?.nickname,
          username: me.data?.username,
        },
      };
    }
    if (action === "session") {
      if (!(await official.u().checkToken()))
        return { code: 0, msg: "官方会话已失效，请重新登录" };
      await official.u().userinfo();
      const me = official.u().userInfo;
      if (expectedRemoteId && String(me.id) !== String(expectedRemoteId))
        return { code: 0, msg: "会话商户身份改变", identityMismatch: true };
      return {
        code: 1,
        data: { id: me.id, nickname: me.nickname, username: me.username },
      };
    }
    if (action === "identity")
      return {
        code: 1,
        data: {
          ua: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
          origin: location.origin,
        },
      };
    if (action === "upload") {
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0)),
        form = new FormData();
      form.append("file", new File([bytes], data.name, { type: data.type }));
      return await http.post(routes.upload, form);
    }
    if (!routes[action]) throw new Error("未授权业务操作");
    const r = await http.post(routes[action], data);
    if (
      action === "user" &&
      expectedRemoteId &&
      String(r.data?.id || "") !== String(expectedRemoteId)
    )
      return {
        code: 0,
        msg: "当前商户与本地账号绑定不一致",
        identityMismatch: true,
      };
    if (
      action !== "user" &&
      expectedRemoteId &&
      boundId() !== String(expectedRemoteId)
    )
      return {
        code: 0,
        msg: "请求期间账号身份变化，结果不能确认",
        identityMismatch: true,
        uncertain: true,
      };
    if (action === "user" && r.code === 1)
      return {
        code: 1,
        data: {
          id: r.data?.id,
          nickname: r.data?.nickname,
          username: r.data?.username,
        },
      };
    return r;
  })().catch((e) => ({
    code: 0,
    msg: String(e?.message || "官方请求失败").replace(
      /(token|password|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    ),
    uncertain: true,
  }));
}
function expression(action, data = {}, expectedRemoteId = null, options = {}) {
  if (
    !Object.hasOwn(ROUTES, action) &&
    !["login", "identity", "session"].includes(action)
  )
    throw new Error("未授权协议操作");
  return (
    "(" +
    rendererRequest.toString() +
    ")(" +
    JSON.stringify({
      action,
      data,
      routes: ROUTES,
      expectedRemoteId,
      identityChecked: options.identityChecked === true,
    }) +
    ")"
  );
}
module.exports = {
  ORIGIN,
  ROUTES,
  defaultProduct,
  validateProduct,
  expression,
};
