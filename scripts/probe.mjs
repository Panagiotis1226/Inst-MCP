#!/usr/bin/env node
// Phase 0 capability probe: calls every Instagram Platform endpoint the plan relies on with your
// real credentials and records what actually works. See docs/SETUP.md.
//
//   node scripts/probe.mjs                 read-only checks
//   node scripts/probe.mjs --write         also runs safe, self-cleaning write checks
//   node scripts/probe.mjs --only media,insights
//   node scripts/probe.mjs --verbose       print full error details
//
// Results go to probe-results/capability-matrix-<mode>.{json,md}. IDs and tokens are replaced with
// placeholders, so the files are safe to share.
import { mkdirSync, writeFileSync } from 'node:fs';
import { graph, loadEnv, parseArgs, HOSTS, GraphError } from './lib/graph.mjs';

const args = parseArgs(process.argv.slice(2));
const env = loadEnv();
const mode = args.mode || env.IG_AUTH_MODE || 'facebook';
const FB = mode === 'facebook';
const WRITE = Boolean(args.write);
const VERBOSE = Boolean(args.verbose);
const ONLY = typeof args.only === 'string' ? args.only.split(',') : null;
const DELAY_MS = 150;

const cfg = {
  host: HOSTS[mode],
  version: args.version || env.IG_API_VERSION || 'v25.0',
  appId: env.IG_APP_ID,
  appSecret: env.IG_APP_SECRET,
  userToken: env.IG_USER_TOKEN || env.IG_ACCESS_TOKEN,
  pageToken: env.IG_PAGE_TOKEN || (FB ? env.IG_ACCESS_TOKEN : undefined),
};

if (!HOSTS[mode]) fatal(`Unknown IG_AUTH_MODE "${mode}" (use facebook or instagram).`);
if (!cfg.userToken && !cfg.pageToken) fatal('No token found. Run `npm run setup-token` first (docs/SETUP.md).');

