// CiteSeen dashboard (vanilla JS SPA). Talks to /api/*; all rendering goes through esc() for safety.
(function () {
  const esc = CR.esc;
  const view = document.getElementById("view");
  const crumbs = document.getElementById("crumbs");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let me = null;

  // ---------------------------------------------------------------- api
  async function call(method, path, data) {
    const res = await fetch(path, {
      method,
      headers: data ? { "content-type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "same-origin",
    });
    if (res.status === 401) {
      location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
      throw new Error("Please sign in.");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const e = new Error((body && body.error) || `Request failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
    return body;
  }
  const get = (p) => call("GET", p);

  // ---------------------------------------------------------------- ui helpers
  function toast(msg, err) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = msg;
    document.getElementById("toasts").appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }
  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
    brush: '<path d="M9.5 14.5L3 21"/><path d="M14 4l6 6-8.5 8.5a3 3 0 01-4.2 0l-1.8-1.8a3 3 0 010-4.2z"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    tools: '<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
    out: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  const scoreClass = (s) => (s == null ? "info" : s >= 75 ? "pass" : s >= 50 ? "warn" : "fail");
  const chip = (s, suffix = "") => `<span class="score-chip pill ${scoreClass(s)}">${s == null ? "–" : Math.round(s) + suffix}</span>`;
  function ago(ts) {
    if (!ts) return "never";
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function sparkline(vals) {
    if (!vals || vals.length < 2) return '<span class="muted small">–</span>';
    const w = 110, h = 30, max = 100;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * (w - 4) + 2},${h - 3 - (v / max) * (h - 6)}`).join(" ");
    const last = vals[vals.length - 1], first = vals[0];
    const color = last >= first ? "var(--pass)" : "var(--fail)";
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score trend from ${first} to ${last}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function lineChart(series, opts = {}) {
    // series: [{name, color, points:[{t, v}]}]
    const all = series.flatMap((s) => s.points);
    if (all.length < 2) return `<p class="muted small">Not enough history yet. Re-audits add a point each time.</p>`;
    const W = 720, H = 240, L = 34, R = 12, T = 12, B = 28;
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t)) || t0 + 1;
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - v / 100) * (H - T - B);
    let g = "";
    for (const v of [0, 25, 50, 75, 100]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const fmtD = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    g += `<text x="${L}" y="${H - 8}">${fmtD(t0)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${fmtD(t1)}</text>`;
    const paths = series
      .filter((s) => s.points.length)
      .map((s) => {
        const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
        const dots = s.points.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5" fill="${s.color}"><title>${esc(s.name)}: ${Math.round(p.v)} on ${fmtD(p.t)}</title></circle>`).join("");
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chart-line"/>${dots}`;
      })
      .join("");
    const legend = series.map((s) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><i style="width:10px;height:10px;border-radius:50%;background:${s.color};display:inline-block"></i>${esc(s.name)}</span>`).join("");
    return `<div class="small muted" style="margin-bottom:6px">${legend}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "Score history")}">${g}${paths}</svg>`;
  }
  function animateLines(root) {
    if (reduce) return;
    root.querySelectorAll(".chart-line").forEach((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 1100, easing: "cubic-bezier(.22,1,.36,1)" });
    });
  }
  function setView(html, title) {
    view.innerHTML = `<div class="fade-in">${html}</div>`;
    if (title) document.title = `${title} – CiteSeen`;
    window.CRReport && window.CRReport.animateRings(view);
    animateLines(view);
  }
  function emptyState(title, text, action) {
    return `<div class="card empty"><div class="art">${icon("globe")}</div><h2 style="font-size:1.3rem">${esc(title)}</h2><p class="muted">${esc(text)}</p>${action || ""}</div>`;
  }

  // ---------------------------------------------------------------- shell
  function renderShell() {
    const path = location.pathname;
    const nav = [
      ["/app", "home", "Overview"],
      ["/app/alerts", "bell", "Alerts", me.unreadAlerts],
      ["/app/brand", "brush", "White-label"],
      ["/app/billing", "card", "Plan & billing"],
    ];
    document.getElementById("side-nav").innerHTML =
      nav
        .map(([href, ic, label, badge]) => {
          const cur = href === "/app" ? path === "/app" || path === "/app/" || path.startsWith("/app/sites") : path.startsWith(href);
          return `<a href="${href}"${cur ? ' aria-current="page"' : ""}>${icon(ic)}${label}${badge ? `<span class="badge">${badge}</span>` : ""}</a>`;
        })
        .join("") + `<div class="label">Free tools</div><a href="/tools/">${icon("tools")}All tools</a>`;
    const L = me.limits, U = me.usage;
    const pct = Math.min(100, Math.round((U.aiPrompts / L.aiPromptsPerMonth) * 100));
    document.getElementById("side-plan").innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center"><b>${esc(L.name)} plan</b>${L.id === "free" ? '<a href="/app/billing" class="small">Upgrade</a>' : ""}</div>
      <div class="small muted" style="margin-top:6px">AI questions ${U.aiPrompts}/${L.aiPromptsPerMonth}</div><div class="bar"><i style="width:${pct}%"></i></div>
      <div class="small muted">Sites ${U.sites}/${L.sites}</div>`;
    const u = me.user;
    const initial = (u.name || u.email).trim().charAt(0).toUpperCase();
    document.getElementById("side-user").innerHTML = `
      <span class="avatar">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : esc(initial)}</span>
      <span class="who"><b>${esc(u.name || u.email.split("@")[0])}</b><span>${esc(u.email)}</span></span>
      <button class="btn sm ghost" type="button" id="logout" aria-label="Sign out" title="Sign out">${icon("out")}</button>`;
    document.getElementById("logout").onclick = async () => {
      await call("POST", "/api/auth/logout");
      location.href = "/";
    };
  }

  // ---------------------------------------------------------------- views
  async function overview() {
    crumbs.textContent = "Overview";
    const { sites } = await get("/api/sites");
    const scored = sites.filter((s) => s.lastScore != null);
    const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.lastScore, 0) / scored.length) : null;
    const ai = sites.filter((s) => s.lastAiScore != null);
    const avgAi = ai.length ? Math.round(ai.reduce((a, s) => a + s.lastAiScore, 0) / ai.length) : null;
    const hello = me.user.name ? `Welcome back, ${me.user.name.split(" ")[0]}` : "Welcome back";
    const stats = `
      <div class="stats">
        <div class="card stat"><div class="k">Client sites</div><div class="v">${sites.length}<span class="muted" style="font-size:1rem">/${me.limits.sites}</span></div><div class="d">${me.limits.weekly ? "Re-audited weekly" : "Weekly re-audits on Plus"}</div></div>
        <div class="card stat"><div class="k">Avg. readiness</div><div class="v">${avg == null ? "–" : `<span data-count="${avg}">${avg}</span>`}</div><div class="d">Rule-based, out of 100</div></div>
        <div class="card stat"><div class="k">Avg. model recognition</div><div class="v">${avgAi == null ? "–" : `<span data-count="${avgAi}" data-suffix="%">${avgAi}%</span>`}</div><div class="d">Open models naming the brand (no web browsing)</div></div>
        <div class="card stat"><div class="k">Unread alerts</div><div class="v">${me.unreadAlerts}</div><div class="d"><a href="/app/alerts">View alerts</a></div></div>
      </div>`;
    const table = sites.length
      ? `<div class="card table-scroll" style="padding:6px 10px"><table class="data sites-table">
          <thead><tr><th>Site</th><th>Readiness</th><th class="hide-sm">Trend</th><th>Model recognition</th><th class="col-purpose">Last audit</th></tr></thead>
          <tbody>${sites
            .map(
              (s) => `<tr><td class="host"><a href="/app/sites/${esc(s.id)}">${esc(s.name || s.host)}</a><div class="small muted">${esc(s.host)}</div></td>
              <td>${chip(s.lastScore)}</td><td class="hide-sm">${sparkline(s.spark)}</td><td>${chip(s.lastAiScore, "%")}</td><td class="small muted col-purpose">${ago(s.lastAuditAt)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
      : emptyState("Add your first client site", "We'll audit it straight away, keep its history and, on Plus, re-check it every week.", `<button class="btn" type="button" data-add>+ Add a site</button>`);
    setView(`<div class="page-head"><div><h1>${esc(hello)}</h1><p class="muted" style="margin:4px 0 0">Here's how your clients look to AI search.</p></div><button class="btn" type="button" data-add>+ Add site</button></div>${stats}${table}`, "Overview");
    view.querySelectorAll("[data-count]").forEach((el) => {
      if (reduce) return;
      const to = Number(el.dataset.count), suf = el.dataset.suffix || "";
      const start = performance.now();
      const step = (n) => { const t = Math.min(1, (n - start) / 900); el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3))) + suf; if (t < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  async function siteView(id, tab) {
    const data = await get(`/api/sites/${id}`);
    const s = data.site, latest = data.latest;
    crumbs.innerHTML = `<a href="/app">Overview</a> / ${esc(s.name || s.host)}`;
    const tabs = [["report", "Report"], ["ai", "Model recognition"], ["history", "History"], ["settings", "Settings"]];
    const head = `
      <div class="page-head"><div class="site-hero">
        ${CRReport.ring(latest ? latest.score : 0, 96, "Readiness")}
        ${CRReport.ring(s.lastAiScore == null ? 0 : Math.round(s.lastAiScore), 96, "Model recognition", "var(--accent)", s.lastAiScore == null ? "–" : Math.round(s.lastAiScore) + "%")}
        <div style="min-width:0"><h1 style="word-break:break-word">${esc(s.name || s.host)}</h1>
          <p class="small muted" style="margin:4px 0 10px"><a href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${esc(s.url)}</a> · audited ${ago(s.lastAuditAt)}${s.weekly ? " · weekly re-audit on" : ""}</p>
          <div class="toolbar" style="margin:0">
            <button class="btn sm" type="button" id="reaudit">Re-audit now</button>
            ${latest ? `<a class="btn sm secondary" href="/app/print/${esc(latest.id)}">White-label report</a><button class="btn sm ghost" type="button" id="share">Copy share link</button>` : ""}
          </div></div></div></div>
      <nav class="tabs" aria-label="Site sections">${tabs.map(([k, l]) => `<a href="/app/sites/${esc(id)}?tab=${k}"${tab === k ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
      <div id="tab"></div>`;
    setView(head, s.name || s.host);
    const tabEl = document.getElementById("tab");
    document.getElementById("reaudit").onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.innerHTML = '<span class="spinner"></span> Auditing…';
      try {
        const r = await call("POST", `/api/sites/${id}/audit`);
        toast(`Re-audited: ${r.audit.score}/100${r.alerts.length ? ` · ${r.alerts.length} change(s)` : ""}`);
        siteView(id, tab);
      } catch (ex) {
        toast(ex.message, true);
        b.disabled = false;
        b.textContent = "Re-audit now";
      }
    };
    const share = document.getElementById("share");
    if (share) share.onclick = (e) => CR.copy(`${location.origin}/r/${latest.id}`, e.currentTarget);

    if (tab === "report") {
      tabEl.innerHTML = latest ? CRReport.renderReport(latest, { noHead: true }) : `<div class="notice">No audit yet. Click "Re-audit now".</div>`;
      CRReport.animateRings(tabEl);
    } else if (tab === "ai") {
      await aiTab(tabEl, s);
    } else if (tab === "history") {
      const series = [
        { name: "Readiness", color: "var(--brand)", points: data.history.map((h) => ({ t: h.created_at, v: h.score })) },
        { name: "Model recognition", color: "var(--accent)", points: data.aiHistory.map((h) => ({ t: h.at, v: (h.mentioned / Math.max(1, h.runs)) * 100 })) },
      ];
      tabEl.innerHTML = `<div class="card">${lineChart(series)}</div>
        <div class="card table-scroll" style="margin-top:16px;padding:6px 10px"><table class="data"><thead><tr><th>Date</th><th>Readiness</th><th>Trigger</th><th></th></tr></thead><tbody>
        ${data.history.slice().reverse().map((h) => `<tr><td>${new Date(h.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td><td>${chip(h.score)}</td><td class="small muted">${esc(h.trigger)}</td><td><a class="small" href="/app/print/${esc(h.id)}">Report</a></td></tr>`).join("")}
        </tbody></table></div>`;
      animateLines(tabEl);
    } else {
      settingsTab(tabEl, s);
    }
  }

  async function aiTab(el, site) {
    const d = await get(`/api/sites/${site.id}/ai`);
    const tierName = { top: "largest models", mid: "mid-size models", small: "fast small models" }[d.tier];
    const results = d.checks.length
      ? d.checks
          .map(
            (c) => `<div class="card ai-result"><div class="top"><div style="min-width:0"><b>${esc(c.prompt)}</b><div class="small muted">${esc(c.model)} · ${new Date(c.createdAt).toLocaleDateString()}</div></div>
            <div style="text-align:right"><span class="dots" aria-label="${c.mentioned} of ${c.runs} answers named the brand">${Array.from({ length: c.runs }, (_, i) => `<i class="${i < c.mentioned ? "on" : ""}"></i>`).join("")}</span>
            <div class="small"><b>${c.mentioned}/${c.runs}</b> named${c.avgPosition ? ` · avg #${c.avgPosition}` : ""}</div></div></div>
            ${c.competitors.length ? `<div class="small muted" style="margin:10px 0 4px">Also named</div><div class="chips">${c.competitors.map((x) => `<span class="chip">${esc(x.name)} ×${x.count}</span>`).join("")}</div>` : ""}
            ${c.sources.length ? `<div class="small muted" style="margin:10px 0 4px">Sources mentioned</div><div class="chips">${c.sources.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : ""}
            <details style="margin-top:10px"><summary class="small" style="cursor:pointer;font-weight:700">Read the ${c.answers.length} answers</summary>${c.answers.map((a, i) => `<div class="answer"><b>Run ${i + 1}</b>\n${esc(a)}</div>`).join("")}</details></div>`,
          )
          .join("")
      : `<div class="notice info">No checks yet. Edit the questions below and run your first Model recognition check.</div>`;
    const visibility = d.checks.length ? Math.round((d.checks.reduce((a, c) => a + c.mentioned, 0) / d.checks.reduce((a, c) => a + c.runs, 0)) * 100) : null;
    el.innerHTML = `
      ${d.configured ? "" : `<div class="notice" style="margin-bottom:14px">AI checks are being switched on. You can prepare your questions now.</div>`}
      <div class="grid-2" style="align-items:start">
        <div class="card"><h2 style="font-size:1.15rem">Questions customers ask</h2>
          <p class="small muted">Up to 5. Each runs 3 times on ${esc(tierName)}. Uses ${"{n}"} of your ${d.quota.limit} monthly questions (${d.quota.used} used).</p>
          <form id="ai-form">${(d.prompts.length ? d.prompts : [""]).map((p) => `<div class="prompt-row"><input type="text" name="p" value="${esc(p)}" maxlength="300" aria-label="Question"><button class="btn sm ghost" type="button" data-rm aria-label="Remove question">✕</button></div>`).join("")}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn sm ghost" type="button" id="ai-addq">+ Question</button><button class="btn sm secondary" type="button" id="ai-save">Save questions</button><button class="btn sm" type="submit" id="ai-run"${d.configured ? "" : " disabled"}>Run AI check</button></div></form>
          ${d.suggested ? `<p class="hint">Suggested from the site's details. Edit them to match how customers really ask.</p>` : ""}
        </div>
        <div class="card"><h2 style="font-size:1.15rem">Model recognition</h2>
          <div class="big-num">${visibility == null ? "–" : visibility + "%"}</div>
          <p class="small muted">Share of AI answers that named ${esc(site.name || site.host)} in the latest check.</p>
          <p class="small muted" style="margin:0">${esc(d.method)}</p></div>
      </div>
      <h2 style="font-size:1.2rem;margin:26px 0 10px">Latest results</h2><div id="ai-results">${results}</div>`;
    const form = el.querySelector("#ai-form");
    const prompts = () => Array.from(form.querySelectorAll("input[name=p]")).map((i) => i.value.trim()).filter(Boolean);
    const updateCount = () => { const p = el.querySelector(".card .small.muted"); if (p) p.innerHTML = p.innerHTML.replace(/Uses (\{n\}|\d+)/, `Uses ${prompts().length}`); };
    updateCount();
    form.addEventListener("input", updateCount);
    form.addEventListener("click", (e) => {
      if (e.target.closest("[data-rm]") && form.querySelectorAll(".prompt-row").length > 1) { e.target.closest(".prompt-row").remove(); updateCount(); }
    });
    el.querySelector("#ai-addq").onclick = () => {
      if (form.querySelectorAll(".prompt-row").length >= 5) return toast("Up to 5 questions per check.", true);
      Array.from(form.querySelectorAll(".prompt-row")).pop().insertAdjacentHTML("afterend", `<div class="prompt-row"><input type="text" name="p" maxlength="300" aria-label="Question"><button class="btn sm ghost" type="button" data-rm aria-label="Remove question">✕</button></div>`);
      updateCount();
    };
    el.querySelector("#ai-save").onclick = async () => {
      try { await call("PUT", `/api/sites/${site.id}/ai/prompts`, { prompts: prompts() }); toast("Questions saved"); } catch (ex) { toast(ex.message, true); }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = el.querySelector("#ai-run");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Asking AI models…';
      el.querySelector("#ai-results").innerHTML = prompts().map(() => '<div class="card ai-result"><div class="skeleton" style="height:18px;width:60%"></div><div class="skeleton" style="height:12px;width:35%;margin-top:10px"></div></div>').join("");
      try {
        const r = await call("POST", `/api/sites/${site.id}/ai/run`, { prompts: prompts() });
        toast(`Model recognition: ${Math.round(r.visibility)}%${r.failed ? ` · ${r.failed} question(s) failed and weren't charged` : ""}`);
        me = await get("/api/me");
        renderShell();
        siteView(site.id, "ai");
      } catch (ex) {
        toast(ex.message, true);
        btn.disabled = false;
        btn.textContent = "Run AI check";
        el.querySelector("#ai-results").innerHTML = `<div class="notice err">${esc(ex.message)}</div>`;
      }
    };
  }

  function settingsTab(el, s) {
    const canWeekly = me.limits.weekly;
    el.innerHTML = `<div class="card" style="max-width:640px"><form id="site-form">
      <div class="field"><label for="s-name">Display name</label><input id="s-name" name="name" value="${esc(s.name)}" maxlength="120"></div>
      <div class="grid-2" style="gap:12px"><div class="field"><label for="s-cat">What they do</label><input id="s-cat" name="category" value="${esc(s.category)}" placeholder="dental clinic"></div>
      <div class="field"><label for="s-loc">Where</label><input id="s-loc" name="location" value="${esc(s.location)}" placeholder="Pune"></div></div>
      <div class="field"><label for="s-comp">Competitors to watch</label><input id="s-comp" name="competitors" value="${esc(s.competitors.join(", "))}" placeholder="Rival Dental, smileclinic.in"><div class="hint">Comma-separated. Counted when AI answers name them.</div></div>
      <div class="field"><label class="switch"><input type="checkbox" name="weekly"${s.weekly ? " checked" : ""}${canWeekly ? "" : " disabled"}> Weekly re-audit and email alerts</label>${canWeekly ? "" : '<div class="hint">Included in <a href="/app/billing">Plus</a>.</div>'}</div>
      <button class="btn" type="submit">Save changes</button></form></div>
      <div class="card" style="max-width:640px;margin-top:16px;border-color:color-mix(in srgb,var(--fail) 35%,var(--line))"><h2 style="font-size:1.1rem">Remove this site</h2><p class="small muted">Deletes its audits, AI checks and alerts. This can't be undone.</p><button class="btn danger sm" type="button" id="del">Remove site</button></div>`;
    el.querySelector("#site-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await call("PATCH", `/api/sites/${s.id}`, {
          name: f.name.value, category: f.category.value, location: f.location.value,
          competitors: f.competitors.value.split(",").map((x) => x.trim()).filter(Boolean), weekly: f.weekly.checked,
        });
        toast("Saved");
      } catch (ex) { toast(ex.message, true); }
    };
    el.querySelector("#del").onclick = async () => {
      if (!confirm(`Remove ${s.host} and all its history?`)) return;
      try { await call("DELETE", `/api/sites/${s.id}`); toast("Site removed"); me = await get("/api/me"); renderShell(); go("/app"); } catch (ex) { toast(ex.message, true); }
    };
  }

  async function alertsView() {
    crumbs.textContent = "Alerts";
    const { alerts } = await get("/api/alerts");
    const kind = { score_drop: ["fail", "Score drop"], new_failure: ["warn", "New problem"], recovered: ["pass", "Improved"] };
    setView(`<div class="page-head"><h1>Alerts</h1>${alerts.some((a) => !a.read) ? '<button class="btn sm secondary" id="read" type="button">Mark all read</button>' : ""}</div>
      ${alerts.length ? `<div class="card" style="padding:6px 16px">${alerts.map((a) => `<div style="display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--line)${a.read ? ";opacity:.7" : ""}"><span class="pill ${kind[a.kind][0]}">${kind[a.kind][1]}</span><div style="flex:1;min-width:0"><a href="/app/sites/${esc(a.site_id)}" style="font-weight:700">${esc(a.host || "Site")}</a><div class="small">${esc(a.message)}</div></div><span class="small muted">${ago(a.created_at)}</span></div>`).join("")}</div>` : emptyState("No alerts yet", "When a weekly re-audit finds a score drop or a new problem, it shows up here and in your inbox.")}`, "Alerts");
    const r = document.getElementById("read");
    if (r) r.onclick = async () => { await call("POST", "/api/alerts/read"); me = await get("/api/me"); renderShell(); alertsView(); };
  }

  function brandView() {
    crumbs.textContent = "White-label";
    const b = me.user.brand;
    const locked = !me.limits.whiteLabel;
    setView(`<div class="page-head"><div><h1>White-label reports</h1><p class="muted" style="margin:4px 0 0">Your brand on every client report. No CiteSeen branding.</p></div></div>
      ${locked ? `<div class="notice" style="margin-bottom:16px">White-label reports are included in Plus and Pro, or $9 per report. You have <b>${me.user.reportCredits}</b> report credit(s). <a href="/app/billing">Get more</a>.</div>` : ""}
      <div class="grid-2" style="align-items:start"><div class="card"><form id="brand-form">
        <div class="field"><label for="b-name">Agency name</label><input id="b-name" name="name" value="${esc(b.name)}" maxlength="80" placeholder="Bright Pixel Agency"></div>
        <div class="field"><label for="b-logo">Logo URL</label><input id="b-logo" name="logo" value="${esc(b.logo)}" placeholder="https://youragency.com/logo.png"><div class="hint">An https:// link to a PNG, JPG or SVG.</div></div>
        <div class="field"><label for="b-color">Brand colour</label><input id="b-color" name="color" type="text" value="${esc(b.color)}" pattern="#[0-9a-fA-F]{6}" placeholder="#315CEB"></div>
        <div class="field"><label for="b-foot">Report footer</label><input id="b-foot" name="footer" value="${esc(b.footer)}" maxlength="200" placeholder="Prepared by Bright Pixel · hello@brightpixel.co"></div>
        <button class="btn" type="submit">Save branding</button></form></div>
        <div><div class="small muted" style="margin-bottom:8px;font-weight:700">Live preview</div><div class="brand-preview" id="bp"></div></div></div>`, "White-label");
    const f = document.getElementById("brand-form");
    const preview = () => {
      const color = /^#[0-9a-fA-F]{6}$/.test(f.color.value) ? f.color.value : "#315CEB";
      const logo = /^https:\/\//.test(f.logo.value) ? `<img src="${esc(f.logo.value)}" alt="">` : "";
      document.getElementById("bp").innerHTML = `<div class="bp-head" style="background:${color}">${logo}<div><b>${esc(f.name.value || "Your agency")}</b><div class="small" style="opacity:.85">AI search readiness report</div></div></div><div style="padding:18px 20px"><div class="small muted">Client</div><b>yourclient.com</b><div class="track" style="margin:12px 0 6px"><i style="width:82%;background:${color}"></i></div><div class="small muted">${esc(f.footer.value || "Prepared for your client")}</div></div>`;
    };
    f.addEventListener("input", preview);
    preview();
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await call("POST", "/api/me/brand", { name: f.name.value, logo: f.logo.value.trim(), color: f.color.value.trim(), footer: f.footer.value });
        me = await get("/api/me");
        toast("Branding saved");
      } catch (ex) { toast(ex.message, true); }
    };
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load checkout")); document.head.appendChild(s); });
  }

  async function razorpay(kind) {
    const o = await call("POST", "/api/billing/razorpay/order", { kind });
    await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    return new Promise((resolve, reject) => {
      const rz = new window.Razorpay({
        key: o.keyId, amount: o.amount, currency: o.currency, order_id: o.orderId, name: "CiteSeen",
        description: kind === "report" ? "White-label report credit" : kind === "pro_month" ? "Pro · 1 month" : "Plus · 1 month",
        prefill: { name: o.name, email: o.email }, theme: { color: "#315CEB" },
        handler: async (resp) => { try { await call("POST", "/api/billing/razorpay/verify", resp); resolve(); } catch (e) { reject(e); } },
        modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rz.open();
    });
  }

  function billingView() {
    crumbs.textContent = "Plan & billing";
    const P = me.plans, cur = me.limits.id, F = me.features;
    const status = new URLSearchParams(location.search).get("status");
    const msg = { success: ["ok", "Payment confirmed. Thank you!"], pending: ["info", "Your payment is processing. Your plan updates as soon as PayPal confirms it."], cancelled: ["", "Checkout was cancelled. Nothing was charged."], error: ["err", "Something went wrong with the payment. You weren't charged twice. Please try again or contact us."] }[status];
    const card = (id, feats) => {
      const p = P[id];
      const isCur = cur === id;
      const price = p.priceUsd ? `$${p.priceUsd}<span>/mo</span>` : "$0";
      const launch = id === "plus" && me.launchSeatsLeft > 0 ? `<span class="pill accent">Launch $19 for life · ${me.launchSeatsLeft} left</span>` : "";
      const lower = { free: 0, plus: 1, pro: 2 }[id] < { free: 0, plus: 1, pro: 2 }[cur];
      const actions = id === "free" || isCur || lower ? "" : `
        <button class="btn" type="button" data-pp="${id}"${F.paypal ? "" : " disabled"}>${F.paypal ? "Subscribe with PayPal" : "PayPal coming soon"}</button>
        <button class="btn secondary" type="button" data-rz="${id}_month"${F.razorpay ? "" : " disabled"}>${F.razorpay ? `Pay ₹${p.priceInr.toLocaleString("en-IN")} for 1 month (Razorpay)` : "Razorpay coming soon"}</button>`;
      return `<div class="card plan${isCur ? " current" : ""}">${isCur ? '<span class="pill pass tag">Current plan</span>' : ""}<h3>${p.name}</h3><div class="price">${price}</div>${launch}
        <ul class="checklist small">${feats.map((f) => `<li>${f}</li>`).join("")}</ul><div style="display:grid;gap:8px">${actions}</div></div>`;
    };
    const until = me.user.planUntil && cur !== "free" ? `<p class="small muted">Your ${esc(me.limits.name)} plan is active until ${new Date(me.user.planUntil).toLocaleDateString(undefined, { dateStyle: "medium" })}.</p>` : "";
    setView(`<div class="page-head"><div><h1>Plan &amp; billing</h1>${until}</div></div>
      ${msg ? `<p class="notice ${msg[0]}">${msg[1]}</p>` : ""}
      <div class="plans">${card("free", ["1 saved site", "10 AI questions/month (fast models)", "Unlimited one-off audits"])}${card("plus", ["10 client sites", "White-label reports", "Weekly re-audits + alerts", "100 AI questions/month (mid-size models)"])}${card("pro", ["30 client sites", "500 AI questions/month (largest models)", "Competitor view + CSV export", "Everything in Plus"])}</div>
      <div class="card" style="margin-top:18px"><h2 style="font-size:1.15rem">One white-label report</h2><p class="small muted">$9 / ₹249 per report. Credits never expire. You have <b>${me.user.reportCredits}</b>.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn secondary" type="button" data-ppr${F.paypal ? "" : " disabled"}>Buy with PayPal ($9)</button><button class="btn secondary" type="button" data-rz="report"${F.razorpay ? "" : " disabled"}>Buy with Razorpay (₹249)</button></div></div>
      ${me.limits.csv ? `<div class="card" style="margin-top:18px"><h2 style="font-size:1.15rem">Export</h2><a class="btn sm secondary" href="/api/export.csv">Download audit history (CSV)</a></div>` : ""}
      <p class="small muted" style="margin-top:16px">Payments are processed by PayPal (USD) and Razorpay (INR). See our <a href="/refunds">refund policy</a>.</p>`, "Plan & billing");
    view.querySelectorAll("[data-pp]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { const r = await call("POST", "/api/billing/paypal/subscribe", { plan: b.dataset.pp }); location.href = r.approveUrl; } catch (ex) { toast(ex.message, true); b.disabled = false; }
    }));
    const ppr = view.querySelector("[data-ppr]");
    if (ppr) ppr.onclick = async () => { ppr.disabled = true; try { const r = await call("POST", "/api/billing/paypal/order"); location.href = r.approveUrl; } catch (ex) { toast(ex.message, true); ppr.disabled = false; } };
    view.querySelectorAll("[data-rz]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await razorpay(b.dataset.rz); toast("Payment confirmed. Thank you!"); me = await get("/api/me"); renderShell(); billingView(); } catch (ex) { toast(ex.message, true); b.disabled = false; }
    }));
  }

  async function printView(auditId) {
    crumbs.innerHTML = `<a href="/app">Overview</a> / Report`;
    const d = await get(`/api/reports/${auditId}`);
    const r = d.audit, b = d.brand;
    const color = /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : "#315CEB";
    const date = new Date(r.fetchedAt).toLocaleDateString(undefined, { dateStyle: "long" });
    const head = d.whiteLabel
      ? `<div class="wl-head" style="background:${color}"><div>${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}">` : `<b style="font-size:1.3rem">${esc(b.name || "Your agency")}</b>`}<div class="small" style="opacity:.9;margin-top:6px">AI search readiness report · ${esc(date)}</div></div><div style="text-align:right"><div class="small" style="opacity:.85">Prepared for</div><b>${esc(r.site.name || r.host)}</b></div></div>`
      : `<div class="notice" style="margin-bottom:12px">${d.canUnlock ? `This report shows CiteSeen branding. <button class="btn sm" id="unlock" type="button">Use 1 credit to white-label it</button>` : `White-label reports are on Plus and Pro, or $9 per report. <a href="/app/billing">See options</a>.`}</div>`;
    setView(`<div class="toolbar no-print"><button class="btn" type="button" id="print">Print / save as PDF</button><a class="btn secondary" href="javascript:history.back()">Back</a>${d.whiteLabel && !b.name ? '<a class="btn ghost" href="/app/brand">Add your branding</a>' : ""}</div>
      <div class="wl">${head}${CRReport.renderReport(r, { openFailing: true, hideInfo: true })}
      <div class="wl-foot"><span>${esc(d.whiteLabel ? b.footer || b.name || "" : "Generated with CiteSeen · citeseen.pages.dev")}</span><span>${esc(r.finalUrl)}</span></div></div>`, `Report – ${r.host}`);
    view.querySelectorAll("details.check").forEach((x) => (x.open = true));
    document.getElementById("print").onclick = () => window.print();
    const u = document.getElementById("unlock");
    if (u) u.onclick = async () => { try { await call("POST", `/api/reports/${auditId}/unlock`); me = await get("/api/me"); toast("Report unlocked"); printView(auditId); } catch (ex) { toast(ex.message, true); } };
  }

  // ---------------------------------------------------------------- router
  async function render() {
    const path = location.pathname.replace(/\/+$/, "") || "/app";
    const q = new URLSearchParams(location.search);
    renderShell();
    document.getElementById("side").classList.remove("open");
    try {
      let m;
      if (path === "/app") await overview();
      else if ((m = path.match(/^\/app\/sites\/([A-Za-z0-9]+)$/))) await siteView(m[1], ["report", "ai", "history", "settings"].includes(q.get("tab")) ? q.get("tab") : "report");
      else if (path === "/app/alerts") await alertsView();
      else if (path === "/app/brand") brandView();
      else if (path === "/app/billing") billingView();
      else if ((m = path.match(/^\/app\/print\/([A-Za-z0-9]+)$/))) await printView(m[1]);
      else setView(emptyState("Page not found", "That page doesn't exist in your workspace.", '<a class="btn" href="/app">Go to overview</a>'));
    } catch (ex) {
      if (ex.status === 404) setView(emptyState("Not found", ex.message, '<a class="btn" href="/app">Go to overview</a>'));
      else setView(`<div class="notice err">${esc(ex.message)}</div>`);
    }
    view.focus({ preventScroll: true });
  }
  function go(href) { history.pushState(null, "", href); window.scrollTo(0, 0); render(); }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (a && a.getAttribute("href").startsWith("/app") && !a.target && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.origin === location.origin) { e.preventDefault(); go(a.getAttribute("href")); }
    if (e.target.closest("[data-add]")) openAdd();
  });
  window.addEventListener("popstate", render);
  const menu = document.getElementById("menu");
  menu.onclick = () => { const s = document.getElementById("side"); const open = s.classList.toggle("open"); menu.setAttribute("aria-expanded", String(open)); };

  // ---------------------------------------------------------------- add site
  const dlg = document.getElementById("add-dialog");
  const addForm = document.getElementById("add-form");
  function openAdd(url) {
    document.getElementById("add-error").textContent = "";
    if (url) addForm.url.value = url;
    dlg.showModal();
    addForm.url.focus();
  }
  document.getElementById("top-add").onclick = () => openAdd();
  document.getElementById("add-cancel").onclick = () => dlg.close();
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("add-submit");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Auditing…';
    try {
      const r = await call("POST", "/api/sites", { url: addForm.url.value.trim(), category: addForm.category.value.trim(), location: addForm.location.value.trim() });
      dlg.close();
      addForm.reset();
      toast(r.audit ? `Added · first audit ${r.audit.score}/100` : r.auditError || "Site added");
      me = await get("/api/me");
      go(`/app/sites/${r.site.id}`);
    } catch (ex) {
      document.getElementById("add-error").innerHTML = ex.status === 402 ? `${esc(ex.message)} <a href="/app/billing">Upgrade</a>` : esc(ex.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Add and audit";
    }
  });

  // ---------------------------------------------------------------- boot
  (async () => {
    try {
      me = await get("/api/me");
    } catch (ex) {
      view.innerHTML = `<div class="notice err">${esc(ex.message)}</div>`;
      return;
    }
    await render();
    const add = new URLSearchParams(location.search).get("add");
    if (add) { history.replaceState(null, "", "/app"); openAdd(add); }
  })();
  window.addEventListener("beforeprint", () => view.querySelectorAll("details.check").forEach((x) => (x.open = true)));
})();
