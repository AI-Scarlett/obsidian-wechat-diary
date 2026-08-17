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

  // ══ v0.3.0 单模式路由 ═══════════════════════════════════════════════════

  const BOUND_DATA = () => ({
    settings: { diaryFolder: "日记", timezone: "Asia/Shanghai", aiApiUrl: "", aiModel: "", dayStartHour: 4 },
    ilink: { botId: "B1", userId: "U1", baseUrl: "", buf: "", contextTokens: {}, recentSeqs: [], pauseUntil: 0, lastAliveTs: 0, loginTime: "x", botTokenFallback: "", skipBacklog: false },
    profile: { state: "active", name: null },
    session: { mode: "chat", entered_date: "", chat_count_today: 0, last_activity_ts: 0, cost_reminder_shown_date: "" },
  });

  // 桩掉 writer 的落盘方法(agent.writer 与 plugin.writer 同引用, 原地换方法即可)
  function stubWriter(p) {
    const calls = { writes: [], finalized: [] };
    p.writer.write = async (text) => { calls.writes.push(text); return { reply: "记下来啦~ 今天第 " + calls.writes.length + " 段 ✍️", n: calls.writes.length }; };
    p.writer.finalizeDay = async (d) => { calls.finalized.push(d || "today"); return calls.writes.length > 0; };
    p.writer.undoLastBlock = async () => (calls.writes.length ? { ok: true, removed: calls.writes.pop() } : { ok: false, removed: null });
    p.writer.countDay = async () => calls.writes.length;
    return calls;
  }

  console.log("\n【11】单模式: 发什么记什么, 探活/命令是唯一例外");
  let sd = { [SECRET_TOKEN]: "TOK1" };
  p = await newPlugin(sd, BOUND_DATA());
  let calls = stubWriter(p);
  let r = await p.agent._dispatch("今天试了新的手冲豆子", false, []);
  check("普通内容 → 记", calls.writes.length === 1 && r.includes("记下来"), r);
  r = await p.agent._dispatch("在吗在吗", false, []);
  check("「在吗在吗」→ 状态回复, 不落库", calls.writes.length === 1 && r.includes("在的") && r.includes("已记 1 段"), r);
  r = await p.agent._dispatch("开始记日记", false, []);
  check("「开始记日记」→ 告知不用了, 不落库", calls.writes.length === 1 && r.includes("不用特意开始"), r);
  r = await p.agent._dispatch("帮助", false, []);
  check("「帮助」→ 指南, 不落库", calls.writes.length === 1 && r.includes("使用指南"), r);

  console.log("\n【12】「结束」是仪式不是开关: 封存后继续发照样记");
  r = await p.agent._dispatch("结束", false, []);
  check("「结束」→ 封存", calls.finalized.length === 1 && !r.includes("不用特意"), r);
  r = await p.agent._dispatch("又想起一件事", false, []);
  check("封存后再发 → 照记(v0.2.1 会掉进闲聊丢掉)", calls.writes.length === 2, JSON.stringify(calls.writes));

  console.log("\n【13】撤回与改称呼");
  r = await p.agent._dispatch("撤回", false, []);
  check("「撤回」→ 删最后一条且带预览", calls.writes.length === 1 && r.includes("撤掉了「又想起一件事」"), r);
  r = await p.agent._dispatch("叫我小明", false, []);
  check("「叫我小明」短句 → 改称呼不落库", p.data.profile.name === "小明" && calls.writes.length === 1, r);
  r = await p.agent._dispatch("叫我妈过来吃饭的时候记得提醒我带上钥匙", false, []);
  check("「叫我」开头的长句是内容 → 照记", calls.writes.length === 2 && p.data.profile.name === "小明", r);

  console.log("\n【14】首次见面: 内容优先, 取名一轮即过");
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => { const d = BOUND_DATA(); d.profile = { state: "unknown", name: null }; return d; })());
  calls = stubWriter(p);
  r = await p.agent._dispatch("帮我记一下明天要给妈妈买降压药", false, []);
  check("第一句是内容 → 先记再欢迎", calls.writes.length === 1 && r.includes("随手记 Agent"), r);
  r = await p.agent._dispatch("谷雨", false, []);
  check("第二句像名字 → 取名", p.data.profile.name === "谷雨" && calls.writes.length === 1, r);

  console.log("\n【15】首次见面发「在吗」: 欢迎语即回答; 之后长句不被取名吞掉");
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => { const d = BOUND_DATA(); d.profile = { state: "unknown", name: null }; return d; })());
  calls = stubWriter(p);
  r = await p.agent._dispatch("在吗", false, []);
  check("第一句探活 → 欢迎语, 不落库", calls.writes.length === 0 && r.includes("随手记 Agent"), r);
  r = await p.agent._dispatch("今天跟医生确认了下周复查的时间安排", false, []);
  check("取名轮里的长句 → 当内容记, 不吞", calls.writes.length === 1 && r.includes("称呼不急"), r);
  check("取名只问一轮", p.data.profile.state === "active");

  console.log("\n【16】跨天: 宽限期外自动封存昨天, 新内容记到今天");
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => {
    const d = BOUND_DATA();
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    d.session = { mode: "diary", entered_date: y, chat_count_today: 0, last_activity_ts: Date.now() - 3 * 3600000, cost_reminder_shown_date: "" };
    return d;
  })());
  calls = stubWriter(p);
  calls.writes.push("昨天的旧段落");   // 让 finalizeDay 有东西可封
  r = await p.agent._dispatch("新一天的第一条", false, []);
  check("昨天被自动封存", calls.finalized.length === 1 && calls.finalized[0] !== "today", JSON.stringify(calls.finalized));
  check("带告知 + 新内容照记", r.includes("自动收尾") && calls.writes.length === 2, r);

  console.log("\n【17】换 bot 吞消息修复: 游标与去重表按 bot 判, 不按微信号");
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
  p.data.ilink.buf = "OLD_CURSOR"; p.data.ilink.recentSeqs = ["s1", "s2"];
  await p.onLoginConfirmed({ botToken: "TOK1", botId: "B1", userId: "U1", baseUrl: "" });
  check("同人同 bot 重登 → 游标保留", p.data.ilink.buf === "OLD_CURSOR" && p.data.ilink.recentSeqs.length === 2);
  await p.onLoginConfirmed({ botToken: "TOK2", botId: "B2", userId: "U1", baseUrl: "" });
  check("同人换 bot → 游标/去重表清零(否则新 bot 前 N 条被吞)", p.data.ilink.buf === "" && p.data.ilink.recentSeqs.length === 0);
  check("换 bot 不清称呼(还是同一个人)", p.data.profile.state === "active");

  console.log("\n【18】逻辑日边界(契约 v1.2): 凌晨 4 点前算前一天");
  const I = WechatDiaryPlugin.__internals;
  I.setTimezone("Asia/Shanghai");
  I.setDayStartHour(4);
  check("凌晨 2:30 → 前一天", I.logicalTodayStr(new Date("2026-08-16T02:30:00+08:00")) === "2026-08-15", I.logicalTodayStr(new Date("2026-08-16T02:30:00+08:00")));
  check("凌晨 3:59 → 前一天", I.logicalTodayStr(new Date("2026-08-16T03:59:00+08:00")) === "2026-08-15");
  check("凌晨 4:00 → 当天", I.logicalTodayStr(new Date("2026-08-16T04:00:00+08:00")) === "2026-08-16");
  check("白天 → 当天", I.logicalTodayStr(new Date("2026-08-16T15:00:00+08:00")) === "2026-08-16");
  check("边界收口: 非法值回落 4", (I.setDayStartHour(99), I.logicalTodayStr(new Date("2026-08-16T03:00:00+08:00")) === "2026-08-15"));

  console.log("\n【19】收尾语分时段");
  check("21:30 → 夜", I.isNightNow(new Date("2026-08-16T21:30:00+08:00")) === true);
  check("凌晨 2 点 → 夜(还没过边界)", I.isNightNow(new Date("2026-08-16T02:00:00+08:00")) === true);
  check("14:00 → 日", I.isNightNow(new Date("2026-08-16T14:00:00+08:00")) === false);

  console.log("\n【20】撤回预览与欢迎语(纯函数)");
  check("文本截 12 字带省略", I.undoOkReply("今天试了新的手冲豆子花香很明显很满意") === "好的, 撤掉了「今天试了新的手冲豆子花香…」", I.undoOkReply("今天试了新的手冲豆子花香很明显很满意"));
  check("语音 🎤 前缀剥掉", I.undoOkReply("🎤 早上开会说的三件事") === "好的, 撤掉了「早上开会说的三件事」");
  check("图片块 → 说撤图", I.undoOkReply("![[日记/attachments/2026/x.jpg]]") === "好的, 撤掉了刚才那张图片");
  check("欢迎语动态填文件夹", I.welcomeText("PersonalGuyu/Diary").includes("「PersonalGuyu/Diary」文件夹"));
  check("欢迎语教在哪改", I.welcomeText("日记").includes("第三方插件 → WeChat Diary"));

  console.log("\n【21】封存后同分钟续写另起段头(019 e2e 抓出, 两侧同修)");
  const sealed = "# 2026-08-16\n\n**22:04**\n\n封存前\n\n---\n_(今日封存于 22:04)_\n";
  check("封存线在最后段头之后 → 不并入", I.canMergeIntoLastHeader(sealed, "22:04") === false);
  check("不同分钟 → 不并入", I.canMergeIntoLastHeader("**22:04**\n\nx\n", "22:05") === false);
  check("同分钟且未封存 → 并入", I.canMergeIntoLastHeader("**22:04**\n\nx\n", "22:04") === true);
  check("封存后又开了同分钟新段头 → 可并入", I.canMergeIntoLastHeader(sealed + "\n\n**22:04**\n\n封存后\n", "22:04") === true);

  console.log("\n────────────────────────");
  console.log(fail === 0 ? `全部通过 (${pass})` : `${pass} 通过, ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("harness 崩了:", e); process.exit(2); });