// ---------------------------------------------------------------------------------------------
// Redaction: every ID and token we learn is replaced with a placeholder in recorded output.
const secrets = new Map();
const redact = (value, placeholder) => {
  if (value) secrets.set(String(value), placeholder);
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-token matches only, so a short username can't mangle unrelated text.
const sanitize = (s) => {
  let out = String(s ?? '');
  for (const [value, placeholder] of secrets) {
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${escapeRe(value)}(?![A-Za-z0-9_])`, 'g'), placeholder);
  }
  return out;
};
redact(cfg.userToken, '<user-token>');
redact(cfg.pageToken, '<page-token>');
redact(cfg.appSecret, '<app-secret>');
redact(cfg.appId, '{app-id}');

// ---------------------------------------------------------------------------------------------
// Call helpers
const ctx = { media: [] };
const findings = {};
const results = [];

const tokenFor = (kind) =>
  kind === 'page' ? cfg.pageToken || cfg.userToken : kind === 'app' ? `${cfg.appId}|${cfg.appSecret}` : cfg.userToken || cfg.pageToken;

async function api(method, path, { params, json, token = 'user', host = cfg.host, version = cfg.version } = {}) {
  await new Promise((r) => setTimeout(r, DELAY_MS));
  return graph(method, path, { host, version, params, json, token: token === null ? undefined : tokenFor(token) });
}

class Skip extends Error {}
const skip = (why) => {
  throw new Skip(why);
};
const need = (value, why) => value ?? skip(why);

async function check(area, endpoint, desc, fn, { modes = ['facebook', 'instagram'], write = false } = {}) {
  if (ONLY && !ONLY.includes(area)) return undefined;
  const row = { area, endpoint, desc, write };
  if (!modes.includes(mode)) return record(row, 'n/a', `not available with ${mode} login`);
  if (write && !WRITE) return record(row, 'skip', 'write check (run with --write)');
  try {
    const value = await fn();
    const detail = typeof value === 'string' ? value : value?.note ?? '';
    record(row, 'ok', detail);
    return value ?? true;
  } catch (e) {
    if (e instanceof Skip) return record(row, 'skip', e.message);
    const detail = e instanceof GraphError ? e.short : e.message;
    record(row, 'fail', detail, e instanceof GraphError ? { code: e.code, subcode: e.subcode, http: e.status } : {});
    if (VERBOSE && e instanceof GraphError) console.log(`      type=${e.type} fbtrace=${e.fbtrace}`);
    return undefined;
  }
}

const ICON = { ok: '✅', fail: '❌', skip: '⏭️ ', 'n/a': '➖' };
function record(row, status, detail, extra = {}) {
  const entry = { ...row, status, detail: sanitize(detail), ...extra };
  results.push(entry);
  const text = entry.detail.length > 140 && !VERBOSE ? `${entry.detail.slice(0, 140)}…` : entry.detail;
  console.log(`${ICON[status]} ${row.endpoint.padEnd(58)} ${text}`);
  return undefined;
}

const section = (title) => {
  if (!ONLY || ONLY.includes(title)) console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`);
};

// Paths use the account ID for media and insights, and the Page (FB) or account (IG) for messaging.
const IG = () => need(ctx.igUserId, 'Instagram account ID unknown');
const INBOX = () => (FB ? need(env.IG_PAGE_ID || ctx.pageId, 'Page ID unknown') : IG());

// ---------------------------------------------------------------------------------------------
console.log(`inst-mcp capability probe — mode=${mode}, host=${cfg.host}, version=${cfg.version}, write=${WRITE}`);

await setup();
await account();
await media();
await comments();
await mentions();
await insights();
await discovery();
await hashtags();
await collaboration();
await shopping();
await events();
await audio();
await creators();
await messaging();
await tokens();
await writes();
report();

// ---------------------------------------------------------------------------------------------
async function setup() {
  section('setup');
  const ok = await check('setup', 'GET /me', 'Token is valid', async () => {
    await api('GET', 'me', { params: { fields: FB ? 'id,name' : 'id,user_id,username' } });
    return 'token accepted';
  });
  if (!ok && !ONLY) fatal('The token was rejected. Re-run `npm run setup-token`.');

  if (FB) {
    ctx.pageId = env.IG_PAGE_ID;
    ctx.igUserId = env.IG_USER_ID;
    if (!ctx.igUserId) {
      await check('setup', 'GET /me/accounts', 'Find Page + linked IG account', async () => {
        const res = await api('GET', 'me/accounts', { params: { fields: 'id,instagram_business_account' } });
        const page = res.data?.find((p) => p.instagram_business_account);
        ctx.pageId = need(page?.id, 'no Page linked to an Instagram account');
        ctx.igUserId = page.instagram_business_account.id;
        return `${res.data.length} page(s)`;
      });
    }
  } else {
    await check('setup', 'GET /me', 'Resolve Instagram account IDs', async () => {
      const me = await api('GET', 'me', { params: { fields: 'id,user_id,username,account_type' } });
      ctx.igUserId = me.id;
      ctx.igProId = me.user_id;
      redact(me.user_id, '{ig-pro-id}');
      redact(me.username, '{username}');
      findings.account_type = me.account_type;
      return `account_type=${me.account_type}`;
    });
  }
  redact(ctx.igUserId, '{ig-user-id}');
  redact(ctx.pageId, '{page-id}');
  redact(env.IG_USERNAME, '{username}');

  // Newest Graph API version that answers.
  for (const v of ['v27.0', 'v26.0', 'v25.0']) {
    try {
      await api('GET', 'me', { params: { fields: 'id' }, version: v });
      findings.newest_working_version = v;
      break;
    } catch {
      // Try the next older version.
    }
  }
  console.log(`   newest working API version: ${findings.newest_working_version ?? 'none of v25–v27'}`);

  if (FB && cfg.appId && cfg.appSecret) {
    for (const [kind, token] of [['user', cfg.userToken], ['page', cfg.pageToken]]) {
      if (!token) continue;
      await check('setup', `GET /debug_token (${kind})`, `Inspect ${kind} token`, async () => {
        const { data } = await api('GET', 'debug_token', { token: 'app', host: HOSTS.facebook, params: { input_token: token } });
        findings[`${kind}_token`] = {
          type: data.type,
          expires: data.expires_at ? new Date(data.expires_at * 1000).toISOString() : 'never',
          scopes: data.scopes ?? [],
        };
        return `${data.type}, expires ${findings[`${kind}_token`].expires}, ${data.scopes?.length ?? 0} scopes`;
      });
    }
  }
}

async function account() {
  section('account');
  const fields = FB
    ? ['id', 'username', 'name', 'biography', 'website', 'profile_picture_url', 'followers_count', 'follows_count', 'media_count', 'has_profile_pic', 'is_published', 'legacy_instagram_user_id']
    : ['id', 'user_id', 'username', 'name', 'account_type', 'biography', 'website', 'profile_picture_url', 'followers_count', 'follows_count', 'media_count'];

  await check('account', 'GET /{ig-user-id}?fields=…', 'Profile fields', async () => {
    try {
      const u = await api('GET', IG(), { params: { fields: fields.join(',') } });
      findings.followers_at_least_100 = (u.followers_count ?? 0) >= 100;
      return `${fields.length} fields OK; followers>=100: ${findings.followers_at_least_100}`;
    } catch (e) {
      // Find out which field breaks the request.
      const bad = [];
      for (const f of fields) {
        try {
          await api('GET', IG(), { params: { fields: f } });
        } catch {
          bad.push(f);
        }
      }
      findings.unsupported_user_fields = bad;
      throw new Error(`unsupported fields: ${bad.join(', ') || '(none individually)'} — ${e.message}`);
    }
  });

  await check('account', 'GET /{ig-user-id}/content_publishing_limit', 'Publishing quota', async () => {
    const res = await api('GET', `${IG()}/content_publishing_limit`, { params: { fields: 'quota_usage,config' } });
    const row = res.data?.[0] ?? {};
    findings.publishing_quota_total = row.config?.quota_total;
    findings.publishing_quota_duration_s = row.config?.quota_duration;
    return `used ${row.quota_usage ?? '?'} of ${row.config?.quota_total ?? '?'} per ${row.config?.quota_duration ?? '?'}s`;
  });

  await check('account', 'GET /{ig-user-id}?fields=shopping_product_tag_eligibility', 'Product tagging eligibility', async () => {
    const res = await api('GET', IG(), { params: { fields: 'shopping_product_tag_eligibility' } });
    return `eligible=${res.shopping_product_tag_eligibility}`;
  }, { modes: ['facebook'] });

  for (const edge of ['connected_threads_user', 'instagram_backed_threads_user']) {
    await check('account', `GET /{ig-user-id}/${edge}`, 'Threads account ID', async () => {
      const res = await api('GET', `${IG()}/${edge}`, { params: { fields: 'threads_user_id' } });
      return res.threads_user_id || res.data?.length ? 'has Threads ID' : 'no Threads account';
    }, { modes: ['facebook'] });
  }
  for (const edge of ['agencies', 'authorized_adaccounts']) {
    await check('account', `GET /{ig-user-id}/${edge}`, 'Ad partners', async () => {
      const res = await api('GET', `${IG()}/${edge}`);
      return `${res.data?.length ?? 0} item(s)`;
    }, { modes: ['facebook'] });
  }
}

async function media() {
  section('media');
  await check('media', 'GET /{ig-user-id}/media', 'List media', async () => {
    const res = await api('GET', `${IG()}/media`, {
      params: { fields: 'id,media_type,media_product_type,timestamp,permalink,comments_count,like_count,is_comment_enabled', limit: 50 },
    });
    ctx.media = res.data ?? [];
    ctx.media.forEach((m, i) => redact(m.id, `{media-${i}}`));
    const kinds = {};
    for (const m of ctx.media) kinds[m.media_product_type ?? m.media_type] = (kinds[m.media_product_type ?? m.media_type] ?? 0) + 1;
    return `${ctx.media.length} items ${JSON.stringify(kinds)}`;
  });

  ctx.feed = ctx.media.find((m) => m.media_product_type === 'FEED' && m.media_type !== 'CAROUSEL_ALBUM');
  ctx.reel = ctx.media.find((m) => m.media_product_type === 'REELS');
  ctx.carousel = ctx.media.find((m) => m.media_type === 'CAROUSEL_ALBUM');
  ctx.latest = ctx.media.find((m) => m.media_product_type !== 'STORY');
  ctx.withComments = ctx.media.find((m) => m.comments_count > 0);
  // Permalinks embed shortcodes; keep them out of the shareable output.
  ctx.media.forEach((m, i) => redact(m.permalink, `{permalink-${i}}`));

  await check('media', 'GET /{ig-user-id}/stories', 'Live stories', async () => {
    const res = await api('GET', `${IG()}/stories`, { params: { fields: 'id,media_type,timestamp' } });
    ctx.story = res.data?.[0];
    redact(ctx.story?.id, '{story-id}');
    return `${res.data?.length ?? 0} active stories`;
  });
  await check('media', 'GET /{ig-user-id}/live_media', 'Live broadcasts', async () => {
    const res = await api('GET', `${IG()}/live_media`, { params: { fields: 'id' } });
    return `${res.data?.length ?? 0} live now`;
  });
  await check('media', 'GET /{ig-user-id}/tags', 'Media you are tagged in', async () => {
    const res = await api('GET', `${IG()}/tags`, { params: { fields: 'id,media_type' } });
    return `${res.data?.length ?? 0} items`;
  });

  const core = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,shortcode,timestamp,username,owner,like_count,comments_count,is_comment_enabled';
  await check('media', 'GET /{ig-media-id}?fields=<core>', 'Media core fields', async () => {
    const m = need(ctx.latest, 'no media on the account');
    await api('GET', m.id, { params: { fields: core } });
    return 'core fields OK';
  });

  const extra = ['alt_text', 'is_shared_to_feed', 'is_ai_generated', 'media_audio_type', 'legacy_instagram_media_id', 'copyright_check_information', 'boost_eligibility_info', 'total_like_count', 'total_comments_count', 'total_views_count', 'saved_count', 'shares_count', 'reposts_count'];
  for (const f of extra) {
    await check('media', `GET /{ig-media-id}?fields=${f}`, 'Extended media field', async () => {
      const m = need(f === 'is_shared_to_feed' ? ctx.reel : ctx.latest, 'no suitable media');
      await api('GET', m.id, { params: { fields: f } });
      return 'supported';
    });
  }

  await check('media', 'GET /{ig-media-id}/children', 'Carousel items', async () => {
    const m = need(ctx.carousel, 'no carousel on the account');
    const res = await api('GET', `${m.id}/children`, { params: { fields: 'id,media_type' } });
    return `${res.data?.length ?? 0} children`;
  });
  await check('media', 'GET /{ig-media-id}/collaborators', 'Post collaborators', async () => {
    const m = need(ctx.latest, 'no media');
    const res = await api('GET', `${m.id}/collaborators`);
    return `${res.data?.length ?? 0} collaborators`;
  }, { modes: ['facebook'] });
  await check('media', 'GET /{ig-media-id}/product_tags', 'Product tags on a post', async () => {
    const m = need(ctx.feed ?? ctx.latest, 'no media');
    const res = await api('GET', `${m.id}/product_tags`);
    return `${res.data?.length ?? 0} tags`;
  }, { modes: ['facebook'] });
}

async function comments() {
  section('comments');
  await check('comments', 'GET /{ig-media-id}/comments', 'List comments', async () => {
    const m = need(ctx.withComments, 'no media with comments');
    const res = await api('GET', `${m.id}/comments`, { params: { fields: 'id,text,username,timestamp,like_count,hidden,from,parent_id' } });
    ctx.comment = res.data?.[0];
    redact(ctx.comment?.id, '{comment-id}');
    redact(ctx.comment?.from?.id, '{commenter-igsid}');
    redact(ctx.comment?.username, '{commenter}');
    return `${res.data?.length ?? 0} comments`;
  });
  await check('comments', 'GET /{ig-comment-id}', 'Comment fields', async () => {
    const c = need(ctx.comment, 'no comment found');
    await api('GET', c.id, { params: { fields: 'id,text,username,from,hidden,like_count,media,parent_id,timestamp,legacy_instagram_comment_id' } });
    return 'OK';
  });
  await check('comments', 'GET /{ig-comment-id}/replies', 'Comment replies', async () => {
    const c = need(ctx.comment, 'no comment found');
    const res = await api('GET', `${c.id}/replies`, { params: { fields: 'id,text,username,timestamp' } });
    return `${res.data?.length ?? 0} replies`;
  });
}

async function mentions() {
  section('mentions');
  const mediaId = env.PROBE_MENTION_MEDIA_ID;
  const commentId = env.PROBE_MENTION_COMMENT_ID;
  await check('mentions', 'GET /{ig-user-id}?fields=mentioned_media', 'Caption that @mentions you', async () => {
    need(mediaId, 'set PROBE_MENTION_MEDIA_ID (from a mention) to test');
    await api('GET', IG(), { params: { fields: `mentioned_media.media_id(${mediaId}){id,caption,media_type}` } });
    return 'OK';
  });
  await check('mentions', 'GET /{ig-user-id}?fields=mentioned_comment', 'Comment that @mentions you', async () => {
    need(commentId, 'set PROBE_MENTION_COMMENT_ID (from a mention) to test');
    await api('GET', IG(), { params: { fields: `mentioned_comment.comment_id(${commentId}){id,text,timestamp}` } });
    return 'OK';
  });
}

async function insights() {
  section('insights');
  const now = Math.floor(Date.now() / 1000);
  const range = { since: now - 7 * 86400, until: now };
  const account = [
    ['reach', { period: 'day', metric_type: 'total_value', ...range }],
    ['reach (time_series)', { metric: 'reach', period: 'day', metric_type: 'time_series', ...range }],
    ['reach by media_product_type', { metric: 'reach', period: 'day', metric_type: 'total_value', breakdown: 'media_product_type', ...range }],
    ['reach by follow_type', { metric: 'reach', period: 'day', metric_type: 'total_value', breakdown: 'follow_type', ...range }],
    ['views', { period: 'day', metric_type: 'total_value', ...range }],
    ['views by follow_type', { metric: 'views', period: 'day', metric_type: 'total_value', breakdown: 'follow_type', ...range }],
    ['views by follower_type', { metric: 'views', period: 'day', metric_type: 'total_value', breakdown: 'follower_type', ...range }],
    ['accounts_engaged', { period: 'day', metric_type: 'total_value', ...range }],
    ['total_interactions', { period: 'day', metric_type: 'total_value', ...range }],
    ['likes', { period: 'day', metric_type: 'total_value', ...range }],
    ['comments', { period: 'day', metric_type: 'total_value', ...range }],
    ['saves', { period: 'day', metric_type: 'total_value', ...range }],
    ['shares', { period: 'day', metric_type: 'total_value', ...range }],
    ['reposts', { period: 'day', metric_type: 'total_value', ...range }],
    ['replies', { period: 'day', metric_type: 'total_value', ...range }],
    ['follows_and_unfollows', { period: 'day', metric_type: 'total_value', breakdown: 'follow_type', ...range }],
    ['profile_links_taps', { period: 'day', metric_type: 'total_value', breakdown: 'contact_button_type', ...range }],
    ['follower_count', { period: 'day', ...range }],
    ['online_followers', { period: 'lifetime', ...range }],
    ['follower_demographics', { period: 'lifetime', metric_type: 'total_value', timeframe: 'this_month', breakdown: 'country' }],
    ['engaged_audience_demographics', { period: 'lifetime', metric_type: 'total_value', timeframe: 'this_month', breakdown: 'country' }],
    ['impressions (deprecated, expect fail)', { metric: 'impressions', period: 'day', ...range }],
  ];
  for (const [label, p] of account) {
    const metric = p.metric ?? label;
    await check('insights', `GET /{ig-user-id}/insights metric=${label}`, 'Account insight', async () => {
      const res = await api('GET', `${IG()}/insights`, { params: { ...p, metric } });
      return `${res.data?.length ?? 0} series`;
    });
  }

  const perType = {
    FEED: [ctx.feed ?? ctx.carousel, ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'reposts', 'total_interactions', 'follows', 'profile_visits', 'profile_activity', 'facebook_views', 'total_likes', 'total_comments', 'total_views']],
    REELS: [ctx.reel, ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'reposts', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate', 'crossposted_views', 'facebook_views', 'total_likes', 'total_comments', 'total_views']],
    STORY: [ctx.story, ['reach', 'views', 'shares', 'reposts', 'replies', 'total_interactions', 'follows', 'profile_visits', 'profile_activity', 'navigation', 'link_clicks', 'facebook_views', 'total_views']],
  };
  for (const [type, [m, metrics]] of Object.entries(perType)) {
    for (const metric of metrics) {
      await check('insights', `GET /{ig-media-id}/insights ${type} metric=${metric}`, 'Media insight', async () => {
        const item = need(m, `no ${type.toLowerCase()} media to test`);
        const res = await api('GET', `${item.id}/insights`, { params: { metric } });
        const v = res.data?.[0]?.values?.[0]?.value ?? res.data?.[0]?.total_value?.value;
        return `value type: ${typeof v}`;
      });
    }
  }
  await check('insights', 'GET /{ig-media-id}/insights metric=profile_activity breakdown=action_type', 'Media insight breakdown', async () => {
    const m = need(ctx.feed ?? ctx.reel, 'no feed media');
    await api('GET', `${m.id}/insights`, { params: { metric: 'profile_activity', breakdown: 'action_type' } });
    return 'OK';
  });
}

async function discovery() {
  section('discovery');
  const target = env.PROBE_DISCOVERY_USERNAME || 'instagram';
  await check('discovery', 'GET /{ig-user-id}?fields=business_discovery', `Public data for @${target}`, async () => {
    const res = await api('GET', IG(), {
      params: { fields: `business_discovery.username(${target}){username,followers_count,media_count,media.limit(3){id,like_count,comments_count,view_count,media_product_type}}` },
    });
    return `media returned: ${res.business_discovery?.media?.data?.length ?? 0}`;
  }, { modes: ['facebook'] });

  const permalink = ctx.latest?.permalink;
  await check('discovery', 'GET /instagram_oembed (no token)', 'Embed HTML without a token', async () => {
    const url = need(permalink, 'no media permalink to embed');
    const res = await api('GET', 'instagram_oembed', { token: null, host: HOSTS.facebook, params: { url } });
    findings.oembed_without_token = true;
    return `html ${res.html ? 'returned' : 'missing'}`;
  });
  if (!findings.oembed_without_token && cfg.appId && cfg.appSecret) {
    await check('discovery', 'GET /instagram_oembed (app token)', 'Embed HTML with app token', async () => {
      const url = need(permalink, 'no media permalink to embed');
      await api('GET', 'instagram_oembed', { token: 'app', host: HOSTS.facebook, params: { url } });
      return 'OK';
    });
  }
}

async function hashtags() {
  section('hashtags');
  const opts = { modes: ['facebook'] };
  await check('hashtags', 'GET /{ig-user-id}/recently_searched_hashtags', 'Hashtags searched this week', async () => {
    const res = await api('GET', `${IG()}/recently_searched_hashtags`, { params: { limit: 30 } });
    findings.hashtag_searches_used = res.data?.length ?? 0;
    return `${findings.hashtag_searches_used} of 30 used`;
  }, opts);
  const tag = env.PROBE_HASHTAG;
  await check('hashtags', 'GET /ig_hashtag_search', 'Hashtag name → ID', async () => {
    need(tag, 'set PROBE_HASHTAG to test (uses 1 of 30 weekly searches)');
    const res = await api('GET', 'ig_hashtag_search', { params: { user_id: IG(), q: tag } });
    ctx.hashtagId = res.data?.[0]?.id;
    return 'OK';
  }, opts);
  for (const edge of ['top_media', 'recent_media']) {
    await check('hashtags', `GET /{hashtag-id}/${edge}`, 'Hashtag media', async () => {
      const id = need(ctx.hashtagId, 'no hashtag ID');
      const res = await api('GET', `${id}/${edge}`, { params: { user_id: IG(), fields: 'id,media_type,like_count,comments_count', limit: 5 } });
      return `${res.data?.length ?? 0} items`;
    }, opts);
  }
}

async function collaboration() {
  section('collaboration');
  const opts = { modes: ['facebook'] };
  await check('collaboration', 'GET /{ig-user-id}/collaboration_invites', 'Pending collab invites', async () => {
    const res = await api('GET', `${IG()}/collaboration_invites`);
    return `${res.data?.length ?? 0} invites`;
  }, opts);
  await check('collaboration', 'GET /{ig-user-id}/collaborative_media', 'Posts you collaborate on', async () => {
    const res = await api('GET', `${IG()}/collaborative_media`, { params: { fields: 'id,media_type' } });
    return `${res.data?.length ?? 0} posts`;
  }, opts);
}

async function shopping() {
  section('shopping');
  await check('shopping', 'GET /{ig-user-id}/available_catalogs', 'Instagram Shop catalog', async () => {
    const res = await api('GET', `${IG()}/available_catalogs`);
    return `${res.data?.length ?? 0} catalogs`;
  }, { modes: ['facebook'] });
}

async function events() {
  section('events');
  await check('events', 'GET /{ig-user-id}/upcoming_events', 'Upcoming events', async () => {
    const res = await api('GET', `${IG()}/upcoming_events`);
    return `${res.data?.length ?? 0} events`;
  }, { modes: ['facebook'] });
}

async function audio() {
  section('audio');
  const opts = { modes: ['facebook'] };
  for (const type of ['music', 'original_sound']) {
    await check('audio', `GET /ig_audio?audio_type=${type}`, 'Reels audio search', async () => {
      const res = await api('GET', 'ig_audio', { params: { audio_type: type, user_id: IG() } });
      ctx.audioId ??= res.data?.[0]?.audio_id ?? res.data?.[0]?.id;
      return `${res.data?.length ?? 0} tracks`;
    }, opts);
  }
  await check('audio', 'GET /{ig-audio-id}', 'Audio details', async () => {
    const id = need(ctx.audioId, 'no audio ID found');
    await api('GET', id, { params: { user_id: IG() } });
    return 'OK';
  }, opts);
}

async function creators() {
  section('creators');
  const opts = { modes: ['facebook'] };
  await check('creators', 'GET /{ig-user-id}/creator_marketplace_brand_info', 'Brand info', async () => {
    await api('GET', `${IG()}/creator_marketplace_brand_info`, { token: 'page' });
    return 'OK';
  }, opts);
  await check('creators', 'GET /{ig-user-id}/creator_marketplace_creators', 'Creator search', async () => {
    const res = await api('GET', `${IG()}/creator_marketplace_creators`, { token: 'page', params: { creator_countries: ['US'], limit: 1 } });
    return `${res.data?.length ?? 0} creators`;
  }, opts);
}

async function messaging() {
  section('messaging');
  const t = FB ? 'page' : 'user';
  await check('messaging', `GET /{${FB ? 'page' : 'ig-user'}-id}/conversations`, 'List DM threads', async () => {
    const res = await api('GET', `${INBOX()}/conversations`, { token: t, params: { platform: 'instagram', fields: 'id,updated_time' } });
    ctx.conversation = res.data?.[0];
    redact(ctx.conversation?.id, '{conversation-id}');
    return `${res.data?.length ?? 0} threads`;
  });
  await check('messaging', 'GET /{conversation-id}?fields=messages', 'Messages in a thread', async () => {
    const c = need(ctx.conversation, 'no conversations');
    const res = await api('GET', c.id, { token: t, params: { fields: 'messages{id,created_time}' } });
    ctx.message = res.messages?.data?.[0];
    redact(ctx.message?.id, '{message-id}');
    return `${res.messages?.data?.length ?? 0} messages`;
  });
  await check('messaging', 'GET /{message-id}', 'Message details', async () => {
    const m = need(ctx.message, 'no messages');
    const res = await api('GET', m.id, { token: t, params: { fields: 'id,created_time,from,to,message' } });
    const self = new Set([ctx.igUserId, ctx.igProId].filter(Boolean));
    ctx.igsid = [res.from, ...(res.to?.data ?? [])].map((p) => p?.id).find((id) => id && !self.has(id));
    redact(ctx.igsid, '{igsid}');
    // Shown on your screen only (never saved) so you can opt in to the DM write checks.
    if (ctx.igsid && !env.PROBE_DM_RECIPIENT) console.log(`   ℹ DM participant found. To test sending DMs to them: PROBE_DM_RECIPIENT=${ctx.igsid}`);
    return 'OK';
  });
  await check('messaging', 'GET /{igsid} (User Profile API)', 'Profile of someone who messaged you', async () => {
    const id = need(ctx.igsid, 'no other participant found');
    await api('GET', id, { token: t, params: { fields: 'name,username,profile_pic,follower_count,is_verified_user,is_user_follow_business,is_business_follow_user' } });
    return 'OK';
  });
  await check('messaging', 'GET /me/messenger_profile', 'Ice breakers + persistent menu', async () => {
    const res = await api('GET', 'me/messenger_profile', { token: t, params: { fields: 'ice_breakers,persistent_menu', ...(FB ? { platform: 'instagram' } : {}) } });
    ctx.profileHasIceBreakers = Boolean(res.data?.[0]?.ice_breakers?.length);
    ctx.profileHasMenu = Boolean(res.data?.[0]?.persistent_menu?.length);
    return `ice_breakers=${ctx.profileHasIceBreakers}, menu=${ctx.profileHasMenu}`;
  });
  await check('messaging', `GET /${FB ? '{page-id}' : 'me'}/welcome_message_flows`, 'Welcome flows (CTD ads)', async () => {
    const res = await api('GET', `${FB ? INBOX() : 'me'}/welcome_message_flows`, { token: t });
    return `${res.data?.length ?? 0} flows`;
  });
  await check('messaging', `GET /${FB ? '{page-id}' : 'me'}/subscribed_apps`, 'Webhook subscription status', async () => {
    const res = await api('GET', `${FB ? INBOX() : 'me'}/subscribed_apps`, { token: t });
    return `${res.data?.length ?? 0} subscribed app(s)`;
  });
  await check('messaging', 'GET /me?fields=messaging_feature_status', 'Conversation routing status', async () => {
    const res = await api('GET', 'me', { token: 'page', params: { fields: 'messaging_feature_status' } });
    return JSON.stringify(res.messaging_feature_status ?? {});
  }, { modes: ['facebook'] });
  await check('messaging', 'GET /{page-id}/thread_owner', 'Which app owns a thread', async () => {
    const id = need(ctx.igsid, 'no other participant found');
    await api('GET', `${INBOX()}/thread_owner`, { token: 'page', params: { recipient: id } });
    return 'OK';
  }, { modes: ['facebook'] });
}

// Can the server run on the non-expiring Page token alone (no 60-day user-token renewals)?
async function tokens() {
  if (!FB || !cfg.pageToken || !cfg.userToken || cfg.pageToken === cfg.userToken) return;
  if (ONLY && !ONLY.includes('tokens')) return;
  section('tokens');
  const probes = [
    ['GET /{ig-user-id} with page token', () => api('GET', IG(), { token: 'page', params: { fields: 'username,media_count' } })],
    ['GET /{ig-user-id}/media with page token', () => api('GET', `${IG()}/media`, { token: 'page', params: { limit: 1 } })],
    ['GET /{ig-user-id}/insights with page token', () => api('GET', `${IG()}/insights`, { token: 'page', params: { metric: 'reach', period: 'day', metric_type: 'total_value' } })],
    ['GET /{ig-user-id}?fields=business_discovery with page token', () => api('GET', IG(), { token: 'page', params: { fields: 'business_discovery.username(instagram){username}' } })],
    ['GET /{ig-user-id}/content_publishing_limit with page token', () => api('GET', `${IG()}/content_publishing_limit`, { token: 'page' })],
  ];
  let all = true;
  for (const [endpoint, fn] of probes) {
    const ok = await check('tokens', endpoint, 'Page token sufficiency', async () => {
      await fn();
      return 'OK';
    });
    all &&= Boolean(ok);
  }
  findings.page_token_sufficient = all;
}

async function writes() {
  section('writes');
  // Comment lifecycle on your own latest post: create → like → hide → unhide → reply → delete.
  let commentId;
  await check('writes', 'POST /{ig-media-id}/comments', 'Create a comment', async () => {
    const m = need(ctx.latest, 'no media');
    const res = await api('POST', `${m.id}/comments`, { params: { message: 'inst-mcp probe test (auto-deleted)' } });
    commentId = res.id;
    redact(commentId, '{probe-comment-id}');
    return 'created';
  }, { write: true });
  await check('writes', 'POST /{ig-user-id}/likes comment_id', 'Like a comment', async () => {
    need(commentId, 'no probe comment');
    await api('POST', `${IG()}/likes`, { params: { comment_id: commentId } });
    return 'liked';
  }, { write: true, modes: ['facebook'] });
  await check('writes', 'DELETE /{ig-user-id}/likes comment_id', 'Unlike a comment', async () => {
    need(commentId, 'no probe comment');
    await api('DELETE', `${IG()}/likes`, { params: { comment_id: commentId } });
    return 'unliked';
  }, { write: true, modes: ['facebook'] });
  for (const hide of [true, false]) {
    await check('writes', `POST /{ig-comment-id} hide=${hide}`, hide ? 'Hide a comment' : 'Unhide a comment', async () => {
      need(commentId, 'no probe comment');
      await api('POST', commentId, { params: { hide } });
      return 'OK';
    }, { write: true });
  }
  let replyId;
  await check('writes', 'POST /{ig-comment-id}/replies', 'Reply to a comment', async () => {
    need(commentId, 'no probe comment');
    const res = await api('POST', `${commentId}/replies`, { params: { message: 'inst-mcp probe reply (auto-deleted)' } });
    replyId = res.id;
    redact(replyId, '{probe-reply-id}');
    return 'replied';
  }, { write: true });
  for (const [id, label] of [[replyId, 'reply'], [commentId, 'comment']]) {
    if (!id) continue;
    await check('writes', 'DELETE /{ig-comment-id}', `Delete the probe ${label}`, async () => {
      await api('DELETE', id);
      return 'deleted';
    }, { write: true });
  }

  // Re-applies the current setting, so nothing changes.
  await check('writes', 'POST /{ig-media-id} comment_enabled=<current>', 'Toggle comments (no-op)', async () => {
    const m = need(ctx.latest, 'no media');
    await api('POST', m.id, { params: { comment_enabled: m.is_comment_enabled ?? true } });
    return `kept comment_enabled=${m.is_comment_enabled ?? true}`;
  }, { write: true });

  // Ice breakers and menu: only touched when you have none, then removed again.
  const t = FB ? 'page' : 'user';
  const platform = FB ? { platform: 'instagram' } : {};
  await check('writes', 'POST+DELETE /me/messenger_profile ice_breakers', 'Set then remove ice breakers', async () => {
    if (ctx.profileHasIceBreakers !== false) skip('you already have ice breakers (left untouched) or the read failed');
    await api('POST', 'me/messenger_profile', {
      token: t,
      json: { ...platform, ice_breakers: [{ locale: 'default', call_to_actions: [{ question: 'Probe test?', payload: 'PROBE' }] }] },
    });
    await api('DELETE', 'me/messenger_profile', { token: t, json: { ...platform, fields: ['ice_breakers'] } });
    return 'set and removed';
  }, { write: true });
  await check('writes', 'POST+DELETE /me/messenger_profile persistent_menu', 'Set then remove menu', async () => {
    if (ctx.profileHasMenu !== false) skip('you already have a menu (left untouched) or the read failed');
    await api('POST', 'me/messenger_profile', {
      token: t,
      json: {
        ...platform,
        persistent_menu: [{ locale: 'default', call_to_actions: [{ type: 'postback', title: 'Probe', payload: 'PROBE' }] }],
      },
    });
    await api('DELETE', 'me/messenger_profile', { token: t, json: { ...platform, fields: ['persistent_menu'] } });
    return 'set and removed';
  }, { write: true });

  // Publishing pipeline without publishing: containers expire unpublished after 24h.
  const imageUrl = env.PROBE_IMAGE_URL || 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg';
  await check('writes', 'POST /{ig-user-id}/media (image container)', 'Create image container (not published)', async () => {
    const res = await api('POST', `${IG()}/media`, { params: { image_url: imageUrl, caption: 'inst-mcp probe (never published)', alt_text: 'probe' } });
    ctx.container = res.id;
    redact(res.id, '{container-id}');
    return 'created';
  }, { write: true });
  await check('writes', 'GET /{container-id}?fields=status_code', 'Container status', async () => {
    const id = need(ctx.container, 'no container');
    let status;
    for (let i = 0; i < 10; i++) {
      const res = await api('GET', id, { params: { fields: 'status,status_code' } });
      status = res.status_code;
      if (status !== 'IN_PROGRESS') break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    findings.image_container_status = status;
    return `status_code=${status} (not published)`;
  }, { write: true });
  await check('writes', 'POST /{ig-user-id}/media upload_type=resumable', 'Start resumable video upload', async () => {
    const res = await api('POST', `${IG()}/media`, { params: { media_type: 'REELS', upload_type: 'resumable', caption: 'inst-mcp probe (never published)' } });
    findings.resumable_upload_supported = Boolean(res.uri);
    redact(res.id, '{resumable-container-id}');
    if (res.uri) redact(res.uri, '{rupload-uri}');
    return res.uri ? 'session created (no bytes sent)' : 'no upload uri returned';
  }, { write: true });

  // DMs only go to a recipient you name, who must have messaged you in the last 24h.
  await check('writes', 'POST /{id}/messages sender_action=typing_on', 'Typing indicator', async () => {
    const to = need(env.PROBE_DM_RECIPIENT, 'set PROBE_DM_RECIPIENT to test DMs');
    redact(to, '{dm-recipient}');
    await api('POST', `${INBOX()}/messages`, { token: t, json: { recipient: { id: to }, sender_action: 'typing_on' } });
    return 'sent';
  }, { write: true });
  await check('writes', 'POST /{id}/messages text', 'Send a DM', async () => {
    const to = need(env.PROBE_DM_RECIPIENT, 'set PROBE_DM_RECIPIENT to test DMs');
    await api('POST', `${INBOX()}/messages`, { token: t, json: { recipient: { id: to }, message: { text: 'inst-mcp probe test message' } } });
    return 'sent';
  }, { write: true });
}

// ---------------------------------------------------------------------------------------------
function report() {
  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const out = {
    generated_at: new Date().toISOString(),
    mode,
    host: cfg.host,
    api_version: cfg.version,
    write_checks: WRITE,
    summary: counts,
    findings: JSON.parse(sanitize(JSON.stringify(findings))),
    // Re-sanitize: IDs learned late in the run may appear in earlier rows.
    results: results.map((r) => ({ ...r, detail: sanitize(r.detail) })),
  };
  mkdirSync('probe-results', { recursive: true });
  const base = `probe-results/capability-matrix-${mode}`;
  writeFileSync(`${base}.json`, `${JSON.stringify(out, null, 2)}\n`);

  const md = [
    `# Capability matrix — ${mode} login`,
    '',
    `Generated ${out.generated_at} · API ${cfg.version} · write checks: ${WRITE ? 'yes' : 'no'}`,
    '',
    `**Summary:** ${Object.entries(counts).map(([k, v]) => `${ICON[k]} ${k}: ${v}`).join(' · ')}`,
    '',
    '## Findings',
    '',
    '```json',
    JSON.stringify(out.findings, null, 2),
    '```',
    '',
    '## Results',
    '',
    '| | Area | Endpoint | Detail |',
    '|---|---|---|---|',
    ...out.results.map((r) => `| ${ICON[r.status]} | ${r.area} | \`${r.endpoint}\` | ${r.detail.replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
  writeFileSync(`${base}.md`, md);

  console.log(`\n${Object.entries(counts).map(([k, v]) => `${ICON[k]} ${k}: ${v}`).join('   ')}`);
  console.log(`Findings: ${JSON.stringify(out.findings)}`);
  console.log(`Saved ${base}.json and ${base}.md (IDs and tokens redacted; safe to share).`);
}

function fatal(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
