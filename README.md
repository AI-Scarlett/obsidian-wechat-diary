# WeChat Diary · 微信随手记

**Send anything to WeChat — it lands in your Obsidian vault as daily Markdown notes.**

WeChat is the highest-frequency input box in a Chinese-speaking user's day. This plugin turns it into a zero-friction capture pipeline: scan a QR code once to bind a WeChat bot, then send text, voice, or photos to it from your phone anytime. While Obsidian is open on your desktop, every message is appended to `Diary/YYYY/YYYY-MM-DD.md` in your vault — plain Markdown, entirely on your machine.

This is the Obsidian-plugin form of [wechat-diary](https://github.com/ArtemisLin/wechat-diary) (Python). Both implementations write byte-identical files under the same [data contract](docs/data-contract.md), so you can switch between them at any time.

## Features

- **Zero ceremony**: everything you send is recorded — no mode to enter, no magic words. Commands: 「撤回」 undo last entry, 「结束」 optional sealing footnote, 「帮助」 help. Greetings like 「在吗」 get a status reply instead of being recorded.
- **Voice friendly**: WeChat transcribes voice messages for you; they arrive as text with a 🎤 mark.
- **Photos**: send a picture and it is decrypted from WeChat's CDN, saved into `Diary/attachments/YYYY/`, and embedded in the day's note. 「撤回」 undoes a photo too.
- **No AI involved**: raw text is stored exactly as you sent it — a purely mechanical, predictable pipeline. (AI settings are kept for a future opt-in feature but are currently inactive.)
- **Data sovereignty**: notes are plain Markdown in your vault. No cloud service of ours, no account with us, no telemetry.
- **Append-only and atomic**: history paragraphs are never rewritten; frontmatter is stable; the format is a documented contract any agent can read.

## Setup

1. Install and enable the plugin (desktop only).
2. Open plugin settings → **扫码绑定** → scan the QR code with WeChat on your phone and confirm.
3. Pick the diary folder (default `日记`). Done — send the bot a message.

## Honest limitations

- **Desktop only, and the pipeline runs only while Obsidian is running.** Messages sent while your computer is off or asleep are fetched later via the server-side cursor when Obsidian comes back — offline gaps of up to 24 hours have been verified to backfill; longer gaps are untested.
- Voice messages rely on WeChat's own transcription; when transcription fails the bot asks you to repeat.
- Scheduled reminders from the Python version are not in this release yet.

## Network use disclosure

This plugin talks to exactly two kinds of remote services:

1. **Tencent iLink bot API** (`ilinkai.weixin.qq.com`, plus the base URL that service assigns after login; QR pages are served from Tencent domains). This is the official WeChat bot channel — the plugin logs in by QR scan, long-polls for the messages you send to your bot, and sends replies back. Your messages necessarily transit WeChat/Tencent infrastructure, exactly as any WeChat message does. Connections to this API are made directly (bypassing system proxy) because the endpoint rejects proxied TLS in practice.
2. **An OpenAI-compatible LLM endpoint that you configure yourself** — currently inactive: the present version never sends LLM traffic, even if configured. The settings exist for a future opt-in feature.

No other network requests are made. There is no telemetry, no analytics, and no server operated by the plugin author. A WeChat account is required (that's the point of the plugin). The bot binding token and your AI key are stored in Obsidian's SecretStorage — outside the vault folder, so sync tools never pick them up; sync progress and non-secret state live in the plugin's `data.json`.

## Data format

```
Diary/
├── 2026/
│   └── 2026-08-12.md
└── attachments/
    └── 2026/
        └── 2026-08-12-2305-a3f1.jpg
```

```markdown
---
date: 2026-08-12
weekday: 周三
source: wechat-diary
---

# 2026-08-12

**23:05**

今天试了新的手冲豆子, 花香很明显。

![[Diary/attachments/2026/2026-08-12-2305-a3f1.jpg]]
```

Full rules in [docs/data-contract.md](docs/data-contract.md): append-only, Beijing-time dates (timezone configurable), one `\n\n`-separated block per message, sealing footnote on 「结束」.

---

## 中文说明

对着微信说话, 日记自动落进你自己电脑的 Obsidian 库。

- 设置里扫码绑定一次, 之后手机上任何时刻发文字/语音/图片给 bot, Obsidian 开着就会写进 `日记/YYYY/YYYY-MM-DD.md`。
- **发什么记什么, 不用任何开场白**——不用再说「开始记日记」了。「撤回」删掉最后一条, 「结束」是可选的收尾仪式(不发也没关系, 跨天自动收尾), 「帮助」看全部命令。「在吗」这类打招呼会得到状态回复, 不会被记进笔记。
- 发图: 图片存进 `日记/attachments/YYYY/`, 笔记里插 `![[...]]`;「撤回」同样撤得掉(只删引用, 图片文件保留)。
- **纯机械记录, 不经过任何 AI**——原文直存, 一个字不改。(设置里的 AI 配置暂未启用, 为将来的可选功能保留。)
- 数据只在你机器上: 凭据存 Obsidian 密钥存储, 不进 vault、不被同步盘带走; 无遥测、无作者服务器。
- 与 Python 版 [wechat-diary](https://github.com/ArtemisLin/wechat-diary) 产出的文件逐字节一致, 两边随时互迁。

**诚实的限制**: 仅桌面端; Obsidian 关着时管道即停, 重开后按服务端游标补拉离线期间的消息(24 小时内已实测可补收, 更长未测)。

## License

[MIT](LICENSE)
