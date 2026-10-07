# Instagram Platform: Endpoint and Capability Catalog

Researched from the Meta Instagram Platform docs on 2026-10-07: all 88 pages in
`developers.facebook.com/documentation/instagram-platform/llms.txt`, the Messenger
Platform Instagram Messaging pages, and the changelog.

**API version.** Most pages use `v25.0`. The newest reference page (User Likes)
already shows `v26.0`. The server pins the version in config (see PLAN.md §5).

## Legend

**Login: which login type the endpoint works with.**
- **IG**: Instagram API with Instagram Login. Host `graph.instagram.com`, Instagram User token. No Facebook Page needed.
- **FB**: Instagram API with Facebook Login for Business. Host `graph.facebook.com`, Facebook User or Page token. The IG account must be linked to a Facebook Page.
- **Both**: the docs say it works with either login.
- **FB (IG?)**: the reference page only documents FB, but the feature is listed as supported on both. Confirm in the Phase 0 capability probe.

One Meta app uses **either** IG Login **or** FB Login, not both. That is why the server has an `authMode` switch.

**Tool**: the planned MCP tool name (PLAN.md §6). `—` means not exposed as a tool.

---

## 1. Authentication and tokens

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET (browser) | `www.instagram.com/oauth/authorize` | IG | Shows the Instagram consent screen and returns an auth `code` (valid 1h, single use) | `inst-mcp auth login` CLI |
| POST | `api.instagram.com/oauth/access_token` | IG | Exchanges the code for a 1-hour token and the user id | CLI |
| GET | `graph.instagram.com/access_token?grant_type=ig_exchange_token` | IG | Exchanges a 1h token for a 60-day long-lived token (server-side, needs the app secret) | CLI |
| GET | `graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` | IG | Extends a long-lived token by 60 days (the token must be at least 24h old) | `ig_token_refresh` plus automatic refresh |
| GET (browser) | `www.facebook.com/{v}/dialog/oauth` | FB | Facebook Login for Business dialog that returns a user token and a long-lived token | CLI |
| GET | `/me/accounts?fields=id,name,access_token,instagram_business_account` | FB | Lists your Pages, their Page tokens and the linked IG account IDs | `ig_list_linked_accounts` |
| GET | `/{page-id}?fields=instagram_business_account` | FB | Gets the IG account linked to one Page | `ig_list_linked_accounts` |

**Permissions.** Scopes the server can request.

*Instagram Login:*
- `instagram_business_basic`: profile and media (always required).
- `instagram_business_content_publish`: publish posts and check the publishing quota.
- `instagram_business_manage_comments`: read, reply to, hide and delete comments; mentions.
- `instagram_business_manage_messages`: DMs.
- `instagram_business_manage_insights`: insights.

*Facebook Login:*
- `instagram_basic`: base permission for almost everything.
- `instagram_content_publish`: publish.
- `instagram_manage_comments`: comments and mentions.
- `instagram_manage_insights`: insights and business discovery.
- `instagram_manage_messages`: DMs.
- `instagram_manage_contents`: delete media.
- `instagram_manage_engagement`: like and unlike.
- `instagram_manage_upcoming_events`: events.
- `instagram_shopping_tag_products` + `catalog_management`: product tags.
- `instagram_branded_content_creator`: paid-partnership label.
- `instagram_creator_marketplace_discovery`: creator search.
- `threads_business_basic`: Threads IDs.
- Page permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`.
- `business_management`, `ads_management`, `ads_read`: needed when the Page role was granted via Business Manager.

*Features that need approval:* Human Agent (7-day DM reply window), Instagram Public Content Access (hashtag search), Meta oEmbed Read.

---

## 2. Account / IG User

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/me` | IG | Resolves the token's account and returns id, user_id, username, name, account_type, profile pic and counts | `ig_get_account` |
| GET | `/{ig-user-id}` | Both | Reads profile fields: biography, website, followers_count, follows_count, media_count, profile_picture_url, and others | `ig_get_account` |
| GET | `/{ig-user-id}/content_publishing_limit` | Both | Shows how much of the 24h publishing quota is used (`quota_usage`, `config`) | `ig_get_publishing_limit` |
| GET | `/{ig-user-id}?fields=shopping_product_tag_eligibility` | FB | Checks whether the account can tag products | `ig_shop_check_eligibility` |
| GET | `/{ig-user-id}/connected_threads_user` | FB | Gets the Threads account ID linked to this IG account | `ig_threads_get_user` |
| GET | `/{ig-user-id}/instagram_backed_threads_user` | FB | Gets the Instagram-backed Threads ID (used for Threads ads) | `ig_threads_get_user` |
| POST | `/{ig-user-id}/instagram_backed_threads_user` | FB | Creates an Instagram-backed Threads account for running Threads ads | `ig_threads_create_backed_user` |
| GET | `/{ig-user-id}/agencies` | FB | Lists businesses allowed to advertise for this account (edge listed only; no detail page) | `ig_list_ad_partners` |
| GET | `/{ig-user-id}/authorized_adaccounts` | FB | Lists ad accounts allowed to advertise for this account (edge listed only) | `ig_list_ad_partners` |

