# Dayline

A repeating weekly planner with private account saves and hourly web push updates.

## Run locally

Use Node.js 22 or later:

```sh
npm ci
npm run build
npm start
```

The development server listens on port 3000. No cloud credentials are needed for
local planning. Tasks, subjects, colors, and completion states save in this
browser. The build also produces **dist/dayline-local.html**, a self-contained
local copy you can download and open to review the planner. It uses local saves
only. The earlier mockup remains at public/mockup.html.

The weekly plan repeats: edits change the reusable weekly template, not one
calendar date. Completion applies only to the current date in the schedule's
IANA time zone, resets at midnight, and is rechecked after waking the device.

- Drag a subject from the bottom tray, or select it and click a slot; enter a title.
- Each task shows its title, subject, and (when tall enough) time range.
- Drag the middle to move a task; drag either edge to resize in 15-minute steps.
- Click to complete/undo; Ctrl + click to delete. Blocks cannot overlap.
- Focus an edge and use arrow keys to resize with a keyboard.
- The tray arrow hides/shows subjects; + adds a name and color after the last block.
- Schedule settings includes a JSON backup download and time zone selection.

## Free hosting architecture

Cloudflare Pages serves `dist`. Supabase Auth handles logins, and its PostgreSQL
database stores one weekly planner per user with row-level security. A Cloudflare
Worker runs every 15 minutes, checks local hours, and sends encrypted Web Push
messages only at each user's full local hour. This supports half- and quarter-hour
UTC offsets as well as daylight saving time. No SMS, paid domain, or paid plan is
required for a small personal deployment. Provider quotas and free-plan terms
still apply; verify current plans when creating accounts and leave paid upgrades
disabled. Free projects can pause or have quotas, so delivery is best effort.

## 1. Set up the private database and login

1. Create a **free Supabase project** in your own account.
2. Run the entire `supabase/schema.sql` in its SQL editor. It is rerunnable.
3. Copy the project URL and **publishable key** from project settings. Never use
   a service-role/secret key in the browser or Pages build.
4. Set Auth's Site URL to your eventual Pages URL. Allow the same URL as a redirect;
   add the local development URL if you want to test account flows locally.
5. Recommended zero-email-provider option: enable **Google** under Auth providers.
   Create a Google OAuth web client, use Supabase's displayed callback URL as its
   authorized redirect URI, and enter the client ID/secret in Supabase. Basic
   Google sign-in does not require buying a domain. While Google consent is in
   testing mode, add yourself as a test user.
6. Email/password is also implemented, including confirmation and password reset.
   Supabase's built-in email service has strict limits and recipient restrictions;
   it is not a public production mail service. For personal use check that your
   email is an allowed recipient. Use Google login if you do not want to configure
   a separate mail service. Do not disable email verification just to bypass this.

Database tests verify two separate users cannot access each other's planner,
settings, or device subscriptions. Anonymous users have no access. Saves use an
atomic revision check so an old device cannot overwrite a newer cloud save.
Conflicts keep local edits and offer a backup download or explicit reload of the
latest cloud save. Guest and account saves are separate. To migrate your local
plan, log in, open Schedule settings, and choose **Copy this device's local plan**.

## 2. Publish the website to a free address

Connect this repository to **Cloudflare Pages**, with:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22 or later |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Your public publishable key |
| `PUSH_API_URL` | The Worker URL from step 3 |

Cloudflare assigns an available `YOUR_NAME.pages.dev` address. No custom domain
is required. Set Supabase's Site URL/redirect allowlist to this exact address.
Subsequent GitHub updates can automatically rebuild and publish through Pages.

For CLI deployment instead of Git integration, authenticate Wrangler to your own
Cloudflare account, set the three public build variables in your shell, and run
`npm run deploy:web`. `.env.example` lists names only; the build reads process
environment variables and does not automatically load `.env` files.

## 3. Configure hourly phone notifications

1. Run `npm run keys` once. This creates an ignored, permission-restricted
   `.data/vapid.json`. Preserve the keys securely; changing them requires reconnecting
   devices. The command refuses to overwrite existing keys.
2. In the Cloudflare Worker settings, configure:

| Worker variable/secret | Value |
| --- | --- |
| `SUPABASE_URL` | Same project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key; **secret**, backend only |
| `VAPID_PUBLIC_KEY` | `publicKey` from your generated file |
| `VAPID_PRIVATE_KEY` | `privateKey` from the file; **secret** |
| `VAPID_SUBJECT` | `mailto:YOUR_REAL_EMAIL` |
| `APP_ORIGIN` | Exact Pages origin, e.g. `https://YOUR_NAME.pages.dev`, no trailing slash |

   Use the dashboard's encrypted secrets or `wrangler secret put NAME --config
   worker/wrangler.toml`. Do not paste credentials into chat, source files, logs,
   or Pages configuration. The frontend only receives the publishable key.
3. Run `npm run deploy:push`, or deploy `worker/index.js` using
   `worker/wrangler.toml`. The config includes the scheduled trigger.
4. Put the resulting Worker HTTPS URL into Pages' `PUSH_API_URL` and rebuild Pages.
5. On the exact phone you want to notify, open your Pages website and log in.
   On iPhone (iOS 16.4+), add the website to the Home Screen and open it there first.
6. Open **Notifications**, tap **Enable notifications on this device**, and allow
   permission. Enable hourly updates and save. Default hours cover the entire day;
   you can also set a narrower or overnight range.
7. Tap **Send test notification**. Test delivery is limited to once a minute per
   account. Confirm it appears on the phone, then verify the next real hourly update.

Connect every desired device separately. Logging out disconnects that browser's
push subscription. You can also disconnect it from notification settings. Your
phone number is never used. Browser support, network access, and OS notification
settings can delay or suppress delivery. No guarantee of exact-to-the-minute
arrival is made. A failed hourly delivery is logged without exposing subscription
URLs; expired endpoints are deleted. Hourly sends are deduplicated per account
and UTC hour/quarter-hour; a failed send is not automatically replayed, to avoid
sending duplicate hourly updates. Deduplication rows are purged after seven days.

Hourly notifications list **Done** tasks and **Left to do** tasks for the current day, using task titles in schedule order. Empty days say no tasks are scheduled. Very long lists show an omitted-task count so the encrypted message stays within push payload limits; phone operating systems may also shorten the displayed text.

Worker configuration explicitly sets `APP_ORIGIN` to `https://codexstudyapp.pages.dev`. If hosting on a different address, update `[vars]` in `worker/wrangler.toml`. The public `/health` endpoint lists missing/invalid runtime variable names and the allowed website origin, but never exposes keys. A `configured` result checks configuration shape only, not live database access or physical-phone delivery.

## Verification

```sh
npm test                 # model, timezone/recurrence, database isolation, push API
npm run test:ui          # desktop/mobile browser and simulated cloud account tests
npm run build
npx wrangler deploy --dry-run --config worker/wrangler.toml
```

Browser tests use system Chromium when available; otherwise install Playwright
Chromium with `npx playwright install chromium`, or set `CHROMIUM_PATH`.
The database tests run actual PostgreSQL policies/functions in PGlite, not a text
check of the SQL. Cloud account browser tests simulate Supabase responses;
production login/email/OAuth and physical-phone delivery must be checked after
real accounts and secrets are configured. These have not been verified against
a live hosted deployment by this repository's local tests.

On sandboxed machines with a read-only home directory, use
`npm ci --cache /tmp/dayline-npm-cache` and set `XDG_CONFIG_HOME=/tmp/dayline-config`
for Wrangler. Each cloud task is already isolated; use this existing checkout
rather than creating a Git worktree unless explicitly requested.
