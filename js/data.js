/* =====================================================================
   SAMIRA · telemetry model
   A self-contained simulation that keeps every panel telling the same
   story: room air drifts, the intake sensor reads it, the AI trims the
   fan, the multi-stage stack scrubs it, and the output sensor confirms.
   Exposed as window.Samira.
   ===================================================================== */
(function () {
  "use strict";

  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var round = Math.round;

  /* ---- AQI banding (refined semantic scale) ---- */
  var BANDS = [
    { max: 50,  key: "good", label: "Good",           color: "var(--aqi-good)" },
    { max: 100, key: "mod",  label: "Moderate",        color: "var(--aqi-mod)"  },
    { max: 150, key: "poor", label: "Poor",            color: "var(--aqi-poor)" },
    { max: 200, key: "bad",  label: "Unhealthy",       color: "var(--aqi-bad)"  },
    { max: 300, key: "vbad", label: "Very Unhealthy",  color: "var(--aqi-vbad)" },
    { max: 1e9, key: "haz",  label: "Hazardous",       color: "var(--aqi-haz)"  }
  ];
  function band(v) { for (var i = 0; i < BANDS.length; i++) if (v <= BANDS[i].max) return BANDS[i]; }

  /* ---- unit definitions (each room has its own personality) ---- */
  var DEFS = [
    { id: "u1", name: "Reception Hall",  location: "Ground floor · lobby",  base: 74,  peaky: 0.9, online: true  },
    { id: "u2", name: "Open Workspace",  location: "Level 2 · north wing",  base: 96,  peaky: 1.1, online: true  },
    { id: "u3", name: "Server Room",     location: "Level 2 · east",        base: 58,  peaky: 0.4, online: true  },
    { id: "u4", name: "Conference A",    location: "Level 3 · boardroom",   base: 118, peaky: 1.4, online: true  },
    { id: "u5", name: "Wet Lab · Bay 2", location: "Level 1 · fume zone",   base: 142, peaky: 1.7, online: true  }
  ];

  var FILTER_STAGES = [
    { key: "coarse",   name: "Coarse pre-filter",  note: "PM10 / dust" },
    { key: "mesh",     name: "HEPA mesh",          note: "PM2.5" },
    { key: "carbon",   name: "Activated carbon",   note: "VOC / odour" },
    { key: "sodaLime", name: "Soda lime",          note: "CO₂ capture" },
    { key: "kmno4",    name: "KMnO₄ sheets",       note: "NH₃ / oxidiser" }
  ];

  function daysAgo(n) {
    var d = new Date(Date.now() - n * 864e5);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }

  function makeUnit(def) {
    var pre = def.base + rand(-8, 8);
    return {
      id: def.id, name: def.name, location: def.location,
      online: def.online, base: def.base, peaky: def.peaky,
      pre: pre, preTarget: def.base, post: pre * 0.06,
      voc: clamp(def.base * 1.6 + rand(-40, 40), 40, 480),
      co2: clamp(430 + def.base * 3.4 + rand(-60, 60), 400, 1600),
      nh3: clamp(def.base * 0.13 + rand(-2, 2), 1, 40),
      mq135: def.base + rand(-10, 10),
      temp: rand(21.5, 24.5), tempTarget: rand(21.5, 24.5),
      hum: rand(42, 52), humTarget: rand(42, 52),
      fanPct: 55, fanRpm: 1400, mode: "auto", residenceMs: 420,
      filters: {
        coarse:   round(rand(58, 88)),
        mesh:     round(rand(46, 80)),
        carbon:   round(rand(34, 66)),
        sodaLime: round(rand(40, 70)),
        kmno4:    def.id === "u5" ? 17 : round(rand(24, 60))
      },
      lastReplaced: {
        coarse: daysAgo(round(rand(8, 20))),  mesh: daysAgo(round(rand(30, 60))),
        carbon: daysAgo(round(rand(40, 90))), sodaLime: daysAgo(round(rand(20, 55))),
        kmno4: daysAgo(round(rand(60, 110)))
      },
      runtimeHours: round(rand(2600, 7400)),
      pollutantsRemoved: rand(6.2, 21.5),        // kg lifetime estimate
      avgImprovement: 0,                          // computed
      spikeTtl: 0, spikeMag: 0, nextSpike: rand(18, 60),
      aiLog: [], alerts: [], _lastFanBucket: 3, _seededLog: false,
      hist: { "1h": [], "6h": [], "24h": [] }
    };
  }

  var units = DEFS.map(makeUnit);

  /* ---- efficiency + fan policy ---- */
  function filterAvg(u) {
    var f = u.filters;
    // stages that touch gas count more toward scrubbing capacity
    return (f.coarse * 0.15 + f.mesh * 0.28 + f.carbon * 0.27 + f.sodaLime * 0.14 + f.kmno4 * 0.16) / 100;
  }

  function autoFanTarget(u, hour) {
    // baseline: worse intake -> faster fan
    var t = clamp(28 + (u.pre - 30) * 0.46, 22, 100);
    // signature behaviour: high VOC at moderate particulate -> slow down for residence time
    if (u.voc > 260 && u.pre < 140) t = clamp(t - 26, 20, 70);
    // night eco
    if (hour >= 22 || hour < 6) t = clamp(t - 14, 18, 100);
    return t;
  }

  function pushLog(u, html) {
    var now = new Date();
    u.aiLog.unshift({ t: now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }), html: html });
    if (u.aiLog.length > 6) u.aiLog.pop();
  }
  function pushAlert(u, kind, title, desc) {
    // de-dupe recent identical titles
    if (u.alerts[0] && u.alerts[0].title === title) return;
    var now = new Date();
    u.alerts.unshift({ kind: kind, title: title, desc: desc, t: now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) });
    if (u.alerts.length > 12) u.alerts.pop();
  }

  /* seed a few historical alerts/log lines so panels aren't empty on load */
  function seed(u) {
    if (u._seededLog) return;
    u._seededLog = true;
    pushLog(u, "Baseline learned · target output <b>&lt;20 AQI</b>");
    pushLog(u, "Auto mode engaged for <b>" + u.name + "</b>");
    if (u.filters.kmno4 < 20) pushAlert(u, "warn", "KMnO₄ sheets low", "Stage 5 at " + u.filters.kmno4 + "% — schedule replacement.");
    Object.keys(u.hist).forEach(function (w) { reseed(u, w); });
  }

  /* ---- history seeding: builds a plausible curve ending at 'now' ---- */
  var WIN_POINTS = { "1h": 60, "6h": 72, "24h": 96 };
  function reseed(u, win) {
    var n = WIN_POINTS[win], arr = new Array(n);
    var phase = rand(0, Math.PI * 2);
    for (var i = 0; i < n; i++) {
      var p = i / (n - 1);                 // 0..1 oldest->newest
      // diurnal-ish swell + a couple of bumps + noise, converging to current
      var swell = Math.sin(phase + p * Math.PI * (win === "24h" ? 2.1 : 1.2)) * u.base * 0.16;
      var bump = (win !== "1h" && Math.abs(p - 0.62) < 0.05) ? u.base * 0.5 : 0;
      var noise = rand(-1, 1) * u.base * 0.07;
      var pre = clamp(u.base + swell + bump + noise, 18, 340);
      if (i === n - 1) pre = u.pre;         // anchor newest to live value
      var eff = 0.9 + rand(-0.03, 0.03);
      arr[i] = {
        pre: round(pre),
        post: round(pre * (1 - eff)),
        temp: +(u.temp + Math.sin(phase + p * 3) * 0.9 + rand(-0.15, 0.15)).toFixed(1),
        hum: round(u.hum + Math.sin(phase + p * 2.4) * 4 + rand(-1, 1)),
        fan: round(clamp(30 + (pre - 30) * 0.42, 20, 100))
      };
    }
    u.hist[win] = arr;
  }

  var activeWin = "1h";

  /* ---- main tick: advance every unit one step ---- */
  function tick() {
    var hour = new Date().getHours();
    units.forEach(function (u) {
      if (!u.online) return;
      seed(u);

      /* spike scheduler — occasional pollution events */
      u.nextSpike -= 1;
      if (u.spikeTtl <= 0 && u.nextSpike <= 0) {
        u.spikeTtl = round(rand(6, 14));
        u.spikeMag = rand(50, 120) * u.peaky;
        u.nextSpike = rand(30, 90);
      }
      var spikeAdd = 0;
      if (u.spikeTtl > 0) { spikeAdd = u.spikeMag * (u.spikeTtl / 14); u.spikeTtl--; }

      /* room air random-walk toward base + spike */
      u.preTarget += rand(-6, 6); u.preTarget = clamp(u.preTarget, u.base * 0.7, u.base * 1.35);
      u.pre += (u.preTarget + spikeAdd - u.pre) * 0.18 + rand(-1.5, 1.5);
      u.pre = clamp(u.pre, 15, 360);

      /* correlated gases */
      u.voc += (u.pre * 1.5 - u.voc) * 0.12 + rand(-8, 8); u.voc = clamp(u.voc, 30, 500);
      u.co2 += (420 + u.pre * 3.2 - u.co2) * 0.08 + rand(-14, 14); u.co2 = clamp(u.co2, 400, 1900);
      u.nh3 += (u.pre * 0.12 - u.nh3) * 0.1 + rand(-0.6, 0.6); u.nh3 = clamp(u.nh3, 1, 48);
      u.mq135 += (u.pre - u.mq135) * 0.15 + rand(-2, 2); u.mq135 = clamp(u.mq135, 12, 360);

      /* temp / humidity gentle walk */
      u.tempTarget += rand(-0.05, 0.05); u.tempTarget = clamp(u.tempTarget, 20.5, 25.5);
      u.temp += (u.tempTarget - u.temp) * 0.05 + rand(-0.03, 0.03);
      u.humTarget += rand(-0.3, 0.3); u.humTarget = clamp(u.humTarget, 38, 58);
      u.hum += (u.humTarget - u.hum) * 0.05 + rand(-0.15, 0.15);

      /* fan control */
      var target = u.mode === "auto" ? autoFanTarget(u, hour) : u.fanPct;
      u.fanPct += (target - u.fanPct) * 0.22;
      u.fanPct = clamp(u.fanPct, 15, 100);
      u.fanRpm = round(u.fanPct / 100 * 2600 + rand(-30, 30));
      u.residenceMs = round(940 - u.fanPct * 7.4);   // faster fan -> shorter residence

      /* scrubbing */
      var eff = clamp(0.72 + filterAvg(u) * 0.22 + (u.residenceMs / 900) * 0.06, 0.7, 0.988);
      // very high load slightly reduces achievable efficiency
      if (u.pre > 220) eff -= 0.03;
      u.post += (u.pre * (1 - eff) - u.post) * 0.3;
      u.post = clamp(u.post, 2, u.pre);
      u.avgImprovement = round((1 - u.post / u.pre) * 100);

      /* filter wear (slow) — gas stages wear faster under load */
      var load = u.pre / 100;
      u.filters.coarse   = clamp(u.filters.coarse   - 0.0016 * load, 0, 100);
      u.filters.mesh     = clamp(u.filters.mesh     - 0.0020 * load, 0, 100);
      u.filters.carbon   = clamp(u.filters.carbon   - 0.0030 * (u.voc / 200), 0, 100);
      u.filters.sodaLime = clamp(u.filters.sodaLime - 0.0022 * (u.co2 / 800), 0, 100);
      u.filters.kmno4    = clamp(u.filters.kmno4    - 0.0026 * (u.nh3 / 20), 0, 100);

      /* lifetime tallies creep up */
      u.pollutantsRemoved += (u.pre - u.post) * 1e-6 * u.fanPct;

      /* ---- narrate meaningful changes (AI log) ---- */
      var bucket = u.fanPct > 82 ? 5 : u.fanPct > 62 ? 4 : u.fanPct > 42 ? 3 : u.fanPct > 28 ? 2 : 1;
      if (bucket !== u._lastFanBucket) {
        if (bucket > u._lastFanBucket) {
          if (u.voc > 260 && u.pre < 140)
            pushLog(u, "High VOC (<b>" + round(u.voc) + "</b>) → holding fan for deeper carbon contact");
          else
            pushLog(u, "Intake rising to <b>" + round(u.pre) + "</b> → fan ramped to <b>" + round(u.fanPct) + "%</b>");
        } else {
          pushLog(u, "Air clearing → fan eased to <b>" + round(u.fanPct) + "%</b>, saving energy");
        }
        u._lastFanBucket = bucket;
      }

      /* ---- alerts ---- */
      if (spikeAdd > 40 && u.spikeTtl === round(rand(6, 14)) - 0) { /* handled below on first frame */ }
      if (u.spikeTtl > 0 && spikeAdd > 60 && (!u.alerts[0] || u.alerts[0].title.indexOf("spike") === -1)) {
        pushAlert(u, "warn", "Sudden AQI spike", "Intake jumped to " + round(u.pre) + " AQI — filtration compensating.");
      }
      if (u.co2 > 1400 && (!u.alerts[0] || u.alerts[0].title !== "Elevated CO₂")) {
        pushAlert(u, "warn", "Elevated CO₂", round(u.co2) + " ppm — cognitive-load threshold. Consider fresh-air exchange.");
      }
      Object.keys(u.filters).forEach(function (k) {
        if (u.filters[k] < 20 && u.filters[k] > 19.9) {
          pushAlert(u, "warn", "Filter service due", stageName(k) + " dropped below 20%.");
        }
      });
    });

    /* offline demo: keep u5 humming hard, occasionally flag it */
    var sel = current();
    if (sel) {
      var arr = sel.hist[activeWin];
      if (arr && arr.length) {
        arr.push({ pre: round(sel.pre), post: round(sel.post), temp: +sel.temp.toFixed(1), hum: round(sel.hum), fan: round(sel.fanPct) });
        arr.shift();
      }
    }
  }

  function stageName(k) { for (var i = 0; i < FILTER_STAGES.length; i++) if (FILTER_STAGES[i].key === k) return FILTER_STAGES[i].name; return k; }

  /* ---- selection ---- */
  var currentId = units[1].id;   // default to Open Workspace (a busy one)
  function current() { for (var i = 0; i < units.length; i++) if (units[i].id === currentId) return units[i]; }
  function select(id) { currentId = id; var u = current(); Object.keys(u.hist).forEach(function (w) { reseed(u, w); }); }

  /* network: which unit is working hardest (highest fan under load) */
  function hardest() {
    var best = null, score = -1;
    units.forEach(function (u) { if (!u.online) return; var s = u.fanPct * 0.6 + u.pre * 0.4; if (s > score) { score = s; best = u; } });
    return best;
  }

  window.Samira = {
    units: units, FILTER_STAGES: FILTER_STAGES,
    band: band, stageName: stageName,
    tick: tick, current: current, select: select, hardest: hardest,
    reseed: reseed,
    get activeWin() { return activeWin; },
    setWin: function (w) { activeWin = w; reseed(current(), w); }
  };
})();
