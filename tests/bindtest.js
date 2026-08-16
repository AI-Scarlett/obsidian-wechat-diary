// v0.2.1 半绑定修复的执行验证: 给 obsidian 打桩, 真的跑一遍状态机。
// 跑法: node tests/bindtest.js (只需要 Node, 无依赖)
const Module = require("module");
const path = require("path");

// ── 环境桩 ────────────────────────────────────────────────────────────────
global.window = {
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (...a) => clearTimeout(...a),
  setInterval: (...a) => setInterval(...a),
  clearInterval: (...a) => clearInterval(...a),
};
global.btoa = (s) => Buffer.from(String(s), "binary").toString("base64");

const notices = [];
class Notice { constructor(msg) { notices.push(String(msg)); } }

class Plugin {
  constructor(app) { this.app = app; }
  async loadData() { return this._stored || null; }
  async saveData(d) { this._stored = JSON.parse(JSON.stringify(d)); }
  addCommand() {}
  addSettingTab() {}
  addStatusBarItem() { return { setText() {} }; }
  registerInterval() {}
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
class Modal {
  constructor(app) {
    this.app = app;
    this.titleEl = { setText() {} };
    this.contentEl = { createEl() { return {}; }, empty() {} };
  }
  open() { opened.push(this); }
  close() {}
}
const opened = [];
const chain = new Proxy({}, { get: () => () => chain });
class Setting { constructor() { return chain; } }
class AbstractInputSuggest {}

const stub = {
  Plugin, PluginSettingTab, Setting, Modal, Notice, AbstractInputSuggest,
  normalizePath: (p) => p,
  requestUrl: async () => ({}),
  Platform: { isDesktop: true },
};

const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === "obsidian") return stub;
  return orig.call(this, req, ...rest);
};

const WechatDiaryPlugin = require(path.join(__dirname, "..", "main.js"));

// ── 假 app: secretStorage 是进程级的(模拟"卸载插件不删 secret") ──────────────
function makeApp(secrets) {
  return {
    secretStorage: {
      getSecret: (k) => (k in secrets ? secrets[k] : null),
      setSecret: (k, v) => { secrets[k] = v; },
    },
    workspace: { onLayoutReady: (cb) => { pendingLayout.push(cb); } },
    vault: { getAbstractFileByPath: () => null },
  };
}
let pendingLayout = [];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

async function newPlugin(secrets, storedData) {
  pendingLayout = [];
  const p = new WechatDiaryPlugin(makeApp(secrets));
  p._stored = storedData ? JSON.parse(JSON.stringify(storedData)) : null;
  p.startPipeline = function () { this._startedPipeline = true; };  // 不联网
  await p.onload();
  return p;
}

