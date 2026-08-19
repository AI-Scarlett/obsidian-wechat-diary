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

  const I = WechatDiaryPlugin.__internals;
  // 桩掉 writer 的落盘方法(agent.writer 与 plugin.writer 同引用, 原地换方法即可)
  // finalizeDay 桩按真函数的三态语义: 第一次有内容 → sealed, 之后 → already(afterSeal=封存后新写的条数), 没内容 → empty
  function stubWriter(p) {
    const calls = { writes: [], finalized: [], sealedAt: {} };
    p.writer.write = async (text) => {
      calls.writes.push(text);
      const n = calls.writes.length;
      let reply = "记下来啦~ 今天第 " + n + " 段 ✍️";
      if (n === 1) reply = I.texts.FIRST_OF_DAY_PREFIX + reply + I.texts.FIRST_OF_DAY_TIPS; // 与真 write 同构(开页前缀+tips)
      return { reply, n, sealed: "today" in calls.sealedAt };
    };
    p.writer.finalizeDay = async (d) => {
      const key = d || "today"; calls.finalized.push(key);
      const n = calls.writes.length;
      if (!n) return { status: "empty", n: 0, afterSeal: 0 };
      if (key in calls.sealedAt) return { status: "already", n, afterSeal: n - calls.sealedAt[key] };
      calls.sealedAt[key] = n; return { status: "sealed", n, afterSeal: 0 };
    };
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

  // ══ 2026-08-19 「一天的句号」: 人话式结束 + 夜间收尾提示 + 三个旧 bug ══════════

  console.log("\n【22】识别层: 剥壳/告别语/复读/emoji——正例(命令)与负例(内容)");
  const D = (t) => I.detectIntent(t);
  const FIN = [ "好，结束", "好 结束", "好的结束", "好结束", "嗯结束", "那结束吧", "OK 结束", "ok，结束", "好啦，收工", "结束了", "记完了", "记完啦", "今天记完了", "今天结束", "结束结束", "结束。。", "「结束」", "嗯嗯 结束了",
    "好的好的结束", "好好好结束", "行行行结束", "好啊结束", "好的呀，结束", "结束！！！！！！！！！！！！！！", "✅结束", "【结束】", "结束 结束", "结束咯" ];
  for (const t of FIN) check("FINALIZE ← " + JSON.stringify(t), D(t).intent === I.INTENT.FINALIZE && !D(t).signoff, D(t).intent);
  const SO = [ "晚安", "晚安🌙", "晚安啦", "晚安晚安", "我睡了", "我去睡了", "去睡了", "睡觉去了", "我要睡了", "今天就到这", "今天就到这里", "今天先到这儿吧", "明天见", "好，晚安", "嗯 明天见", "那晚安啦",
    "我睡啦", "去睡啦", "睡觉去啦", "我去睡觉啦", "我先睡了", "我该睡了", "我睡觉了", "晚安了", "晚安咯", "晚安呢", "🌙晚安", "👋明天见", "😴我睡了", "晚安🌙🌙🌙🌙🌙🌙🌙🌙🌙🌙🌙🌙🌙🌙",
    "好的好的晚安", "那好晚安", "好哦，晚安", "嗯呐晚安", "晚安 晚安", "晚安，晚安", "晚安。晚安。", "晚安，明天见", "晚安 明天见", "晚安明天见", "结束 晚安", "好了，晚安，明天见", "我睡了晚安", "那我睡啦", "好，我睡啦" ];
  for (const t of SO) check("告别语 ← " + JSON.stringify(t), D(t).intent === I.INTENT.FINALIZE && D(t).signoff === true, JSON.stringify(D(t)));
  check("晚安 → 睡觉类(晚安池)", D("晚安").bedtime === true);
  check("明天见 → 非睡觉类", D("明天见").bedtime === false);
  const UND = [ "嗯 撤回", "好的，撤回", "撤回撤回撤回这一段", "撤回一下", "撤销掉", "撤回❌", "❌撤回", "撤回！！！！！！！！！！！！！！",
    "好的撤回上一条", "嗯撤回一下", "那撤销一下", "撤回上面那条", "撤回那个", "撤回刚才", "撤回刚才发的", "删掉刚才那条", "删掉最后一条", "撤回吧撤回吧" ];
  for (const t of UND) check("UNDO ← " + JSON.stringify(t), D(t).intent === I.INTENT.UNDO, D(t).intent);
  check("「好，在吗」→ 探活(有分隔符)", D("好，在吗").intent === I.INTENT.CHAT);
  check("「在嘛」「来啦」探活词自带语气字也认(旧 bug)", D("在嘛").intent === I.INTENT.CHAT && D("来啦").intent === I.INTENT.CHAT && D("在嘛在嘛").intent === I.INTENT.CHAT);
  check("「嗯 帮助」→ 帮助", D("嗯 帮助").intent === I.INTENT.HELP);
  check("「在吗在吗」复读仍是探活", D("在吗在吗").intent === I.INTENT.CHAT);
  // 负例: 全部必须是内容——备忘录/病历/待办用户的回归防线
  const CONTENT = [ "睡了", "睡觉了", "醒了", "吃药了", "写完了", "先这样", "就这样吧", "今天就这样", "到此为止", "走了", "88", "完事", "拜拜", "再见",
    "好早", "好早啊", "那完了", "好完了", "那开始", "那记一下", "好的撤销了订单", "那撤回来了", "撤回申请", "撤销订阅", "撤回来了",
    "好的，报销 386", "嗯 妈血压 135/85", "好的在吗", "行了", "那天结束得很晚", "今天就到这里明天继续写方案吧我先去吃饭了",
    "完了", "完了完了", "完了！", "完了😭", "完了……", "那完了", "《晚安》", "《结束》", "#标签", "✅ 买菜", "晚安 宝贝", "好好学习", "好好休息", "好啊今天吃火锅", "那好的", "好好好", "嗯好",
    "睡啦", "睡觉啦", "醒啦", "吃药啦", "写完啦", "走啦", "下班啦", "我睡", "去睡", "删掉了一些旧照片", "删除那个账号", "撤回来了", "今天 结束", "结束 宝贝" ];
  for (const t of CONTENT) check("DIARY ← " + JSON.stringify(t), D(t).intent === I.INTENT.DIARY, JSON.stringify(D(t)));
  check("光杆「好」不是命令", D("好").intent === I.INTENT.DIARY);
  check("光杆「嗯」不是命令", D("嗯").intent === I.INTENT.DIARY);
  check("isUndoPhrase 只放行复读/指代尾巴", I.isUndoPhrase("撤回撤回这一段") && I.isUndoPhrase("撤销一下") && !I.isUndoPhrase("撤回申请") && !I.isUndoPhrase("撤回来了"));

  console.log("\n【23】「记：」逃生口: 任何词都能原样记下");
  check("「记：晚安」→ DIARY + forced", D("记：晚安").intent === I.INTENT.DIARY && D("记：晚安").forced === true);
  check("半角冒号也认", D("记: 结束了").forced === true);
  check("「记一下明天开会」不是逃生口(没冒号)", !D("记一下明天开会").forced);

  console.log("\n【23.5】「继续记录」是宣告不是内容(谷雨 8/19 实测反馈)");
  for (const t of ["继续记录", "继续", "继续记", "接着记", "继续写", "继续记录吧", "继续记录。"])
    check("宣告 ← " + JSON.stringify(t), D(t).intent === I.INTENT.START_DIARY && D(t).cont === true, JSON.stringify(D(t)));
  for (const t of ["明天继续记录血压", "继续加油", "继续吃药", "继续观察", "工作继续"])
    check("内容 ← " + JSON.stringify(t), D(t).intent === I.INTENT.DIARY, JSON.stringify(D(t)));
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
  calls = stubWriter(p);
  await p.agent._dispatch("先记一条", false, []);
  await p.agent._dispatch("结束", false, []);
  r = await p.agent._dispatch("继续记录", false, []);
  check("「结束」后发「继续记录」→ 告知直接发, 不落库", calls.writes.length === 1 && r.includes("直接发就行") && r.includes("收尾标记"), r);
  r = await p.agent._dispatch("然后真的记一条", false, []);
  check("之后的内容照记", calls.writes.length === 2, r);
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
  calls = stubWriter(p);
  r = await p.agent._dispatch("记：晚安", false, []);
  check("落库的是剥掉前缀的「晚安」, 没封存", calls.writes.length === 1 && calls.writes[0] === "晚安" && calls.finalized.length === 0, JSON.stringify(calls));
  r = await p.agent._dispatch("记：叫我小明", false, []);
  check("「记：叫我小明」照记, 不改称呼", calls.writes[1] === "叫我小明" && p.data.profile.name === null, JSON.stringify(calls.writes));
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => { const d = BOUND_DATA(); d.profile = { state: "awaiting_name", name: null }; return d; })());
  calls = stubWriter(p);
  r = await p.agent._dispatch("记：谷雨", false, []);
  check("取名轮里「记：谷雨」→ 当内容记, 不当名字", calls.writes[0] === "谷雨" && p.data.profile.name === null && p.data.profile.state === "active", JSON.stringify([calls.writes, p.data.profile]));

  console.log("\n【24】告别语流程: 晚安 → 补一条 → 再晚安; 空日子只道别; 「好，结束」也封存");
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
  calls = stubWriter(p);
  r = await p.agent._dispatch("晚安", false, []);
  check("空日子「晚安」→ 只道别, 不封、不催记", calls.finalized.length === 1 && r.includes("晚安") && !r.includes("想记什么直接发") && !r.includes("段"), r);
  check("空日子说了收尾词也算手动收尾(说明会用了, 提示永久闭嘴)", p.data.profile.finalize_count === 1, String(p.data.profile.finalize_count));
  await p.agent._dispatch("今天生病了去医院", false, []);
  await p.agent._dispatch("先去检查再说", false, []);
  r = await p.agent._dispatch("晚安", false, []);
  check("有内容「晚安」→ 封存 + 回以同类(带段数)", calls.finalized.length === 2 && /晚安|好梦/.test(r) && r.includes("2 段都收好了"), r);
  check("不走「结束」仪式池", !r.includes("装订") && !r.includes("小册子") && !r.includes("时光胶囊"));
  check("finalize_count = 2", p.data.profile.finalize_count === 2, String(p.data.profile.finalize_count));
  r = await p.agent._dispatch("晚安", false, []);
  check("紧接着再说晚安(没补记)→ 短句只道别", r === "晚安 🌙 明天见", r);
  await p.agent._dispatch("想起来还要买药", false, []);
  r = await p.agent._dispatch("我睡了", false, []);
  check("补一条后再告别 → 「补的也收好了」", r.includes("补的也收好了") && r.includes("晚安"), r);
  check("每次手动收尾都计数", p.data.profile.finalize_count === 4, String(p.data.profile.finalize_count));
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
  calls = stubWriter(p);
  await p.agent._dispatch("今天记一条", false, []);
  r = await p.agent._dispatch("好，结束", false, []);
  check("「好，结束」→ 封存, 不再被当内容", calls.writes.length === 1 && calls.finalized.length === 1 && !r.includes("记下来"), r);
  r = await p.agent._dispatch("结束", false, []);
  check("「结束」保留仪式池(有收尾+告别两段)", r.includes("\n\n"), r);
  r = await p.agent._dispatch("好，帮助", false, []);
  check("「好，帮助」→ 指南, 且帮助里教了「晚安」和「记：」", r.includes("使用指南") && r.includes("晚安 / 结束") && r.includes("记：xx"), r.slice(0, 60));

  console.log("\n【25】signoffReply 纯函数: 白天/夜里/名字");
  const dayT = new Date("2026-08-16T14:00:00+08:00"), nightT = new Date("2026-08-16T23:00:00+08:00");
  check("白天「今天就到这」→ 白天版, 带段数", I.signoffReply({ signoff: true, bedtime: false }, { status: "sealed", n: 5, afterSeal: 0 }, null, dayT).includes("5 段都收好了 📖"));
  check("白天「晚安」→ 仍走晚安池(bedtime 强制)", /晚安|好梦/.test(I.signoffReply({ signoff: true, bedtime: true }, { status: "sealed", n: 5, afterSeal: 0 }, null, dayT)));
  check("夜里「明天见」→ 夜版", /晚安|好梦/.test(I.signoffReply({ signoff: true, bedtime: false }, { status: "sealed", n: 5, afterSeal: 0 }, null, nightT)));
  check("写入失败 → 响亮", I.signoffReply({ signoff: true }, { status: "error" }, null, nightT) === I.texts.FINALIZE_FAIL_REPLY);
  const one = I.signoffReply({ signoff: true, bedtime: true }, { status: "sealed", n: 1, afterSeal: 0 }, null, nightT);
  check("只有 1 段 → 「这一段收好了」", one.includes("这一段收好了") && !one.includes("1 段"), one);
  let sawName = false;
  for (let i = 0; i < 60; i++) if (I.signoffReply({ signoff: true, bedtime: true }, { status: "sealed", n: 3, afterSeal: 0 }, "谷雨", nightT).includes("谷雨")) sawName = true;
  check("有称呼时偶尔带名字", sawName);

  console.log("\n【26】夜间收尾提示决策(纯函数, 表驱动)");
  I.setNudgeNightHour(22);
  const N = (o) => I.nightSignoffTip(Object.assign({ n: 3, sealed: false, now: nightT, nudgedDate: "", nudgeCount: 0, finalizeCount: 0 }, o));
  check("23:00 第一条深夜消息 → 提示", N({}) === I.texts.NIGHT_SIGNOFF_TIP);
  check("凌晨 1 点(边界前)也算深夜", N({ now: new Date("2026-08-17T01:00:00+08:00") }) === I.texts.NIGHT_SIGNOFF_TIP);
  check("21:30 → 不提示(22 点起)", N({ now: new Date("2026-08-16T21:30:00+08:00") }) === null);
  check("14:00 → 不提示", N({ now: dayT }) === null);
  check("今天已提示过 → 不再提示", N({ nudgedDate: I.logicalTodayStr(nightT) }) === null);
  check("昨天提示过 → 今天可以", N({ nudgedDate: "2026-08-15" }) === I.texts.NIGHT_SIGNOFF_TIP);
  check("终身 3 次到顶 → 永久闭嘴", N({ nudgeCount: 3 }) === null);
  check("手动收尾过 1 次 → 永久闭嘴", N({ finalizeCount: 1 }) === null);
  check("今天已封存 → 不提示", N({ sealed: true }) === null);
  check("写入失败(n=0) → 不提示", N({ n: 0 }) === null);
  check("非法阈值回落 22", (I.setNudgeNightHour(3), N({ now: new Date("2026-08-16T21:30:00+08:00") }) === null));
  I.setNudgeNightHour(22);
  check("isLateNight 22:00 起", I.isLateNight(new Date("2026-08-16T22:00:00+08:00")) === true && I.isLateNight(new Date("2026-08-16T21:59:00+08:00")) === false);

  console.log("\n【27】夜间提示挂在回执上: 一天一次、开页并成一句、命令回执不挂、老用户手动收尾后闭嘴");
  // agent 级路径的 now 取自 new Date(), 不能注入; 用阈值把"现在"强制成深夜/白天两种情况都跑到:
  // isLateNight = h >= nudgeNightHour || h < dayStartHour —— h≥12 时把 nudge 拉到 h, h<12 时把 dayStart 抬到 12
  const hNow = Number(I.hhmmStr(new Date()).slice(0, 2));
  const forceLate = () => (hNow >= 12 ? (I.setDayStartHour(4), I.setNudgeNightHour(hNow)) : (I.setDayStartHour(12), I.setNudgeNightHour(23)));
  const forceDay = () => (hNow < 4 ? (I.setDayStartHour(0), I.setNudgeNightHour(23)) : (I.setDayStartHour(4), I.setNudgeNightHour(23)));
  const canForceDay = hNow !== 23; // 23 点无法用合法阈值变成"白天"
  forceLate();
  check("(强制深夜)isLateNight 为真", I.isLateNight(new Date()) === true);
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
  forceLate(); // onload 会按 settings 重设阈值, 再压一次
  calls = stubWriter(p);
  r = await p.agent._dispatch("第一条", false, []);
  check("开页回执: 提示并进 tips, 一条回执一个括号", r.includes("睡前跟我说声「晚安」") && !r.includes(I.texts.FIRST_OF_DAY_TIPS) && r.split("(").length === 2, r);
  check("发送前不记账(回执发不出去不烧额度)", !p.data.session.nudged_date && !p.data.profile.nudge_count && !!p.agent._pendingNudge);
  check("commitNudge 落账", p.agent.commitNudge() === true && p.data.session.nudged_date === I.logicalTodayStr(new Date()) && p.data.profile.nudge_count === 1, JSON.stringify([p.data.session.nudged_date, p.data.profile.nudge_count]));
  check("重复 commit 无效", p.agent.commitNudge() === false && p.data.profile.nudge_count === 1);
  r = await p.agent._dispatch("第二条", false, []);
  check("同一天第二条不再提示", !r.includes("睡前"), r);
  r = await p.agent._dispatch("在吗", false, []);
  check("命令回执从不挂提示", !r.includes("睡前"), r);
  r = await p.agent._dispatch("撤回", false, []);
  check("撤回回执也不挂", !r.includes("睡前"), r);
  // 非开页的深夜第一条(白天开的页, 夜里回来接着写——谷雨 8/18 的路径): 单独追加一句
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
  forceLate();
  calls = stubWriter(p);
  calls.writes.push("白天记的"); // 让今天不是第一条
  r = await p.agent._dispatch("夜里回来写的", false, []);
  check("非开页深夜第一条 → 单独附一句提示", r.includes("\n\n" + I.texts.NIGHT_SIGNOFF_TIP) && r.includes("第 2 段"), r);
  p.agent.commitNudge();
  r = await p.agent._dispatch("再写一条", false, []);
  check("落账后同晚不再提示", !r.includes("睡前"), r);
  r = await p.agent._dispatch("晚安", false, []);
  check("说了晚安 → finalize_count=1", p.data.profile.finalize_count === 1);
  // 终身上限: 提示过 3 次的账号再深夜也不提示
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => { const d = BOUND_DATA(); d.profile = { state: "active", name: null, finalize_count: 0, nudge_count: 3 }; return d; })());
  forceLate();
  calls = stubWriter(p);
  r = await p.agent._dispatch("第四晚", false, []);
  check("终身 3 次到顶 → 深夜也不提示", !r.includes("睡前"), r);
  // 手动收尾过的老用户
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => { const d = BOUND_DATA(); d.profile = { state: "active", name: null, finalize_count: 2, nudge_count: 0 }; return d; })());
  forceLate();
  calls = stubWriter(p);
  r = await p.agent._dispatch("老用户的一条", false, []);
  check("手动收尾过的用户: 深夜也不提示", !r.includes("睡前"), r);
  // 首次见面那条不挂(欢迎语已经够长)
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => { const d = BOUND_DATA(); d.profile = { state: "unknown", name: null }; return d; })());
  forceLate();
  calls = stubWriter(p);
  r = await p.agent._dispatch("第一次来记一条", false, []);
  check("首次见面不挂夜间提示", r.includes("随手记 Agent") && !r.includes("睡前"), r);
  if (canForceDay) {
    forceDay();
    check("(强制白天)isLateNight 为假", I.isLateNight(new Date()) === false);
    p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
    forceDay();
    calls = stubWriter(p);
    r = await p.agent._dispatch("白天第一条", false, []);
    check("白天开页: tips 原样, 不带夜间提示", r.includes(I.texts.FIRST_OF_DAY_TIPS) && !r.includes("睡前"), r);
    check("白天 nudge_count 不动", !p.data.profile.nudge_count && !p.data.session.nudged_date);
  } else {
    console.log("  (本机 23 点整, 跳过强制白天分支)");
  }
  // 跨天告知那条不挂夜间提示(顺延到下一条)
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => { const d = BOUND_DATA(); d.session.entered_date = "2026-01-01"; return d; })());
  forceLate();
  calls = stubWriter(p);
  calls.writes.push("昨天的"); // 昨天有内容且未手动封存 → 自动封存 → 告知
  r = await p.agent._dispatch("今晚第一条", false, []);
  check("带跨天告知的回执不挂夜间提示", r.includes("自动收尾") && !r.includes("睡前") && !p.agent._pendingNudge, r);
  r = await p.agent._dispatch("今晚第二条", false, []);
  check("提示顺延到下一条", r.includes("睡前"), r);
  I.setDayStartHour(4); I.setNudgeNightHour(22);
  check("老 data.json 缺字段 → 默认补零", (await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA())).data.profile.nudge_count === 0);
  // 「晚安」+图片同条: 图先落库再收尾
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, BOUND_DATA());
  calls = stubWriter(p);
  p._client = { downloadImage: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) };
  p.writer.writeImage = async () => { calls.writes.push("[img]"); return { n: calls.writes.length, diskFull: false, sealed: false }; };
  await p.agent._dispatch("先记一条", false, []);
  r = await p.agent._dispatch("晚安", false, [{ fake: 1 }]);
  check("图先记(第 2 段)再封存(2 段都收好了), 顺序与数字一致", r.indexOf("图片收好啦") < r.indexOf("2 段都收好了") && calls.finalized.length === 1, r);

  console.log("\n【28】跨天告知只给真自动封存的: 昨晚自己说了晚安, 今早不再说「已自动收尾」(旧 bug)");
  p = await newPlugin({ [SECRET_TOKEN]: "TOK1" }, (() => {
    const d = BOUND_DATA();
    d.session = { mode: "diary", entered_date: "2026-01-01", chat_count_today: 0, last_activity_ts: 0, cost_reminder_shown_date: "" };
    return d;
  })());
  calls = stubWriter(p);
  calls.writes.push("昨晚的段落"); calls.sealedAt["2026-01-01"] = 1;   // 昨晚已手动封存
  r = await p.agent._dispatch("新一天的第一条", false, []);
  check("finalizeDay 走了但返回 already", calls.finalized[0] === "2026-01-01");
  check("回执不带「自动收尾」(桩不分日, 段数续算), 新内容照记", !r.includes("自动收尾") && r.includes("记下来") && calls.writes.length === 2, r);
  check("对照【16】: 真自动封存的才带告知", true);

  console.log("\n【29】真 DiaryWriter 落盘: finalizeDay 三态 + 撤回保住封存行(假 vault)");
  function fakeVault(files) {
    const v = {
      files,
      getFileByPath: (path) => (path in files ? { path } : null),
      getAbstractFileByPath: (path) => (path in files ? { path } : null),
      getFolderByPath: () => ({}),
      createFolder: async () => {},
      create: async (path, c) => { files[path] = c; },
      process: async (f, fn) => { files[f.path] = fn(files[f.path]); return files[f.path]; },
      cachedRead: async (f) => files[f.path],
    };
    return v;
  }
  const files = {};
  const wp = { app: { vault: fakeVault(files) }, settings: { diaryFolder: "日记" } };
  const W = new I.DiaryWriter(wp, null);
  const DAY = "2026-08-18";
  let fr = await W.finalizeDay(DAY);
  check("没有文件 → empty", fr.status === "empty" && fr.n === 0);
  await W.write("第一段", false, DAY);
  await W.write("第二段", false, DAY);
  fr = await W.finalizeDay(DAY);
  check("有内容 → sealed, n=2", fr.status === "sealed" && fr.n === 2, JSON.stringify(fr));
  const path = W.diaryPath(DAY);
  check("文件里有封存行", files[path].includes(I.texts.CLOSING_MARKER));
  fr = await W.finalizeDay(DAY);
  check("再封 → already, afterSeal=0, 不重复写", fr.status === "already" && fr.afterSeal === 0 && files[path].split(I.texts.CLOSING_MARKER).length === 2, JSON.stringify(fr));
  const w3 = await W.write("封存后补的", false, DAY);
  check("write 报告 sealed=true", w3.sealed === true && w3.n === 3);
  fr = await W.finalizeDay(DAY);
  check("补记后再封 → already, afterSeal=1", fr.status === "already" && fr.afterSeal === 1 && fr.n === 3, JSON.stringify(fr));
  let u = await W.undoLastBlock(DAY);
  check("撤回封存后补的那条", u.ok && u.removed === "封存后补的");
  check("封存行还在, 且孤儿段头清掉了", files[path].includes(I.texts.CLOSING_MARKER) && (files[path].match(/\*\*\d\d:\d\d\*\*/g) || []).length === 1, JSON.stringify(files[path]));
  u = await W.undoLastBlock(DAY);
  check("再撤(封存线之前的「第二段」)", u.ok && u.removed === "第二段");
  check("封存行仍保住(旧 bug: 会连封存行一起删)", files[path].includes(I.texts.CLOSING_MARKER) && files[path].includes("第一段"), JSON.stringify(files[path]));
  check("封存行位置正确: 在内容之后、文件末尾", files[path].trim().endsWith(")_"), JSON.stringify(files[path]));
  u = await W.undoLastBlock(DAY);
  fr = await W.finalizeDay(DAY);
  check("全撤光后再封 → empty(只剩标题不封)", u.ok && fr.status === "empty" && fr.n === 0, JSON.stringify(fr));
  const emptyPath = W.diaryPath("2026-08-19");
  files[emptyPath] = "";
  check("空字符串文件 → empty", (await W.finalizeDay("2026-08-19")).status === "empty");
  const before29 = files[path];
  const wr = await W.write("再来一条", false, DAY);
  check("光标题文件续写正常, sealed=false", wr.n === 1 && wr.sealed === false && files[path] !== before29);

  console.log("\n────────────────────────");
  console.log(fail === 0 ? `全部通过 (${pass})` : `${pass} 通过, ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("harness 崩了:", e); process.exit(2); });