---

## 3. Media (read and manage)

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/{ig-user-id}/media` | Both | Lists your posts and reels (up to 10K most recent; `since`/`until`; excludes stories) | `ig_media_list` |
| GET | `/{ig-user-id}/stories` | FB (IG?) | Lists your currently live stories (24h) | `ig_stories_list` |
| GET | `/{ig-user-id}/live_media` | FB | Lists live broadcasts happening right now | `ig_live_list` |
| GET | `/{ig-media-id}` | Both | Reads one media's fields: caption, media_url, permalink, like and comment counts, timestamp, alt_text, and more | `ig_media_get` |
| GET | `/{ig-media-id}/children` | Both | Lists the items inside a carousel | `ig_media_get` (`include_children`) |
| POST | `/{ig-media-id}` `comment_enabled=` | Both | Turns comments on or off for a post | `ig_media_set_comments_enabled` |
| DELETE | `/{ig-media-id}` | FB | Deletes a post, reel, story or whole carousel (`instagram_manage_contents`) | `ig_media_delete` |
| GET | `/{ig-media-id}?fields=copyright_check_information` | FB | Shows copyright matches found on published media | `ig_media_check_copyright` |
| GET | `/{ig-media-id}?fields=total_like_count,total_comments_count,total_views_count,saved_count,shares_count,reposts_count` | FB | Totals across all surfaces, including boosted and ad versions | `ig_media_get` |

**IG Media fields.**
- Core: `id`, `caption`, `media_type` (IMAGE / VIDEO / CAROUSEL_ALBUM), `media_product_type` (FEED / REELS / STORY / AD), `media_url`, `thumbnail_url`, `permalink`, `shortcode`, `timestamp`, `username`, `owner`.
- Counts: `like_count`, `comments_count`.
- Flags: `is_comment_enabled`, `is_shared_to_feed`, `is_ai_generated`.
- Other: `alt_text`, `media_audio_type`, `legacy_instagram_media_id`, `copyright_check_information`, `boost_ads_list`, `boost_eligibility_info`.
- FB-only totals: `total_like_count`, `total_comments_count`, `total_views_count`, `saved_count`, `shares_count`, `reposts_count`.
- Business Discovery only: `view_count`.

---

## 4. Content publishing

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| POST | `/{ig-user-id}/media` | Both | Creates a media container for an image, video, reel, story, carousel item or carousel | `ig_publish_*` (high-level), `ig_container_create` (low-level) |
| POST | `/{ig-user-id}/media?upload_type=resumable` | FB (IG?) | Starts a resumable video upload session and returns `{id, uri}` | used inside `ig_publish_reel` / `_story` / `_carousel` |
| POST | `rupload.facebook.com/ig-api-upload/{v}/{container-id}` | FB (IG?) | Uploads local video bytes (`offset`, `file_size` headers) or a hosted `file_url` | `ig_upload_video` |
| GET | `/{container-id}?fields=status,status_code,video_status,copyright_check_status` | Both | Polls container state (IN_PROGRESS / FINISHED / ERROR / EXPIRED / PUBLISHED), upload progress and copyright check | `ig_container_status` |
| POST | `/{ig-user-id}/media_publish?creation_id=` | Both | Publishes a finished container and returns the media ID | `ig_container_publish` |
| GET | `/ig_audio?audio_type=music\|original_sound` | FB | Searches music or original-sound audio for Reels (trending if there is no query) | `ig_audio_search` |
| GET | `/{ig-audio-id}` | FB | Gets audio metadata: title, artist, duration, preview link | `ig_audio_get` |
| GET | `/ig_audio?product=ADS&purpose=AUDIO_COPYRIGHT_REPLACEMENT` | FB | Finds royalty-free replacement audio for a Reel with a copyright match (ads; limited release) | `ig_audio_find_replacement` |

**What a container can be:**
- **Image post:** `image_url` (JPEG, 8MB max, aspect 4:5 to 1.91:1).
- **Reel:** `media_type=REELS` plus `video_url` (MP4/MOV, 3s to 15min, 300MB max).
- **Trial reel:** a reel plus `trial_params.graduation_strategy=MANUAL|SS_PERFORMANCE`. It is shown to non-followers first.
- **Story:** `media_type=STORIES` plus an image or video (3–60s, 100MB max). No stickers.
- **Carousel item:** `is_carousel_item=true` plus an image or video.
- **Carousel:** `media_type=CAROUSEL` plus `children` (2–10 items). It counts as 1 post.

**Container options:**
- `caption`: 2200 chars, 30 hashtags, 20 @tags.
- `alt_text`: images only, 1000 chars.
- `location_id`: a Page ID that has a location.
- `user_tags`: `[{username, x, y}]`; works on images and stories.
- `collaborators`: up to 3 usernames; not on stories.
- `product_tags`: `[{product_id, x, y}]`; FB only.
- `cover_url` / `thumb_offset`: reel cover image or thumbnail frame.
- `share_to_feed`: reels only.
- `audio_name`: rename the reel's original audio (once).
- `audio_configuration`: `{audio_id, audio_volume, video_volume}`; FB.
- `is_ai_generated`: AI label; carousel parent only.
- `branded_content_sponsor_ids` (max 2) and `is_paid_partnership`: "Paid partnership" label; FB.

**Limits:**
- Publishing cap: the docs disagree, saying **50** (reference pages) and **100** (guide) posts per 24h. The server reads the real cap from `content_publishing_limit`.
- 400 containers per 24h. Containers expire after 24h.
- Media URLs must be publicly reachable when Meta fetches them.

---

## 5. Comments and moderation

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/{ig-media-id}/comments` | Both | Lists top-level comments on a post (50 per page, newest first) | `ig_comments_list` |
| POST | `/{ig-media-id}/comments` | Both | Posts a new top-level comment on your media | `ig_comment_create` |
| GET | `/{ig-comment-id}` | Both | Reads a comment: text, from, username, like_count, hidden, parent_id, timestamp | `ig_comment_get` |
| GET | `/{ig-comment-id}/replies` | Both | Lists replies under a comment | `ig_comment_replies_list` |
| POST | `/{ig-comment-id}/replies` | Both | Replies publicly to a top-level comment | `ig_comment_reply` |
| POST | `/{ig-comment-id}` `hide=true\|false` | Both | Hides or unhides a comment | `ig_comment_hide` |
| DELETE | `/{ig-comment-id}` | Both | Deletes a comment on your media (any author) | `ig_comment_delete` |
| POST | `/{ig-user-id}/messages` `recipient.comment_id` | Both | **Private reply**: sends one DM to a commenter (within 7 days; during the broadcast for Live) | `ig_comment_private_reply` |
| POST | `/{ig-user-id}/likes` `media_id\|comment_id` | FB | Likes a post, reel, carousel, comment or reply (burst limit: 50 per 5s, or a 1h lockout) | `ig_like` |
| DELETE | `/{ig-user-id}/likes` `media_id\|comment_id` | FB | Removes a like | `ig_unlike` |

