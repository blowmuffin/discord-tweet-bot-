/**
 * State persistence module.
 *
 * Reads and writes `state.json` at the project root to track:
 *   - lastSeenIds   — the newest tweet ID fetched per account (used as since_id)
 *   - postedTweetIds — rolling log of the last N posted tweet IDs (duplicate guard)
 *   - dailyStats    — per-account tweet counts for the current UTC day
 *   - lastRunAt     — ISO timestamp of the last successful run
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.resolve(__dirname, '..', 'state.json');
const MAX_POSTED_LOG = 150; // keep the last 150 IDs (covers ~50 per account × 3)

/** Default shape for a fresh state file. */
const DEFAULT_STATE = {
  lastSeenIds: {},
  postedTweetIds: [],
  dailyStats: {},
  lastRunAt: null,
};

/**
 * Load state from disk, or return defaults if the file is missing / corrupt.
 */
function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      lastSeenIds: parsed.lastSeenIds || {},
      postedTweetIds: parsed.postedTweetIds || [],
      dailyStats: parsed.dailyStats || {},
      lastRunAt: parsed.lastRunAt || null,
    };
  } catch {
    console.warn('[state] Could not read state.json — starting fresh.');
    return { ...DEFAULT_STATE };
  }
}

/**
 * Persist the current state to disk.
 */
function saveState(state) {
  // Trim posted log to prevent unbounded growth
  if (state.postedTweetIds.length > MAX_POSTED_LOG) {
    state.postedTweetIds = state.postedTweetIds.slice(-MAX_POSTED_LOG);
  }
  state.lastRunAt = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  console.log('[state] state.json saved.');
}

/**
 * Returns the last-seen tweet ID for a given username, or null.
 */
function getLastSeenId(state, username) {
  return state.lastSeenIds[username.toLowerCase()] || null;
}

/**
 * Update the last-seen tweet ID for a given username.
 */
function setLastSeenId(state, username, tweetId) {
  state.lastSeenIds[username.toLowerCase()] = tweetId;
}

/**
 * Check whether a tweet has already been posted (duplicate guard).
 */
function hasBeenPosted(state, tweetId) {
  return state.postedTweetIds.includes(tweetId);
}

/**
 * Record a tweet ID as posted.
 */
function markPosted(state, tweetId) {
  if (!state.postedTweetIds.includes(tweetId)) {
    state.postedTweetIds.push(tweetId);
  }
}

/**
 * Increment the daily tweet counter for an account.
 * Resets counters when the UTC day changes.
 */
function incrementDailyCount(state, username) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  if (!state.dailyStats[today]) {
    // New day — wipe old stats
    state.dailyStats = { [today]: {} };
  }
  const day = state.dailyStats[today];
  const key = username.toLowerCase();
  day[key] = (day[key] || 0) + 1;
}

/**
 * Return the daily stats object for today (or an empty object).
 */
function getTodayStats(state) {
  const today = new Date().toISOString().slice(0, 10);
  return state.dailyStats[today] || {};
}

module.exports = {
  loadState,
  saveState,
  getLastSeenId,
  setLastSeenId,
  hasBeenPosted,
  markPosted,
  incrementDailyCount,
  getTodayStats,
};
