(function () {
  "use strict";

  /**
   * API root under the current management page path.
   * Classic: /{password}/management → /{password}/management/api
   * Gateway: /svc-xxx/{password}/management → keep /svc-xxx prefix (must not use origin + first segment).
   */
  function apiBase() {
    var path = window.location.pathname.replace(/\/+$/, "");
    var marker = "/management";
    var idx = path.lastIndexOf(marker);
    if (idx !== -1) {
      var end = idx + marker.length;
      // Require exact /management segment (not /management-foo)
      if (end === path.length || path.charAt(end) === "/") {
        return window.location.origin + path.slice(0, end) + "/api";
      }
    }
    // Fallback: first segment is password (no Gateway prefix)
    var seg = path.replace(/^\/+/, "").split("/");
    var p = seg[0] || "";
    return window.location.origin + "/" + encodeURIComponent(p) + "/management/api";
  }

  /** Auto-refresh interval (ms) */
  var POLL_MS = 10000;
  var LOGS_POLL_MS = 5000;
  var pollTimer = null;

  function getHash() {
    const h = (window.location.hash || "#/requests").replace(/^#/, "");
    if (h === "/cache" || h === "cache") {
      return { view: "cache" };
    }
    if (h === "/clients" || h === "clients") {
      return { view: "clients" };
    }
    if (h === "/logs" || h === "logs") {
      return { view: "logs" };
    }
    if (h.startsWith("/requests/")) {
      return { view: "detail", id: h.slice("/requests/".length) };
    }
    return { view: "list" };
  }

  function setActiveTab(name) {
    ["requests", "cache", "clients", "logs"].forEach(function (n) {
      var el = document.getElementById("tab-" + n);
      if (el) el.classList.toggle("active", n === name);
    });
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function pollTick() {
    if (document.hidden) return;
    var h = getHash();
    if (h.view === "list") loadList(true);
    else if (h.view === "detail" && h.id) showDetail(h.id, true);
    else if (h.view === "cache") loadCache(true);
    else if (h.view === "clients") loadClients(true);
    else if (h.view === "logs") loadLogs(true);
  }

  function startPolling() {
    stopPolling();
    var h = getHash();
    var interval = h.view === "logs" ? LOGS_POLL_MS : POLL_MS;
    pollTimer = setInterval(pollTick, interval);
  }

  function setHash(path) {
    window.location.hash = path;
  }

  var toastTimer = null;
  function showToast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 4000);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch (_) {
      return iso;
    }
  }

  function truncate(str, max) {
    if (str == null || str === "") return "—";
    var s = String(str);
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  function loadCache(silent) {
    var content = document.getElementById("cache-content");
    var hint = document.getElementById("cache-poll-hint");
    if (!content) return;
    if (!silent) content.innerHTML = '<p class="hint">Loading…</p>';

    fetch(apiBase() + "/cache", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        var s = d.stats;
        var sz = d.sizes;
        var t = d.ttlSec;
        content.innerHTML = "";
        var note = el("p", "cache-intro", "Clearing a layer invalidates in-memory data only. Full clear also resets hit/miss counters.");
        content.appendChild(note);
        var table = el("table", "data");
        var thead = el("thead", null, null);
        var trh = el("tr", null, null);
        ["Store", "Keys", "TTL (s)", "Hits", "Misses", ""].forEach(function (x) {
          trh.appendChild(el("th", null, x));
        });
        thead.appendChild(trh);
        table.appendChild(thead);
        var tbody = el("tbody", null, null);
        var rows = [
          {
            name: "Metadata (Cinemeta, subtitles, …)",
            k: "metadata",
            count: sz.metadata,
            hit: s.metadataHits,
            miss: s.metadataMisses,
            ttl: t.metadata,
          },
          {
            name: "Torrent search (Torrentio aggregate)",
            k: "torrentSearch",
            count: sz.torrentSearch,
            hit: s.torrentSearchHits,
            miss: s.torrentSearchMisses,
            ttl: t.torrentSearch,
          },
          {
            name: "Stream (per-request + per-torrent RD links)",
            k: "stream",
            count: sz.streams,
            hit: s.streamHits,
            miss: s.streamMisses,
            ttl: t.streams,
          },
        ];
        rows.forEach(function (row) {
          var tr = el("tr", null, null);
          tr.appendChild(el("td", null, row.name));
          tr.appendChild(el("td", "mono", String(row.count)));
          tr.appendChild(el("td", "mono", String(row.ttl)));
          tr.appendChild(el("td", null, String(row.hit)));
          tr.appendChild(el("td", null, String(row.miss)));
          var tdA = el("td", null, null);
          var b = el("button", "btn", "Clear");
          b.addEventListener("click", function () {
            clearCacheLayer(row.k);
          });
          tdA.appendChild(b);
          tr.appendChild(tdA);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        content.appendChild(table);
        var allRow = el("div", "cache-actions", null);
        var ball = el("button", "btn btn-danger", "Clear all caches + reset hit/miss stats");
        ball.addEventListener("click", function () {
          clearCacheLayer("all");
        });
        allRow.appendChild(ball);
        content.appendChild(allRow);
        if (hint) {
          hint.textContent = silent
            ? "Auto-refresh: " +
              POLL_MS / 1000 +
              "s (tab visible) · updated " +
              new Date().toLocaleTimeString()
            : "Auto-refresh: " + POLL_MS / 1000 + "s (pauses in background tab)";
        }
      })
      .catch(function (e) {
        content.innerHTML = "";
        content.appendChild(el("p", "tag-miss", e.message));
        if (!silent) showToast("Cache: " + e.message);
      });
  }

  function loadClients(silent) {
    var content = document.getElementById("clients-content");
    var hint = document.getElementById("clients-poll-hint");
    if (!content) return;
    if (!silent) content.innerHTML = '<p class="hint">Loading…</p>';

    fetch(apiBase() + "/clients", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        content.innerHTML = "";
        content.appendChild(
          el(
            "p",
            "cache-intro",
            "Per public IP (X-Forwarded-For or direct socket). One row can be many devices behind NAT. “Live” is this server process; “Request log” uses the on-disk JSONL (pruned when large)."
          )
        );

        var live = d.live || {};
        content.appendChild(el("h2", "clients-h2", "Live (in-memory)"));
        content.appendChild(
          el(
            "p",
            "hint",
            "Drop idle after " + (live.ttlSec != null ? live.ttlSec : "—") + "s · keep at most " + (live.maxEntries != null ? live.maxEntries : "—") + " clients"
          )
        );

        var t1 = el("table", "data clients-table");
        var thead1 = el("thead", null, null);
        var trh1 = el("tr", null, null);
        ["IP", "Last seen", "User-Agent", "Proxy", "Stream busy", "Manifests", "Streams", "Stream label", "Catalog title"].forEach(function (x) {
          trh1.appendChild(el("th", null, x));
        });
        thead1.appendChild(trh1);
        t1.appendChild(thead1);
        var tb1 = el("tbody", null, null);
        (live.clients || []).forEach(function (c) {
          var tr = el("tr", null, null);
          tr.appendChild(el("td", "mono", c.key));
          tr.appendChild(el("td", null, formatTime(c.lastSeen)));
          tr.appendChild(el("td", "ua-cell", truncate(c.userAgent, 80)));
          tr.appendChild(el("td", "mono", String(c.activeProxy)));
          tr.appendChild(el("td", "mono", String(c.activeStreamFetch)));
          tr.appendChild(el("td", "mono", String(c.manifestCount)));
          tr.appendChild(el("td", "mono", String(c.streamRequestCount)));
          tr.appendChild(el("td", "mono", truncate(c.lastStreamTitle, 36)));
          tr.appendChild(el("td", null, truncate(c.lastSeriesName, 36)));
          tb1.appendChild(tr);
        });
        t1.appendChild(tb1);
        content.appendChild(t1);

        content.appendChild(el("h2", "clients-h2", "From request log (on disk)"));
        var t2 = el("table", "data clients-table");
        var thead2 = el("thead", null, null);
        var trh2 = el("tr", null, null);
        ["IP", "Requests", "Last at", "Last title", "Catalog title"].forEach(function (x) {
          trh2.appendChild(el("th", null, x));
        });
        thead2.appendChild(trh2);
        t2.appendChild(thead2);
        var tb2 = el("tbody", null, null);
        (d.fromLog || []).forEach(function (c) {
          var tr = el("tr", null, null);
          tr.appendChild(el("td", "mono", c.key));
          tr.appendChild(el("td", "mono", String(c.requestCount)));
          tr.appendChild(el("td", null, formatTime(c.lastAt)));
          tr.appendChild(el("td", "mono", truncate(c.lastTitle, 50)));
          tr.appendChild(el("td", null, truncate(c.lastSeriesName, 40)));
          tb2.appendChild(tr);
        });
        t2.appendChild(tb2);
        content.appendChild(t2);

        if (d.serverTime) {
          content.appendChild(el("p", "hint", "Server time: " + d.serverTime));
        }
        if (hint) {
          hint.textContent = silent
            ? "Auto-refresh: " + POLL_MS / 1000 + "s · updated " + new Date().toLocaleTimeString()
            : "Auto-refresh: " + POLL_MS / 1000 + "s (pauses in background tab)";
        }
      })
      .catch(function (e) {
        content.innerHTML = "";
        content.appendChild(el("p", "tag-miss", e.message));
        if (!silent) showToast("Clients: " + e.message);
      });
  }

  function clearCacheLayer(layer) {
    var human = { metadata: "metadata", torrentSearch: "torrent search", stream: "stream", all: "ALL caches" }[layer];
    if (layer === "all") {
      if (
        !window.confirm(
          "Clear ALL caches and reset hit/miss counters? The next Stremio requests will miss until caches refill."
        )
      )
        return;
    } else {
      if (!window.confirm("Clear the " + human + " cache?")) return;
    }
    fetch(apiBase() + "/cache/clear", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layer: layer }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.message) || j.error || "HTTP " + r.status);
          return j;
        });
      })
      .then(function () {
        showToast("Cleared: " + human);
        loadCache(false);
      })
      .catch(function (e) {
        showToast("Clear failed: " + e.message);
      });
  }

  function kindTagClass(kind) {
    if (kind === "torbox") return "tag-torbox";
    if (kind === "remake") return "tag-remake";
    return "mono";
  }

  function formatLogTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString();
    } catch (_) {
      return iso;
    }
  }

  function loadLogs(silent) {
    var qEl = document.getElementById("logs-filter-q");
    var levelEl = document.getElementById("logs-filter-level");
    var linesEl = document.getElementById("logs-filter-lines");
    var content = document.getElementById("logs-content");
    var meta = document.getElementById("logs-meta");
    var hint = document.getElementById("logs-poll-hint");
    if (!content) return;

    var params = new URLSearchParams();
    if (qEl && qEl.value) params.set("q", qEl.value);
    if (levelEl && levelEl.value) params.set("level", levelEl.value);
    if (linesEl && linesEl.value) params.set("lines", linesEl.value);

    var autoscroll = document.getElementById("logs-autoscroll");
    var wasAtBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 40;

    if (!silent) content.textContent = "Loading…";

    fetch(apiBase() + "/logs?" + params.toString(), { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        var lines = d.lines || [];
        content.innerHTML = "";
        if (lines.length === 0) {
          content.appendChild(el("span", "hint", "(no log lines)"));
        } else {
          lines.forEach(function (line) {
            var row = el("span", "log-line log-" + (line.level || "log"), null);
            var ts = el("span", "log-ts", formatLogTime(line.at));
            var lvl = el("span", "log-lvl", "[" + (line.level || "log") + "]");
            var msg = document.createTextNode(line.message || "");
            row.appendChild(ts);
            row.appendChild(lvl);
            row.appendChild(msg);
            content.appendChild(row);
            content.appendChild(document.createTextNode("\n"));
          });
        }
        if (meta) {
          meta.textContent =
            lines.length +
            " line(s) · file: " +
            (d.path || "—") +
            " · source: " +
            (d.source || "—") +
            (d.serverTime ? " · server " + d.serverTime : "");
        }
        if (hint) {
          hint.textContent = silent
            ? "Auto-refresh: " + LOGS_POLL_MS / 1000 + "s · updated " + new Date().toLocaleTimeString()
            : "Auto-refresh: " + LOGS_POLL_MS / 1000 + "s (pauses in background tab)";
        }
        if (autoscroll && autoscroll.checked && (wasAtBottom || !silent)) {
          content.scrollTop = content.scrollHeight;
        }
      })
      .catch(function (e) {
        content.textContent = "Error: " + e.message;
        if (!silent) showToast("Logs: " + e.message);
      });
  }

  function loadList(silent) {
    var q = document.getElementById("filter-q");
    var kind = document.getElementById("filter-kind");
    var sort = document.getElementById("filter-sort");
    var order = document.getElementById("filter-order");
    var params = new URLSearchParams();
    if (q && q.value) params.set("q", q.value);
    if (kind && kind.value) params.set("kind", kind.value);
    if (sort && sort.value) params.set("sort", sort.value);
    if (order && order.value) params.set("order", order.value);
    params.set("limit", "200");

    var url = apiBase() + "/requests?" + params.toString();
    var hint = document.getElementById("list-hint");
    if (hint && !silent) hint.textContent = "Loading…";

    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var tbody = document.getElementById("tbody-requests");
        if (!tbody) return;
        tbody.innerHTML = "";
        (data.items || []).forEach(function (row) {
          var tr = el("tr", null, null);
          tr.dataset.id = row.id;
          tr.appendChild(el("td", null, formatTime(row.at)));
          tr.appendChild(el("td", kindTagClass(row.kind), row.kind));
          tr.appendChild(el("td", null, row.type));
          tr.appendChild(el("td", "mono", row.stremioId));
          var c = el("td", null, "");
          if (row.kind === "torbox") {
            c.appendChild(el("span", "tag-torbox", "API"));
          } else {
            c.appendChild(el("span", row.cacheHit ? "tag-hit" : "tag-miss", row.cacheHit ? "HIT" : "MISS"));
          }
          tr.appendChild(c);
          tr.appendChild(el("td", null, String(row.durationMs)));
          tr.appendChild(el("td", null, String(row.streamCount)));
          tr.addEventListener("click", function () {
            setHash("/requests/" + row.id);
          });
          tbody.appendChild(tr);
        });
        if (hint) {
          var base = (data.items || []).length + " of " + (data.total || 0) + " shown";
          if (silent) {
            base += " · auto-updated " + new Date().toLocaleTimeString();
          }
          hint.textContent = base;
        }
      })
      .catch(function (e) {
        if (hint) hint.textContent = "Error: " + e.message;
        if (!silent) showToast("List failed: " + e.message);
      });
  }

  function showDetail(id, silent) {
    var listView = document.getElementById("view-requests");
    var detailView = document.getElementById("view-detail");
    if (listView) listView.classList.add("hidden");
    if (detailView) detailView.classList.remove("hidden");

    var content = document.getElementById("detail-content");
    if (!content) return;
    if (!silent) {
      content.innerHTML = "";
      content.appendChild(el("p", "hint", "Loading…"));
    }

    fetch(apiBase() + "/requests/" + encodeURIComponent(id), { credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 404) throw new Error("Not found");
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        content.innerHTML = "";
        var entry = data.entry;
        var h2 = el("h2", null, "Request " + entry.id);
        var block = el("div", "detail-block", null);
        block.appendChild(h2);
        var p1 = el("p", null, null);
        p1.appendChild(
          el("strong", null, entry.type + " · " + entry.stremioId + " — " + (entry.title || "—"))
        );
        block.appendChild(p1);
        block.appendChild(
          el(
            "p",
            "mono",
            "at " +
              entry.at +
              " · " +
              entry.durationMs +
              " ms · " +
              entry.streamCount +
              " streams · cache " +
              (entry.cacheHit ? "hit" : "miss")
          )
        );
        if (entry.remadeFromId) {
          block.appendChild(el("p", "mono", "Remake of " + entry.remadeFromId));
        }
        if (entry.error) {
          block.appendChild(el("p", "tag-miss", "Error: " + entry.error));
        }
        if (entry.providerApiCalls && entry.providerApiCalls.length > 0) {
          var apiBlock = el("div", "detail-block", null);
          apiBlock.appendChild(el("h2", null, "Outbound API calls"));
          var apiTable = el("table", "data");
          var apiHead = el("thead", null, null);
          var apiTrh = el("tr", null, null);
          ["Step", "ms", "OK", "Detail"].forEach(function (col) {
            apiTrh.appendChild(el("th", null, col));
          });
          apiHead.appendChild(apiTrh);
          apiTable.appendChild(apiHead);
          var apiBody = el("tbody", null, null);
          entry.providerApiCalls.forEach(function (call) {
            var trApi = el("tr", null, null);
            trApi.appendChild(el("td", "mono", call.step));
            trApi.appendChild(el("td", null, String(call.durationMs)));
            trApi.appendChild(el("td", null, call.ok ? "✓" : "✗"));
            trApi.appendChild(el("td", "mono", truncate(call.detail, 80)));
            apiBody.appendChild(trApi);
          });
          apiTable.appendChild(apiBody);
          apiBlock.appendChild(apiTable);
          content.appendChild(apiBlock);
        }
        if (silent) {
          content.appendChild(el("p", "hint", "View refreshed " + new Date().toLocaleTimeString()));
        }
        content.appendChild(block);

        if (data.relatedCacheKeys) {
          var k = el("div", "detail-block", null);
          k.appendChild(el("h2", null, "Related cache key names"));
          k.appendChild(el("pre", "raw", data.relatedCacheKeys.join("\n")));
          content.appendChild(k);
        }

        var actions = el("div", "detail-block", null);
        if (entry.kind === "stream" || entry.kind === "remake") {
          actions.appendChild(el("h2", null, "Actions"));
          var btn = el("button", "btn", "Remake (clear caches + re-run pipeline)");
          btn.addEventListener("click", function () {
            btn.disabled = true;
            var orig = btn.textContent;
            btn.textContent = "Running… (may take minutes)";
            fetch(apiBase() + "/requests/" + encodeURIComponent(id) + "/remake", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            })
              .then(function (r) {
                return r.json().then(function (j) {
                  if (!r.ok) throw new Error(j.message || j.error || "HTTP " + r.status);
                  return j;
                });
              })
              .then(function (j) {
                showToast("Remake done — " + (j.streamCount != null ? j.streamCount + " streams" : "ok"));
                if (j.newLogId) {
                  setHash("/requests/" + j.newLogId);
                } else {
                  setHash("/requests");
                }
              })
              .catch(function (e) {
                showToast("Remake failed: " + e.message);
              })
              .finally(function () {
                btn.disabled = false;
                btn.textContent = orig;
              });
          });
          actions.appendChild(btn);
          content.appendChild(actions);
        } else if (entry.kind === "torbox") {
          var note = el(
            "p",
            "hint",
            "TorBox entries are outbound API traces from api.torbox.app — not remakable from here."
          );
          content.appendChild(note);
        }
      })
      .catch(function (e) {
        if (silent) return;
        content.innerHTML = "";
        content.appendChild(el("p", "tag-miss", e.message));
      });
  }

  function route() {
    stopPolling();
    var h = getHash();
    var listView = document.getElementById("view-requests");
    var detailView = document.getElementById("view-detail");
    var cacheView = document.getElementById("view-cache");
    var clientsView = document.getElementById("view-clients");
    var logsView = document.getElementById("view-logs");
    if (h.view === "cache") {
      if (listView) listView.classList.add("hidden");
      if (detailView) detailView.classList.add("hidden");
      if (cacheView) cacheView.classList.remove("hidden");
      if (clientsView) clientsView.classList.add("hidden");
      if (logsView) logsView.classList.add("hidden");
      setActiveTab("cache");
      loadCache(false);
    } else if (h.view === "clients") {
      if (listView) listView.classList.add("hidden");
      if (detailView) detailView.classList.add("hidden");
      if (cacheView) cacheView.classList.add("hidden");
      if (clientsView) clientsView.classList.remove("hidden");
      if (logsView) logsView.classList.add("hidden");
      setActiveTab("clients");
      loadClients(false);
    } else if (h.view === "logs") {
      if (listView) listView.classList.add("hidden");
      if (detailView) detailView.classList.add("hidden");
      if (cacheView) cacheView.classList.add("hidden");
      if (clientsView) clientsView.classList.add("hidden");
      if (logsView) logsView.classList.remove("hidden");
      setActiveTab("logs");
      loadLogs(false);
    } else if (h.view === "detail" && h.id) {
      if (listView) listView.classList.add("hidden");
      if (detailView) detailView.classList.remove("hidden");
      if (cacheView) cacheView.classList.add("hidden");
      if (clientsView) clientsView.classList.add("hidden");
      if (logsView) logsView.classList.add("hidden");
      setActiveTab("requests");
      showDetail(h.id, false);
    } else {
      if (listView) listView.classList.remove("hidden");
      if (detailView) detailView.classList.add("hidden");
      if (cacheView) cacheView.classList.add("hidden");
      if (clientsView) clientsView.classList.add("hidden");
      if (logsView) logsView.classList.add("hidden");
      setActiveTab("requests");
      loadList(false);
    }
    startPolling();
  }

  document.getElementById("btn-refresh") &&
    document.getElementById("btn-refresh").addEventListener("click", function () {
      loadList(false);
    });
  document.getElementById("filter-q") &&
    document.getElementById("filter-q").addEventListener("input", function () {
      loadList(false);
    });
  ["filter-kind", "filter-sort", "filter-order"].forEach(function (id) {
    var n = document.getElementById(id);
    if (n) n.addEventListener("change", function () {
      loadList(false);
    });
  });
  document.getElementById("btn-back") &&
    document.getElementById("btn-back").addEventListener("click", function () {
      setHash("/requests");
    });

  var tabR = document.getElementById("tab-requests");
  if (tabR) {
    tabR.addEventListener("click", function () {
      setHash("/requests");
    });
  }
  var tabC = document.getElementById("tab-cache");
  if (tabC) {
    tabC.addEventListener("click", function () {
      setHash("/cache");
    });
  }
  var tabCl = document.getElementById("tab-clients");
  if (tabCl) {
    tabCl.addEventListener("click", function () {
      setHash("/clients");
    });
  }
  var tabLogs = document.getElementById("tab-logs");
  if (tabLogs) {
    tabLogs.addEventListener("click", function () {
      setHash("/logs");
    });
  }
  var btnCacheRefresh = document.getElementById("btn-cache-refresh");
  if (btnCacheRefresh) {
    btnCacheRefresh.addEventListener("click", function () {
      loadCache(false);
    });
  }
  var btnClientsRefresh = document.getElementById("btn-clients-refresh");
  if (btnClientsRefresh) {
    btnClientsRefresh.addEventListener("click", function () {
      loadClients(false);
    });
  }
  var btnLogsRefresh = document.getElementById("btn-logs-refresh");
  if (btnLogsRefresh) {
    btnLogsRefresh.addEventListener("click", function () {
      loadLogs(false);
    });
  }
  ["logs-filter-q", "logs-filter-level", "logs-filter-lines"].forEach(function (id) {
    var n = document.getElementById(id);
    if (n) {
      n.addEventListener("change", function () {
        loadLogs(false);
      });
      if (id === "logs-filter-q") {
        n.addEventListener("input", function () {
          loadLogs(false);
        });
      }
    }
  });

  window.addEventListener("hashchange", route);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stopPolling();
    } else {
      pollTick();
      startPolling();
    }
  });

  if (document.getElementById("tbody-requests")) {
    var ps = document.getElementById("poll-status");
    if (ps) {
      ps.textContent = "Auto-refresh: " + POLL_MS / 1000 + "s (pauses in background tab)";
    }
    var cph = document.getElementById("cache-poll-hint");
    if (cph) {
      cph.textContent = "Auto-refresh: " + POLL_MS / 1000 + "s (pauses in background tab)";
    }
    var cph2 = document.getElementById("clients-poll-hint");
    if (cph2) {
      cph2.textContent = "Auto-refresh: " + POLL_MS / 1000 + "s (pauses in background tab)";
    }
    var lph = document.getElementById("logs-poll-hint");
    if (lph) {
      lph.textContent = "Auto-refresh: " + LOGS_POLL_MS / 1000 + "s (pauses in background tab)";
    }
    if (!window.location.hash || window.location.hash === "#") {
      window.location.hash = "#/requests";
    } else {
      route();
    }
  }
})();