---

## 6. Mentions and tags

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/{ig-user-id}/tags` | Both | Lists media where other accounts tagged you | `ig_tagged_media_list` |
| GET | `/{ig-user-id}?fields=mentioned_media.media_id(X){…}` | FB (IG?) | Reads a post whose caption @mentions you (ID comes from a webhook) | `ig_mention_get_media` |
| GET | `/{ig-user-id}?fields=mentioned_comment.comment_id(X){…}` | FB (IG?) | Reads a comment that @mentions you (ID comes from a webhook) | `ig_mention_get_comment` |
| POST | `/{ig-user-id}/mentions` | Both | Replies to a caption or comment that @mentioned you (as a comment thread) | `ig_mention_reply` |

---

## 7. Hashtag search (FB only, needs "Instagram Public Content Access")

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/ig_hashtag_search?q=` | FB | Converts a hashtag name to its global ID (counts toward 30 unique per 7 days) | `ig_hashtag_search` |
| GET | `/{hashtag-id}` | FB | Reads a hashtag's id and name | `ig_hashtag_search` |
| GET | `/{hashtag-id}/top_media` | FB | Most popular public posts with the hashtag | `ig_hashtag_media` (`sort=top`) |
| GET | `/{hashtag-id}/recent_media` | FB | Public posts with the hashtag from the last 24h | `ig_hashtag_media` (`sort=recent`) |
| GET | `/{ig-user-id}/recently_searched_hashtags` | FB | Hashtags you queried in the last 7 days (shows quota use) | `ig_hashtag_recent_searches` |

