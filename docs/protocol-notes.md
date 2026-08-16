# iLink 协议笔记

> **重大更新 · 2026-08-05：协议的权威来源找到了。**
>
> 之前以为 iLink 没有公开文档、只能逆向。**错了。** 它是腾讯官方产品「微信 ClawBot 插件」，
> 腾讯以 `Tencent` 名义开源了完整实现，而且**发布了 TypeScript 源码**——
> 正好就是插件版要用的语言。
>
> ```bash
> curl -sL https://registry.npmjs.org/@tencent-weixin/openclaw-weixin/-/openclaw-weixin-2.4.6.tgz \
>   | tar xz && ls package/src/
> ```
>
> - npm: `@tencent-weixin/openclaw-weixin` · author `Tencent` · MIT · latest **2.4.6** (2026-06-22)
> - 6 名维护者邮箱全部 `@tencent.com`
> - `src/api/types.ts` 就是协议的 spec（注释里写明 mirrors proto）
>
> ⚠️ **只信 `src/`，不要信 README。** 官方 README 的 header 表少列了 3 个、
> 对 `-14` 的说法已被代码推翻、全文甚至不出现 `channel_version` 一词。
>
> 本文档中标 ✅ 的条目 = 已从官方源码逐行独立核实（2026-08-05）。

---

## 0. 一句话

扫码换 `bot_token` → 长轮询收消息 → 带 `context_token` 回消息。
**没有 webhook、不需要公网 IP、纯客户端出站拉取**——这正是它能做"纯本地部署"的原因，
也是它在所有微信通道里最适合本项目的根本理由。

---

## 1. 🔴 019 现有实现与官方的 5 处实质偏差

**这是本文档最重要的一节。** 移植到 TS 时必须修掉，019 也应该跟着改。

### ① `-14` 的处理是反的 —— 最严重 ✅

| | 019 现在的做法 | 官方做法 |
|---|---|---|
| 语义理解 | session 过期，需要重新登录 | **stale token**（v2.4.5 起常量已从 `SESSION_EXPIRED_ERRCODE` 改名为 `STALE_TOKEN_ERRCODE`） |
| 处理 | 返回 exit code 2 → `start.bat` 删 state → **重新扫码** | `pauseSession()` —— **暂停该账号 1 小时**，不清 token、不通知用户、不重新登录；冷却后用同一 token 继续轮询 |

官方源码（`src/api/session-guard.ts`）：
```ts
const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000;   // 整整一小时
export const STALE_TOKEN_ERRCODE = -14;
export function pauseSession(accountId: string): void { ... }
```

**为什么严重**：收到 `-14` 就重新扫码，既没必要（token 其实还能用），
又可能在腾讯侧放大风控异常。第三方实现的注释原话就是这么做是为了
"prevent triggering risk controls"。

### ② `longpolling_timeout_ms` 方向搞反了 ✅

官方 `src/api/types.ts`：
```ts
export interface GetUpdatesReq {
  sync_buf?: string;          // @deprecated
  get_updates_buf?: string;   // ← 请求体只有这两个字段
}
export interface GetUpdatesResp {
  ...
  /** Server-suggested timeout (ms) for the next getUpdates long-poll. */
  longpolling_timeout_ms?: number;    // ← 它是【响应】字段
}
```

019 把它塞进**请求体**（`run_loop` 发 3000，`probe_session` 发 100）。
**请求体里根本没有这个字段，服务端会忽略。**

正确做法：请求不带它；读**响应**里的建议值，用来设下一轮的客户端超时。
官方默认值 `DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000`。

> ⚠️ **调研报告在这里自相矛盾，我按官方源码纠正**：报告一边正确指出"它是响应字段"，
> 一边又推论"所以实际只 hang 3 秒，插件长轮询很轻松"。**后半句是错的**——
> 既然请求体里的 3000 被忽略，服务端实际 hold 多久是未知的，官方客户端按 **35 秒**
> 准备。所以插件的 HTTP 层**必须能撑住 35 秒不返回**，不能按 3 秒设计。

### ③ `BASE_URL` 不该硬编码 ✅

