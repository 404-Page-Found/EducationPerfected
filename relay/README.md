# Support report relay

A small Cloudflare Worker (free tier) that turns anonymous app reports into public GitHub issues on `404-Page-Found/EducationPerfected`. GitHub does not allow anonymous issue creation, so the app posts to this relay and only the relay holds an Issues-only token.

## What it accepts

`POST` with a JSON body under 512 bytes and exactly four fields: `task_type`, `reason` (both from fixed lists in `worker.mjs`), `app_version` (like `2026.11.26`) and `schema` (`1`). Anything else is rejected with an empty response.

## What it does

- One issue per `(task_type, reason)`: the first report creates it (label `task-support`), later reports only raise a counter stored in KV. The issue body is refreshed at 10, 100 and 1000 reports.
- A report from a newer app version than any seen before checks the issue and reopens it if it was closed.
- At most 30 GitHub writes a day (`DAILY_WRITE_CAP`). Past that, reports are still counted.
- `DISABLED` set to any non-empty value makes the relay do nothing.
- A rate limit binding runs first. The connection address is its key and is never stored or forwarded.

## Privacy

The Worker does not store or forward IP addresses, headers or user agents, and Workers logs and observability are off in `wrangler.toml`. Only validated enum values, a version and counters reach KV or GitHub. Cloudflare itself still sees connection metadata as the network provider; the code cannot change that.

## Deploy

1. Create a free Cloudflare account and install Wrangler (`npm i -g wrangler`, then `wrangler login`).
2. Create the KV namespace: `wrangler kv namespace create REPORTS`. Put the returned id in `wrangler.toml`.
3. Create a fine-grained GitHub token: repository `404-Page-Found/EducationPerfected` only, permission Issues read and write only, 90 day expiry.
4. Store it as a secret without printing it: `cd relay && wrangler secret put GITHUB_TOKEN`.
5. Deploy: `cd relay && wrangler deploy`. Note the Worker URL.
6. Test with one manual POST of `{"task_type":"audio","reason":"no-handler","app_version":"2026.11.26","schema":1}`, check the issue, then delete it and the KV entry.
7. Set the Worker URL as the relay URL in `lib/support-sender.js` (or `EP_SUPPORT_RELAY_URL` for testing) to turn sending on.
8. Calendar a token renewal before it expires.

To stop everything quickly, set `DISABLED` to `1` in `wrangler.toml` and run `wrangler deploy`.
