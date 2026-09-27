/* =====================================================================
   SAMIRA · console orchestration
   Builds static scaffolding once, then updates values in place each tick.
   ===================================================================== */
(function () {
  "use strict";
  var S = window.Samira, C = window.Charts;
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  var round = Math.round;

  /* ---- gas readout config ---- */
  var GASES = [
    { key: "co2",   name: "CO₂",     unit: "ppm", max: 1600, warn: 1000, crit: 1400 },
    { key: "nh3",   name: "NH₃",     unit: "ppb", max: 50,   warn: 25,   crit: 38   },
    { key: "voc",   name: "VOC",     unit: "idx", max: 500,  warn: 250,  crit: 350  },
    { key: "mq135", name: "MQ-135",  unit: "aqi", max: 300,  warn: 100,  crit: 150  }
  ];

  /* ---- trend series ---- */
  var SERIES = [
    { key: "pre",  label: "Intake AQI",  color: "var(--s-pre)",  on: true,  area: true, unit: "" },
    { key: "post", label: "Output AQI",  color: "var(--s-post)", on: true,  area: false, unit: "" },
    { key: "temp", label: "Temp",        color: "var(--s-temp)", on: false, area: false, unit: "°C" },
    { key: "hum",  label: "Humidity",    color: "var(--s-hum)",  on: false, area: false, unit: "%" },
    { key: "fan",  label: "Fan",         color: "var(--s-fan)",  on: false, area: false, unit: "%" }
  ];

  var winLabel = { "1h": "1h", "6h": "6h", "24h": "24h" };
  var logSig = "", alertSig = "", netSig = "";

  /* =================== BUILD STATIC =================== */
  function build() {
    // unit dropdown
    var sel = $("unitSelect");
    S.units.forEach(function (u) {
      var o = document.createElement("option");
      o.value = u.id; o.textContent = u.name + " · " + u.location;
      sel.appendChild(o);
    });
    sel.value = S.current().id;
    sel.addEventListener("change", function () { S.select(this.value); syncMode(); render(true); });

    // gas chips
    var gl = $("gasList");
    GASES.forEach(function (g) {
      var c = el("div", "gas");
      c.id = "gas-" + g.key;
      c.innerHTML =
        '<div class="gas__top"><span class="gas__name">' + g.name + '</span><span class="gas__stat"></span></div>' +
        '<div><span class="gas__val num">—</span><span class="gas__unit">' + g.unit + '</span></div>' +
        '<div class="gas__bar"><i></i></div>';
      gl.appendChild(c);
    });

    // filter stack (mini, in hero flow)
    var mini = $("filterStackMini");
    S.FILTER_STAGES.forEach(function () { mini.appendChild(el("i")); });

    // filters list
    var fl = $("filterList");
    S.FILTER_STAGES.forEach(function (st) {
      var row = el("div", "filt"); row.id = "filt-" + st.key;
      row.innerHTML =
        '<div class="filt__top"><span class="filt__name">' + st.name + ' <small>' + st.note + '</small></span>' +
        '<span class="filt__pct num">—</span></div>' +
        '<div class="filt__track"><i class="filt__fill"></i></div>';
      fl.appendChild(row);
    });

    // legend
    var lg = $("trendLegend");
    SERIES.forEach(function (s) {
      var it = el("div", "legend__item" + (s.on ? "" : " is-off")); it.dataset.key = s.key;
      it.innerHTML = '<span class="legend__swatch" style="background:' + s.color + '"></span>' + s.label +
        ' <span class="legend__val num" data-val="' + s.key + '"></span>';
      it.addEventListener("click", function () { s.on = !s.on; it.classList.toggle("is-off", !s.on); drawTrend(); });
      lg.appendChild(it);
    });

    // stats
    var stl = $("statList");
    ["runtime", "removed", "improve", "service"].forEach(function (k) {
      var c = el("div", "stat"); c.id = "stat-" + k;
      c.innerHTML = '<div class="stat__val num">—</div><div class="stat__lab"></div><div class="stat__sub"></div>';
      stl.appendChild(c);
    });

    // window seg
    document.querySelectorAll(".seg__btn").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".seg__btn").forEach(function (x) { x.classList.remove("is-active"); });
        b.classList.add("is-active"); S.setWin(b.dataset.win); drawTrend();
      });
    });

    // mode toggle
    $("modeAuto").addEventListener("click", function () { setMode("auto"); });
    $("modeManual").addEventListener("click", function () { setMode("manual"); });

    // theme toggle
    $("themeToggle").addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("samira-theme", next); } catch (e) {}
      drawTrend(); // repaint chart immediately with the new palette
    });

    // clock
    setInterval(tickClock, 1000); tickClock();
  }

  function setMode(m) {
    var u = S.current(); if (u.mode === m) return;
    u.mode = m;
    u.aiLog.unshift({ t: nowHM(), html: m === "manual" ? "Manual override — fan held at <b>" + round(u.fanPct) + "%</b>" : "Auto mode re-engaged — AI managing airflow" });
    if (u.aiLog.length > 6) u.aiLog.pop();
    logSig = "";
    syncMode();
  }
  function syncMode() {
    var u = S.current();
    $("modeAuto").classList.toggle("is-active", u.mode === "auto");
    $("modeManual").classList.toggle("is-active", u.mode === "manual");
    $("fanModeMeta").textContent = u.mode === "auto" ? "Auto · AI-managed" : "Manual";
    $("aiState").textContent = u.mode === "auto" ? "active" : "standby";
  }
  function nowHM() { return new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }); }
  function tickClock() { $("clock").textContent = new Date().toLocaleTimeString(undefined, { hour12: false }); }

  /* =================== RENDER =================== */
  function trendArrow(hist, key) {
    var n = hist.length; if (n < 8) return { cls: "flat", ch: "→" };
    var a = hist[n - 6][key], b = hist[n - 1][key], d = b - a;
    var thr = key === "temp" ? 0.15 : 0.6;
    if (d > thr) return { cls: "up", ch: "↑" };
    if (d < -thr) return { cls: "down", ch: "↓" };
    return { cls: "flat", ch: "→" };
  }

  function render(force) {
    var u = S.current();

    /* hero gauges */
    var pb = S.band(u.pre), ob = S.band(u.post);
    C.gauge($("gaugePre"), u.pre, pb);
    C.gauge($("gaugePost"), u.post, ob);
    setBand($("preBand"), pb);
    setBand($("postBand"), ob);

    var eff = round((1 - u.post / u.pre) * 100);
    $("effVal").textContent = eff + "%";

    /* gases */
    GASES.forEach(function (g) {
      var v = u[g.key], c = $("gas-" + g.key);
      c.querySelector(".gas__val").textContent = round(v);
      var col = v >= g.crit ? "var(--aqi-bad)" : v >= g.warn ? "var(--aqi-mod)" : "var(--aqi-good)";
      c.querySelector(".gas__stat").style.background = col;
      var fill = c.querySelector(".gas__bar i");
      fill.style.width = Math.min(100, v / g.max * 100).toFixed(0) + "%";
      fill.style.background = col;
    });

    /* environment */
    var h = u.hist[S.activeWin];
    $("tempVal").textContent = u.temp.toFixed(1);
    $("humVal").textContent = round(u.hum);
    setTrend($("tempTrend"), trendArrow(h, "temp"));
    setTrend($("humTrend"), trendArrow(h, "hum"));
    C.spark($("tempSpark"), h.slice(-26).map(function (d) { return d.temp; }), "var(--s-temp)");
    C.spark($("humSpark"), h.slice(-26).map(function (d) { return d.hum; }), "var(--s-hum)");

    /* fan */
    C.dial($("fanDial"), u.fanPct);
    $("fanPct").textContent = round(u.fanPct);
    $("fanRpm").textContent = u.fanRpm.toLocaleString();
    $("resMs").textContent = u.residenceMs;

    /* ai log */
    var ls = u.aiLog.map(function (x) { return x.t + x.html; }).join("|");
    if (ls !== logSig || force) {
      logSig = ls;
      var list = $("aiLog"); list.innerHTML = "";
      u.aiLog.forEach(function (x) {
        list.appendChild(el("li", "ailog__item", '<span class="ailog__time">' + x.t + '</span><span>' + x.html + '</span>'));
      });
    }

    /* filters */
    S.FILTER_STAGES.forEach(function (st) {
      var v = u.filters[st.key], row = $("filt-" + st.key);
      row.classList.toggle("is-low", v < 20);
      row.querySelector(".filt__pct").textContent = round(v) + "%";
      var f = row.querySelector(".filt__fill");
      f.style.width = v + "%";
      f.style.background = v < 20 ? "var(--aqi-bad)" : v < 40 ? "var(--aqi-mod)" : "var(--brand)";
      row.querySelector(".filt__pct").style.color = v < 20 ? "var(--aqi-bad)" : "var(--ink)";
      row.title = "Last replaced " + u.lastReplaced[st.key];
    });
    var low = S.FILTER_STAGES.filter(function (st) { return u.filters[st.key] < 20; }).length;
    $("filterMeta").textContent = low ? low + " need service" : "5 stages · healthy";
    $("filterMeta").style.color = low ? "var(--aqi-poor)" : "";

    /* trends */
    drawTrend();

    /* network */
    drawNet(force);

    /* alerts */
    drawAlerts();

    /* summary */
    var recent = mostRecentService(u);
    $("stat-runtime").querySelector(".stat__val").innerHTML = u.runtimeHours.toLocaleString() + '<small>hrs</small>';
    $("stat-runtime").querySelector(".stat__lab").textContent = "Total runtime";
    $("stat-runtime").querySelector(".stat__sub").textContent = "since commissioning";
    $("stat-removed").querySelector(".stat__val").innerHTML = u.pollutantsRemoved.toFixed(1) + '<small>kg</small>';
    $("stat-removed").querySelector(".stat__lab").textContent = "Pollutants removed";
    $("stat-removed").querySelector(".stat__sub").textContent = "lifetime estimate";
    $("stat-improve").querySelector(".stat__val").innerHTML = u.avgImprovement + '<small>%</small>';
    $("stat-improve").querySelector(".stat__lab").textContent = "Avg AQI improvement";
    $("stat-improve").querySelector(".stat__sub").textContent = "intake → output";
    $("stat-service").querySelector(".stat__val").innerHTML = '<span style="font-size:19px">' + recent.date + '</span>';
    $("stat-service").querySelector(".stat__lab").textContent = "Last filter service";
    $("stat-service").querySelector(".stat__sub").textContent = recent.name;
  }

  function mostRecentService(u) {
    var best = null;
    S.FILTER_STAGES.forEach(function (st) {
      var d = new Date(u.lastReplaced[st.key] + " " + new Date().getFullYear());
      if (!best || d > best.d) best = { d: d, date: u.lastReplaced[st.key], name: st.name };
    });
    return best;
  }

  function drawTrend() {
    var u = S.current(), h = u.hist[S.activeWin];
    C.trend($("trendChart"), h, SERIES, winLabel[S.activeWin]);
    var last = h[h.length - 1];
    SERIES.forEach(function (s) {
      var t = document.querySelector('.legend__val[data-val="' + s.key + '"]');
      if (t && last) t.textContent = (s.key === "temp" ? last.temp.toFixed(1) : round(last[s.key])) + s.unit;
    });
  }

  function drawNet(force) {
    var list = $("netList"), sel = S.current();
    var sig = S.units.map(function (u) { return u.id + (u.online ? round(u.pre) + round(u.fanPct) : "off") + (u.id === sel.id ? "*" : ""); }).join("|");
    var online = S.units.filter(function (u) { return u.online; }).length;
    $("netMeta").textContent = online + " / " + S.units.length + " online";
    var hard = S.hardest();
    $("netHardest").innerHTML = "Working hardest · <b>" + (hard ? hard.name : "—") + "</b>";
    if (sig === netSig && !force) {
      // still refresh live numbers without rebuilding
      S.units.forEach(function (u) {
        var r = document.getElementById("net-" + u.id); if (!r || !u.online) return;
        r.querySelector(".netrow__aqi").textContent = round(u.pre);
        r.querySelector(".netrow__aqi").style.color = S.band(u.pre).color;
        r.querySelector(".netrow__stat").style.background = S.band(u.pre).color;
        r.querySelector(".netrow__loadbar i").style.width = round(u.fanPct) + "%";
      });
      return;
    }
    netSig = sig;
    list.innerHTML = "";
    S.units.forEach(function (u) {
      var r = el("div", "netrow" + (u.id === sel.id ? " is-active" : "")); r.id = "net-" + u.id;
      var b = S.band(u.pre);
      r.innerHTML =
        '<span class="netrow__stat" style="background:' + (u.online ? b.color : "var(--ink-4)") + '"></span>' +
        '<span><div class="netrow__name">' + u.name + '</div><div class="netrow__loc">' + u.location + '</div></span>' +
        (u.online
          ? '<span class="netrow__load"><span class="netrow__loadbar"><i style="width:' + round(u.fanPct) + '%"></i></span></span>'
          : '<span class="netrow__off">offline</span>') +
        '<span class="netrow__aqi" style="color:' + (u.online ? b.color : "var(--ink-4)") + '">' + (u.online ? round(u.pre) : "—") + '</span>';
      r.addEventListener("click", function () {
        S.select(u.id); $("unitSelect").value = u.id; syncMode(); render(true);
      });
      list.appendChild(r);
    });
  }

  function drawAlerts() {
    var u = S.current(), list = $("alertList");
    var sig = u.alerts.map(function (a) { return a.t + a.title; }).join("|");
    $("alertCount").textContent = u.alerts.length;
    if (sig === alertSig) return;
    alertSig = sig;
    list.innerHTML = "";
    if (!u.alerts.length) { list.appendChild(el("li", "alerts__empty", "All clear — no active alerts for this unit.")); return; }
    var ico = { info: "i", warn: "!", crit: "!" };
    u.alerts.forEach(function (a) {
      list.appendChild(el("li", "alert alert--" + a.kind,
        '<span class="alert__ico">' + (ico[a.kind] || "i") + '</span>' +
        '<span class="alert__body"><div class="alert__title">' + a.title + '</div><div class="alert__desc">' + a.desc + '</div></span>' +
        '<span class="alert__time">' + a.t + '</span>'));
    });
  }

  function setBand(node, b) {
    node.textContent = b.label;
    node.style.color = b.color;
    node.style.borderColor = b.color;
    node.style.background = "color-mix(in srgb, " + b.color + " 12%, transparent)";
  }
  function setTrend(node, t) {
    node.className = "trend trend--" + t.cls;
    node.innerHTML = t.ch + " <span class='num'></span>";
  }

  /* =================== BOOT =================== */
  build();
  syncMode();
  S.tick();          // prime derived values
  render(true);
  setInterval(function () { S.tick(); render(false); }, 2000);
})();