019 在 `ilink.py:35` 硬编码 `https://ilinkai.weixin.qq.com`。
官方是**登录 confirmed 时服务端下发 `baseUrl`**，之后所有调用都用下发的那个
（`src/channel.ts` 里 `account.baseUrl` 贯穿全部调用；CDN 地址同理，
`src/cdn/cdn-url.ts` 里没有任何硬编码域名）。

腾讯若做分区/灰度调度，硬编码会在某些账号上直接失效。

### ④ 扫码状态机漏了 4 个状态，还多了 3 个不存在的 ✅

官方 8 个状态（`src/auth/login-qr.ts:15`）：
```ts
"wait" | "scaned" | "confirmed" | "expired"
| "scaned_but_redirect" | "need_verifycode" | "verify_code_blocked" | "binded_redirect"
```

| 状态 | 含义 | 019 的处理 |
|------|------|-----------|
| `wait` | 等待扫码 | 落到 else，继续轮询 ✓ |
| `scaned` | 已扫，等确认 | 同上 ✓ |
| `confirmed` | 确认成功 | ✓ |
| `expired` | 二维码过期 | ✓ |
| `scaned_but_redirect` | **要换个 host 继续轮询** | ❌ 不认识 → 空等到超时 |
| `need_verifycode` | **需要输入验证码**（账号级风控） | ❌ 不认识 → 空等 5 分钟 |
| `verify_code_blocked` | **验证码被封** | ❌ 不认识 → 空等 5 分钟 |
| `binded_redirect` | **成功语义**: 已经连过了, 不下发新凭据, 本地凭据继续有效 | ❌ 不认识 |
| ~~`cancel`/`canceled`/`cancelled`~~ | **官方根本没有这三个** | 019 专门写了分支——要么对应未文档化的返回，要么是死代码 |

**`need_verifycode` 的存在证明腾讯对具体账号会做验证码级风控。**
触发条件、阈值、解封方式全部无文档。

> 🔴 **勘误 2026-08-14：上表里 `binded_redirect` 原先写的是「该 bot 已绑到别处」，是错的。**
>
> 官方 `src/auth/login-qr.ts:162-168` 的注释原文：
> > Server reported `binded_redirect`: the scanned bot is **already bound to this OpenClaw
> > instance**, so no new credentials are issued and **existing local credentials remain
> > valid**. Callers should treat this as a **successful outcome** ("already done") rather
> > than a login failure.
>
> 官方 CLI 走到该分支打印的是 `✅ 已连接过此 OpenClaw，无需重复连接。`（`login-qr.ts:389-397`）。
>
> **这条笔记的错误直接生成了一个线上故障**：020 v0.1.3 照着"绑到别处"实现，
> 在本地有 token 但 data.json 丢失（卸载重装）时把用户引向"找作者做服务端解绑"——
> 而**服务端解绑这个操作根本不存在**：整个官方包里没有任何 unbind 端点，
> 官方自己的 `clearWeixinAccount()`（`src/auth/accounts.ts:219-238`）也只删本地四个文件，
> 一个网络请求都不发。v0.2.1 已修，见 `00-decisions.md` D5 补记。

### ⑤ header 和 `base_info` 少了字段 ✅

官方 `src/api/api.ts`：
```ts
const CHANNEL_VERSION = pkg.version ?? "unknown";   // ← 就是插件自己的版本号
// header
"iLink-App-Id": ILINK_APP_ID,      // 019 没发 —— 取值来自 package.json 的 ilink_appid
// base_info
{ channel_version: CHANNEL_VERSION,
  bot_agent: sanitizeBotAgent(...) }               // 019 没发
```

- `channel_version = "1.0.2"` **过时了三个大版本**（latest 2.4.6，连 legacy tag 都是 1.0.3）。
  目前还跑得通，但服务端校不校验、发旧值会不会被拒——**查不到**。
- `bot_agent` 是 UA 风格的自我标识（`Name/Version`，ASCII，≤256 字节），
  官方注释说"仅用于日志归因，不参与鉴权或路由"。**建议老实填 `obsidian-wechat-diary/x.y.z`**，
  将来出问题腾讯侧能归因到你。

