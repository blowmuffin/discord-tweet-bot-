/**
 * Twitter API v2 module.
 *
 * Handles all communication with the Twitter/X API:
 *   - Authenticated read-only client via Bearer Token
 *   - Fetch user profile info (name, avatar, handle)
 *   - Fetch recent tweets since a given tweet ID
 *   - Graceful rate-limit handling with retry
 *   - Filtering of retweets / replies per account config
 */

const { TwitterApi } = require('twitter-api-v2');

// Fields we request from the API
const TWEET_FIELDS = [
  'created_at',
  'public_metrics',
  'entities',
  'attachments',
  'referenced_tweets',
  'conversation_id',
  'in_reply_to_user_id',
  'author_id',
];

const USER_FIELDS = [
  'profile_image_url',
  'name',
  'username',
  'verified',
  'description',
];

const MEDIA_FIELDS = [
  'url',
  'preview_image_url',
  'type',
  'width',
  'height',
  'alt_text',
];

const EXPANSIONS = [
  'attachments.media_keys',
  'referenced_tweets.id',
  'referenced_tweets.id.author_id',
  'author_id',
];

let _client = null;

/**
 * Lazily initialise and return the read-only Twitter client.
 */
function getClient() {
  if (!_client) {
    const bearer = process.env.TWITTER_BEARER_TOKEN;
    if (!bearer) {
      throw new Error(
        'TWITTER_BEARER_TOKEN is not set. Add it to .env or GitHub Secrets.',
      );
    }
    _client = new TwitterApi(bearer).readOnly;
  }
  return _client;
}

/**
 * Fetch a user's profile by username.
 *
 * @param {string} username  Twitter handle (without @)
 * @returns {{ id, name, username, profile_image_url, verified, description }}
 */
async function fetchUserProfile(username) {
  const client = getClient();
  const { data } = await client.v2.userByUsername(username, {
    'user.fields': USER_FIELDS.join(','),
  });
  if (!data) throw new Error(`User @${username} not found.`);

  // Twitter returns a 48×48 avatar by default — upgrade to 200×200
  if (data.profile_image_url) {
    data.profile_image_url = data.profile_image_url.replace('_normal', '_200x200');
  }

  return data;
}

/**
 * Fetch recent tweets for a user.
 *
 * @param {string}      userId       Twitter user ID
 * @param {string|null} sinceId      Only return tweets newer than this ID (or null for first run)
 * @param {object}      accountCfg   Per-account config from config/accounts.js
 * @returns {{ tweets: Array, includes: object, newestId: string|null }}
 */
async function fetchNewTweets(userId, sinceId, accountCfg = {}) {
  const client = getClient();

  const params = {
    'tweet.fields': TWEET_FIELDS.join(','),
    'user.fields': USER_FIELDS.join(','),
    'media.fields': MEDIA_FIELDS.join(','),
    expansions: EXPANSIONS.join(','),
    max_results: 10, // Twitter API v2 minimum is 5, max is 100
  };

  if (sinceId) {
    params.since_id = sinceId;
  }

  // Exclude retweets and replies unless the account config says otherwise
  const excludes = [];
  if (!accountCfg.includeRetweets) excludes.push('retweets');
  if (!accountCfg.includeReplies) excludes.push('replies');
  if (excludes.length) params.exclude = excludes.join(',');

  const response = await client.v2.userTimeline(userId, params);

  const tweets = response.data?.data || [];
  const includes = response.data?.includes || {};

  // Determine the newest tweet ID in this batch
  let newestId = null;
  if (tweets.length > 0) {
    newestId = tweets[0].id; // Twitter returns newest first
  }

  return { tweets, includes, newestId };
}

/**
 * Extract media objects from tweet includes keyed by media_key.
 */
function buildMediaMap(includes) {
  const map = {};
  if (includes && includes.media) {
    for (const m of includes.media) {
      map[m.media_key] = m;
    }
  }
  return map;
}

/**
 * Extract referenced (quoted) tweets from includes.
 */
function buildReferencedTweetMap(includes) {
  const map = {};
  if (includes && includes.tweets) {
    for (const t of includes.tweets) {
      map[t.id] = t;
    }
  }
  return map;
}

/**
 * Extract user objects from includes keyed by user id.
 */
function buildUserMap(includes) {
  const map = {};
  if (includes && includes.users) {
    for (const u of includes.users) {
      map[u.id] = u;
    }
  }
  return map;
}

/**
 * Determine if a tweet is part of a self-thread (the author replying to themselves).
 */
function isSelfThread(tweet, authorId) {
  return (
    tweet.referenced_tweets?.some((r) => r.type === 'replied_to') &&
    tweet.in_reply_to_user_id === authorId
  );
}

/**
 * Determine if a tweet is a quote tweet.
 */
function isQuoteTweet(tweet) {
  return tweet.referenced_tweets?.some((r) => r.type === 'quoted');
}

/**
 * Get the quoted tweet ID from a quote tweet's referenced_tweets.
 */
function getQuotedTweetId(tweet) {
  const ref = tweet.referenced_tweets?.find((r) => r.type === 'quoted');
  return ref ? ref.id : null;
}

/**
 * Wrapper that handles Twitter API rate-limit (429) errors.
 * Waits for the reset window then retries once.
 */
async function withRateLimitRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === 429 || err.rateLimit) {
      const resetAt = err.rateLimit?.reset
        ? err.rateLimit.reset * 1000
        : Date.now() + 60_000;
      const waitMs = Math.max(resetAt - Date.now(), 1000);
      console.warn(`[twitter] Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s…`);
      await sleep(waitMs);
      return await fn(); // retry once
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  fetchUserProfile,
  fetchNewTweets,
  buildMediaMap,
  buildReferencedTweetMap,
  buildUserMap,
  isSelfThread,
  isQuoteTweet,
  getQuotedTweetId,
  withRateLimitRetry,
  sleep,
};
