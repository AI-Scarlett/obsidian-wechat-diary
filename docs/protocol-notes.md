# iLink 协议笔记

> **这份文档比代码值钱。**
>
> iLink（`ilinkai.weixin.qq.com`）没有公开的开发者文档，下面所有内容都是
> wechat-diary (Python 版) 逆向 + 实测得出的。重写成 TypeScript 时如果丢了这些，
> 就得从头再逆向一遍。
>
> 来源：`019Dairy/src/ilink.py`（逐行提炼，标注了原始行号）
> 提炼日期：2026-08-05 · 对应 Python 版最后提交 `8febfd1`

---

## 0. 一句话

iLink 是微信侧的 bot 接入通道：扫码换 `bot_token` → 长轮询收消息 → 带
`context_token` 回消息。**没有 webhook，没有服务器要求，纯客户端主动拉取** ——
这正是它能做"纯本地部署"的原因。

---

## 1. 基础

```
BASE_URL = https://ilinkai.weixin.qq.com          (ilink.py:35)
base_info = { "channel_version": "1.0.2" }        (ilink.py:55, 可用 env 覆盖)
```

`base_info` 几乎每个 POST 请求都要带。`channel_version` 的作用未知——不确定
服务端是否校验、不同值有什么区别。**这是待验证项之一。**

### 认证 header（拿到 bot_token 之后所有请求）

```
Content-Type:       application/json
AuthorizationType:  ilink_bot_token
Authorization:      Bearer {bot_token}
X-WECHAT-UIN:       {base64(随机整数 0..0xFFFFFFFF)}
```
（`ilink.py:130-136`）

⚠️ `X-WECHAT-UIN` **每个请求都重新随机生成**（`_random_uin()`, `ilink.py:126`），
服务端照收不误。说明它不参与身份校验，可能只是个埋点字段。重写时照抄即可，
不要试图让它稳定。

---

## 2. 四个端点

### 2.1 取登录二维码

```
GET /ilink/bot/get_bot_qrcode?bot_type=3
无需认证 header
```

返回：
```json
{
  "qrcode": "<token字符串, 用于后续轮询状态>",
  "qrcode_img_content": "<二维码图片的 URL>"
}
```

❓ `bot_type=3` 的含义未知，1 和 2 是什么没试过。

### 2.2 轮询扫码状态

```
GET /ilink/bot/get_qrcode_status?qrcode={上一步的 qrcode}
header: iLink-App-ClientVersion: 1        ← 注意是这个，不是 bot_token 那套
HTTP timeout 35s，每秒轮一次，总共等 300s
```

返回 `status` 字段。**代码里明确处理的取值**（`ilink.py:330-355`）：

| status | 含义 | 处理 |
|--------|------|------|
| `confirmed` | 用户在微信里点了确认 | 保存 state，登录成功 |
| `expired` | 二维码过期 | 要求重新扫码 |
| `cancel` / `canceled` / `cancelled` | 用户取消 | 退出（三种拼写都兼容，说明实测见过不止一种） |
| 其他 | 等待中 | 继续轮询 |

❓ "等待中"的具体字符串是什么，代码没记录（只是打印出来）。重写时建议把所有
见过的 status 值记下来补进这张表。

`confirmed` 时返回：
```json
{
  "status": "confirmed",
  "bot_token": "...",
  "ilink_bot_id": "...",
  "ilink_user_id": "..."     ← 这就是用户身份，Python 版让用户手动抄进 .env（应该自动回填）
}
```

### 2.3 收消息（长轮询）

```
POST /ilink/bot/getupdates
认证 header
body: {
  "get_updates_buf": "<cursor, 首次为空字符串>",
  "base_info": { "channel_version": "1.0.2" },
  "longpolling_timeout_ms": 3000
}
HTTP 层 timeout: 35s
```

返回：
```json
{
  "get_updates_buf": "<新 cursor, 变了就要持久化>",
  "msgs": [ ... ]
}
```

**cursor 机制是离线补拉的关键**（`ilink.py:488-493`）：把 `get_updates_buf`
存盘，重启后带上它，服务端会把离线期间的消息补给你。