---

## 8. Insights

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/{ig-user-id}/insights` | Both | Account metrics over time, with breakdowns and demographics | `ig_insights_account` |
| GET | `/{ig-media-id}/insights` | Both | Lifetime metrics for one post, reel or story | `ig_insights_media` |

**Account metrics** (`period=day` unless noted; `metric_type=total_value|time_series`; `since`/`until` or `timeframe`):
- `reach`: unique accounts that saw your content. Breakdowns: `media_product_type`, `follow_type`.
- `views`: times content was played or shown. Breakdowns: `follow_type`, `media_product_type`.
- `accounts_engaged`: accounts that interacted with your content.
- `total_interactions`: all likes, saves, comments, shares and replies. Breakdown: `media_product_type`.
- `likes`, `comments`, `saves`, `shares`, `reposts`, `replies`: per-interaction counts.
- `follows_and_unfollows`: follows gained and lost. Breakdown: `follow_type`. Needs 100+ followers.
- `profile_links_taps`: taps on call, email, address and book buttons. Breakdown: `contact_button_type`.
- `follower_demographics` (`lifetime`): followers by age, gender, country or city. `timeframe=this_week|this_month`; needs 100+ followers.
- `engaged_audience_demographics` (`lifetime`): engaged accounts by age, gender, country or city.
- Also in the Limitations section: `follower_count`, `online_followers` (last 30 days).

**Media metrics** (always lifetime):

| Metric | Feed | Reels | Story | Meaning |
|---|---|---|---|---|
| `reach` | ✓ | ✓ | ✓ | Unique accounts that saw it |
| `views` | ✓ | ✓ | ✓ | Plays or displays |
| `likes`, `comments`, `saved`, `shares`, `reposts` | ✓ | ✓ | shares, reposts | Engagement counts |
| `total_interactions` | ✓ | ✓ | ✓ | Sum of interactions |
| `follows`, `profile_visits`, `profile_activity` | ✓ | — | ✓ | Profile actions it drove (`action_type` breakdown) |
| `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate` | — | ✓ | — | Watch time and skip rate in the first 3s |
| `crossposted_views`, `facebook_views` | FB views only | ✓ | FB views only | Views on Facebook |
| `navigation` | — | — | ✓ | Taps forward, back, exit and next story (`story_navigation_action_type`) |
| `replies` | — | — | ✓ | Story replies (0 in the EU and Japan) |
| `link_clicks` | — | — | ✓ (FB) | Story link sticker taps |
| `total_likes`, `total_comments`, `total_views` | ✓ (FB) | ✓ (FB) | views (FB) | Totals including ads and boosts |

**Deprecated, do not implement:**
- `impressions` (removed April 2025).
- `plays`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count`, `video_views`.
- `profile_views`, `website_clicks`, `email_contacts`, `phone_call_clicks`, `text_message_clicks`, `get_direction_clicks`.
- `audience_*` and `carousel_album_*` metrics.

---

