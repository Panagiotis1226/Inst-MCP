# Setup Guide (personal developer, no business needed)

This takes you from zero to a working token and a capability report for your own Instagram
account. It takes about 20–30 minutes, costs nothing, and needs **no registered business, no
business verification and no Meta App Review**.

Your Meta app stays in **Development mode** the whole time. In that mode, only people with a role
on the app (you, plus any testers you add) can use it. That is all a personal setup needs.

> Meta renames menu items from time to time. These steps were written on 2026-10-07. If a label
> differs slightly, look for the closest match.

## What you need

- An Instagram account you control. A secondary or test account is a good idea while experimenting.
- A Facebook account (the same person who owns the Instagram account).
- Node.js 18.17 or newer (22 LTS recommended): <https://nodejs.org>
- This repository cloned locally.

## What "no business" means for features

| Status | Features |
|---|---|
| ✅ **Expected to work** | Profile, media, publishing (posts, carousels, reels, trial reels, stories), comments and moderation, mentions, insights, DMs (with testers while in Development mode), business discovery (public stats of other accounts), collaboration invites, like/unlike, deleting media, Reels audio search, oEmbed |
| ❓ **The probe will tell** | Hashtag search (Meta says it needs business verification, but app-role users get all features in Development mode), Threads account IDs |
| ⛔ **Needs a business or Shop** | Webhooks / real-time events (app must be published and business-verified; the server's `ig_activity_check` polling replaces this). Product tagging and shopping (needs an approved Instagram Shop). Creator Marketplace (brand eligibility). Upcoming events (account must belong to a business portfolio). Paid-partnership labels (eligibility) |

Some insights metrics (follower demographics, follows/unfollows, online followers) also need the
account to have **100+ followers**. Below that, Meta returns an error for those metrics, and the probe
shows it as expected.

---

## Step 1: Make your Instagram account a professional (Creator) account

The API only works with professional accounts. Switching is free, reversible, and keeps your
followers and posts.

1. In the Instagram app, open your profile, tap **☰**, then **Settings and activity**.
2. Find **Account type and tools**, then **Switch to professional account**. You can also search "professional" in settings.
3. Choose **Creator**, pick any category, and finish.

Creator vs Business: either works with the API. Choose **Creator** for personal use. Business is only
needed for shopping features later.

## Step 2: Create a Facebook Page and link it to the Instagram account

Facebook Login mode, which gives the full feature set, needs the Instagram account to be connected
to a Facebook Page. The Page can be empty, and anyone can create one; no business is needed.

1. Go to <https://www.facebook.com/pages/create>. Give it any name, pick a category such as "Personal blog", and click **Create Page**. You can skip the optional steps.
2. Link Instagram using either path:
   - **Instagram app:** **Edit profile**, then **Page** (under public business information), then **Connect existing Page**, and choose the Page you just made.
   - **Facebook:** open the Page, then **Settings**, **Linked accounts**, **Instagram**, **Connect account**.

## Step 3: Register as a Meta developer

1. While logged into Facebook, open <https://developers.facebook.com/async/registration>.
2. Accept the terms, verify your phone and email, and pick an occupation such as "Developer".

## Step 4: Create the Meta app

1. Open <https://developers.facebook.com/apps/creation>.
2. **App details:** use a name like `inst-mcp-personal`. Meta rejects names containing its trademarks, such as "Instagram", "Insta", "IG" or "Facebook". Enter your email and click **Next**.
3. **Use cases:** select **Manage messaging & content on Instagram**, then **Next**.
4. **Business:** choose **I don't want to connect a business portfolio yet**, then **Next**.
5. Click **Next** past Requirements, then **Go to dashboard**.
6. On the dashboard, click **Customize** on the *Manage messaging and content on Instagram* use case.
7. In the left menu, choose **API setup with Facebook Login** (not "with Instagram Login"; an app can only have one).
8. Click **Add all required permissions** (content), and then **Add required messaging permissions**.
9. Open **Permissions and features** for this use case. Add any of the following that are listed. Skip anything that isn't offered; the probe reports what is missing.
   - `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_contents`, `instagram_manage_engagement`
   - `pages_manage_metadata`, `pages_messaging`
   - `instagram_manage_upcoming_events`, `instagram_branded_content_creator`, `threads_business_basic`
   - Features: **Human Agent**, **Instagram Public Content Access**
10. Go to **App settings**, then **Basic**. Copy the **App ID**, then click **Show** next to **App Secret** and copy it. Treat the secret like a password.

Leave the app in **Development** mode. Don't publish it; nothing here needs Live mode.

## Step 5: Get a starting token in the Graph API Explorer

1. Open <https://developers.facebook.com/tools/explorer>.
2. In the right panel, set **Meta App** to your new app.
3. Set **User or Page** to **Get User Access Token**.
4. Under **Permissions**, add these. Type each name and press Enter; skip any the list doesn't offer.
   ```
   instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_insights,
   instagram_manage_messages, instagram_manage_contents, instagram_manage_engagement,
   pages_show_list, pages_read_engagement, pages_manage_metadata, pages_messaging, business_management
   ```
5. Click **Generate Access Token**. In the Facebook dialog, **select your Page and your Instagram account** when asked what the app can access. This is the step people most often miss. Then continue.
6. Copy the token from the **Access Token** field. It is valid for only 1 hour, so do the next step right away.

## Step 6: Turn it into long-lived credentials

From the repository folder:

```bash
npm run setup-token
```

It asks for the App ID, the App Secret and the token from Step 5. Secrets are not shown as you type.

The script then:
1. exchanges the token for a **60-day user token**;
2. finds your Page and its linked Instagram account;
3. gets the **Page token**, which does not expire when it comes from a long-lived user token;
4. writes everything to `.env`. That file is gitignored and readable only by you.

It also lists any recommended permissions you haven't granted. If you want them, add them in the
Explorer, generate a new token, and run the script again.

## Step 7: Run the capability probe

**Read-only first.** This makes about 150 API calls and takes 1–2 minutes. It changes nothing.

```bash
npm run probe
```

**Then the write checks**, which are designed to leave your account as they found it:

```bash
npm run probe:write
```

Here is exactly what `--write` does:

| Action | Cleanup |
|---|---|
| Posts a comment "inst-mcp probe test (auto-deleted)" on your latest post. It likes, hides, unhides and replies to that comment | The reply and the comment are deleted seconds later |
| Re-applies your post's current "comments enabled" setting | No change |
| Sets one ice-breaker question and one menu item, **only if you have none** | Removed right after |
| Creates an image container and a video upload session | **Never published.** Both expire on their own after 24h. They count toward the 400 containers/day limit, not toward posts |
| Sends a DM **only if** you set `PROBE_DM_RECIPIENT` | — |

It never publishes a post and never deletes your posts.

**Optional settings.** Add any of these to `.env` before running:

| Variable | Effect |
|---|---|
| `PROBE_HASHTAG=sunset` | Tests hashtag search. Uses 1 of your 30 unique hashtag searches per 7 days |
| `PROBE_DISCOVERY_USERNAME=natgeo` | Public Business/Creator account for the business-discovery test (default `instagram`) |
| `PROBE_IMAGE_URL=https://…/photo.jpg` | Public JPEG for the container test (default: a Wikimedia sample image) |
| `PROBE_DM_RECIPIENT=<id>` | Tests sending a DM to this person. The probe prints their ID if they've messaged you |
| `PROBE_MENTION_MEDIA_ID` / `PROBE_MENTION_COMMENT_ID` | Tests reading @mentions (the IDs normally come from webhooks) |

**Testing DMs while in Development mode.** The other person must have a role on your app. Add your
second account under **App roles**, **Roles**, **Add People**, **Tester**. They accept the invite in
Facebook **Settings**, **Apps and websites**. Then they DM your Instagram account, and you run the
probe within 24 hours (Meta's reply window).

## Step 8: Share the results

The probe writes these files:
- `probe-results/capability-matrix-facebook.md` (readable)
- `probe-results/capability-matrix-facebook.json` (for tooling)

All IDs, usernames, links and tokens in them are replaced with placeholders like `{ig-user-id}`, so
they are safe to share. Paste the `.md` file into the chat. It settles the open questions in PLAN.md:
- the publishing cap (50 or 100);
- which API version is current;
- whether the non-expiring Page token is enough on its own;
- which features work without a business.

---

## Tokens: lifetime, renewal and safety

| Token | Lifetime | Renewal |
|---|---|---|
| User token (`IG_USER_TOKEN`) | ~60 days | Repeat steps 5–6. The probe's `page_token_sufficient` finding shows whether you can skip this entirely |
| Page token (`IG_PAGE_TOKEN`) | Does not expire | Only stops working if you change your Facebook password, remove the app, or lose your Page role |

- **Never** paste tokens or the App Secret into chats, issues or commits. `.env` is gitignored for this reason.
- **To revoke everything:**
  - remove the app in Facebook **Settings**, **Apps and websites** (or **Business integrations**); or
  - reset the App Secret in **App settings**, **Basic**.

## Troubleshooting

| Error | Fix |
|---|---|
| `No Pages returned` / `none is linked` | In Step 5, the Page or Instagram account wasn't selected, or Step 2 isn't done. Click **Get User Access Token** again, choose "Edit settings", and tick your Page and Instagram account |
| `#190 Invalid OAuth access token` | The Explorer token expired (1h) or was revoked. Generate a new one and re-run `npm run setup-token` |
| `#10` or `#200` permission errors | That permission isn't granted or isn't added to the use case. Add it (Step 4.9 / 5.4) if Meta offers it; otherwise it is a "needs a business" feature |
| `#100 … not supported` on an insights metric | Expected for deprecated metrics, for small accounts (under 100 followers) and for media types that metric doesn't apply to |
| Container check fails with `9004/2207052` | Meta couldn't download `PROBE_IMAGE_URL`. Set it to another public JPEG |
| Business discovery fails | Try another public Business/Creator account via `PROBE_DISCOVERY_USERNAME` |

## Instagram Login mode (alternative, not the default)

If you ever want the simpler mode without a Facebook Page (fewer features, see PLAN.md):
1. Create a **separate** app with the same use case, but choose **API setup with Instagram Login**.
2. Click **Add account** under **Generate access tokens** and copy the 60-day token.
3. Run `npm run setup-token -- --mode instagram`, then `npm run probe`.