---

## 2. 协议细节（以官方 `src/api/types.ts` 为准）

### 认证 header

```
Content-Type:       application/json
AuthorizationType:  ilink_bot_token
Authorization:      Bearer {bot_token}
X-WECHAT-UIN:       {base64(随机整数)}
iLink-App-Id:       bot                    ← 019 缺
SKRouteTag:         (条件性)                ← 019 缺
```

`X-WECHAT-UIN` 每个请求重新随机生成，服务端照收——不参与身份校验，照抄即可，
不要试图让它稳定。

### 端点

| 端点 | 用途 | 019 有没有 |
|------|------|-----------|
| `GET /ilink/bot/get_bot_qrcode?bot_type=3` | 取登录二维码 | ✅ |
| `GET /ilink/bot/get_qrcode_status?qrcode=` | 轮询扫码状态（header 用 `iLink-App-ClientVersion: 1`） | ✅ |
| `POST /ilink/bot/getupdates` | 长轮询收消息 | ✅ |
| `POST /ilink/bot/sendmessage` | 发消息 | ✅ |
| `getuploadurl` / `getconfig` / `sendtyping` / `msg/notifystop` / `msg/notifystart` | 媒体上传、配置、输入态、中断控制 | ❌ 全没有 |
| `GET {cdn}/download?encrypted_query_param=` | **收图**（CDN，非 iLink 域，裸 GET 无鉴权头） | 020 v0.2.0 起 ✅ |

### 枚举（`src/api/types.ts` 逐字）✅

```ts
MessageType     = { NONE:0, USER:1, BOT:2 }
MessageState    = { NEW:0, GENERATING:1, FINISH:2 }
MessageItemType = { NONE:0, TEXT:1, IMAGE:2, VOICE:3, FILE:4, VIDEO:5,
                    TOOL_CALL_START:11, TOOL_CALL_RESULT:12 }
```

**019 硬编码的 `message_type=2, message_state=2` 是对的** —— 即 BOT + FINISH。
（019 的注释写着"含义未知"，现在可以填上了。）

图片/文件/视频走 CDN 且 **AES-128-ECB 加密**（`src/cdn/aes-ecb.ts`）。
019 只处理 TEXT(1) 和 VOICE(3)；**020 自 v0.2.0 起加上 IMAGE(2)**，FILE/VIDEO 仍忽略。

### 收到的消息

```jsonc
{
  "seq": "...",              // 或 "message_id"，去重用
  "from_user_id": "...",
  "context_token": "...",    // ← 见第 3 节
  "item_list": [
    { "type": 1, "text_item":  { "text": "文字" } },
    { "type": 3, "voice_item": { "text": "微信已转写好的文字" } },
    { "type": 2, "image_item": { /* 见下 */ } }
  ]
}
```

语音是**微信自己转写好的**，不需要你做 ASR。转写失败时 text 为空。

### 收图（`src/api/types.ts:101` + `src/media/media-download.ts`）✅

```jsonc
{ "type": 2, "image_item": {
    "media": { "full_url": "...", "encrypt_query_param": "...",
               "aes_key": "base64", "encrypt_type": 1 },
    "thumb_media": { ... },        // 缩略图，另一份独立的 CDN 引用
    "aeskey": "32 位 hex",         // ← inbound 优先用这个
    "hd_size": 0, "mid_size": 0 } }
```

三步：**URL → 裸 GET → AES-128-ECB 解密**。

1. **URL**：优先服务端下发的 `media.full_url`；没有才客户端拼
   `{cdn}/download?encrypted_query_param=<urlencode>`，
   `cdn` 默认 `https://novac2c.cdn.weixin.qq.com/c2c`（`src/auth/accounts.ts:12`）。
2. **下载**：CDN 不吃任何 iLink 鉴权头，鉴权信息就在 URL 的加密参数里。
   官方用 `fetch`（会自动跟 302）；用 Node `https` 要**自己跟重定向**。
