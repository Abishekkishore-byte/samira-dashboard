# Samira · Air Purification Console

A live monitoring dashboard for the Samira multi-stage air purifier. Static
site — no build step, no dependencies. All telemetry is generated client-side
by a self-contained simulation so the demo runs anywhere with zero backend.

## Panels
1. **Live Air Quality** — pre / post-filter AQI gauges, purification efficiency, per-gas readouts (CO₂, NH₃, VOC, MQ-135).
2. **Environment** — temperature & humidity with trend arrows and sparklines (DHT22).
3. **Fan & Operation** — fan speed dial, RPM, residence time, mode, live AI decision log.
4. **Filter Health** — the five stages (coarse, HEPA mesh, activated carbon, soda lime, KMnO₄) with service alerts.
5. **Historical Trends** — 1 h / 6 h / 24 h line charts, toggleable series.
6. **Unit Network** — every connected Samira unit, live AQI/load, "working hardest" callout. Click a unit to focus it.
7. **Alerts & Notifications** — spikes, elevated CO₂, filter service, sync status.
8. **At a Glance** — runtime, pollutants removed, average improvement, last service.

## Structure
```
index.html        markup / layout
css/styles.css    design system
js/data.js         telemetry simulation model
js/charts.js       hand-built SVG instruments (gauges, dials, sparklines, trend chart)
js/app.js          DOM orchestration + live loop
```

## Run locally
```bash
npx serve .
# or
python -m http.server 4600
```

## Deploy
```bash
vercel --prod
```
Static output — Vercel serves the folder as-is.
