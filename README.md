# TanamTenang — the hackathon build

**▶ [lucoslabs-cloud.github.io/tanamtenang-spaceapps](https://lucoslabs-cloud.github.io/tanamtenang-spaceapps/)**

*Tanam tenang* — "plant calmly".

The NASA Space Apps Challenge 2026 build of TanamTenang, for *Field Shift:
Adapting Farms with NASA Data*. A project of **Lucos Labs**.

**No server, no database, no ingest.** `npm run build` produces a `dist/`
folder that any static host will serve, and the whole thing — scoring,
rotation planning, the map — runs in the browser.

---

## What this is, and why it exists separately

There is a second, larger half of this project: a Laravel 12 platform over
PostgreSQL + PostGIS, in a private repository. That one is the real thing —
it ingests SRTM, NASA POWER, MODIS, SoilGrids and NEX-GDDP-CMIP6 itself,
scores 67,855 cells in SQL, and serves the map as Mapbox Vector Tiles.
Setting it up means Docker, an hour of `composer install` and `npm install`,
and then **about four hours of ingest before it draws a single pixel**.

A judge gets five minutes.

So this build takes one photograph of that database and serves it statically.
Nothing is recomputed on the way out, and the thresholds, priority
multipliers and rotation weights are exported from the platform's own config
files rather than retyped — which is what lets the two agree. Where the
platform compiles a trapezoidal membership function into SQL, this one runs
the same function in TypeScript; `MembershipAgreementTest` over there keeps
the PHP and the SQL honest, and the port here follows the PHP branch for
branch.

**One thing is genuinely better here.** The platform re-scores in the
database, so moving a farmer's priority slider means a round trip per tile.
Here the grid is already in the browser, so a slider repaints all 67,855
cells while you drag it. That is not a trick: it is the same arithmetic, run
where the data already is.

---

## Run it

```bash
npm install
npm run dev
```

The snapshot is committed under `public/data/`, so nothing else is needed.
To rebuild the snapshot from a running platform database, see
[Rebuilding the snapshot](#rebuilding-the-snapshot).

```bash
npm run build     # type-checks, then writes dist/
npm run preview   # serves dist/ locally
```

`dist/` is a plain static site with `base: './'`, so it works from a
subdirectory as well as from a domain root.

---

## What it does

### 1. Four rotation strategies, side by side

The front door, because it is what the brief asks for in as many words: *at
least three rotation strategies, including the existing rotation*.

| Strategy | What it maximises |
|---|---|
| **Carry on as you are** | Nothing. It is what the field does if nobody changes anything — the crop in the ground now, every season, with the rotation rules applied in full. A baseline, never a recommendation. |
| **Best return** | Summed suitability over the sequence, with cover seasons counted at nothing. |
| **Build the soil** | The same, plus a soil index: nitrogen fixed, residue returned, families varied. |
| **Use the least water** | The same, minus the sequence's water demand against a four-ordinary-seasons reference. |

Every strategy searches the same space of legal sequences and differs only in
its objective, so a difference between two plans is a difference in *goal*
rather than in implementation.

The search is **exhaustive, not greedy**, and that is the whole reason it is
not fifteen lines: a legume's value is not in its own season but in the
nitrogen it leaves for the season behind it, and a planner that picks the
best crop each season in turn can never see that. Eight candidates over four
seasons is 4,096 sequences, walked once per strategy.

Each strategy answers the same five questions the brief asks: **why** it was
suggested, **what evidence** supports it — named down to the dataset — **what
it may offer**, **where the information gaps are**, and **what needs local
review**. The gap list is long on purpose.

Only *build the soil* can afford a cover crop. A green manure is scored as
suitable like anything else and as earning nothing, so a season of one costs
that season's whole harvest, and the panel marks the season **no harvest** and
says what it costs.

### 2. A district you can move through time

Two map modes. **What grows** paints FAO suitability for one enterprise under
one climate and the farmer's own weighting. **Evidence** paints the raw layers
behind it, each citing its dataset.

Stepping the timeline Today → 2030 → 2050 → 2070 re-scores every cell against
monthly normals shifted by a six-model CMIP6 ensemble and recounted day by
day. Only scenarios that actually have twelve monthly normals at every
sampling point are offered: the platform once declared seven and had data for
one, which made the 2070 map pixel-identical to today's, and a farmer taking
comfort from that has been misled by a feature that looked like it worked.

Under the map, **the year at this point**: monthly rainfall with its
one-in-ten wet and dry years, crop water demand on the same axis, and the
temperature band. A month whose dry year falls below what a crop loses to the
air is marked — which on today's record happens nowhere in Sri Aman, and
under SSP5-8.5 at 2070 happens in July and September.

### 3. Built for a farmer, not an analyst

Three questions, about a minute: where is your field, what is on it now, what
matters to you. Nothing is required except the first, and the tool says what
each answer changes rather than collecting it silently.

The priority sliders are inputs to the model, not a filter on its output.
Pushing *conserve water* up multiplies the weight on driest-month rainfall,
dry-spell length, the water balance and available water capacity; the
geometric mean then re-ranks every enterprise, and it also decides which
rotation strategy is put forward.

A farmer can tap one spot or trace their field's outline. An outline is scored
from every cell it touches, weighted by how much of each it covers, because a
plot across the peat edge near Simanggang spans 60 to 120 cm of peat and a
flood hazard from 0.41 to 0.91 — one end of it land a drainage design will
work with, the other end land it refuses. Where the cells disagree, the
ranking says so instead of averaging it away.

Every figure is defined in **What this means**, read from the same source as
the tooltips so the two cannot drift, with the dataset behind each one printed
beside it. There is a whole section on what the tool cannot know.

### 4. Anywhere on Earth

Sri Aman ships as a 250 m snapshot. Anywhere else, the tool asks NASA POWER
for the climate and ISRIC SoilGrids for the soil straight from the browser and
derives exactly what the platform derives from them — FAO-56 Penman-Monteith
ET₀, USDA texture class, natural drainage, available water capacity, the peat
indicator.

**What it cannot get, it does not invent.** There is no elevation model
reachable without an Earthdata token, so slope, wetness, height above drainage
and flood hazard come back null; dry-spell length and rainfall variability
need the daily record rather than a climatology; land cover needs a subsetting
service. The engine already handles that honestly — a null metric drops out of
the geometric mean and the coverage figure falls — so a live point reports a
lower coverage than a district cell and the panel names every requirement it
could not look at.

---

## How a score is built

FAO land evaluation (Soils Bulletin 32), as inspectable data rather than
branching code.

1. Each enterprise carries a **requirement envelope** per metric: an absolute
   range outside which it fails, and an optimal range inside which it is
   unconstrained. 343 envelopes across 31 enterprises.
2. One value scores 0 to 1 on a trapezoid over that envelope. **A value with
   no measurement behind it scores `null`, never zero** — "we did not measure
   this" and "this is lethal" are different claims and only one of them is
   ours to make.
3. The farmer's priorities multiply the weight on the metrics they care about.
4. Per-metric scores combine as a **weighted geometric mean**, then get pulled
   a quarter of the way toward the weakest one. That is Liebig's law of the
   minimum: a farmer cannot eat the average of good rainfall and impossible
   soil.
5. The result lands in FAO classes **S1 → S2 → S3 → N1 → N2**. The N1/N2 split
   is the useful part: N1 fails today on something investment can fix, which
   turns a red patch into a work order; N2 fails on something nobody can
   change, which is an honest "look elsewhere".
6. **Coverage** travels alongside — the share of the weighted requirements
   that had data behind them. Without it, a cell missing its soil data would
   score the same as one with genuinely good soil, which is the most dangerous
   failure mode available here.

A farm is not only crops: oil palm, paddy, kangkung, tilapia and a goat herd
all pass through the same engine with the same shape of envelope. Weather hits
fish and livestock hardest and they are usually left out of a tool like this.

---

## Data

Exported from the platform database, which ingested it from:

| Dataset | Resolution | Role |
|---|---|---|
| **NASA SRTM** SRTMGL1 v003 | 30 m | Slope, aspect, wetness index, height above drainage, flood hazard |
| **NASA POWER** MERRA-2 / CERES | 0.5° × 0.625° | Rainfall and temperature seasonality, ET₀, dry spells, extremes |
| **NASA MODIS** MCD12Q1 v061 | 500 m | Land cover, and the model's permanent exclusions |
| **NASA MODIS** MOD13Q1 v061 | 250 m | Mean NDVI and its seasonal swing |
| **NASA NEX-GDDP-CMIP6** | 0.25° | Six-model ensemble, SSP2-4.5 and SSP5-8.5 to 2070 |
| **ISRIC SoilGrids** | 250 m | pH, texture, organic carbon, CEC, bulk density, nitrogen |
| **UN OCHA COD-AB** | — | The district boundary and the grid built inside it |
| **OpenStreetMap** | — | Base map tiles, served live |

Fetched live, in the browser, for a point outside the district: **NASA POWER**
and **ISRIC SoilGrids**.

Six more datasets — NASADEM, GPM IMERG, SMAP, MODIS LST, MODIS ET and
GRACE-FO — are **registered and carry no data**. They have an endpoint, a DOI
and a citation, and their columns are null for all 67,855 cells. The
**What this means → Where the numbers come from** tab says so plainly rather
than listing them as though the scores rested on them.

Of the nine NASA dataset families the challenge brief names, **three are
behind a number here**: MODIS, POWER and SRTM. ECOSTRESS, Landsat and GEDI are
absent entirely.

### An honest constraint

NASA POWER's native grid is 0.5° × 0.625°, roughly 55 × 69 km, and the whole
district spans about 1.1° × 0.64°. POWER therefore resolves to **two to four
distinct cells district-wide** and cannot by itself produce a within-district
map. Rather than interpolate it into a precision it does not have, the
architecture splits the job: *where* things differ comes from SRTM at 30 m,
SoilGrids at 250 m and MODIS; *when*, and *what changes*, comes from POWER and
CMIP6. Climate is never baked into a cell, which is also what lets switching
scenario be instant here.

---

## How it is put together

```
public/data/          the snapshot — 1.8 MB of grid gzipped, plus JSON
  meta.json           grid geometry, scenarios, every scoring constant
  vocabulary.json     45 metrics: label, unit, group, provenance, definition
  catalogue.json      31 enterprises, 343 envelopes, 80 rotation rules
  climate.json        4 POWER points x 7 scenarios: annual, monthly, yearly
  grid/*.bin          one Int16 raster per metric over a 485 x 284 lattice

src/engine/           the port: membership, suitability, ranking, seasonal
  rotation/           search, axes, explainer, planner
src/data/             loading the snapshot; the live anywhere-on-Earth path
src/workers/          scoring the district off the main thread
src/components/       the map, the charts, the strategy cards
src/views/            start · field · district · what this means
tools/export.mjs      bakes the platform database into public/data
```

### The grid is an image

`ST_SquareGrid` lays a **regular** lattice, and a regular lattice needs no
geometry: an origin, a step and two indices place every cell exactly. So the
district ships as one Int16 raster per metric over a 485 × 284 frame — 1.8 MB
gzipped for all twenty-five — and the browser treats it as what it is, an
image it can index, score and repaint. The map puts the scored result up as a
single image source with `raster-resampling: nearest`, because each pixel is
6.25 hectares and smoothing it would draw a precision the data does not have.

`-32768` is reserved for "no data" and every read returns `null` for it.

---

## Rebuilding the snapshot

**Not needed to run or deploy this.** The snapshot is committed; this is only
for when the platform's data or scoring constants change, and it needs a
checkout of that private repository with its PostGIS container up and PHP
available. With this repository checked out at `hackathon/` inside it:

```bash
docker compose up -d postgis
node hackathon/tools/export.mjs
```

It reads the tables through `docker exec psql` and the config arrays through
`php artisan tinker`, so there is no second database client and no copy of the
scoring constants to keep in step. It prints what it wrote and warns about any
scenario that has no normals behind it.

---

## Deploying

It is already deployed. `.github/workflows/deploy.yml` builds on every push
to `main` and publishes to GitHub Pages at the link at the top of this file.
The workflow runs `npm run build`, which type-checks before it bundles, so a
push that breaks the engine fails there rather than shipping a broken map.
No secrets are involved: the snapshot is committed, so the build needs no
database and no Earthdata token.

**What a visitor actually downloads**, measured against the live site rather
than estimated:

| | On the wire |
|---|---|
| The 25 grid rasters | 1.71 MB |
| The JSON — catalogue, climate, vocabulary, glossary, boundary | 0.10 MB |
| App code, MapLibre, CSS | ~0.40 MB |

GitHub Pages gzips `application/octet-stream`, so the rasters arrive at
about 40% of their 6.7 MB on disk. That is worth checking on any other host
before trusting it — the app works either way and simply downloads four
times as much if the host does not compress.

`dist/` is plain static output, so anything else will serve it too:

- **Azure Static Web Apps** — app location `/`, output location `dist`.
- **Firebase Hosting / Google Cloud** — `firebase init hosting`, public
  directory `dist`, configure as a single-page app: **no**.
- **A free Porkbun domain** (the GoDaddy Registry Space Apps offer) can be
  pointed at the Pages site with a `CNAME` file and a DNS record; the free
  SSL certificate covers it.

There is no router — the whole app is one page — so no host needs an SPA
rewrite rule.

---

## What this cannot know

Written at length in the app itself, and worth repeating here:

- **The pixel is bigger than your field.** 250 m, 6.25 hectares, almost
  certainly in the wrong place. Tracing an outline helps and does not fix it.
- **It has no memory of this ground.** The rotation rules are general agronomy
  by plant family, not this valley's disease history.
- **Nothing here is about money.** No price or market data, so no plan has been
  weighed against what you would be paid.
- **It is an order, not a calendar.** Every score behind a rotation is annual,
  so it can say what follows what and not which month to plant in.
- **A projection is not a forecast.** Direction and rough size, never what a
  given year will do. Wind is observed and carried into every scenario
  unchanged.
- **Where it disagrees with you, you are probably right.** You have stood on
  this ground in a wet year. The satellite has not.

---

## Licence

Code under the MIT Licence — see [`LICENSE`](LICENSE).

The data is not ours to relicense: NASA datasets are public domain, SoilGrids
is CC BY 4.0, OpenStreetMap is ODbL. Per-dataset terms are carried in
`public/data/datasets.json`, shown in the app, and summarised in
[`DATA-LICENCES.md`](DATA-LICENCES.md).

NASA does not endorse this project, and this project is not a NASA product.