## 9. Competitor research and embeds

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/{ig-user-id}?fields=business_discovery.username(X){…}` | FB | Reads another Business or Creator account's public profile and media stats (followers, media, likes, comments, view_count) | `ig_business_discovery` |
| GET | `/instagram_oembed?url=` | FB (no token needed since May 2026) | Gets embed HTML and metadata for a public post, reel or profile (1,000 per hour) | `ig_oembed` |

---

## 10. Direct messages (Messaging API)

Two variants:
- IG Login: `graph.instagram.com/{ig-id}/…` with an IG token.
- FB Login: Messenger Platform, `graph.facebook.com/{page-id}/…` with a Page token.

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/{ig-id or page-id}/conversations?platform=instagram` | Both | Lists DM threads, or finds one thread with `user_id=` (2 calls per second) | `ig_dm_conversations_list` |
| GET | `/{conversation-id}?fields=messages` | Both | Lists message IDs and times in a thread | `ig_dm_conversation_get` |
| GET | `/{message-id}?fields=id,created_time,from,to,message,story,reply_to` | Both | Reads one message (only the 20 most recent per thread have details) | `ig_dm_message_get` |
| GET | `/{igsid}?fields=name,username,profile_pic,follower_count,is_verified_user,is_user_follow_business,is_business_follow_user` | Both | User Profile API for someone who messaged you | `ig_dm_user_profile` |
| POST | `/{id}/messages` | Both | Send API. Supported message types are listed below | `ig_dm_send`, `ig_dm_send_template`, `ig_dm_send_quick_replies` |
| POST | `/{id}/messages` `sender_action=react\|unreact` | Both | Adds or removes an emoji reaction on a message | `ig_dm_react` |
| POST | `/{id}/messages` `sender_action=typing_on\|typing_off\|mark_seen` | Both | Shows typing, or marks the thread seen | `ig_dm_sender_action` |
| POST | `/{ig-scoped-id}/messages` (to self) | Both | Self-messaging: the account sends a test message to itself | `ig_dm_send_self` |
| POST | `/{page-id}/message_attachments` | FB | Uploads an image, video, audio or PDF once and returns a reusable `attachment_id` | `ig_dm_upload_attachment` |
| POST | `/{page-id}/moderate_conversations` | FB | Blocks or unblocks a user, or moves a thread to spam (up to 10 users) | `ig_dm_moderate` |

**Send API message types:**
- Text or link: up to 1000 bytes.
- Image or GIF: up to 10 per message (png, jpeg or gif; 8MB).
- Video: mp4, ogg, avi, mov or webm; 25MB.
- Audio: aac, m4a, wav or mp4; 25MB.
- File: PDF; 25MB.
- Heart sticker: `like_heart`.
- Share your own published post: `MEDIA_SHARE`.
- Reply to a specific message: `reply_to.mid` (documented for FB).
- Quick replies: up to 13. Types are `text`, `user_phone_number` and `user_email`.
- Generic template: a carousel of up to 10 cards, each with up to 3 buttons.
- Button template: text up to 640 chars, with 1–3 buttons.
- Product template: up to 10 catalog products (FB only).
- Marketing-message opt-in template: `notification_messages` (FB only).
- `HUMAN_AGENT` tag: a human can reply up to 7 days after the user's last message (needs the Human Agent feature).

**Messaging rules:**
- The user must message first. You then have 24 hours to reply, or 7 days with `HUMAN_AGENT`.
- No promotional content in tagged messages. No group threads.
- A bot must offer a way to reach a human, and must disclose that it is a bot where the law requires it.

### 10a. Inbox configuration

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| GET | `/me/messenger_profile?fields=ice_breakers` | Both | Reads the FAQ starter questions | `ig_dm_ice_breakers_get` |
| POST | `/me/messenger_profile` `ice_breakers` | Both | Sets up to 4 FAQ questions shown on a new chat (per locale) | `ig_dm_ice_breakers_set` |
| DELETE | `/me/messenger_profile` `fields=["ice_breakers"]` | Both | Removes all ice breakers | `ig_dm_ice_breakers_delete` |
| GET / POST / DELETE | `/me/messenger_profile` `persistent_menu` | Both | Reads, sets or removes the always-on chat menu (postback or URL buttons) | `ig_dm_menu_get` / `_set` / `_delete` |
| GET | `/me/welcome_message_flows` | Both | Lists welcome flows used by Click-to-Instagram-Direct ads | `ig_dm_welcome_flows_list` |
| POST | `/me/welcome_message_flows` | Both | Creates or updates a welcome flow (text plus quick replies) | `ig_dm_welcome_flow_upsert` |
| DELETE | `/me/welcome_message_flows?flow_id=` | Both | Deletes a flow that is not used in an ad | `ig_dm_welcome_flow_delete` |
| — | `https://ig.me/m/{username}?ref=` | n/a | Deep link that opens a DM and passes a `ref` to the webhook (built locally) | `ig_dm_build_link` |