⚠️ **服务端缓冲窗口有多久是未知的。** Python 版 README 只敢写"短时离线已实测可补收，
长时间离线的缓冲窗口未知"。这直接决定「用户白天不开 Obsidian，晚上开了能不能补收今天的消息」
—— **对插件形态是关键问题，必须实测。**

注意 `longpolling_timeout_ms: 3000` 但 HTTP timeout 给了 35s。也就是说服务端
最多 hang 3 秒就返回。**这个数字对 Obsidian 插件很重要**：如果 `requestUrl()`
有超时上限，3 秒的长轮询比 30 秒的容易活下来。（Python 版用 35s 的 HTTP timeout
是留余量，不是长轮询真的会 hang 那么久。）

### 2.4 发消息

```
POST /ilink/bot/sendmessage
认证 header
body: {
  "msg": {
    "from_user_id": "",                          ← 固定空串
    "to_user_id": "<对方 user_id>",
    "client_id": "diary:{毫秒时间戳}-{8位随机hex}",  ← 幂等/去重用，自己生成
    "message_type": 2,
    "message_state": 2,
    "context_token": "<从收到的消息里取, 见下>",
    "item_list": [ { "type": 1, "text_item": { "text": "回复内容" } } ]
  },
  "base_info": { "channel_version": "1.0.2" }
}
```
（`ilink.py:376-401`）

❓ `message_type: 2` / `message_state: 2` 的含义未知，照抄。

---

## 3. 消息结构（收到的）

```json
{
  "seq": "...",              // 或 "message_id"，两个字段名都见过，用来去重
  "from_user_id": "...",
  "context_token": "...",    // ← 关键，见第 4 节
  "item_list": [
    { "type": 1, "text_item":  { "text": "文字内容" } },
    { "type": 3, "voice_item": { "text": "语音的转写文本" } }
  ]
}
```

**已知的 item type**：

| type | 含义 | 备注 |
|------|------|------|
| 1 | 文本 | |
| 3 | 语音 | `voice_item.text` 是**微信自己转写好的文字**，不需要你做 ASR。转写失败时 text 为空，要提示用户改发文字 |

❓ 图片、文件、视频是 type 几，没试过。Python 版直接忽略未知 type。

⚠️ 一条消息的 `item_list` 可能有多项，Python 版是**逐项独立处理并各回一条**
（`ilink.py:512`）。这个行为对不对没验证过。

---

## 4. context_token —— 主动推送的命脉

**这是整个协议里最需要理解的机制。**

- `context_token` 只能从**用户发来的消息**里拿到（`ilink.py:505`）
- 想主动给用户发消息（比如晚上的日记提醒），必须带一个**还有效的** `context_token`
- Python 版的做法：每收到一条消息就把 `context_token` 连同时间戳缓存进 state
  （`ilink.py:506-510`），发提醒时取出来用

**新鲜度判断**（`ilink.py:404-412`）：
```python
def _is_token_fresh(info, max_hours=20):   # ← 20 是作者设的阈值
```

⚠️ **这个 20 小时是 Python 版作者自己设的保守值，不确定是不是官方规则。**
README 里写成了"iLink 限制 bot 超过约 20 小时无互动就不能主动发消息（平台反骚扰规则）"，
但代码里没有任何官方文档依据。**这一条正在调研核实中，结论出来要回填到这里。**

### 💀 由此推出的核心缺陷（已确认）

```
昨晚 22:05 用户回复了提醒     ← token 从这一刻开始计时
今晚 22:00 定时提醒触发       ← 距上次互动 23.9 小时 > 20 小时
                             → token 已判定为不新鲜，提醒直接跳过
```

**每天固定同一时钟时间提醒，间隔天然接近 24 小时，必然掉出窗口。**
越规律越发不出去。这就是"装了但用不起来"的技术根因。

**修复方向**：按「距上次互动的时长」触发，而不是按时钟时间。例如上次互动
+18 小时就推，卡在窗口关闭前。时间会逐日前漂，但至少发得出去。
（真正的解法还需要多路冗余，见 `00-decisions.md` D3。）

---

## 5. 错误码

响应里的错误码字段可能叫 `ret`，也可能叫 `errcode`（`ilink.py:155-157`，两个都要读）。
非 0 即错误，`errmsg` 是描述。

