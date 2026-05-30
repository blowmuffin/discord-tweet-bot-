/**
 * Entry point — Twitter → Discord Bot
 *
 * Orchestrates the full poll cycle:
 *   1. Load persisted state (last-seen tweet IDs, posted log)
 *   2. For each active account:
 *      a. Fetch user profile (avatar, display name)
 *      b. Fetch new tweets since last run
 *      c. Filter by keywords if configured
 *      d. Build Discord embeds and post them
 *      e. Update state with newest tweet ID
 *   3. Save updated state to disk
 *   4. Post daily digest if the current run is the first of a new UTC day
 *
 * Designed to run as a GitHub Actions cron job (every ~8 hours).
 */

require('dotenv').config();

const { getActiveAccounts } = require('../config/accounts');
const twitter = require('./twitter');
const discord = require('./discord');
const state = require('./state');

// ──────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────

/**
 * Add a random 10–90 s delay to feel human (not instant bot-like).
 */
async function humanDelay() {
  const ms = Math.floor(Math.random() * 80_000) + 10_000;
  console.log(`[bot] Adding human delay: ${(ms / 1000).toFixed(1)}s`);
  await twitter.sleep(ms);
}

/**
 * Check whether a tweet passes the account's keyword filter.
 */
function passesKeywordFilter(tweetText, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const lower = tweetText.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ──────────────────────────────────────────────
//  Main loop
// ──────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  🐦  Twitter → Discord Bot  —  Run  ');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════\n');

  // ── Load state ──
  const currentState = state.loadState();
  const accounts = getActiveAccounts();
  console.log(`[bot] Tracking ${accounts.length} account(s): ${accounts.map((a) => '@' + a.username).join(', ')}\n`);

  let totalPosted = 0;
  let errored = false;

  // ── Check if this is the first run of a new UTC day (for digest) ──
  const today = new Date().toISOString().slice(0, 10);
  const lastRunDate = currentState.lastRunAt
    ? currentState.lastRunAt.slice(0, 10)
    : null;
  const isNewDay = lastRunDate && lastRunDate !== today;

  // Post yesterday's digest if we just crossed midnight
  if (isNewDay) {
    const yesterdayStats = state.getTodayStats({
      ...currentState,
      // getTodayStats checks *today*, but we want yesterday's data
      // which is still keyed under lastRunDate
      dailyStats: { [lastRunDate]: currentState.dailyStats[lastRunDate] || {} },
    });
    // The stats are keyed under lastRunDate — extract them manually
    const stats = currentState.dailyStats[lastRunDate] || {};
    if (Object.keys(stats).length > 0) {
      await discord.postDailyDigest(stats);
    }
  }

  // ── Process each account ──
  for (const account of accounts) {
    const handle = account.username;
    console.log(`── @${handle} ${'─'.repeat(40)}`);

    try {
      // 1. Fetch user profile
      const user = await twitter.withRateLimitRetry(() =>
        twitter.fetchUserProfile(handle),
      );
      console.log(`[twitter] User: ${user.name} (ID: ${user.id})`);

      // 2. Fetch new tweets
      const sinceId = state.getLastSeenId(currentState, handle);
      const { tweets, includes, newestId } = await twitter.withRateLimitRetry(() =>
        twitter.fetchNewTweets(user.id, sinceId, account),
      );

      console.log(`[twitter] Fetched ${tweets.length} new tweet(s)`);

      // 3. First-run guard — record the latest ID but don't spam old tweets
      if (!sinceId) {
        console.log('[bot] First run for this account — recording latest ID, not posting.');
        if (newestId) {
          state.setLastSeenId(currentState, handle, newestId);
        }
        continue;
      }

      if (tweets.length === 0) {
        console.log('[bot] No new tweets.\n');
        continue;
      }

      // Build lookup maps from includes
      const mediaMap = twitter.buildMediaMap(includes);
      const refTweetMap = twitter.buildReferencedTweetMap(includes);
      const userMap = twitter.buildUserMap(includes);

      // 4. Process tweets (oldest → newest for chronological posting)
      const sorted = [...tweets].reverse();

      for (const tweet of sorted) {
        // Duplicate guard
        if (state.hasBeenPosted(currentState, tweet.id)) {
          console.log(`[bot] Skipping already-posted tweet ${tweet.id}`);
          continue;
        }

        // Keyword filter
        if (!passesKeywordFilter(tweet.text || '', account.keywords)) {
          console.log(`[bot] Skipping tweet ${tweet.id} — keyword filter`);
          continue;
        }

        // Detect thread and quote tweets
        const isThread = twitter.isSelfThread(tweet, user.id);
        const isQuote = twitter.isQuoteTweet(tweet);
        let quotedTweet = null;
        let quotedUser = null;
        if (isQuote) {
          const qtId = twitter.getQuotedTweetId(tweet);
          quotedTweet = qtId ? refTweetMap[qtId] : null;
          if (quotedTweet && quotedTweet.author_id) {
            quotedUser = userMap[quotedTweet.author_id];
          }
        }

        // Build embed
        const embed = discord.buildEmbed(tweet, user, account, {
          mediaMap,
          quotedTweet,
          quotedUser,
          isThread,
          threadPart: isThread ? null : undefined, // TODO: compute thread position
        });

        // Human delay before posting
        await humanDelay();

        // Post to Discord
        await discord.postToDiscord(account.webhookUrl, embed, handle);

        // Update state
        state.markPosted(currentState, tweet.id);
        state.incrementDailyCount(currentState, handle);
        totalPosted++;
      }

      // Update last-seen ID
      if (newestId) {
        state.setLastSeenId(currentState, handle, newestId);
      }

      console.log('');
    } catch (err) {
      errored = true;
      const errorMsg = `❌ [${new Date().toISOString()}] @${handle} — ${err.message}`;
      console.error(errorMsg);
      await discord.postLogMessage(errorMsg);
    }
  }

  // ── Save state ──
  state.saveState(currentState);

  // ── Summary ──
  console.log('═══════════════════════════════════════');
  if (totalPosted > 0) {
    const successMsg = `✅ [${new Date().toISOString()}] ${totalPosted} tweet(s) posted successfully.`;
    console.log(successMsg);
    await discord.postLogMessage(successMsg);
  } else {
    console.log('  No new tweets to post this run.');
  }
  if (errored) {
    console.log('  ⚠️  Some accounts had errors — check logs above.');
  }
  console.log('═══════════════════════════════════════');
}

// ── Run ──
main().catch(async (err) => {
  console.error('[FATAL]', err);
  await discord.postLogMessage(`🚨 **FATAL ERROR**: ${err.message}`);
  process.exit(1);
});