### 10b. Conversation routing / handover (FB only)

| Method | Endpoint | What it does | Tool |
|---|---|---|---|
| GET | `/{page-id}/thread_owner?recipient=` | Shows which app currently controls a thread | `ig_dm_thread_owner` |
| POST | `/{page-id}/pass_thread_control` | Hands the thread to another app or inbox (IG Inbox app id `1217981644879628`) | `ig_dm_thread_pass` |
| POST | `/{page-id}/take_thread_control` | Takes control of a thread (when Conversation Routing allows it) | `ig_dm_thread_take` |
| POST | `/{page-id}/release_thread_control` | Releases a thread to idle | `ig_dm_thread_release` |
| POST | `/{page-id}/request_thread_control` | Asks the owner app for control | `ig_dm_thread_request` |
| POST | `/{page-id}/extend_thread_control` | Keeps control for up to 7 days | `ig_dm_thread_extend` |
| GET | `/me?fields=messaging_feature_status` | Checks whether Conversation Routing or multi-app is on | `ig_dm_routing_status` |

---

## 11. Collaboration (FB only)

| Method | Endpoint | What it does | Tool |
|---|---|---|---|
| GET | `/{ig-user-id}/collaboration_invites` | Lists pending invites to be a collaborator on someone's post (300/day) | `ig_collab_invites_list` |
| POST | `/{ig-user-id}/collaboration_invites` `media_id, accept` | Accepts or declines an invite (50/day) | `ig_collab_invite_respond` |
| GET | `/{ig-user-id}/collaborative_media` | Lists posts where you are an accepted collaborator | `ig_collab_media_list` |
| GET | `/{ig-user-id}?fields=collaborative_media_search.media_id(X)` | Looks up one collaborative post | `ig_collab_media_list` (`media_id`) |
| GET | `/{ig-media-id}/collaborators` | Lists a post's collaborators and invite status | `ig_collab_media_collaborators` |

## 12. Shopping / product tagging (FB only, needs an approved IG Shop; Business accounts only)

| Method | Endpoint | What it does | Tool |
|---|---|---|---|
| GET | `/{ig-user-id}/available_catalogs` | Gets the Shop's product catalog | `ig_shop_catalogs` |
| GET | `/{ig-user-id}/catalog_product_search?catalog_id=&q=` | Searches taggable products by name or SKU | `ig_shop_product_search` |
| GET | `/{ig-media-id}/product_tags` | Reads product tags on a post | `ig_shop_tags_get` |
| POST | `/{ig-media-id}/product_tags` `updated_tags` | Adds or moves product tags on an existing post (feed 20, reels 30) | `ig_shop_tags_set` |
| GET | `/{ig-user-id}/product_appeal?product_id=` | Checks a rejected product's appeal status | `ig_shop_appeal_status` |
| POST | `/{ig-user-id}/product_appeal` | Appeals a product rejection | `ig_shop_appeal` |

## 13. Upcoming events (FB only; for reminder ads)

| Method | Endpoint | What it does | Tool |
|---|---|---|---|
| GET | `/{ig-user-id}/upcoming_events` | Lists upcoming events | `ig_events_list` |
| POST | `/{ig-user-id}/upcoming_events` | Creates an event (title, start/end, notification settings) | `ig_event_create` |
| GET | `/{event-id}` | Reads an event | `ig_events_list` (`event_id`) |
| POST | `/{event-id}` | Updates an event | `ig_event_update` |

## 14. Creator Marketplace (FB only; Advanced Access; brand must be eligible)

