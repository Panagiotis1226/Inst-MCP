#!/usr/bin/env node
// Turns a short-lived token from the Graph API Explorer into long-lived credentials and writes .env.
//
// Facebook Login (default):
//   node scripts/setup-token.mjs [--token <short-lived user token>] [--page-id <id>]
//   1. exchanges the 1-hour user token for a ~60-day user token
//   2. finds your Facebook Page linked to an Instagram professional account
//   3. gets that Page's token (does not expire when derived from a long-lived user token)
//   4. writes everything to .env (gitignored, permissions 600)
//
// Instagram Login:
//   node scripts/setup-token.mjs --mode instagram [--token <token from "Generate token">]
//
// Missing values (app id, app secret, token) are prompted for; secrets are not echoed.
import { graph, loadEnv, writeEnv, mask, parseArgs, ask, HOSTS, GraphError } from './lib/graph.mjs';

const RECOMMENDED_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'instagram_manage_messages',
  'instagram_manage_contents',
  'instagram_manage_engagement',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_messaging',
  'business_management',
];

const args = parseArgs(process.argv.slice(2));
const env = loadEnv();
const mode = args.mode || env.IG_AUTH_MODE || 'facebook';
const version = args.version || env.IG_API_VERSION || 'v25.0';

try {
  if (mode === 'instagram') await setupInstagram();
  else await setupFacebook();
} catch (e) {
  console.error(`\n✖ ${e instanceof GraphError ? e.short : e.message}`);
  process.exit(1);
}

async function setupFacebook() {
  const appId = args['app-id'] || env.IG_APP_ID || (await ask('Meta App ID: '));
  const appSecret = args['app-secret'] || env.IG_APP_SECRET || (await ask('Meta App Secret (hidden): ', { secret: true }));
  const shortToken = args.token || (await ask('User access token from Graph API Explorer (hidden): ', { secret: true }));
  const fb = { host: HOSTS.facebook, version };
  const appToken = `${appId}|${appSecret}`;

  console.log('\n1/4 Exchanging for a long-lived user token…');
  const ll = await graph('GET', 'oauth/access_token', {
    ...fb,
    params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
  });
  const userToken = ll.access_token;
  const userInfo = await debugToken(userToken, appToken);
  const expiresAt = userInfo.expires_at ? new Date(userInfo.expires_at * 1000).toISOString() : 'never';
  console.log(`    user token ${mask(userToken)}, expires ${expiresAt}`);

  const granted = new Set(userInfo.scopes ?? []);
  const missing = RECOMMENDED_SCOPES.filter((s) => !granted.has(s));
  console.log(`    granted scopes: ${[...granted].sort().join(', ') || '(none reported)'}`);
  if (missing.length) {
    console.log(`    ⚠ not granted: ${missing.join(', ')}`);
    console.log('      Add them in Graph API Explorer if they are listed there, then re-run this script.');
    console.log('      Anything Meta does not offer for your app will show up as a failure in the probe instead.');
  }

  console.log('2/4 Finding your Page and linked Instagram account…');
  const pages = await graph('GET', 'me/accounts', {
    ...fb,
    token: userToken,
    params: { fields: 'id,name,access_token,tasks,instagram_business_account{id,username}', limit: 100 },
  });
  const linked = (pages.data ?? []).filter((p) => p.instagram_business_account);
  if (!pages.data?.length) {
    throw new Error(
      'No Pages returned. In Graph API Explorer, re-generate the token and make sure you select your Page ' +
        '(and grant pages_show_list) in the Facebook login dialog.',
    );
  }
  if (!linked.length) {
    throw new Error(
      `Found ${pages.data.length} Page(s) but none is linked to an Instagram professional account. ` +
        'Link your Instagram account to the Page (docs/SETUP.md step 2) and try again.',
    );
  }

  let page = linked[0];
  if (args['page-id']) {
    page = linked.find((p) => p.id === args['page-id']);
    if (!page) throw new Error(`Page ${args['page-id']} is not one of your linked Pages.`);
  } else if (linked.length > 1) {
    linked.forEach((p, i) => console.log(`    [${i + 1}] ${p.name} → @${p.instagram_business_account.username}`));
    const choice = Number(await ask('    Which one? ')) - 1;
    page = linked[choice] ?? linked[0];
  }
  const ig = page.instagram_business_account;
  console.log(`    Page "${page.name}" → Instagram @${ig.username}`);

  console.log('3/4 Checking the Page token…');
  const pageInfo = await debugToken(page.access_token, appToken);
  const pageExpiry = pageInfo.expires_at ? new Date(pageInfo.expires_at * 1000).toISOString() : 'never';
  console.log(`    page token ${mask(page.access_token)}, expires ${pageExpiry}`);

  console.log('4/4 Writing .env…');
  writeEnv({
    IG_AUTH_MODE: 'facebook',
    IG_API_VERSION: version,
    IG_APP_ID: appId,
    IG_APP_SECRET: appSecret,
    IG_USER_TOKEN: userToken,
    IG_USER_TOKEN_EXPIRES_AT: expiresAt,
    IG_PAGE_ID: page.id,
    IG_PAGE_TOKEN: page.access_token,
    IG_USER_ID: ig.id,
    IG_USERNAME: ig.username,
  });
  console.log('\n✔ Done. Next: npm run probe');
}

async function setupInstagram() {
  const token = args.token || (await ask('Instagram token from App Dashboard "Generate token" (hidden): ', { secret: true }));
  const me = await graph('GET', 'me', {
    host: HOSTS.instagram,
    version,
    token,
    params: { fields: 'id,user_id,username,account_type' },
  });
  console.log(`Token works for @${me.username} (${me.account_type}).`);
  writeEnv({
    IG_AUTH_MODE: 'instagram',
    IG_API_VERSION: version,
    IG_ACCESS_TOKEN: token,
    IG_USER_ID: me.user_id ?? me.id,
    IG_USERNAME: me.username,
  });
  console.log('✔ Wrote .env. Next: npm run probe');
}

async function debugToken(inputToken, appToken) {
  const res = await graph('GET', 'debug_token', {
    host: HOSTS.facebook,
    version,
    token: appToken,
    params: { input_token: inputToken },
  });
  if (!res.data?.is_valid) throw new Error('Meta reports this token as invalid.');
  return res.data;
}
