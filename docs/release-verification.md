# CiteSeen release verification (16 Oct 2026)

Production: https://citeseen.pages.dev (Cloudflare Pages project `citeseen`, D1 `citeseen-db`, KV `CITESEEN_KV`).

## Verified

| Area | Result |
|---|---|
| Build parity | Live files match `dist/` byte for byte (sha256) after redeploy. |
| Routes | `/`, `/sample`, `/tools/`, 4 tools, `/login`, `/about`, `/contact`, `/privacy`, `/terms`, `/refunds` return 200; unknown paths 404; `/app` redirects to `/login?next=/app` without a session. |
| Viewports | No horizontal overflow at 360, 390, 768, 1024, 1280, 1440 px. Screenshots checked for home, sample report, dashboard, robots generator and login. |
| Audit API | NDJSON stream emits page, robots, simulation, sitemap, scoring stages then a result. Invalid URL → 400, private host → 400, unreachable host → 422 with a readable message. |
| Scoring | Score = earned ÷ applicable points. Recomputed from check data for a live audit: 35/87 → 40, matching engine, dashboard and report. N/A and inconclusive checks leave the denominator. |
| Severity and confidence | Display metadata only. They never enter the score. |
| Crawler classes | Scored: OAI-SearchBot, PerplexityBot, Claude-SearchBot, Googlebot, Bingbot. Reported, not scored: ChatGPT-User, Perplexity-User, Claude-User. Informational: 7 training crawlers. |
| About/Contact | `/about` and `/contact` are fetched before a page is reported as missing them. |
| Check counts | 18 checks, 16 scored, consistent across engine, report, dashboard and marketing. |
| Model recognition | Labelled as open models answering from training data, not live AI search or citations. Remaining "AI visibility" labels were replaced. |
| Tools | Crawler checker, raw-HTML view, llms.txt and robots.txt APIs return data; copy buttons copy the generated text. |
| Pricing | USD and INR toggle; the Plus launch tag now says the offer is US pricing only when INR is selected. Plan buttons link to `/login?next=…`. |
| Login | Error codes map to messages; unknown codes show a generic message, and HTML in the query string is escaped. Google is disabled with a note when not configured. |
| Dev sign-in | Local only. Production `/api/auth/email` returns `sent:false` with no dev link. |
| Dashboard (local dev sign-in) | Add site → audit → saved, survives reload, score matches the engine; the Model recognition tab says it is off without an API key. |
| D1 (remote) | All migrations applied, 12 app tables present. Production worker wrote to `login_tokens`, so the binding works. No users yet because sign-in is not configured. |
| Headers | CSP, `X-Frame-Options: DENY`, HSTS present. No console errors or failed requests on live pages. |
| Tests | 51 Vitest tests pass (3 new: inconclusive firewall exclusion, user-triggered bots not scored, About/Contact probe). `tsc --noEmit` clean. No lint config exists. |

## Fixed in this release

- robots.txt generator overflowed by 247 px at 360 px wide.
- Plus launch tag showed "$19/month" above ₹799 in India pricing.
- "AI visibility" labels on the dashboard, report, homepage and login meta described model recognition.

## Blockers (external setup, not code)

| Feature | Needs |
|---|---|
| Google sign-in | Pages secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; OAuth redirect `https://citeseen.pages.dev/api/auth/google/callback`. |
| Email sign-in | `RESEND_API_KEY` and a verified sending domain (`EMAIL_FROM`). Until then no one can create an account in production. |
| Model recognition | `NVIDIA_API_KEY`, and a check of NIM licence terms for commercial use. |
| Payments | PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_PLAN_*`, `PAYPAL_ENV`. Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. |

Set secrets with `npx wrangler pages secret put NAME --project-name citeseen`, then redeploy.

## Not verified

- Google, email, NIM and payment flows end to end (not configured).
- Real-device testing; viewports were emulated in Chromium.
- The hourly `citeseen-cron` worker run (no saved production sites to re-audit).