(async () => {
  const SECRET_TOKEN = "wechat-diary-ilink-bot-token";
  const SECRET_ID = "wechat-diary-bind-identity";

  console.log("\n【1】全新安装: 什么都没有");
  const s1 = {};
  let p = await newPlugin(s1, null);
  check("bindState() === none", p.bindState() === "none", p.bindState());
  pendingLayout.forEach((cb) => cb());
  check("不启动管道", !p._startedPipeline);

  console.log("\n【2】扫码绑定成功");
  await p.onLoginConfirmed({ botToken: "TOK1", botId: "B1", userId: "U1", baseUrl: "https://x.example" });
  check("bindState() === bound", p.bindState() === "bound", p.bindState());
  check("token 进了 secretStorage", s1[SECRET_TOKEN] === "TOK1");
  check("身份也进了 secretStorage", !!s1[SECRET_ID], JSON.stringify(s1[SECRET_ID]));
  check("身份内容正确", (p.getBindIdentity() || {}).userId === "U1");
  const dataAfterBind = p._stored;

  console.log("\n【3】卸载重装: data.json 没了, secret 还在 ← 就是线上那个故障");
  p = await newPlugin(s1, null);
  check("userId 从 secret 恢复了", p.data.ilink.userId === "U1", p.data.ilink.userId);
  check("bindState() === bound (不是 half)", p.bindState() === "bound", p.bindState());
  check("baseUrl 也恢复了", p.data.ilink.baseUrl === "https://x.example");
  check("置了 skipBacklog(防积压重放)", p._skipBacklog === true);
  check("skipBacklog 已落盘(跨重启有效)", p._stored.ilink.skipBacklog === true);
  pendingLayout.forEach((cb) => cb());
  check("管道启动了", p._startedPipeline === true);

  console.log("\n【4】skipBacklog 期间不落笔, 但要能解除");
  p.writer = { write: async () => { throw new Error("不该写!"); } };
  await p._handleIncoming({ from_user_id: "U1", seq: "1", item_list: [{ type: 1, text_item: { text: "旧消息" } }] });
  check("积压消息被跳过(没写)", true);
  check("计数 +1", p._skippedCount === 1, String(p._skippedCount));
  await p._clearSkipBacklog();
  check("解除后 _skipBacklog=false", p._skipBacklog === false);
  check("解除后落盘也翻了", p._stored.ilink.skipBacklog === false);
  check("提示了用户", notices.some((n) => n.includes("已跳过离线期间的 1 条")), JSON.stringify(notices.slice(-2)));

  console.log("\n【5】v0.1.3 老用户升上来: data.json 没了, secret 里【没有】身份副本");
  const s5 = { [SECRET_TOKEN]: "TOK1" };   // 老版本只存过 token
  p = await newPlugin(s5, null);
  check("bindState() === half", p.bindState() === "half", p.bindState());
  check("没有伪造 skipBacklog", p._skipBacklog === false);
  pendingLayout.forEach((cb) => cb());
  check("管道照样启动(v0.1.3 会卡死在这)", p._startedPipeline === true);

  console.log("\n【6】待认领: 陌生人不能自动成为主人");
  const before = opened.length;
  p._handleIncoming({ from_user_id: "STRANGER", seq: "9", item_list: [{ type: 1, text_item: { text: "hi" } }] });
  check("弹了确认框, 没有自动认领", opened.length === before + 1 && !p.data.ilink.userId);
  const modal = opened[opened.length - 1];
  check("_claiming 上锁", p._claiming === true);
  p._handleIncoming({ from_user_id: "STRANGER2", seq: "10", item_list: [{ type: 1, text_item: { text: "hi" } }] });
  check("上锁期间不叠弹窗", opened.length === before + 1);

  console.log("\n【7】叉掉弹窗 ≠ 明确拒绝");
  modal.onClose();
  check("_claiming 放开了", p._claiming === false);
  check("没被拉黑(下次还会问)", !p._declinedClaims.has("STRANGER"));

  console.log("\n【8】点「是我」→ 认领");
  await p.adoptOwner("U1");
  check("userId 认回来了", p.data.ilink.userId === "U1");
  check("bindState() === bound", p.bindState() === "bound", p.bindState());
  check("身份补写进了 secret", (p.getBindIdentity() || {}).userId === "U1");
  check("认领后进入 skipBacklog(防积压落笔)", p._skipBacklog === true && p._stored.ilink.skipBacklog === true);
  await p._clearSkipBacklog();
  check("一次空轮询即解除", p._skipBacklog === false);
  await p.adoptOwner("HACKER");
  check("已有主人后不能被顶替", p.data.ilink.userId === "U1", p.data.ilink.userId);

  console.log("\n【9】解绑两档: 只清身份 vs 彻底解除");
  await p.unbind(true);
  check("keepToken: token 还在", p.getBotToken() === "TOK1", p.getBotToken());
  check("keepToken: 回到 half", p.bindState() === "half", p.bindState());
  check("keepToken: 身份副本清了", p.getBindIdentity() === null);
  await p.unbind(false);
  check("彻底解除: token 清了", p.getBotToken() === "");
  check("彻底解除: bindState === none", p.bindState() === "none", p.bindState());

  console.log("\n【10】没有 secretStorage 的宿主(botTokenFallback 路径)");
  pendingLayout = [];
  const app10 = makeApp({});
  app10.secretStorage = null;
  const p10 = new WechatDiaryPlugin(app10);
  p10._stored = null;
  p10.startPipeline = function () { this._startedPipeline = true; };
  await p10.onload();
  await p10.onLoginConfirmed({ botToken: "TOK2", botId: "B2", userId: "U2", baseUrl: "" });
  check("token 落在 data.json 兜底字段", p10.data.ilink.botTokenFallback === "TOK2");
  check("bindState() === bound", p10.bindState() === "bound", p10.bindState());
  await p10.unbind(true);
  check("keepToken 在兜底路径上也保住了 token", p10.getBotToken() === "TOK2", p10.getBotToken());
  await p10.unbind(false);
  check("彻底解除清干净", p10.getBotToken() === "");

  console.log("\n────────────────────────");
  console.log(fail === 0 ? `全部通过 (${pass})` : `${pass} 通过, ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("harness 崩了:", e); process.exit(2); });