| 码 | 含义 | 处理 |
|----|------|------|
| `-14` | session 过期 | 必须重新扫码登录。Python 版返回 exit code 2，由 start.bat 清 state 后重新走登录流程 |
| 其他 | 未知 | 只有 -14 是确认过的，**其他错误码全是未知领域** |

重写时建议：把所有遇到的非 0 码连同 `errmsg` 记进日志，慢慢补全这张表。

---

## 6. 网络怪癖（踩过的坑）

### 6.1 iLink API 必须直连，不能走代理

Python 版用了"三重保险"强制绕过代理（`ilink.py:40-43`）：
```python
for _proxy_env in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    os.environ.pop(_proxy_env, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"
```
症状：走 Clash 会出现 TLS 中间层延迟、二维码状态轮询超时。
注意 Clash 的 **TUN 模式是 OS 层劫持，代码层面绕不过去**，只能让用户加直连规则。

> 插件版备注：`requestUrl()` 是 Obsidian 自己实现的 HTTP 客户端，是否受系统代理
> 影响、能不能绕过，**待调研确认**。如果 Obsidian 走 Electron 的网络栈，行为可能
> 和 Python 的 urllib 完全不同。

### 6.2 Windows 上 SSL 中断被误报成 KeyboardInterrupt

`ilink.py:290-303`：扫码轮询时，SSL recv 被 OS 网络栈打断，Python 在 Windows 下
会误抛 `KeyboardInterrupt`（用户根本没按 Ctrl+C）。Python 版的处理是：当超时看待，
等 1 秒重试，**连续 5 次**才真的退出。

> 插件版备注：这是 Python/Windows 特有的 quirk，**TypeScript 版不会遇到**，
> 这段逻辑可以整个丢掉。记在这里是为了防止以后有人看到 Python 版这段代码不明所以。

### 6.3 长轮询的正常超时不是错误

长轮询协议下，服务端 hang 到 `longpolling_timeout_ms` 没消息就返回，客户端看起来
像"超时"。Python 版设了降噪阈值：连续 5 次才告警，之后每 30 次提示一次
（`ilink.py:52-53, 457-475`）。

**重写时务必保留这个心智**：偶发超时 = 正常心跳，不要吓唬用户。

---

## 7. 消息去重

`seq`（或 `message_id`）进一个 Set，重复的跳过（`ilink.py:496-502`）。
Set 超过 200 条就整个 clear。

> ⚠️ 小瑕疵：clear 的时候会把刚 add 进去的那条也清掉。实际影响极小，但重写时
> 可以顺手改成保留最近 N 条（比如用数组做滑动窗口）。

---

## 8. 待验证清单（重写时要逐个实测）

这些是公开资料查不到、只能靠实测的。按重要性排序：

| # | 问题 | 为什么重要 |
|---|------|-----------|
| 1 | **cursor 的离线消息缓冲窗口有多久？** | 决定"用户白天不开 Obsidian，晚上开了能不能补收" |
| 2 | **20 小时限制是官方规则还是作者猜的？确切数字是多少？** | 决定提醒机制怎么设计 |
| 3 | `requestUrl()` 能不能撑住长轮询？有没有超时上限？ | 决定插件形态**是否可行** |
| 4 | `requestUrl()` 受不受系统代理影响？ | 国内用户大多开着代理 |
| 5 | 普通用户能不能自己扫码创建 bot？要不要审批？ | 决定 B 类用户能不能用 |
| 6 | 图片 / 文件的 item type 是几？ | 未来功能 |
| 7 | `channel_version` 服务端校不校验？现在最新是多少？ | 会不会哪天被强制升级打死 |
| 8 | 完整的错误码表 | 错误处理质量 |
| 9 | 扫码等待中的 status 字符串是什么 | 登录 UX |

---

## 附：Python 版原始实现的位置

| 内容 | 文件:行 |
|------|--------|
| 全部协议调用 | `019Dairy/src/ilink.py` |
| 登录流程 | `ilink.py:255-373` |
| 长轮询主循环 | `ilink.py:425-547` |
| 发消息 | `ilink.py:376-401` |
| 主动推送 + token 新鲜度 | `ilink.py:404-422` |
| 探活（快速版长轮询，timeout 100ms） | `ilink.py:230-252` |
