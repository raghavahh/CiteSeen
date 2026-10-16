// Homepage walkthrough on ILLUSTRATIVE data (fictional yourclient.com): finding → evidence → why → fix.
(function () {
  const root = document.querySelector("[data-demo]");
  if (!root) return;
  const esc = window.CR.esc;
  const F = [
    {
      title: "PerplexityBot blocked in robots.txt",
      evidence: ["robots.txt line 7: User-agent: PerplexityBot", "robots.txt line 8: Disallow: /", "Other search crawlers: allowed"],
      why: "Perplexity can't index the page, so it can't cite it. This is a direct, confirmed block (high confidence).",
      fix: "User-agent: PerplexityBot\nAllow: /\n\nSitemap: https://yourclient.com/sitemap.xml",
      verify: "Upload the new robots.txt, then re-run the audit or the AI crawler checker.",
    },
    {
      title: "Main text needs JavaScript",
      evidence: ["38 words of text in the raw HTML", "Empty <div id=\"root\"></div> container", "Platform: React (client-side)"],
      why: "Most AI crawlers read raw HTML and don't run scripts, so they see an almost empty page.",
      fix: "// Pre-render public pages at build time, e.g. with Vite SSG\n// or move to a framework with server rendering (Next.js, Astro).",
      verify: "Open the page in What AI bots see and confirm the main text appears.",
    },
    {
      title: "Possible firewall block (simulated)",
      evidence: ["Browser request: status 200, 640 words", "Simulated OAI-SearchBot request: status 403", "CDN: Cloudflare"],
      why: "A bot-protection rule may be rejecting AI crawlers. Our test comes from our servers, not the crawler's real IPs, so treat it as possible until your logs confirm it.",
      fix: "Cloudflare → Security → Bots: allow verified bots.\nSecurity → Events: filter by user agent OAI-SearchBot to confirm.",
      verify: "Check your firewall logs for the crawler's user agent and response status.",
    },
  ];
  const panel = root.querySelector(".demo-panel");
  const tabs = Array.from(root.querySelectorAll("[role=tab]"));
  function show(i) {
    tabs.forEach((t, k) => t.setAttribute("aria-selected", String(k === i)));
    const f = F[i];
    panel.innerHTML = `
      <h3>${esc(f.title)}</h3>
      <div class="demo-step"><span>Evidence</span><ul class="evidence">${f.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>
      <div class="demo-step"><span>Why it matters</span><p>${esc(f.why)}</p></div>
      <div class="demo-step"><span>Fix</span><div class="code"><button class="btn sm copy" type="button" data-copy>Copy</button><pre><code>${esc(f.fix)}</code></pre></div></div>
      <div class="demo-step"><span>Verify</span><p>${esc(f.verify)}</p></div>`;
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => show(i));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const n = (i + (e.key === "ArrowDown" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[n].focus();
      show(n);
    });
  });
  show(0);
})();
