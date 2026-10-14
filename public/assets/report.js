// Renders an audit result at /r/<id>.
(function () {
  const root = document.getElementById("report");
  const esc = CR.esc;
  const ICON = { pass: "✓", warn: "!", fail: "✕", info: "i" };
  const LABEL = { pass: "Pass", warn: "Needs work", fail: "Fail", info: "Info" };

  const id = (location.pathname.match(/^\/r\/([A-Za-z0-9]{8,16})/) || [])[1];
  if (!id) {
    root.innerHTML = `<div class="notice err" style="margin:60px 0">No report ID in the address. <a href="/#audit">Run an audit</a>.</div>`;
    return;
  }

  CR.get("/api/audit/" + id)
    .then(render)
    .catch((e) => {
      root.innerHTML = `<div style="padding:60px 0"><div class="notice err">${esc(e.message)}</div><p style="margin-top:16px"><a class="btn" href="/#audit">Run a new audit</a></p></div>`;
    });

  function scoreColor(s) {
    return s >= 75 ? "var(--pass)" : s >= 50 ? "var(--warn)" : "var(--fail)";
  }

  function ring(score) {
    const r = 70;
    const c = 2 * Math.PI * r;
    const off = c * (1 - score / 100);
    return `<div class="ring" role="img" aria-label="Score ${score} out of 100">
      <svg viewBox="0 0 160 160" width="160" height="160">
        <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
        <circle cx="80" cy="80" r="${r}" fill="none" stroke="${scoreColor(score)}" stroke-width="12" stroke-linecap="round"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
      </svg>
      <div class="num"><div><b>${score}</b><small>out of 100</small></div></div>
    </div>`;
  }

  function fixHtml(f) {
    if (!f) return "";
    const steps = (f.steps || []).filter(Boolean);
    return `<div class="fix">
      <h4>Fix: ${esc(f.title)}</h4>
      ${steps.length ? `<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
      ${f.code ? CR.codeBlock(f.code, f.where) : ""}
    </div>`;
  }

  function checkHtml(c) {
    const pts = c.points ? `${fmt(c.earned)} / ${c.points} pts` : "0 pts";
    const open = c.status === "fail" || c.status === "warn";
    return `<details class="check ${c.status}" id="check-${esc(c.id)}"${open ? " open" : ""}>
      <summary>
        <span class="icon" aria-label="${LABEL[c.status]}">${ICON[c.status]}</span>
        <span><div class="t">${esc(c.title)}</div><div class="s">${esc(c.summary)}</div></span>
        <span class="pts">${pts}</span>
      </summary>
      <div class="body">
        <p class="why small">${esc(c.why)}</p>
        <ul class="evidence" aria-label="Evidence">${c.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        ${fixHtml(c.fix)}
      </div>
    </details>`;
  }

  function fmt(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function render(r) {
    document.title = `${r.host}: ${r.score}/100 AI search audit – CiteReady`;
    const failing = r.checks.filter((c) => c.status === "fail" || c.status === "warn");
    const priority = failing
      .filter((c) => c.points > 0)
      .sort((a, b) => b.points - b.earned - (a.points - a.earned))
      .slice(0, 3);
    const date = new Date(r.fetchedAt);
    const groupNames = { reach: "Can AI reach it?", understand: "Can AI understand it?", quote: "Will AI quote it?", info: "Info only (not scored)" };
    const meta = [r.site.platform && `Platform: ${r.site.platform}`, r.site.cdn && `CDN: ${r.site.cdn}`, `${r.site.wordCount} words in raw HTML`]
      .filter(Boolean)
      .join(" · ");

    root.innerHTML = `
      <div class="report-head">
        ${ring(r.score)}
        <div>
          <div class="eyebrow">${esc(r.grade)}</div>
          <h1 style="font-size:clamp(1.6rem,4vw,2.4rem);margin-bottom:6px;word-break:break-word">${esc(r.site.name || r.host)}</h1>
          <p class="muted small" style="margin:0 0 4px"><a href="${esc(r.finalUrl)}" rel="nofollow noopener" target="_blank">${esc(r.finalUrl)}</a></p>
          <p class="muted small" style="margin:0">Audited ${esc(date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))} · ${esc(meta)}</p>
          <div class="groups">
            ${r.groups
              .map(
                (g) => `<div class="gbar"><span>${esc(g.title)}</span><span class="track"><i style="width:${(g.earned / g.points) * 100}%;background:${scoreColor((g.earned / g.points) * 100)}"></i></span><span class="val">${fmt(g.earned)}/${g.points}</span></div>`,
              )
              .join("")}
          </div>
        </div>
      </div>

      <div class="toolbar">
        <button class="btn sm" type="button" id="share">Copy share link</button>
        <button class="btn sm secondary" type="button" id="rerun">Re-run audit</button>
        <button class="btn sm secondary" type="button" onclick="window.print()">Print / save PDF</button>
        <button class="btn sm ghost" type="button" id="expand">Expand all</button>
      </div>

      ${
        priority.length
          ? `<div class="card" style="margin-bottom:8px">
              <h2 style="font-size:1.2rem">Fix these first</h2>
              <p class="small muted">The ${priority.length} changes worth the most points. Each has copy-paste code below.</p>
              <ol style="margin:0;padding-left:1.2em">${priority
                .map((c) => `<li><a href="#check-${esc(c.id)}">${esc(c.title)}</a> <span class="muted small">(+${fmt(c.points - c.earned)} pts)</span></li>`)
                .join("")}</ol>
            </div>`
          : `<div class="notice ok">Every scored check passes. This site is ready to be cited.</div>`
      }

      ${["reach", "understand", "quote", "info"]
        .map((gid) => {
          const cs = r.checks.filter((c) => c.group === gid);
          const g = r.groups.find((x) => x.id === gid);
          return `<div class="group-title"><h2>${groupNames[gid]}</h2>${g ? `<span class="muted">${fmt(g.earned)} / ${g.points}</span>` : ""}</div>${cs.map(checkHtml).join("")}`;
        })
        .join("")}

      <div class="card" style="margin-top:28px">
        <h2 style="font-size:1.15rem">How this score works</h2>
        <p class="small muted" style="margin:0">The score is the sum of 16 rule-based checks on the live page: reach (40 points), understanding (35) and quotability (25). Every point above shows the evidence that produced it. Training-bot blocking and llms.txt are reported but don't change the score. The firewall test sends requests with AI-bot user agents. Some firewalls verify real bots by IP address, so a "possible block" should be confirmed in your firewall logs. Engine v${esc(r.version)}.</p>
      </div>

      <div class="cta-band">
        <h2 style="font-size:1.35rem;margin-bottom:6px">Send this as a branded report to your client</h2>
        <p class="muted">White-label PDFs with your logo and colours, weekly re-audits and before-and-after history. Early-access agencies get $19/month for life.</p>
        <form class="inline-form" data-waitlist data-source="report:${esc(r.host)}">
          <label class="sr-only" for="wl-email">Work email</label>
          <input id="wl-email" type="email" name="email" placeholder="you@agency.com" required autocomplete="email">
          <input class="honeypot" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button class="btn" type="submit">Get white-label reports</button>
          <div class="form-error" data-out style="flex-basis:100%"></div>
        </form>
      </div>
    `;

    // Waitlist forms are wired in app.js at load; wire the one we just rendered
    wireWaitlist(root.querySelector("form[data-waitlist]"));

    document.getElementById("share").addEventListener("click", (e) => CR.copy(location.origin + "/r/" + r.id, e.currentTarget));
    document.getElementById("expand").addEventListener("click", (e) => {
      const all = root.querySelectorAll("details.check");
      const open = [...all].some((d) => !d.open);
      all.forEach((d) => (d.open = open));
      e.currentTarget.textContent = open ? "Collapse all" : "Expand all";
    });
    document.getElementById("rerun").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Re-running…";
      try {
        const nr = await CR.post("/api/audit", { url: r.url, fresh: true });
        location.href = "/r/" + nr.id;
      } catch (ex) {
        btn.textContent = ex.message;
      }
    });
  }

  function wireWaitlist(form) {
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = form.querySelector("[data-out]");
      const btn = form.querySelector("button[type=submit]");
      const fd = new FormData(form);
      btn.disabled = true;
      try {
        const res = await CR.post("/api/waitlist", { email: fd.get("email"), website: fd.get("website") || "", source: form.dataset.source });
        form.innerHTML = `<p class="notice ok" style="margin:0">${res.already ? "You're already on the list." : "You're on the list. We'll email you when white-label reports open."}</p>`;
      } catch (ex) {
        out.textContent = ex.message;
        btn.disabled = false;
      }
    });
  }
})();