3. **解密**：key 优先 `image_item.aeskey`（hex → 16 字节）；退回 `media.aes_key` 时
   ⚠️ **同一字段两种编码**（`src/cdn/pic-decrypt.ts` 的 `parseAesKey`）：
   base64 解出 **16 字节** = 图片（裸 key）；解出 **32 个 ASCII hex 字符** = 文件/语音/视频，
   还要再 hex 解一次。没有 key 时官方走明文下载分支（`downloadPlainCdnBuffer`）。

> 💡 解密对不对**没有校验位**。用 magic bytes 认图片格式可以兼职当校验——
> key 错了解出来必然不是合法图头。

上限 100MB（官方 `WEIXIN_MEDIA_MAX_BYTES`）。

**发图**（本项目不做，记录备查）：`getuploadurl`（报明文大小、密文大小
`ceil((n+1)/16)*16`、MD5、`no_need_thumb`）→ AES 加密后 POST 到 CDN →
从响应头 `x-encrypted-param` 取回下载参数 → 拼 IMAGE item 发送。
⚠️ 发送时 `aes_key` 填的是 `base64(hex 字符串)`（`src/messaging/send.ts:223`），
**与收图那边的编码又不一样**。

### 错误码

字段可能叫 `ret` 也可能叫 `errcode`，**两个都要读**。

| 码 | 含义 | 来源 |
|----|------|------|
| `-14` | stale token → **退避 1 小时**，不重新登录 | ✅ 官方源码 |
| `-2` | **语义不明**。社区两份文档互相矛盾（一说无效 token，一说参数错误），实际 issue 里有人当限流 | ⚠️ 待实测 |
| 其他 | 官方无完整错误码表 | 遇到就记日志，慢慢补 |

---

## 3. context_token 与提醒问题的真相

### 3.1 机制

`context_token` 只能从**用户发来的消息**里拿到。想主动推送（晚上的日记提醒），
必须带一个还有效的 `context_token`。019 的做法是每收一条消息就缓存它 + 时间戳。

### 3.2 🔴 「20 小时」是编的

> **019 的 README 写着「iLink 限制 bot 超过约 20 小时无互动就不能主动发消息
> （平台反骚扰规则，无法绕开）」。**
>
> **这句话没有任何依据。** 腾讯官方源码、README、CHANGELOG、以及查到的
> 全部社区文档，**没有一处提到 20 小时**，"平台反骚扰规则"这个定性同样零出处。

代码层面可以确证它是本地拍脑袋的启发式（`ilink.py:404`）：
```python
def _is_token_fresh(info, max_hours=20):
    # 只做一件事: 本地时间戳相减
    # 不发任何网络请求, 不读任何服务端字段
```
而 `send_to_user`（`:415-421`）判定不 fresh 时**直接 print 跳过、根本不调 sendmessage**。

**也就是说：这条链路从未、也不可能从服务端观测过真实窗口。20 这个数字是猜的。**

旁证：README 自己用了"约"字；`scheduler.py` 的 docstring 把出处标为
"015fridge 经验"（作者上一个项目）；20 恰好是 24 的保守打折。

**社区流传的"24 小时"同样是假的** —— 追查发现它其实挂在 `typing_ticket`
（输入状态票据）上，被搜索摘要串台后在博客圈互抄扩散。

**真实窗口是多少？没有任何人知道。** 两个踩坑最深的 issue 都只说"数小时"，
且非独立观测。

### 3.3 💀 由此推出的产品死结

```
用户每天写日记  → token 天然高频刷新 → 提醒发得出去（但他本来就不需要提醒）
用户连续没写    → token 陈旧        → 提醒发不出去（而这正是最需要提醒的时刻）
```

**提醒机制在最需要它的时刻必然失效。这就是"包括作者自己在内没人能持续使用"的技术根因。**

叠加另一个更蠢的问题：每天固定同一时钟提醒，间隔接近 24 小时，
**必然大于任何合理的窗口值**。越规律越发不出去。

### 3.4 🔑 官方源码给出了决定性答案：根本没有"新鲜度"这个概念 ✅

2026-08-05 补充核实，直接读官方 `src/messaging/inbound.ts`：

