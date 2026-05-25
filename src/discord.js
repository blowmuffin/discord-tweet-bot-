/**
 * Discord webhook module.
 *
 * Builds richly formatted embeds from tweet data and posts them to Discord
 * via webhook URLs. Handles:
 *   - Branded embed construction (colors, avatars, metrics)
 *   - Media attachment (images inline, video links)
 *   - Quote-tweet nested display
 *   - Thread detection labels
 *   - Human-like random intro messages
 *   - Random posting delays to feel organic
 *   - Rate-limit (429) retry with exponential backoff
 *   - Error/log posting to a separate channel
 *   - Daily digest summary
 */

const axios = require('axios');
const { formatTweetText, formatNumber } = require('./formatter');
const { INTRO_MESSAGES } = require('../config/accounts');

const TWITTER_ICON =
  'https://abs.twimg.com/responsive-web/client-web/icon-ios.77d25eba.png';

// ──────────────────────────────────────────────
//  Embed builder
// ──────────────────────────────────────────────

/**
 * Build a Discord embed object for a single tweet.
 *
 * @param {object} tweet        Tweet object from the API
 * @param {object} user         Author user object
 * @param {object} accountCfg   Per-account config
 * @param {object} [opts]       Extra options (mediaMap, quotedTweet, isThread, threadPart)
 * @returns {object}            Discord embed object
 */
function buildEmbed(tweet, user, accountCfg, opts = {}) {
  const { mediaMap = {}, quotedTweet, quotedUser, isThread, threadPart } = opts;

  const tweetUrl = `https://twitter.com/${user.username}/status/${tweet.id}`;
  const avatarUrl =
    user.profile_image_url?.replace('_normal', '_200x200') ||
    TWITTER_ICON;

  // Clean up the tweet text
  const description = formatTweetText(
    tweet.text,
    tweet.entities,
    tweetUrl,
  );

  // Build engagement metrics line
  const metrics = tweet.public_metrics || {};
  const metricsLine = [
    `❤️ ${formatNumber(metrics.like_count)}`,
    `🔁 ${formatNumber(metrics.retweet_count)}`,
    `💬 ${formatNumber(metrics.reply_count)}`,
    metrics.impression_count != null
      ? `👁️ ${formatNumber(metrics.impression_count)}`
      : null,
  ]
    .filter(Boolean)
    .join('   ');

  // Base embed
  const embed = {
    author: {
      name: `${user.name} (@${user.username})`,
      url: `https://twitter.com/${user.username}`,
      icon_url: avatarUrl,
    },
    description,
    color: accountCfg.embedColor || 0x1da1f2,
    url: tweetUrl,
    timestamp: tweet.created_at || new Date().toISOString(),
    footer: {
      text: `𝕏 Twitter / X  •  ${accountCfg.label || '🐦 Twitter'}`,
      icon_url: TWITTER_ICON,
    },
    fields: [],
  };

  // Engagement metrics as a field
  if (metricsLine) {
    embed.fields.push({ name: '\u200b', value: metricsLine, inline: false });
  }

  // Thread indicator
  if (isThread && threadPart) {
    embed.fields.unshift({
      name: '🧵 Thread',
      value: `Part ${threadPart} of a thread by @${user.username}`,
      inline: false,
    });
  }

  // Quoted tweet (nested display)
  if (quotedTweet) {
    const qtUser = quotedUser || { name: 'Unknown', username: 'unknown' };
    const qtUrl = `https://twitter.com/${qtUser.username}/status/${quotedTweet.id}`;
    const qtText = formatTweetText(quotedTweet.text, quotedTweet.entities, qtUrl);
    embed.fields.push({
      name: `💬 Quoting @${qtUser.username}`,
      value: qtText.slice(0, 1024) || '*[media]*',
      inline: false,
    });
  }

  // Attach first image if available
  const mediaKeys = tweet.attachments?.media_keys || [];
  for (const key of mediaKeys) {
    const media = mediaMap[key];
    if (!media) continue;

    if (media.type === 'photo' && media.url) {
      embed.image = { url: media.url };
      break; // only show the first image in the main embed
    }
    if ((media.type === 'video' || media.type === 'animated_gif') && media.preview_image_url) {
      embed.image = { url: media.preview_image_url };
      // Add a note that it's a video
      embed.fields.push({
        name: '🎥 Video',
        value: `[Watch on Twitter](${tweetUrl})`,
        inline: true,
      });
      break;
    }
  }

  return embed;
}

// ──────────────────────────────────────────────
//  Posting
// ──────────────────────────────────────────────

/**
 * Pick a random human-sounding intro message.
 */
function pickIntro(handle) {
  const template =
    INTRO_MESSAGES[Math.floor(Math.random() * INTRO_MESSAGES.length)];
  return template.replace('{handle}', handle);
}

/**
 * Post an embed to a Discord webhook with a random intro.
 *
 * @param {string} webhookUrl   Discord webhook URL
 * @param {object} embed        Discord embed object
 * @param {string} handle       Twitter @handle for the intro message
 */
async function postToDiscord(webhookUrl, embed, handle) {
  if (!webhookUrl) {
    throw new Error(
      `No Discord webhook URL configured for @${handle}. ` +
        'Set DISCORD_WEBHOOK_URL in your environment.',
    );
  }

  const content = pickIntro(handle);

  await axiosWithRetry(() =>
    axios.post(webhookUrl, {
      content,
      embeds: [embed],
    }),
  );

  console.log(`[discord] Posted tweet to Discord for @${handle}`);
}

/**
 * Post a plain-text or embed message to the error/log webhook.
 */
async function postLogMessage(message) {
  const webhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL;
  if (!webhookUrl) {
    // No error webhook configured — just log to console
    console.log(`[log] ${message}`);
    return;
  }

  try {
    await axios.post(webhookUrl, { content: message });
  } catch {
    console.error('[discord] Failed to post log message to error webhook.');
  }
}

/**
 * Post the daily digest summary to the digest webhook.
 *
 * @param {object} stats  { username: count, ... }
 */
async function postDailyDigest(stats) {
  const webhookUrl =
    process.env.DISCORD_DIGEST_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const today = new Date().toISOString().slice(0, 10);
  const entries = Object.entries(stats);
  if (entries.length === 0) return;

  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  const lines = entries.map(
    ([user, count]) => `@${user}  →  **${count}** tweet${count === 1 ? '' : 's'}`,
  );

  const digestText = [
    `📊 **Daily Tweet Digest — ${today}**`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ...lines,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `Total: **${total}** tweet${total === 1 ? '' : 's'} forwarded today`,
  ].join('\n');

  try {
    await axios.post(webhookUrl, { content: digestText });
    console.log('[discord] Daily digest posted.');
  } catch (err) {
    console.error('[discord] Failed to post daily digest:', err.message);
  }
}

// ──────────────────────────────────────────────
//  Retry helper (handles Discord 429s)
// ──────────────────────────────────────────────

/**
 * Execute an axios call with exponential backoff on 429 responses.
 */
async function axiosWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < maxRetries) {
        const retryAfter =
          (err.response?.headers?.['retry-after'] || 5) * 1000;
        const backoff = retryAfter * (attempt + 1);
        console.warn(
          `[discord] Rate limited (429). Retrying in ${Math.ceil(backoff / 1000)}s…`,
        );
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  buildEmbed,
  postToDiscord,
  postLogMessage,
  postDailyDigest,
  pickIntro,
};
