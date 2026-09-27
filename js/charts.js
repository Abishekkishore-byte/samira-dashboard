/* =====================================================================
   SAMIRA · hand-built SVG instruments (no chart library)
   window.Charts
   ===================================================================== */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  function polar(cx, cy, r, deg) { var a = deg * Math.PI / 180; return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) }; }
  function arcPath(cx, cy, r, startDeg, endDeg) {
    var s = polar(cx, cy, r, startDeg), e = polar(cx, cy, r, endDeg);
    var large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    // decreasing angle = clockwise on screen => sweep 1
    return "M" + s.x.toFixed(2) + " " + s.y.toFixed(2) + " A" + r + " " + r + " 0 " + large + " 1 " + e.x.toFixed(2) + " " + e.y.toFixed(2);
  }

  /* ---------- semicircular AQI gauge ---------- */
  function gauge(el, value, bnd) {
    var scale = Math.max(300, Math.ceil(value / 50) * 50);
    var cx = 100, cy = 120, r = 84;
    var f = Math.min(1, value / scale);
    var progEnd = 180 - f * 180;

    var ticks = "";
    [50, 100, 150, 200, 300].forEach(function (t) {
      if (t > scale) return;
      var deg = 180 - (t / scale) * 180;
      var a = polar(cx, cy, r - 2, deg), b = polar(cx, cy, r - 11, deg);
      ticks += '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="var(--line)" stroke-width="1.5"/>';
    });

    el.innerHTML =
      '<svg viewBox="0 0 200 140">' +
        '<path d="' + arcPath(cx, cy, r, 180, 0) + '" fill="none" stroke="var(--line)" stroke-width="12" stroke-linecap="round"/>' +
        '<path d="' + arcPath(cx, cy, r, 180, progEnd) + '" fill="none" stroke="' + bnd.color + '" stroke-width="12" stroke-linecap="round" style="transition:stroke .4s"/>' +
        ticks +
        '<text class="gauge__num" x="100" y="108" text-anchor="middle" fill="' + bnd.color + '">' + Math.round(value) + '</text>' +
        '<text class="gauge__sub" x="100" y="128" text-anchor="middle">AQI</text>' +
      '</svg>';
  }

  /* ---------- circular fan dial ---------- */
  function dial(el, pct) {
    var r = 46, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    el.innerHTML =
      '<svg viewBox="0 0 118 118">' +
        '<circle cx="59" cy="59" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="9"/>' +
        '<circle cx="59" cy="59" r="' + r + '" fill="none" stroke="var(--brand)" stroke-width="9" stroke-linecap="round" ' +
          'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" ' +
          'transform="rotate(-90 59 59)" style="transition:stroke-dashoffset .5s ease"/>' +
        '<text class="fan__dial-num" x="59" y="57" text-anchor="middle">' + Math.round(pct) + '<tspan font-size="13" dy="0">%</tspan></text>' +
        '<text class="fan__dial-lab" x="59" y="74" text-anchor="middle">FAN</text>' +
      '</svg>';
  }

  /* ---------- sparkline ---------- */
  function spark(el, data, color) {
    var w = 100, h = 38, n = data.length; if (n < 2) return;
    var min = Math.min.apply(null, data), max = Math.max.apply(null, data), span = (max - min) || 1;
    var pts = data.map(function (v, i) { return [(i / (n - 1)) * w, h - ((v - min) / span) * (h - 6) - 3]; });
    var d = smooth(pts);
    el.innerHTML =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="' + color + '" opacity=".08"/>' +
        '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linecap="round"/>' +
      '</svg>';
  }

  /* catmull-rom -> smooth bezier path */
  function smooth(p) {
    if (p.length < 2) return "";
    var d = "M" + p[0][0].toFixed(1) + " " + p[0][1].toFixed(1);
    for (var i = 0; i < p.length - 1; i++) {
      var p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += " C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " + c2x.toFixed(1) + " " + c2y.toFixed(1) + " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    return d;
  }

  /* ---------- main trend chart (multi-series, own-range normalised) ---------- */
  function trend(el, hist, series, winLabel) {
    var W = 820, H = 240, padL = 14, padR = 14, padT = 16, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB, n = hist.length;
    if (!n) { el.innerHTML = ""; return; }

    // horizontal gridlines
    var grid = "";
    for (var g = 0; g <= 4; g++) { var y = padT + (ih / 4) * g; grid += '<line class="grid-line" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"/>'; }

    // x labels
    var xlabs = "";
    var marks = [0, Math.floor(n / 3), Math.floor(2 * n / 3), n - 1];
    var lab = { start: winLabel, now: "now" };
    marks.forEach(function (idx, k) {
      var x = padL + (idx / (n - 1)) * iw;
      var txt = idx === 0 ? "−" + winLabel : idx === n - 1 ? "now" : "";
      if (txt) xlabs += '<text class="axis-lab" x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (idx === 0 ? "start" : "end") + '">' + txt + '</text>';
    });

    var paths = "";
    series.forEach(function (s) {
      if (!s.on) return;
      var vals = hist.map(function (d) { return d[s.key]; });
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
      var span = (max - min) || 1; min -= span * 0.15; max += span * 0.15; span = max - min;
      var pts = vals.map(function (v, i) { return [padL + (i / (n - 1)) * iw, padT + ih - ((v - min) / span) * ih]; });
      var d = smooth(pts);
      if (s.area) paths += '<path class="series-area" d="' + d + ' L' + pts[n - 1][0].toFixed(1) + ' ' + (padT + ih) + ' L' + pts[0][0].toFixed(1) + ' ' + (padT + ih) + ' Z" fill="' + s.color + '"/>';
      paths += '<path class="series-line" d="' + d + '" stroke="' + s.color + '" vector-effect="non-scaling-stroke"/>';
      // end dot
      var last = pts[n - 1];
      paths += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="' + s.color + '"/>';
    });

    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid + paths + xlabs + '</svg>';
  }

  window.Charts = { gauge: gauge, dial: dial, spark: spark, trend: trend };
})();
