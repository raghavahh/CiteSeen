// CiteSeen shared browser helpers (no build step, no dependencies).
(function () {
  const CR = (window.CR = {});

  CR.esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  CR.post = async (path, data) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
    return body;
  };

  CR.get = async (path) => {
    const res = await fetch(path);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
    return body;
  };

  CR.copy = async (text, btn) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = "Copied ✓";
      setTimeout(() => (btn.textContent = old), 1500);
    }
  };

  CR.codeBlock = (code, where) =>
    `<div class="code">${where ? `<div class="where">${CR.esc(where)}</div>` : ""}<button class="btn sm copy" type="button" data-copy>Copy</button><pre><code>${CR.esc(code)}</code></pre></div>`;

  // Delegate all copy buttons: copies the <pre> next to the button
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    const pre = btn.parentElement.querySelector("pre");
    const text = btn.dataset.copyText || (pre ? pre.innerText : "");
    CR.copy(text, btn);
  });

  // Remember the last URL across tools (per-browser convenience only)
  CR.lastUrl = {
    get() {
      try {
        return localStorage.getItem("cr:lastUrl") || "";
      } catch {
        return "";
      }
    },
    set(v) {
      try {
        localStorage.setItem("cr:lastUrl", v);
      } catch {
        /* ignore */
      }
    },
  };

  // Generic "URL form → API → render" wiring used by every tool page
  CR.wireUrlForm = (form, { endpoint, render, loadingText }) => {
    const input = form.querySelector("input[name=url]");
    const btn = form.querySelector("button[type=submit]");
    const err = document.getElementById(form.dataset.error || "form-error");
    const loader = document.getElementById(form.dataset.loader || "loader");
    const params = new URLSearchParams(location.search);
    if (params.get("url")) input.value = params.get("url");
    else if (!input.value) input.value = CR.lastUrl.get();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = input.value.trim();
      if (!url) {
        if (err) err.textContent = "Enter a website address.";
        return;
      }
      if (err) err.textContent = "";
      btn.disabled = true;
      if (loader) {
        loader.classList.add("on");
        const t = loader.querySelector("[data-text]");
        if (t && loadingText) t.textContent = loadingText;
      }
      try {
        CR.lastUrl.set(url);
        const data = await CR.post(endpoint, { url });
        render(data, url);
      } catch (ex) {
        if (err) err.textContent = ex.message;
      } finally {
        btn.disabled = false;
        if (loader) loader.classList.remove("on");
      }
    });
    if (params.get("url") && params.get("run") !== "0") form.requestSubmit();
  };

  // Early-access / waitlist forms: <form data-waitlist data-source="...">
  document.querySelectorAll("form[data-waitlist]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = form.querySelector("[data-out]") || form.nextElementSibling;
      const btn = form.querySelector("button[type=submit]");
      const fd = new FormData(form);
      btn.disabled = true;
      try {
        const r = await CR.post("/api/waitlist", {
          email: fd.get("email"),
          agency: fd.get("agency") || "",
          clients: fd.get("clients") || "",
          website: fd.get("website") || "",
          source: form.dataset.source || location.pathname,
        });
        form.innerHTML = `<p class="notice ok" style="margin:0">${
          r.already ? "You're already on the list. We'll be in touch." : "You're on the list. We'll email you when white-label reports open, with the $19/month lifetime launch price."
        }</p>`;
      } catch (ex) {
        if (out) out.textContent = ex.message;
        btn.disabled = false;
      }
    });
  });

  // Footer year
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
})();