```ts
/**
 * contextToken is issued per-message by the Weixin getupdates API and must
 * be echoed verbatim in every outbound send. The in-memory map is the primary
 * lookup; a disk-backed file per account ensures tokens survive gateway restarts.
 */
const contextTokenStore = new Map<string, string>();   // ← 就是个纯 Map
```

**这个 store 里没有时间戳、没有 TTL、没有过期逻辑、没有任何 `Date.now()`。**
（对整个文件 grep `ttl|expire|stale|maxAge|Date.now()` —— **命中数为 0**。）

而且它被**特意持久化到磁盘**，注释写明目的是
"ensures tokens survive gateway **restarts**" —— 官方不但不丢弃旧 token，
还专门保证它跨重启存活。

**没有 token 时官方怎么做？照发。** `src/channel.ts:123`：
```ts
if (!params.contextToken) {
  aLog.warn(`sendWeixinOutbound: contextToken missing for to=${params.to}, sending without context`);
}
// ← 只是 warn, 然后继续往下发, 没有 return
```

**官方明确支持定时投递给微信用户。** `src/channel.ts:201` 的提示词原文：
> "When creating a **cron job (scheduled task)** for the current Weixin user, you MUST set
> `delivery.to` to the user's Weixin ID ... `delivery: { mode: 'announce', channel: 'openclaw-weixin', ... }`"

—— 定时主动推送是官方设计里的**正常用例**，不是被禁止的东西。

### 3.5 结论与修复

**019 的 `_is_token_fresh` 是一个官方实现里完全不存在的发明，
而它正是那个"连试都不试就跳过提醒"的开关。**

修复优先级：

1. 🔴 **直接删掉 `_is_token_fresh` 和 `send_to_user` 里的预判分支。**
   官方的策略是「有什么 token 就用什么，没有也发，失败了再按返回码处理」。
   019 的策略是「我猜它过期了所以我不发」——**这一条改动可能就把提醒修好了。**
2. token 存储改成跟官方一样：无 TTL、落盘、跨重启存活。
   （019 已经落盘了，只是多了个没必要的时间判断。）
3. 发送失败按返回码分流并记录，攒真实数据。
4. 多路冗余仍然要做（见 `00-decisions.md` D3）——但优先级排在上面三条之后了。

> 关于"不带 context_token 能不能发"：**官方客户端确实会这么发**（只 warn 不拦），
> 但服务端接不接受仍未验证。网上流传的"实测无效"已被证伪
> （那个日志里失败的是富文本降级重试，仍带着旧 token，tokenless 分支从未触发）。

---

## 4. 网络怪癖

### 4.1 iLink 必须直连 —— 但插件版会丢掉这个能力 ⚠️

019 用"三重保险"强制绕过代理（`ilink.py:40-43`）：pop 掉 4 个代理环境变量
+ `NO_PROXY="*"` + `ProxyHandler({})`。症状：走 Clash 会 TLS 中间层延迟、
二维码轮询超时。

**插件版的坑**：Obsidian 的 `requestUrl()` 底层是 Electron `net.request`，
官方文档明写它会"Automatic management of system proxy configuration" ——
**强制跟随系统代理，无法逐请求 opt-out**。唯一后门是
`session.defaultSession.setProxy()`，但那会影响**整个 Obsidian 的所有网络请求**。

**→ 这是选 Node `https` 而不是 `requestUrl` 的一个具体的、非风格性的理由。**
合规性没问题：官方规则只要求用了 Node API 就必须 `isDesktopOnly: true`
（那条"不要用 fetch，要用 requestUrl"出自自查清单的 **Mobile support** 节，
该节开头写明"Complete this section if you have `isDesktopOnly` set to false"）。

### 4.2 Windows SSL 误报 KeyboardInterrupt

`ilink.py:290-303` 的处理（连续 5 次才真退出）是 Python/Windows 特有 quirk，
**TS 版不会遇到，整段可以丢掉**。记在这里免得以后有人看到不明所以。

### 4.3 不要手设 `Content-Length` ✅

官方 CHANGELOG v2.4.2 记载：Node 24 内置的 undici 拒绝手工设置的
`Content-Length`，报 `UND_ERR_INVALID_ARG`，导致所有请求失败。

