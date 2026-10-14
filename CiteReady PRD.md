Contents

1. [Summary](#summary)
2. [Problem](#problem)
3. [Who pays](#customers)
4. [Competitor teardown](#teardown)
5. [Positioning](#positioning)
6. [Product scope](#product)
7. [Audit checks](#checks)
8. [Pricing & payments](#pricing)
9. [Tech & costs](#tech)
10. [SEO plan](#seo)
11. [GEO plan](#geo)
12. [AI leads & launch](#leads)
13. [Ads](#ads)
14. [90-day plan](#roadmap)
15. [Metrics & kill rules](#metrics)
16. [Risks](#risks)
17. [Open questions](#open)
18. [Sources](#sources)

Product requirements · v0.1 · 14 Oct 2026

# CiteReady: fix-first AI search audits for small agencies

A self-serve tool that shows why a website is invisible to ChatGPT, Perplexity and Google AI, gives the exact code to fix it, and proves the fix worked. White-label reports included at a price small agencies can afford.

Owner: Pithani Raghavendra Status: planning, nothing built Budget: ₹0 until revenue Working name, not final

## Summary

**The bet:** small SEO and web agencies need to sell "AI search visibility" to their clients, but the tools that produce client-ready, white-label reports cost $199–$385 a month. Most tools also only monitor. They tell you a brand is missing from AI answers, not what to change.

**What we build:** a free instant audit of the website itself, with copy-paste fixes for every problem. Paid plans add white-label PDF reports, weekly re-audits with before-and-after history, and later, real AI-answer checks.

**The target:** ₹5,000–10,000 a month in recurring revenue by month 3. That is 2–4 agencies on the $29 plan, or 1–2 on the $79 plan.

**Realistic expectations.** This is a 2–4 month bet, not money in week one. A rough estimate puts the chance of ₹5k a month after one month at 15–25%, and ₹5–10k a month by month 3 at 35–50% if someone posts and replies every day. Without daily distribution the chance is close to zero. These odds are judgement calls, not data.

## Problem

AI answer engines now decide which businesses get recommended, and many sites fail for reasons that are fixable but invisible to the owner:

- **The site blocks AI crawlers without the owner knowing.** A firewall, CDN default or old `robots.txt` rule can stop ChatGPT's or Perplexity's crawlers.
- **The page is empty without JavaScript.** Many AI crawlers read raw HTML. A React or Wix-style shell can look blank to them.
- **The site doesn't explain who the business is.** Missing organization schema, no `sameAs` links and vague titles make it hard for a model to connect the site to the brand.
- **Content isn't quotable.** No direct answers, no tables or lists, no dates. Citation studies repeatedly find structured, answer-first, data-rich pages get cited more often.

Independent reviews of GEO tools say most offer insights without actionable next steps. Peec AI is described by a reviewer as "a monitoring platform, not an optimization platform". That gap is what CiteReady fills.

## Who pays

| Segment | Why they pay | Plan | Priority |
| --- | --- | --- | --- |
| **Small SEO, web and marketing agencies** with 3–20 clients, worldwide | They bill clients monthly and need branded proof of work. One report pays for the month. | Agency $29 / Pro $79 | Primary |
| **Freelance SEO consultants** | Same as agencies, at a smaller scale. A $9 report is an easy upsell for them. | Pay-as-you-go, Agency | Primary |
| **SaaS founders and online stores** | AI recommendations bring signups and sales. They want alerts when something breaks. | Solo $12 | Secondary |
| Hobby bloggers, tiny local shops | They rarely pay. They use the free audit and spread the word. | Free | Not a target |

## Competitor teardown

Prices come from third-party listings checked in 2026, and some sources disagree. Confirm on each vendor's site before using them in marketing copy.

| Tool | Entry price | White-label | Fixes? | How they grew |
| --- | --- | --- | --- | --- |
| OtterlyAI | $29/mo | Agency workspaces from $189 | Basic GEO audit | #2 Product of the Day on Product Hunt, TechCrunch coverage, then the Semrush App Center. Reported 30,000+ users. |
| Peec AI | $95/mo | Higher tiers ($245+) | No, monitoring only | Daily data, Looker Studio export, API access. |
| Rankscale | \~$20/mo, very limited | Growth plan, $385/mo | Some audits | Credit-based plans, many engines tracked. |
| Spyglasses | $29/mo or $15 one-off | Agency plan, $199/mo | No | Pay-as-you-go entry point. |
| LLM Pulse | €49/mo | Paid add-on | No | Agency landing pages, comparison content. |
| Search Atlas | $99–349/mo | Yes, inside a full SEO suite | Some | Bundled into a larger platform. |

### What to copy

- **From Getlead:** a hub of free single-purpose tools, each an SEO page. Comparison pages like "vs Apollo". "Paste your website" onboarding with instant value. Pay-as-you-go credits that never expire. An MCP server so people can use it from Claude, ChatGPT or Cursor.
- **From OtterlyAI:** launch loudly once on Product Hunt, then get distributed inside a platform agencies already use. That means the Semrush App Center once we have traction.
- **From Spyglasses:** a low-cost one-off option so agencies can try it on a single client.

### What to avoid

- Building a crowded monitoring dashboard first. That fight is already lost on budget.
- Hiding white-label behind a $200 tier. It's our main wedge.
- Unlimited AI calls on cheap plans. That's a cost trap.
- Unexplained scores. AI answers vary from run to run, so every score must show how it was calculated.

## Positioning

**One line:** "Find out why AI can't see your client's website, fix it with copy-paste code, and send a branded report, for $29 a month."

- **Fix-first:** every finding ships with the exact snippet, generated from the site's own data.
- **White-label from the first paid plan:** the agency's logo, colours and name, not ours.
- **Proof it worked:** weekly re-audits and a before-and-after chart the agency can show the client.
- **Transparent scoring:** every point on the score links to the check that produced it.

## Product scope

### v0.1 · Free audit (week 1)

- Paste a URL and get a 0–100 score in about 10 seconds
- About 20 checks in 3 groups (see next section)
- Every failed check shows a fix with a copy button
- A shareable result link
- "Get white-label reports" early-access signup

### v0.2 · Paid agency plan (weeks 3–4)

- Email login with a magic link
- Saved client sites and audit history
- White-label PDF report with logo, colour and agency name
- Weekly automatic re-audit plus email alerts
- PayPal checkout, plus Razorpay for India

### v0.3 · AI answer checks (month 2–3)

- Ask ChatGPT, Perplexity and others about the client's category
- Each prompt runs 3 times and results are averaged, with the method shown
- Which competitors and sources appear
- Paid plans only, with a monthly quota so API costs stay below revenue

### Out of scope for now

- Content writing or AI rewrites
- Backlink tools, rank tracking
- Team seats and roles
- Mobile apps
- Anything needing a sales call

## Audit checks (v0.1)

All checks are rule-based. They read the site's HTML, headers, `robots.txt`, sitemap and `llms.txt`, so they cost nothing per audit. Weights add up to 100.

| Group | Check | Points | Fix we generate |
| --- | --- | --- | --- |
| **Can AI reach it?** 40 pts | Search bots allowed in robots.txt: OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Googlebot, Bingbot | 12 | Corrected robots.txt block |
| Firewall or CDN test: fetch the page with AI-bot user agents and compare to a normal browser | 10 | Steps for Cloudflare, Wix, Shopify and others |  |
| Content readable without JavaScript | 8 | Server-rendering or prerender guidance for the detected framework |  |
| No `noindex` or `nosnippet` in meta tags or X-Robots-Tag | 4 | The exact line to remove |  |
| Sitemap exists and is listed in robots.txt | 4 | Sitemap line to add |  |
| HTTPS, status 200, at most 2 redirects | 2 | Redirect advice |  |
| **Can AI understand it?** 35 pts | Organization and WebSite schema (JSON-LD) | 10 | Ready JSON-LD filled with the site's name, URL and logo |
| `sameAs` links to social and profile pages | 5 | Template with detected social links |  |
| Page-type schema: Product, Article, FAQPage or LocalBusiness | 8 | Matching template |  |
| Title, meta description, one H1, sensible heading order, `lang`, canonical | 8 | Suggested tags |  |
| Open Graph tags | 4 | Tag set |  |
| **Will AI quote it?** 25 pts | Answer-first structure: question headings, lists, tables | 9 | Rewrite pattern with an example from their page |
| Enough real text (not a thin page) | 6 | Content checklist |  |
| Freshness: visible dates, `dateModified` | 5 | Schema plus visible-date snippet |  |
| Trust pages: About, Contact, author info linked | 5 | Page checklist |  |
| **Info only** | `llms.txt` present | 0 | Generated draft, clearly labelled low impact |

**Training bots are reported, not penalised.** GPTBot, ClaudeBot, CCBot and Google-Extended are used for model training. Blocking them is a legitimate business choice and doesn't stop a site appearing in AI search answers. The report explains the difference instead of marking it as a failure.

**The firewall test can give false alarms.** Some firewalls verify real bots by IP address, so our test request may be blocked while the real crawler gets through. The report words this as "possible block" and tells the user how to confirm it in their firewall logs.

Example fix output for the robots.txt check:

```
# Generated by CiteReady for example.com
User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

# Training crawlers: your choice. Remove these lines to allow training.
User-agent: GPTBot
Disallow: /

Sitemap: https://example.com/sitemap.xml
```

## Pricing & payments

Free

- Unlimited single audits
- All fixes visible
- Our branding on shared links

$9 one report

- One white-label PDF
- Try it on one client
- Credits never expire

$29 / month · Agency

- 10 client sites
- White-label PDFs
- Weekly re-audit and alerts
- Before-and-after history

$79 / month · Pro

- 30 client sites
- AI-answer checks (quota)
- Competitor view
- CSV export

- **Launch offer:** the first 20 agencies get $19/month locked for life. That gives a reason to buy now and early testimonials.
- **India pricing:** ₹249 per report, ₹799/month Agency, through Razorpay. Solo plan for founders at $12 / ₹399.
- **International:** PayPal subscriptions and one-time payments in USD. Razorpay rejected international cards on your account, but PayPal is active.
- **Why sell one-time packs too:** they pay faster than subscriptions and avoid India's auto-debit mandate rules, which require a registered mandate and a pre-debit notice for every recurring charge.

## Tech & running costs

| Part | Choice | Cost now |
| --- | --- | --- |
| App and API | Cloudflare Workers with static assets | ₹0 (free tier) |
| Database | Cloudflare D1 for users, sites and audit history | ₹0 |
| Cache and waitlist | Cloudflare KV | ₹0 |
| Weekly re-audits | Cloudflare Cron Triggers | ₹0 |
| Email (login, alerts) | A transactional email service's free tier | ₹0 |
| White-label PDF | Branded print layout, saved as PDF from the browser | ₹0 |
| Domain | Your free domain, or a cheap .com later | ₹0–900/yr |
| AI-answer checks (v0.3) | A paid search-enabled AI API | Per call, paid plans only |

- **No NVIDIA NIM in production.** NVIDIA's FAQ limits free access to prototyping, research and testing. Anything serving real users needs a paid licence.
- **Safety:** only fetch public http(s) URLs, cap page size and time per request, and rate-limit per IP so the auditor can't be abused.
- **Check free-tier limits** on Cloudflare's pricing page before launch. They change.

## SEO plan

### Free tools hub (the Getlead play)

Each tool is its own page, targets one search phrase, and ends with "Run the full audit".

1. AI crawler checker: "Is my site blocked by ChatGPT?"
2. AI-ready robots.txt generator
3. `llms.txt` generator and validator
4. Schema generator for Organization, FAQ and LocalBusiness
5. "What AI bots see" viewer, showing the page as raw HTML without JavaScript
6. AI bot user-agent directory, a reference page people link to
7. Meta and Open Graph tag checker

### Programmatic pages, with a quality gate

- **By platform:** "Is Shopify / Wix / Squarespace / Webflow / WordPress / Framer blocking AI crawlers?" Each page uses real findings from audits of sites on that platform.
- **By industry:** "AI search checklist for dentists / law firms / SaaS / restaurants / real estate."
- **Rule:** a page only goes live when it has unique data, like real audit stats for that platform or industry. Mass-generated thin pages risk scaled-content penalties.

### Comparison pages

- "OtterlyAI alternative for small agencies", "Peec AI alternative", "Cheapest white-label AI visibility tool", "Spyglasses vs CiteReady".
- These catch people already shopping with a budget. Keep them factual, dated and fair.

## GEO plan: getting CiteReady cited by AI

We sell AI visibility, so our own site has to be the proof.

1. **Publish original data.** Audit the top 10,000 websites and publish "State of AI crawler access 2026", for example the share that block ChatGPT's search bot by mistake. Quotable statistics are what AI engines and journalists cite. Refresh it every quarter. This is the biggest single GEO and PR move.
2. **Be on Bing.** One study found about 87% of ChatGPT search citations match Bing's top 10. Submit to Bing Webmaster Tools and ping IndexNow on every new page.
3. **Be on Reddit.** Reddit is reported as ChatGPT's most-cited source in a June 2026 snapshot. Post genuinely helpful answers in r/SEO, r/bigseo, r/TechSEO, r/webdev and r/shopify, and mention the free tool only when it actually answers the question.
4. **Be on YouTube.** YouTube is reported as Perplexity's top source. Make short screen recordings like "Why ChatGPT can't see your website (60-second fix)". You already know YouTube.
5. **Write in a citable format:** answer in the first sentence, use tables and lists, show visible dates, use FAQ schema, and give clear definitions like "AI crawler access means…".
6. **Practise what we preach:** allow every AI search bot, add complete Organization schema with `sameAs` links, and publish an `llms.txt`. Score 100 on our own audit.
7. **Earn mentions in "best AI visibility tools" lists.** These listicles are what AI engines summarise when someone asks for a recommendation. Pitch the authors with the data study.

## AI leads & launch channels

| Channel | What we do | Cost | When |
| --- | --- | --- | --- |
| MCP server | An `audit_site` tool so agencies can run audits from Claude, ChatGPT or Cursor. List it in MCP registries. | ₹0 | Month 2 |
| Product Hunt | One prepared launch with the data study as the hook | ₹0 | Week 2 |
| AI directories | There's An AI For That (free), SaaSHub, AlternativeTo, Toolify, Dang AI, Future Tools. Check each one is still live first. | ₹0 | Week 2 |
| Indie Hackers, r/SaaS, X | Build-in-public posts with real numbers | ₹0 | Weekly |
| Agency communities | Offer "a free white-label audit for one of your clients". No cold DMs. | ₹0 | From week 2 |
| Affiliate programme | 30% recurring commission for agencies and SEO creators with referral codes | Paid from revenue | Month 2 |
| Semrush App Center | Apply once there are paying users. This was OtterlyAI's route to scale. | ₹0 to apply | Month 3+ |

Directory listings mainly bring backlinks and credibility, not floods of buyers. Treat them as SEO support, not as the sales engine.

## Ads

**No paid ads until there is revenue.** Reddit's B2B cost per click is typically quoted at $0.50–$4. Agencies recommend $1,500–$3,000 just to run a meaningful test, which is far outside a ₹0 budget.

- **After the first ₹10k of revenue:** reinvest a small share into one tight test. Use Google search ads on comparison keywords like "otterly alternative", or Reddit ads in 3–5 SEO subreddits.
- **Measure cost per paying customer, not cost per click.** Stop any channel where a customer costs more than 3 months of their subscription.

## 90-day plan

Claude builds and writes everything. Your part is about 45 minutes a day posting and replying, plus approving each launch.

Week 1

### Build the free audit

- Audit engine with 20 checks and fixes
- Landing page, results page, 3 free tools
- Our own site scores 100

Week 2

### Launch

- Data study on the top 10,000 sites
- Product Hunt, directories, Indie Hackers, Reddit answers
- Bing Webmaster Tools and IndexNow

Weeks 3–4

### Start charging

- Login, saved sites, white-label PDF
- PayPal and Razorpay checkout
- $19 lifetime offer for the first 20 agencies

Month 2

### Grow and retain

- Weekly re-audits and alerts
- Platform and industry pages, comparison pages
- MCP server, affiliate codes

Month 3

### Expand

- AI-answer checks on Pro
- Second data study
- Semrush App Center application

## Metrics & kill rules

| Stage | Metric | Healthy | Kill or pivot if |
| --- | --- | --- | --- |
| 2 weeks after launch | Audits run / early-access signups | 1,000+ / 30+ | \<300 / \<10 |
| Day 45 | Paying customers | 3+ | 0 |
| Day 90 | Monthly recurring revenue | ₹5–10k | \<₹2k with no growth |
| Ongoing | Monthly churn | \<8% | >15% |

**Funnel assumption, to be tested:** 1,500 audits a month leads to about 60 free accounts (4%), which leads to 3–5 paid (5–8%). That's about $90–150 a month, or ₹7,500–12,500. Every number here is a guess until real data replaces it.

## Risks

- **Competitors cut prices or add white-label cheaply.** OtterlyAI already has a $29 plan with a GEO audit. Our response is to move faster on fixes and agency workflow.
- **Search engines and AI companies change crawler rules often.** Keep the bot list in one data file and update it monthly.
- **Firewall-test false alarms** could hurt trust. Label them as "possible", and show the evidence.
- **Payments:** PayPal holds or account limits on a new account. Keep records clean and add terms, privacy and refund pages from day one.
- **Founder time:** results depend on daily distribution. Without it the plan fails regardless of product quality.

## Open questions

- Final name and domain. "CiteReady" needs a domain and trademark check.
- Does your PayPal business account support subscriptions for India-based sellers? Test with a $1 plan before launch.
- Is Razorpay Subscriptions enabled on your account, or only one-time payments?
- Which AI API for v0.3 answer checks, and what does each check cost at current prices?
- Should the free audit require an email after 3 audits? That trades some reach for more leads.

## Sources

- [OtterlyAI pricing (Capterra)](https://www.capterra.com/p/10023384/Otterly-AI/pricing/), [G2](https://www.g2.com/products/otterlyai/pricing), [TechCrunch](https://techcrunch.com/2024/12/18/ai-is-burying-company-web-sites-in-search-results-but-otterly-ai-thinks-it-can-help), [Semrush App Center launch](https://ai-cache.otterly.ai/blog/semrush-ai-search-monitoring/index.html), [Wikipedia](https://en.wikipedia.org/wiki/Otterly.ai), [Yespress profile](https://yespress.io/products/otterly-ai.md)
- [Peec AI pricing (Capterra)](https://capterra.com/p/10030058/Peec-AI/pricing), [FixAEO review](https://fixaeo.com/blogs/peec-ai-review/), [SE Ranking review](https://visible.seranking.com/blog/peec-ai-review/)
- [Rankscale (OMR)](https://omr.com/en/reviews/product/rankscale-ai/pricing), [Toolradar](https://toolradar.com/tools/rankscale/pricing), [AI visibility tools for agencies](https://superframeworks.com/articles/best-ai-search-visibility-tools-agencies), [LLM Pulse white-label](https://llmpulse.ai/blog/white-label-ai-seo-software/)
- [Contently](https://contently.com/2026/03/18/best-llm-visibility-tools-2026/), [NoGood GEO tools](https://nogood.io/2025/04/05/generative-engine-optimization-tools)
- [How AI engines choose sources](https://aeohunt.com/blog/how-ai-engines-choose-sources-2026), [Citation patterns 2026](https://www.gptmelo.com/resources/ai-platform-citation-patterns-2026), [What gets cited](https://quickseo.ai/blog/ai-citation-patterns-chatgpt-claude-gemini-perplexity), [Frase GEO playbook](https://www.frase.io/blog/how-to-get-cited-by-ai-search-engines-the-complete-geo-playbook)
- [Bootstrapped SaaS and free tools](https://www.tryanalyze.ai/blog/top-bootstrapped-saas-companies), [Programmatic SEO quality gates](https://ustechautomations.com/resources/blog/best-programmatic-seo-tools-for-saas-2026)
- [AI directories ranked](https://vantaige.io/blog/where-to-list-your-ai-tool-2026), [There's An AI For That](https://ideaproof.io/launch-directories/there-s-an-ai-for-that), [Directory list that works](https://dev.to/claudeprime/the-real-ai-directory-list-for-2026-what-actually-works-44pk)
- [Reddit ads B2B cost](https://directiveconsulting.com/blog/reddit-ads-cost-b2b-2026/), [Reddit ads cost guide](https://stackmatix.com/blog/reddit-ads-cost-guide-2026)
- [NVIDIA NIM FAQ](https://forums.developer.nvidia.com/t/nvidia-nim-faq/300317), [India recurring payments (Cashfree)](https://www.cashfree.com/blog/recurring-payment)

Most sources are vendor or agency content with commercial interests. Treat figures as directional and verify before quoting them publicly.