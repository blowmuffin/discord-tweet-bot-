/**
 * Tweet text formatter.
 *
 * Cleans up raw tweet text so Discord embeds look polished and human-like:
 *   - Expands t.co shortened URLs to their real destinations
 *   - Strips trailing media URLs (the image is already shown in the embed)
 *   - Converts @mentions to clickable Twitter profile links
 *   - Converts #hashtags to clickable Twitter search links
 *   - Truncates very long tweets with a "Read more" link
 *   - Normalizes excessive whitespace
 */

const MAX_DISPLAY_LENGTH = 300;

/**
 * Build a lookup map from t.co URLs → expanded URLs using the tweet's
 * `entities.urls` array returned by the Twitter API.
 */
function buildUrlMap(entities) {
  const map = {};
  if (entities && entities.urls) {
    for (const u of entities.urls) {
      if (u.url && u.expanded_url) {
        map[u.url] = u.display_url
          ? `[${u.display_url}](${u.expanded_url})`
          : u.expanded_url;
      }
    }
  }
  return map;
}

/**
 * Expand every t.co link in the text using the entity map.
 */
function expandUrls(text, entities) {
  const map = buildUrlMap(entities);
  for (const [shortUrl, replacement] of Object.entries(map)) {
    text = text.replaceAll(shortUrl, replacement);
  }
  return text;
}

/**
 * Remove trailing t.co URLs that point to media (photos / videos).
 * These are redundant because the media is attached to the embed.
 */
function stripTrailingMediaUrls(text, entities) {
  if (!entities || !entities.urls) return text;

  // Twitter appends a t.co link for every piece of attached media.
  // We strip any URL whose expanded form points to twitter media.
  const mediaUrls = entities.urls
    .filter(
      (u) =>
        u.expanded_url &&
        (u.expanded_url.includes('/photo/') ||
          u.expanded_url.includes('/video/') ||
          u.expanded_url.includes('pic.twitter.com')),
    )
    .map((u) => u.url);

  for (const url of mediaUrls) {
    text = text.replace(new RegExp(`\\s*${escapeRegex(url)}\\s*$`), '');
  }

  return text.trim();
}

/**
 * Convert raw @mentions to markdown links: @elonmusk → [@elonmusk](https://twitter.com/elonmusk)
 */
function linkifyMentions(text) {
  return text.replace(
    /@(\w{1,15})/g,
    '[@$1](https://twitter.com/$1)',
  );
}

/**
 * Convert raw #hashtags to search links: #AI → [#AI](https://twitter.com/hashtag/AI)
 */
function linkifyHashtags(text) {
  return text.replace(
    /#(\w+)/g,
    '[#$1](https://twitter.com/hashtag/$1)',
  );
}

/**
 * Normalize excessive whitespace (3+ newlines → 2, trim).
 */
function normalizeWhitespace(text) {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Truncate text that exceeds MAX_DISPLAY_LENGTH, appending a "Read more" link.
 */
function truncate(text, tweetUrl) {
  if (text.length <= MAX_DISPLAY_LENGTH) return text;
  const cut = text.slice(0, MAX_DISPLAY_LENGTH).replace(/\s+\S*$/, '');
  return `${cut}… [Read more](${tweetUrl})`;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Master formatter — chains all transformations in the correct order.
 *
 * @param {string}  rawText    The tweet's full text
 * @param {object}  entities   The tweet's `entities` object from the API
 * @param {string}  tweetUrl   Canonical URL of the tweet (for "Read more")
 * @returns {string}           Cleaned, Discord-ready markdown text
 */
function formatTweetText(rawText, entities, tweetUrl) {
  if (!rawText) return '';

  let text = rawText;
  text = expandUrls(text, entities);
  text = stripTrailingMediaUrls(text, entities);
  text = linkifyMentions(text);
  text = linkifyHashtags(text);
  text = normalizeWhitespace(text);
  text = truncate(text, tweetUrl);

  return text;
}

/**
 * Format large numbers into human-friendly short forms: 1234 → 1.2K
 */
function formatNumber(n) {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

module.exports = {
  formatTweetText,
  formatNumber,
  expandUrls,
  linkifyMentions,
  linkifyHashtags,
  normalizeWhitespace,
  truncate,
};