### 4.4 长轮询的正常超时不是错误

偶发 timeout = 正常心跳，别吓唬用户。019 的降噪阈值（连续 5 次才告警）保留这个心智。

> ⚠️ 019 注释说"协议本身每隔几秒就会 timeout 重连"——**这个说法可能是
> 把请求体里被忽略的 3000ms 当真了**。实际服务端 hold 多久未知。待实测。

---

## 5. 消息去重与冷启动

`seq`/`message_id` 进 Set，超 200 条 clear（`ilink.py:496-502`）。

⚠️ **插件版更要紧**：Obsidian 被杀掉重启后插件会完整重新 `onload`，
内存里的 `processed` set 全没了，而 cursor 是落盘的
→ **每次冷启动都可能重放一段消息**。cursor 落盘必须保留，
且去重要能跨重启（考虑把最近 N 个 seq 也落盘）。

---

## 6. 待验证清单

**P0 —— 决定架构，必须先测**

| # | 问题 | 为什么阻塞 |
|---|------|-----------|
| 1 | **离线消息缓冲窗口有多久？旧 cursor 能补拉多远？** 停 5min / 1h / 6h / 24h 后重连各能拉回多少 | 决定"Obsidian 关掉一天，开了能不能补收" —— 这是插件形态最大的软肋 |
| 2 | **真实推送窗口是多少？** 改成"到点就发、按返回码记录 token 年龄" | 决定提醒方案。⚠️ 别指望测出精确值 |
| 3 | **`requestUrl` 能不能挂住 35 秒？** 控制台跑 `await requestUrl({url:'https://httpbin.org/delay/35'})` 计时 | 如果不行就只能用 Node https（反正也倾向用它，见 4.1） |

**P1 —— 影响实现**

| # | 问题 |
|---|------|
| 4 | 服务端校不校验 `channel_version`？同账号分别用 `1.0.2` 和 `2.4.6` 打 `getupdates` 比对 |
| 5 | `ret=-2` 的准确语义 |
| 6 | "不带 context_token 发送"到底可不可用（见 3.4 第 3 条） |
| 7 | iLink 允不允许多客户端并发 `getupdates`？决定"Python 常驻 + 插件"能否并存过渡 |
| 8 | 限流阈值（官方承认未公开） |
| 9 | 019 那段 `cancel/canceled/cancelled` 分支到底对应什么 |

---

## 7. ⚠️ 两条不是技术问题的风险

**① 自建客户端处于条款灰区。**
《微信ClawBot功能使用条款》给腾讯单方面权利："有权决定支持本功能的微信软件客户端类型
以及可使用本功能的条件、范围等规则"。条款通篇假定的形态是「ClawBot 插件 + 第三方 AI 服务」，
**既未明文允许也未明文禁止绕开 OpenClaw 直连**。已有多个第三方项目公开这么做且未见被封报告，
但这不构成保证。
⚠️ 该条款全文只在社区镜像仓库读到，**没能定位腾讯自有域名上的原始 URL**——
在合规这种高后果场景下，社区仓库文本可被增删改，不宜当权威引用。
**建议在微信客户端内找到条款页核对。**

**② 没有发信人白名单，陌生人可直接触达 bot。** ✅
OpenClaw 的 pairing/allowlist 是**宿主功能，不是 iLink 协议层的**
（官方文档原文："Direct messages use the normal OpenClaw pairing and allowlist model
for channel plugins"）。自建客户端不会自动获得这层保护。
019 靠 `user_id != config.USER_ID` 挡了一下，插件版必须保留并做好。

---

## 附：原始实现位置

| 内容 | 位置 |
|------|------|
| **协议权威 spec** | `@tencent-weixin/openclaw-weixin@2.4.6` 的 `src/api/types.ts` |
| 官方长轮询实现 | 同上 `src/monitor/monitor.ts` |
| 官方 `-14` 处理 | 同上 `src/api/session-guard.ts` |
| 官方扫码状态机 | 同上 `src/auth/login-qr.ts` |
| 019 的全部协议调用 | `019Dairy/src/ilink.py`（607 行） |