| Method | Endpoint | What it does | Tool |
|---|---|---|---|
| GET | `/{ig-user-id}/creator_marketplace_creators` | Searches creators with about 20 filters: country, followers, age, interests, audience, engagement, similar creators, recommendation type, free-text query | `ig_creators_search` |
| GET | `/{ig-user-id}/creator_marketplace_creators?username=&fields=insights…` | Gets one creator's insights (reach, engaged accounts, reels hook and interaction rate), recent and branded media, and past partnerships | `ig_creator_get` |
| GET | `/{ig-user-id}/creator_marketplace_brand_info` | Lists your custom audiences that can be used as creator filters | `ig_creators_brand_audiences` |

Rate limit: 1,000 requests per user per hour.

---

## 15. Webhooks (real-time events)

| Method | Endpoint | Login | What it does | Tool |
|---|---|---|---|---|
| POST | `/me/subscribed_apps?subscribed_fields=` | IG | Turns on webhook delivery for the account | `ig_webhooks_subscribe` |
| POST / GET | `/{page-id}/subscribed_apps` | FB | Subscribes a Page, or lists the apps subscribed to it | `ig_webhooks_subscribe` / `_status` |
| GET (inbound) | `your-url?hub.mode=subscribe&hub.challenge=` | Both | Meta verifies your endpoint; echo back the challenge | webhook receiver |
| POST (inbound) | `your-url` + `X-Hub-Signature-256` | Both | Event delivery; verify the HMAC-SHA256 with the app secret | webhook receiver → `ig_events_list` |

**Subscribable fields:**
- `comments`: new comment on your media; with IG Login this also covers @mentions.
- `live_comments`: comment during a Live broadcast.
- `mentions` (FB): you were @mentioned in a caption or comment.
- `story_insights` (FB): story metrics when the story expires.
- `messages`: incoming DM, story reply or mention, share, ad referral, deletion, or echo.
- `messaging_postbacks`: ice breaker, menu or button tapped.
- `messaging_seen`: the user read your message.
- `message_reactions`: the user reacted or unreacted.
- `messaging_referral`: the user opened a thread via an ig.me link or an ad.
- `messaging_optins`: marketing-message opt-in.
- `messaging_handover`: thread control changed.
- `standby`: a message arrived while another app owns the thread.
- `messaging_policy_enforcement` (FB): Meta warned or blocked your app.
- `response_feedback` (FB): the user rated a bot reply.
- `message_edit`: the user edited a message. The docs disagree on whether this applies to IG.

Webhook requirements: the app is Live, Business Verification is done, the account is public, and `comments` / `live_comments` have Advanced Access.

---

## 16. Out of scope for the MCP server (not REST, deprecated, or ads-only)

- **Sharing to Feed / Stories:** Android intents (`com.instagram.share.ADD_TO_STORY`) and iOS URL schemes (`instagram-stories://share`) used inside mobile apps.
- **Embed button:** a manual copy-paste in the Instagram web UI. `ig_oembed` covers it programmatically.
- **Deprecated Instagram v1.0 Marketing endpoints:** `/{page-id}/instagram-accounts`, `/{business-id}/owned-instagram-accounts`, `assigned-instagram-accounts`, and others. All were removed by May 2025.
- **Partnership Ads and `branded_content_ad_permissions`:** these belong to the Marketing API. They are a possible future add-on toolset.
- **Messaging Insights** (`/{page-id}/insights` with `messaging_channel`): skimmed only. It is a candidate for the insights toolset in a later phase.

## 17. Known rate limits (enforced client-side)

| Scope | Limit |
|---|---|
| Most endpoints (Business Use Case) | 4800 × account impressions per rolling 24h, per app–user pair. Read from the `X-Business-Use-Case-Usage` header |
| Publishing | 50 or 100 posts per 24h (check `content_publishing_limit`); 400 containers per 24h |
| Hashtags | 30 unique per rolling 7 days |
| Send API | 100/s for text, links, reactions and stickers; 10/s for audio and video |
| Private replies | 750/h for post and reel comments; 100/s for Live |
| Conversations API | 2/s per account |
| Likes | More than 50 in 5s causes a 1h lockout |
| Collaboration invites | GET 300/day, POST 50/day |
| Product-tagged posts | 25 per 24h |
| Messenger Profile (FB) | 10 calls per 10 min per Page |
| Creator Marketplace | 1,000 per user per hour |
| oEmbed | 1,000 per hour |
