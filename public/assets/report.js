// Shared audit report renderer: public /r/<id> page, dashboard, and white-label print view.
(function () {
  const esc = (s) => window.CR.esc(s);
  const ICON = { pass: "✓", warn: "!", fail: "✕", info: "i" };
  const LABEL = { pass: "Pass", warn: "Needs work", fail: "Fail", info: "Info" };
  const GROUP_NAMES = { reach: "Can AI reach it?", understand: "Can AI understand it?", quote: "Will AI quote it?", info: "Info only (not scored)" };
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const scoreColor = (s) => (s >= 75 ? "var(--pass)" : s >= 50 ? "var(--warn)" : "var(--fail)");

  function ring(score, size = 160, label = "out of 100", color, display) {
    const r = 70, c = 2 * Math.PI * r;
    return `<div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="Score ${score} out of 100">
      <svg viewBox="0 0 160 160" width="${size}" height="${size}" aria-hidden="true">
        <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
        <circle class="arc" data-target="${(c * (1 - score / 100)).toFixed(1)}" cx="80" cy="80" r="${r}" fill="none" stroke="${color || scoreColor(score)}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}"/>
      </svg>
      <div class="num"><div><b>${display ?? score}</b><small>${esc(label)}</small></div></div>
    </div>`;
  }

  function animateRings(root) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.querySelectorAll("circle.arc[data-target]").forEach((c) => {
      if (reduce) c.style.transition = "none";
      requestAnimationFrame(() => requestAnimationFrame(() => c.setAttribute("stroke-dashoffset", c.dataset.target)));
    });
  }

  function fixHtml(f) {
    if (!f) return "";
    const steps = (f.steps || []).filter(Boolean);
    return `<div class="fix"><h4>Fix: ${esc(f.title)}</h4>${steps.length ? `<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}${f.code ? window.CR.codeBlock(f.code, f.where) : ""}</div>`;
  }

  function checkHtml(c, openFailing) {
    const pts = c.points ? `${fmt(c.earned)} / ${c.points} pts` : "0 pts";
    const open = openFailing && (c.status === "fail" || c.status === "warn");
    return `<details class="check ${c.status}" id="check-${esc(c.id)}"${open ? " open" : ""}>
      <summary><span class="icon" aria-label="${LABEL[c.status]}">${ICON[c.status]}</span>
        <span><div class="t">${esc(c.title)}</div><div class="s">${esc(c.summary)}</div></span><span class="pts">${pts}</span></summary>
      <div class="body"><p class="why small">${esc(c.why)}</p>
        <ul class="evidence" aria-label="Evidence">${c.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>${fixHtml(c.fix)}</div>
    </details>`;
  }

  function priorityList(r) {
    return r.checks.filter((c) => c.points > 0 && c.earned < c.points).sort((a, b) => b.points - b.earned - (a.points - a.earned)).slice(0, 3);
  }

  function groupBars(r) {
    return r.groups
      .map((g) => `<div class="gbar"><span>${esc(g.title)}</span><span class="track"><i style="width:${(g.earned / g.points) * 100}%;background:${scoreColor((g.earned / g.points) * 100)}"></i></span><span class="val">${fmt(g.earned)}/${g.points}</span></div>`)
      .join("");
  }

  /** Render the full report body. opts: { headExtra, toolbar, openFailing, hideInfo } */
  function renderReport(r, opts = {}) {
    const priority = priorityList(r);
    const meta = [r.site.platform && `Platform: ${r.site.platform}`, r.site.cdn && `CDN: ${r.site.cdn}`, `${r.site.wordCount} words in raw HTML`].filter(Boolean).join(" · ");
    const date = new Date(r.fetchedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const head = opts.noHead
      ? `<div class="card" style="margin-bottom:14px"><div class="groups" style="margin:0;max-width:none">${groupBars(r)}</div><p class="small muted" style="margin:10px 0 0">Audited ${esc(date)} · ${esc(meta)} · ${esc(r.grade)}</p></div>`
      : null;
    return (head ?? `
      <div class="report-head">
        ${ring(r.score)}
        <div>
          <div class="eyebrow">${esc(r.grade)}</div>
          <h1 style="font-size:clamp(1.6rem,4vw,2.4rem);margin-bottom:6px;word-break:break-word">${esc(r.site.name || r.host)}</h1>
          <p class="muted small" style="margin:0 0 4px"><a href="${esc(r.finalUrl)}" rel="nofollow noopener" target="_blank">${esc(r.finalUrl)}</a></p>
          <p class="muted small" style="margin:0">Audited ${esc(date)} · ${esc(meta)}</p>
          ${opts.headExtra || ""}
          <div class="groups">${groupBars(r)}</div>
        </div>
      </div>`) + `
      ${opts.toolbar || ""}
      ${
        priority.length
          ? `<div class="card" style="margin-bottom:8px"><h2 style="font-size:1.2rem">Fix these first</h2>
              <p class="small muted">The ${priority.length} changes worth the most points. Each has copy-paste code below.</p>
              <ol style="margin:0;padding-left:1.2em">${priority.map((c) => `<li><a href="#check-${esc(c.id)}">${esc(c.title)}</a> <span class="muted small">(+${fmt(c.points - c.earned)} pts)</span></li>`).join("")}</ol></div>`
          : `<div class="notice ok">Every scored check passes. This site is ready to be cited.</div>`
      }
      ${["reach", "understand", "quote", "info"]
        .filter((gid) => !(opts.hideInfo && gid === "info"))
        .map((gid) => {
          const cs = r.checks.filter((c) => c.group === gid);
          const g = r.groups.find((x) => x.id === gid);
          return `<div class="group-title"><h2>${GROUP_NAMES[gid]}</h2>${g ? `<span class="muted">${fmt(g.earned)} / ${g.points}</span>` : ""}</div>${cs.map((c) => checkHtml(c, opts.openFailing !== false)).join("")}`;
        })
        .join("")}
      <div class="card" style="margin-top:28px"><h2 style="font-size:1.15rem">How this score works</h2>
        <p class="small muted" style="margin:0">The Readiness score is the sum of 16 rule-based checks on the live page: reach (40 points), understanding (35) and quotability (25). Every point shows the evidence that produced it. Training-bot blocking and llms.txt are reported but don't change the score. The firewall test sends requests with AI-bot user agents; some firewalls verify real bots by IP address, so a "possible block" should be confirmed in firewall logs. Engine v${esc(r.version)}.</p>
      </div>`;
  }

  window.CRReport = { renderReport, ring, animateRings, scoreColor, fmt };

  // ---------------------------------------------------------------- public /r/<id> page
  const root = document.getElementById("report");
  const id = (location.pathname.match(/^\/r\/([A-Za-z0-9]{8,16})/) || [])[1];
  if (!root || !id) return;

  window.CR.get("/api/audit/" + id)
    .then((r) => {
      document.title = `${r.host}: ${r.score}/100 AI search audit – CiteSeen`;
      root.innerHTML =
        renderReport(r, {
          toolbar: `<div class="toolbar">
            <button class="btn sm" type="button" id="share">Copy share link</button>
            <button class="btn sm secondary" type="button" id="rerun">Re-run audit</button>
            <button class="btn sm secondary" type="button" onclick="window.print()">Print / save PDF</button>
            <button class="btn sm ghost" type="button" id="expand">Expand all</button></div>`,
        }) +
        `<div class="cta-band dark">
          <div class="grid-2" style="align-items:center">
            <div><h2 style="font-size:1.45rem;margin-bottom:6px">Does AI actually name ${esc(r.site.name || r.host)}?</h2>
            <p class="muted" style="margin:0">Save this site to track AI Visibility on real AI answers, get weekly re-audits, and send it as a white-label report.</p></div>
            <div style="display:flex;justify-content:flex-end"><a class="btn lg" href="/login?next=${encodeURIComponent("/app?add=" + r.url)}">Track this site free <span class="arrow" aria-hidden="true">→</span></a></div>
          </div></div>`;
      animateRings(root);
      document.getElementById("share").addEventListener("click", (e) => window.CR.copy(location.origin + "/r/" + r.id, e.currentTarget));
      document.getElementById("expand").addEventListener("click", (e) => {
        const all = root.querySelectorAll("details.check");
        const open = Array.from(all).some((d) => !d.open);
        all.forEach((d) => (d.open = open));
        e.currentTarget.textContent = open ? "Collapse all" : "Expand all";
      });
      document.getElementById("rerun").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Re-running…";
        try {
          const nr = await window.CR.post("/api/audit", { url: r.url, fresh: true });
          location.href = "/r/" + nr.id;
        } catch (ex) {
          btn.textContent = ex.message;
        }
      });
    })
    .catch((e) => {
      root.innerHTML = `<div style="padding:60px 0"><div class="notice err">${esc(e.message)}</div><p style="margin-top:16px"><a class="btn" href="/#audit">Run a new audit</a></p></div>`;
    });
})();
