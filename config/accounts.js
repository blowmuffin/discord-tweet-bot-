/**
 * Per-account configuration for tracked Twitter/X accounts.
 *
 * Two-channel setup:
 *   - YOUR tweets   → DISCORD_WEBHOOK_MY_TWEETS  (e.g. #my-tweets channel)
 *   - OTHER tweets  → DISCORD_WEBHOOK_OTHERS     (e.g. #twitter-feed channel)
 *
 * The bot checks MY_TWITTER_USERNAME to decide which webhook to use.
 * If neither per-channel webhook is set, it falls back to DISCORD_WEBHOOK_URL.
 */

// Brand colors keyed by lowercase username for easy lookup
const ACCOUNT_COLORS = {
  anthropicai: 0xcc785c, // Anthropic brand orange
  openai: 0x10a37f, // OpenAI green
  sama: 0x1da1f2, // Twitter blue (default)
};

// Rotating intro messages — {handle} is replaced at runtime
const INTRO_MESSAGES = [
  '📌 New from **@{handle}**',
  '🔔 **@{handle}** just posted',
  '💬 Fresh tweet from **@{handle}**',
  '📣 **@{handle}** says:',
  '👀 Spotted from **@{handle}**',
];

/**
 * Determine the correct webhook URL for a given username.
 *
 * - If the username matches MY_TWITTER_USERNAME → use the "my tweets" webhook
 * - Otherwise → use the "others" webhook
 * - Falls back to the shared DISCORD_WEBHOOK_URL if neither is set
 */
function getWebhookForUser(username) {
  const myHandle = (process.env.MY_TWITTER_USERNAME || '').trim().toLowerCase();
  const isMe = myHandle && username.toLowerCase() === myHandle;

  if (isMe) {
    return (
      process.env.DISCORD_WEBHOOK_MY_TWEETS ||
      process.env.DISCORD_WEBHOOK_URL
    );
  }

  return (
    process.env.DISCORD_WEBHOOK_OTHERS ||
    process.env.DISCORD_WEBHOOK_URL
  );
}

/**
 * Pre-configured accounts with custom settings.
 * Add entries here to give specific accounts custom colors, filters, etc.
 */
const KNOWN_ACCOUNTS = {
  anthropicai: {
    embedColor: 0xcc785c,
    includeRetweets: false,
    includeReplies: false,
    keywords: null,
    label: '🤖 AI News',
  },
  openai: {
    embedColor: 0x10a37f,
    includeRetweets: false,
    includeReplies: false,
    keywords: null,
    label: '🤖 AI News',
  },
  sama: {
    embedColor: 0x1da1f2,
    includeRetweets: false,
    includeReplies: true,
    keywords: ['AI', 'AGI', 'OpenAI'],
    label: '👤 Founder Thoughts',
  },
};

/**
 * Returns the active account list.
 *
 * If the `TWITTER_ACCOUNTS` env var is set (comma-separated usernames), only
 * those accounts are returned. Each account gets the correct webhook based on
 * whether it's "you" or "someone else."
 */
function getActiveAccounts() {
  const envAccounts = process.env.TWITTER_ACCOUNTS;
  if (!envAccounts) return [];

  const requested = envAccounts
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const myHandle = (process.env.MY_TWITTER_USERNAME || '').trim().toLowerCase();

  return requested.map((username) => {
    const key = username.toLowerCase();
    const known = KNOWN_ACCOUNTS[key] || {};
    const isMe = myHandle && key === myHandle;

    return {
      username,
      webhookUrl: getWebhookForUser(username),
      embedColor: known.embedColor || (isMe ? 0x9b59b6 : 0x1da1f2), // purple for you, blue for others
      includeRetweets: known.includeRetweets ?? (process.env.INCLUDE_RETWEETS === 'true'),
      includeReplies: known.includeReplies ?? (process.env.INCLUDE_REPLIES === 'true'),
      keywords: known.keywords || null,
      label: isMe ? '📣 My Tweets' : (known.label || '🐦 Twitter'),
    };
  });
}

module.exports = {
  ACCOUNT_COLORS,
  INTRO_MESSAGES,
  getActiveAccounts,
  getWebhookForUser,
};

