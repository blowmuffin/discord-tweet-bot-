# 🐦 Twitter → Discord Bot

Automatically forwards tweets from tracked Twitter/X accounts to your Discord server via webhooks. Runs **free** on GitHub Actions — no server required.

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-blue)
![Cost](https://img.shields.io/badge/Cost-%240%2Fmonth-brightgreen)

---

## ✨ Features

- 📡 **Multi-account tracking** — follow up to 3+ Twitter accounts simultaneously
- 🎨 **Rich Discord embeds** — branded colors, profile avatars, engagement metrics
- 🧵 **Thread detection** — labels tweets that are part of a thread
- 💬 **Quote tweet support** — shows both the comment and quoted tweet
- 🔍 **Keyword filtering** — only forward tweets containing specific words (per account)
- 🤖 **Human-like behavior** — random delays and rotating intro messages
- 📊 **Daily digest** — summary of all tweets forwarded that day
- 🔁 **Duplicate prevention** — rolling log of posted IDs prevents double-posts
- ❌ **Error logging** — errors posted to a separate Discord channel
- ⚡ **Zero cost** — runs on GitHub Actions free tier (~1,440 min/month of 2,000)

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/your-username/twitter-discord-bot.git
cd twitter-discord-bot
npm install
```

### 2. Get Credentials

| Credential | Where to get it |
|---|---|
| **Twitter Bearer Token** | [developer.twitter.com](https://developer.twitter.com) → Create Project → Create App → Bearer Token |
| **Discord Webhook URL** | Discord Server → Channel Settings → Integrations → Webhooks → New Webhook → Copy URL |

### 3. Configure Locally

```bash
cp .env.example .env
# Edit .env with your tokens
```

### 4. Test Locally

```bash
npm start
```

The first run is **silent** — it records the latest tweet IDs without posting, to avoid spamming old tweets. Run a second time to see new tweets get posted.

### 5. Deploy to GitHub Actions

1. Push the repo to GitHub
2. Go to **Settings → Secrets → Actions** and add:
   - `TWITTER_BEARER_TOKEN`
   - `DISCORD_WEBHOOK_URL`
   - `TWITTER_ACCOUNTS` (e.g. `AnthropicAI,OpenAI,sama`)
3. The bot will automatically run every 10 minutes

You can also trigger a run manually: **Actions → Tweet Poller → Run workflow**

---

## ⚙️ Configuration

### Per-Account Settings

Edit [`config/accounts.js`](config/accounts.js) to customize each account:

```javascript
{
  username: 'AnthropicAI',
  embedColor: 0xCC785C,           // Embed sidebar color
  includeRetweets: false,
  includeReplies: false,
  keywords: null,                  // null = post everything
  label: '🤖 AI News',            // Shown in embed footer
  webhookUrl: process.env.DISCORD_WEBHOOK_URL,
}
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TWITTER_BEARER_TOKEN` | ✅ | Twitter API v2 Bearer Token |
| `DISCORD_WEBHOOK_URL` | ✅ | Default Discord webhook URL |
| `TWITTER_ACCOUNTS` | ❌ | Comma-separated usernames (overrides config file) |
| `DISCORD_ERROR_WEBHOOK_URL` | ❌ | Webhook for `#bot-logs` error channel |
| `DISCORD_DIGEST_WEBHOOK_URL` | ❌ | Webhook for `#tweet-digest` channel |
| `DISCORD_WEBHOOK_ANTHROPIC` | ❌ | Per-account webhook override |
| `INCLUDE_RETWEETS` | ❌ | `true` / `false` (default: `false`) |
| `INCLUDE_REPLIES` | ❌ | `true` / `false` (default: `false`) |

---

## 📡 Discord Channel Setup

Recommended channel structure:

```
📡 twitter-feed    ← All tweets (read-only for members, webhook posts only)
📊 tweet-digest    ← Daily summary
🔧 bot-logs        ← Errors (private, mods only)
```

**Permissions for `#twitter-feed`:**
- `@everyone` → View Channel ✅, Send Messages ❌
- Only the webhook can post — keeps the channel clean

---

## 🧪 Testing Checklist

- [ ] `npm start` works locally with `.env`
- [ ] First run is silent (no old tweets posted)
- [ ] Second run posts only new tweets
- [ ] `state.json` is created and updated
- [ ] Embeds look correct (colors, avatar, metrics)
- [ ] Manual trigger works on GitHub Actions

---

## 📁 Project Structure

```
├── .github/workflows/poll.yml   ← GitHub Actions cron schedule
├── src/
│   ├── index.js                 ← Main entry point / orchestrator
│   ├── twitter.js               ← Twitter API v2 client & helpers
│   ├── discord.js               ← Embed builder & webhook posting
│   ├── formatter.js             ← Tweet text cleaning & formatting
│   └── state.js                 ← State persistence (state.json I/O)
├── config/accounts.js           ← Per-account configuration
├── state.json                   ← Auto-managed tweet tracking state
├── .env.example                 ← Environment variable template
└── package.json
```

---

## 📄 License

MIT — free to use and modify.

*Built for YouTube Discord community servers.*
# discord-tweet-bot-
