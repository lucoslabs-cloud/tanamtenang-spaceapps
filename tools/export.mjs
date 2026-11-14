#!/usr/bin/env node
/**
 * Bakes the platform's database into static files the hackathon build serves.
 *
 * The full platform needs PostGIS, Redis, an Earthdata token and about four
 * hours of ingest before it draws a single pixel. A judge has five minutes.
 * So this reads the finished database once, on a machine that has it, and
 * writes a snapshot that any static host can serve: the catalogue and the
 * climate as JSON, and the 250 m grid as one binary raster per metric.
 *
 * Nothing is recomputed here. Every number that lands in `public/data`
 * already existed in Postgres, which is the point — the hackathon build and
 * the platform agree because one is a photograph of the other.
 *
 * Two sources, no npm dependencies:
 *
 *   - `docker exec psql` for the tables, which is also what the project's
 *     own docs tell you to use, so there is no second database client to
 *     keep in step.
 *   - `php artisan tinker` for the config arrays, so the thresholds,
 *     priorities and rotation weights are the *same* literals the platform
 *     scores with rather than a copy somebody kept up to date by hand.
 *
 * Run from the repository root or from `hackathon/`:
 *
 *     node hackathon/tools/export.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hackathon = resolve(here, '..');
const repo = resolve(hackathon, '..');
const out = join(hackathon, 'public', 'data');

const CONTAINER = process.env.TT_CONTAINER ?? 'tanamtenang-postgis';
const DB = process.env.TT_DB ?? 'tanamtenang';
const DB_USER = process.env.TT_DB_USER ?? 'tanamtenang';

/* ------------------------------------------------------------------ io -- */

function psql(sql) {
    try {
        return execFileSync(
            'docker',
            ['exec', '-i', CONTAINER, 'psql', '-U', DB_USER, '-d', DB, '-t', '-A', '-f', '-'],
            { input: sql, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
        );
    } catch (error) {
        const detail = error.stderr?.toString().trim() || error.message;
        throw new Error(
            `psql failed. Is the container up? \`docker compose up -d postgis\`\n${detail}`,
        );
    }
}

/** One row, one column, parsed as JSON. */
function json(sql) {
    const text = psql(sql).trim();

    if (text === '' || text === '\\N') {
        throw new Error(`Query returned nothing:\n${sql}`);
    }

    return JSON.parse(text);
}

/** A config array or any expression, through the app's own container. */
function php(expression) {
    const code = `echo json_encode(${expression});`;

    try {
        const text = execFileSync('php', ['artisan', 'tinker', '--execute', code], {
            cwd: repo,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        });

        // Tinker prints the expression's own output and nothing else when
        // the command echoes, but a warning on stdout would break the parse,
        // so take the last line that looks like JSON.
        const line = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.startsWith('{') || l.startsWith('['))
            .pop();

        if (!line) {
            throw new Error(`No JSON in tinker output:\n${text}`);
        }

        return JSON.parse(line);
    } catch (error) {
        const detail = error.stderr?.toString().trim() || error.message;
        throw new Error(`php artisan tinker failed for \`${expression}\`\n${detail}`);
    }
}

function write(name, value) {
    const path = join(out, name);
    mkdirSync(dirname(path), { recursive: true });

    const body = Buffer.isBuffer(value) ? value : JSON.stringify(value);
    writeFileSync(path, body);

    const kb = (body.length / 1024).toFixed(body.length > 1024 * 100 ? 0 : 1);
    console.log(`  ${name.padEnd(34)} ${kb.padStart(8)} KB`);

    return body.length;
}

/* ------------------------------------------------------------- the grid -- */

/**
 * Metrics taken from `grid_cells`, with the quantisation each one gets.
 *
 * Every raster is Int16 with -32768 reserved for "no data", because the
 * house rule in this project is that an unmeasured value must not be
 * representable as zero. `scale: null` means "work it out from the data";
 * an explicit 1 is for the integer-coded metrics, where a derived scale
 * would turn a class code into a fraction.
 */
const GRID_METRICS = [
    { column: 'elevation', scale: null },
    { column: 'slope_pct', scale: null },
    { column: 'aspect', scale: null },
    { column: 'twi', scale: null },
    { column: 'hand_m', scale: null },
    { column: 'flood_hazard', scale: null },
    { column: 'soil_ph', scale: null },
    { column: 'soil_clay_pct', scale: null },
    { column: 'soil_sand_pct', scale: null },
    { column: 'soil_silt_pct', scale: null },
    { column: 'soil_organic_carbon', scale: null },
    { column: 'soil_cec', scale: null },
    { column: 'soil_bulk_density', scale: null },
    { column: 'soil_nitrogen', scale: null },
    { column: 'soil_texture_class', scale: 1 },
    { column: 'soil_drainage_class', scale: 1 },
    { column: 'soil_awc', scale: null },
    { column: 'peat_depth_cm', scale: null },
    { column: 'distance_to_water_m', scale: null },
    { column: 'ndvi_mean', scale: null },
    { column: 'ndvi_amplitude', scale: null },
    { column: 'land_cover', scale: 1 },
    { column: 'area_ha', scale: null },
    { column: 'overlap_fraction', scale: null },
    // Not a metric: which of the four POWER sampling points this cell reads
    // its climate from, remapped to a 0-based index into `climate.points`.
    { column: 'climate_point', scale: 1 },
];

const NODATA = -32768;

function exportGrid(regionId, climatePointIndex) {
    const bounds = json(`
        SELECT json_build_object(
            'colMin', MIN(col_index), 'colMax', MAX(col_index),
            'rowMin', MIN(row_index), 'rowMax', MAX(row_index),
            'cells',  COUNT(*),
            'resolutionM', MIN(resolution_m),
            'west',  ST_XMin(ST_Extent(geom)), 'south', ST_YMin(ST_Extent(geom)),
            'east',  ST_XMax(ST_Extent(geom)), 'north', ST_YMax(ST_Extent(geom))
        )
          FROM grid_cells
         WHERE region_id = ${regionId}
    `);

    const cols = bounds.colMax - bounds.colMin + 1;
    const rows = bounds.rowMax - bounds.rowMin + 1;

    // ST_SquareGrid lays a regular lattice in degrees, so the step is the
    // extent over the span and every cell's position follows from its
    // indices. That is what lets the browser skip geometry entirely: the
    // grid is an image, and an image needs an origin and a step.
    const stepLon = (bounds.east - bounds.west) / cols;
    const stepLat = (bounds.north - bounds.south) / rows;

    const columns = GRID_METRICS.map((m) =>
        m.column === 'climate_point' ? 'climate_point_id' : m.column,
    ).join(', ');

    console.log(`  reading ${bounds.cells} cells over a ${cols}x${rows} lattice...`);

    const csv = psql(`
        COPY (
            SELECT col_index, row_index, ${columns}
              FROM grid_cells
             WHERE region_id = ${regionId}
             ORDER BY row_index, col_index
        ) TO STDOUT WITH (FORMAT csv, NULL '')
    `);

    // Parse once into per-metric float arrays, then quantise. Holding the
    // whole grid as floats costs about 28 MB here, which is cheaper than
    // reading the CSV twice.
    const size = cols * rows;
    const raw = GRID_METRICS.map(() => new Float64Array(size).fill(NaN));
    const valid = new Uint8Array(size);

    let seen = 0;

    for (const line of csv.split('\n')) {
        if (line === '' || line === '\r') continue;

        const parts = line.replace(/\r$/, '').split(',');
        const col = Number(parts[0]) - bounds.colMin;
        // Row 0 of the raster is the NORTH edge, as an image expects, so
        // the row index flips. Getting this wrong mirrors the district and
        // is invisible on a symmetric basemap, so it is done once, here.
        const row = rows - 1 - (Number(parts[1]) - bounds.rowMin);
        const at = row * cols + col;

        valid[at] = 1;
        seen++;

        for (let i = 0; i < GRID_METRICS.length; i++) {
            const text = parts[i + 2];

            if (text === undefined || text === '') continue;

            if (GRID_METRICS[i].column === 'climate_point') {
                const index = climatePointIndex.get(Number(text));
                if (index !== undefined) raw[i][at] = index;
                continue;
            }

            raw[i][at] = Number(text);
        }
    }

    if (seen !== bounds.cells) {
        throw new Error(`Read ${seen} rows of an expected ${bounds.cells}.`);
    }

    const metrics = {};
    let bytes = 0;

    for (let i = 0; i < GRID_METRICS.length; i++) {
        const { column, scale: fixed } = GRID_METRICS[i];
        const values = raw[i];

        let min = Infinity;
        let max = -Infinity;
        let known = 0;

        for (let at = 0; at < size; at++) {
            const v = values[at];
            if (Number.isNaN(v)) continue;
            if (v < min) min = v;
            if (v > max) max = v;
            known++;
        }

        if (known === 0) {
            // A column that is null for all 67,855 cells is one of the
            // registered-but-not-ingested datasets. It is left out rather
            // than shipped as an empty raster, and the UI reads its absence
            // as "no data" exactly as the platform does.
            console.log(`  ${column.padEnd(34)}      skipped (no data)`);
            metrics[column] = null;
            continue;
        }

        // Leave the top of the Int16 range unused so a rounding step cannot
        // land on the nodata sentinel.
        const span = Math.max(Math.abs(min), Math.abs(max), 1e-9);
        const scale = fixed ?? Math.max(1, Math.floor(32000 / span));

        const packed = new Int16Array(size);

        for (let at = 0; at < size; at++) {
            const v = values[at];
            packed[at] = Number.isNaN(v)
                ? NODATA
                : Math.max(-32767, Math.min(32767, Math.round(v * scale)));
        }

        const length = write(`grid/${column}.bin`, Buffer.from(packed.buffer));
        bytes += length;

        metrics[column] = {
            scale,
            min: Math.round(min * scale) / scale,
            max: Math.round(max * scale) / scale,
            coverage: Number((known / bounds.cells).toFixed(4)),
            bytes: length,
        };
    }

    bytes += write('grid/valid.bin', Buffer.from(valid.buffer));

    return {
        cols,
        rows,
        cells: bounds.cells,
        resolutionM: bounds.resolutionM,
        west: bounds.west,
        south: bounds.south,
        east: bounds.east,
        north: bounds.north,
        stepLon,
        stepLat,
        nodata: NODATA,
        metrics,
        bytes,
    };
}

/* -------------------------------------------------------------- tables -- */

function exportRegion() {
    return json(`
        SELECT json_build_object(
            'id', id,
            'name', name,
            'localName', local_name,
            'adm1', adm1_name,
            'adm2', adm2_name,
            'country', adm0_name,
            'pcode', adm2_pcode,
            'level', level,
            'areaKm2', ROUND(area_sqkm::numeric, 1)::float8,
            'centroid', json_build_array(
                ROUND(ST_X(ST_Centroid(geom))::numeric, 6)::float8,
                ROUND(ST_Y(ST_Centroid(geom))::numeric, 6)::float8
            ),
            'bbox', json_build_array(
                bbox_min_lon::float8, bbox_min_lat::float8,
                bbox_max_lon::float8, bbox_max_lat::float8
            ),
            'sourceDataset', source_dataset,
            'sourceVersion', source_version
        )
          FROM regions
         ORDER BY id
         LIMIT 1
    `);
}

/**
 * The district outline, simplified.
 *
 * The source polygon is an administrative boundary with thousands of
 * vertices following a river. At the zoom a farmer looks at a district on,
 * 50 m of simplification is invisible and three quarters of the bytes.
 */
function exportBoundary(regionId) {
    return json(`
        SELECT ST_AsGeoJSON(
            ST_SimplifyPreserveTopology(geom, 0.0005), 5
        )::json
          FROM regions
         WHERE id = ${regionId}
    `);
}

function exportClimate() {
    const points = json(`
        SELECT COALESCE(json_agg(row), '[]'::json) FROM (
            SELECT json_build_object(
                'id', id,
                'label', label,
                'lat', lat::float8,
                'lon', lon::float8,
                'source', source,
                'elevationM', source_elevation_m::float8,
                'recordStart', record_start_date,
                'recordEnd', record_end_date
            ) AS row
              FROM climate_points
             ORDER BY id
        ) t
    `);

    // The scenario-aware view is where every annual climate metric in the
    // platform comes from, so it is taken whole rather than recomputed.
    const metrics = json(`
        SELECT COALESCE(json_agg(row), '[]'::json) FROM (
            SELECT to_jsonb(cm) AS row
              FROM climate_point_metrics cm
             ORDER BY cm.climate_point_id, cm.scenario
        ) t
    `);

    const normals = json(`
        SELECT COALESCE(json_agg(row), '[]'::json) FROM (
            SELECT json_build_object(
                'point', climate_point_id,
                'scenario', scenario,
                'month', month,
                't2mMean', t2m_mean::float8,
                't2mMaxMean', t2m_max_mean::float8,
                't2mMinMean', t2m_min_mean::float8,
                'precipMean', precip_mm_mean::float8,
                'precipP10', precip_mm_p10::float8,
                'precipP90', precip_mm_p90::float8,
                'rainDays', rain_days::float8,
                'et0', et0_mm::float8,
                'waterBalance', water_balance_mm::float8,
                'rhMean', rh_mean::float8,
                'solarMean', solar_mean::float8,
                'windMean', wind_mean::float8,
                'heatStressDays', heat_stress_days::float8,
                'maxDrySpellDays', max_dry_spell_days::float8
            ) AS row
              FROM climate_normals
             ORDER BY climate_point_id, scenario, month
        ) t
    `);

    // What the CMIP6 ensemble projects, and how much its members disagree.
    // Averaged over the district's sampling points the way the platform's
    // own scenario picker does it, so the two show the same figures.
    const projections = json(`
        SELECT COALESCE(json_agg(row), '[]'::json) FROM (
            SELECT json_build_object(
                'ssp', ssp,
                'horizon', horizon_year,
                'warming', ROUND(AVG(delta_t2m_c)::numeric, 2)::float8,
                'warmingLow', ROUND(AVG(delta_t2m_c_p10)::numeric, 2)::float8,
                'warmingHigh', ROUND(AVG(delta_t2m_c_p90)::numeric, 2)::float8,
                'rainPct', ROUND(AVG(delta_precip_pct)::numeric, 1)::float8,
                'rainPctLow', ROUND(AVG(delta_precip_pct_p10)::numeric, 1)::float8,
                'rainPctHigh', ROUND(AVG(delta_precip_pct_p90)::numeric, 1)::float8,
                'driestMonthPct', ROUND(MIN(delta_precip_pct)::numeric, 1)::float8,
                'wettestMonthPct', ROUND(MAX(delta_precip_pct)::numeric, 1)::float8,
                'models', model_ensemble,
                'memberCount', member_count,
                'dataset', source_dataset
            ) AS row
              FROM climate_scenarios
             GROUP BY ssp, horizon_year, model_ensemble, member_count, source_dataset
             ORDER BY ssp, horizon_year
        ) t
    `);

    // Which scenarios actually have twelve monthly normals at every point.
    // The platform refuses to offer one that does not, for the reason its
    // ScenarioCatalogue gives: a 2070 map that silently shows today is
    // worse than no 2070 map.
    const built = json(`
        SELECT COALESCE(json_agg(row), '[]'::json) FROM (
            SELECT json_build_object(
                'scenario', n.scenario,
                'points', COUNT(DISTINCT n.climate_point_id),
                'months', COUNT(*)
            ) AS row
              FROM climate_normals n
             GROUP BY n.scenario
        ) t
    `);

    // The observed annual record, for the long-term trend charts. 1,288 rows
    // across every scenario; the baseline ones are measurements and the rest
    // are the same days shifted by the CMIP6 change factors.
    const annual = json(`
        SELECT COALESCE(json_agg(row), '[]'::json) FROM (
            SELECT json_build_object(
                'point', climate_point_id,
                'scenario', scenario,
                'year', year,
                'precipTotal', precip_total::float8,
                'precipMax1Day', precip_max_1day::float8,
                'precipMax5Day', precip_max_5day::float8,
                'rainDays', rain_days,
                't2mMean', t2m_mean::float8,
                't2mMaxAbs', t2m_max_abs::float8,
                'heatStressDays', heat_stress_days,
                'maxDrySpellDays', max_dry_spell_days,
                'dryMonths', dry_months,
                'et0Total', et0_total::float8,
                'waterBalance', water_balance::float8,
                'completeness', completeness::float8
            ) AS row
              FROM climate_annual_stats
             ORDER BY climate_point_id, scenario, year
        ) t
    `);

    return { points, metrics, normals, projections, built, annual };
}

function exportEnterprises() {
    return json(`
        SELECT COALESCE(json_agg(row ORDER BY ord, slug), '[]'::json) FROM (
            SELECT
                e.sort_order AS ord,
                e.slug,
                json_build_object(
                    'slug', e.slug,
                    'name', e.name,
                    'localName', e.local_name,
                    'scientificName', e.scientific_name,
                    'category', e.category,
                    'subcategory', e.subcategory,
                    'description', e.description,
                    'farmerNote', e.farmer_note,
                    'isPerennial', e.is_perennial,
                    'cycleDaysMin', e.cycle_days_min,
                    'cycleDaysMax', e.cycle_days_max,
                    'establishmentMonths', e.establishment_months,
                    'productiveLifeYears', e.productive_life_years,
                    'plantFamily', e.plant_family,
                    'nitrogenRole', e.nitrogen_role,
                    'rootingDepthCm', e.rooting_depth_cm,
                    'residueClass', e.residue_class,
                    'isCoverCrop', e.is_cover_crop,
                    'waterDemandMmCycle', e.water_demand_mm_cycle::float8,
                    'kcMid', e.kc_mid::float8,
                    'yieldMin', e.yield_min::float8,
                    'yieldMax', e.yield_max::float8,
                    'yieldUnit', e.yield_unit,
                    'labourIntensity', e.labour_intensity,
                    'capitalIntensity', e.capital_intensity,
                    'icon', e.icon,
                    'color', e.color,
                    'sortOrder', e.sort_order,
                    'sourceReferences', e.source_references,
                    'requirements', COALESCE((
                        SELECT json_agg(json_build_object(
                            'metric', r.metric,
                            'weight', r.weight::float8,
                            'isCritical', r.is_critical,
                            'isPermanentWhenFailed', r.is_permanent_when_failed,
                            'absMin', r.abs_min::float8,
                            'optMin', r.opt_min::float8,
                            'optMax', r.opt_max::float8,
                            'absMax', r.abs_max::float8,
                            'allowedCodes', r.allowed_codes,
                            'unit', r.unit,
                            'remedyKey', r.remedy_key,
                            'sourceCitation', r.source_citation,
                            'notes', r.notes
                        ) ORDER BY r.metric)
                          FROM enterprise_requirements r
                         WHERE r.enterprise_id = e.id
                    ), '[]'::json),
                    'rotationRules', COALESCE((
                        SELECT json_agg(json_build_object(
                            'followsSlug', f.slug,
                            'followsFamily', rr.follows_family,
                            'effect', rr.effect,
                            'magnitude', rr.magnitude::float8,
                            'minGapSeasons', rr.min_gap_seasons,
                            'reason', rr.reason,
                            'source', rr.source_reference
                        ) ORDER BY rr.id)
                          FROM enterprise_rotation_rules rr
                          LEFT JOIN enterprises f ON f.id = rr.follows_enterprise_id
                         WHERE rr.enterprise_id = e.id
                    ), '[]'::json)
                ) AS row
              FROM enterprises e
             WHERE e.is_active
        ) t
    `);
}

function exportInterventions() {
    return json(`
        SELECT COALESCE(json_agg(row ORDER BY key), '[]'::json) FROM (
            SELECT key, json_build_object(
                'key', key,
                'name', name,
                'localName', local_name,
                'category', category,
                'description', description,
                'howItWorks', how_it_works,
                'improvesMetrics', improves_metrics,
                'unitCostMyr', unit_cost_myr::float8,
                'costUnit', cost_unit,
                'lifespanYears', lifespan_years,
                'complexity', complexity,
                'sourceReferences', source_references
            ) AS row
              FROM interventions
        ) t
    `);
}

function exportDataSources() {
    return json(`
        SELECT COALESCE(json_agg(row ORDER BY slug), '[]'::json) FROM (
            SELECT slug, json_build_object(
                'slug', slug,
                'name', name,
                'provider', provider,
                'program', program,
                'instrument', instrument,
                'product', product_id,
                'resolution', spatial_resolution,
                'temporalResolution', temporal_resolution,
                'role', role,
                'url', url,
                'doi', doi,
                'citation', citation,
                'licence', license,
                'usedFor', used_for,
                'requiresAuth', requires_auth,
                'lastIngestedAt', last_ingested_at
            ) AS row
              FROM data_sources
        ) t
    `);
}

/* ---------------------------------------------------------------- main -- */

console.log('TanamTenang — baking the platform into static files\n');

if (!existsSync(join(repo, 'artisan'))) {
    throw new Error(`Expected the Laravel project at ${repo}`);
}

mkdirSync(join(out, 'grid'), { recursive: true });

console.log('config (from the platform\'s own config files)');
const suitability = php('config("suitability")');
const rotation = php('config("rotation")');
const aoi = php('config("aoi")');
const glossary = php('\\App\\Support\\Glossary::concepts()');

// The metric vocabulary comes out of the PHP enum rather than being
// retyped in TypeScript. Forty-five metrics times label, unit, group,
// provenance, precision and a plain-language definition is three hundred
// lines nobody would keep in step by hand, and the one thing worse than a
// stale label is a metric citing a dataset it does not come from.
const metrics = php(`array_map(fn ($m) => [
    'key' => $m->value,
    'label' => $m->label(),
    'unit' => $m->unit(),
    'group' => $m->group()->value,
    'dataset' => $m->dataset(),
    'precision' => $m->precision(),
    'categorical' => $m->isCategorical(),
    'ordinal' => $m->isOrdinal(),
    'describe' => $m->describe(),
], \\App\\Suitability\\Metric::cases())`);

const metricGroups = php(`array_map(fn ($g) => [
    'key' => $g->value,
    'label' => $g->label(),
    'description' => $g->description(),
    'icon' => $g->icon(),
    'color' => $g->color(),
], \\App\\Suitability\\MetricGroup::cases())`);

const classes = php('\\App\\Suitability\\SuitabilityClass::legend()');

const categories = php('\\App\\Enterprises\\EnterpriseCategory::catalogue()');

console.log('\ntables');
const region = exportRegion();
const climate = exportClimate();
const enterprises = exportEnterprises();
const interventions = exportInterventions();
const dataSources = exportDataSources();
const boundary = exportBoundary(region.id);

// Climate point ids are database keys; the browser wants an index into the
// array it was handed, so the remap happens here, once.
const climatePointIndex = new Map(climate.points.map((p, i) => [p.id, i]));

for (const row of climate.metrics) row.point = climatePointIndex.get(row.climate_point_id);
for (const row of climate.normals) row.point = climatePointIndex.get(row.point);
for (const row of climate.annual) row.point = climatePointIndex.get(row.point);

write('catalogue.json', { enterprises, interventions, categories });
write('vocabulary.json', { metrics, metricGroups, classes });
write('climate.json', climate);
write('boundary.json', boundary);
write('glossary.json', glossary);
write('datasets.json', dataSources);

console.log('\ngrid');
const grid = exportGrid(region.id, climatePointIndex);

// A scenario is offerable only when it has twelve monthly normals at every
// sampling point, which is the platform's rule and the reason it exists.
const builtByKey = new Map(climate.built.map((b) => [b.scenario, b]));
const expectedPoints = climate.points.length;

const scenarios = Object.entries(suitability.scenarios).map(([key, definition]) => {
    const built = builtByKey.get(key);
    const projection = climate.projections.find(
        (p) => p.ssp === definition.ssp && p.horizon === definition.horizon,
    );

    return {
        key,
        label: definition.label,
        description: definition.description ?? null,
        ssp: definition.ssp ?? null,
        horizon: definition.horizon ?? null,
        available:
            built !== undefined &&
            built.points === expectedPoints &&
            built.months === expectedPoints * 12,
        projection: projection ?? null,
    };
});

const unavailable = scenarios.filter((s) => !s.available).map((s) => s.key);

if (unavailable.length > 0) {
    console.log(`\n  note: ${unavailable.join(', ')} have no normals and will not be offered`);
}

write('meta.json', {
    generatedAt: new Date().toISOString(),
    source: 'TanamTenang platform database, exported by hackathon/tools/export.mjs',
    region,
    grid: { ...grid, bytes: undefined },
    scenarios,
    suitability: {
        classThresholds: suitability.class_thresholds,
        aggregation: suitability.aggregation,
        limitingFactors: suitability.limiting_factors,
        groupWeights: suitability.group_weights,
        priorities: suitability.priorities,
        priorityPresets: suitability.priority_presets,
        waterTemperature: suitability.water_temperature,
        erosion: suitability.erosion,
    },
    rotation,
    climateConstants: {
        dryMonthMm: aoi.climate?.dry_month_mm ?? 60,
        normalStartYear: aoi.baseline?.normal_start_year ?? 1991,
        normalEndYear: aoi.baseline?.normal_end_year ?? 2020,
    },
    counts: {
        enterprises: enterprises.length,
        requirements: enterprises.reduce((n, e) => n + e.requirements.length, 0),
        rotationRules: enterprises.reduce((n, e) => n + e.rotationRules.length, 0),
        interventions: interventions.length,
        datasets: dataSources.length,
        cells: grid.cells,
        climatePoints: climate.points.length,
        scenariosAvailable: scenarios.filter((s) => s.available).length,
    },
});

console.log(`\ndone — grid ${(grid.bytes / 1024 / 1024).toFixed(1)} MB across ${
    Object.values(grid.metrics).filter(Boolean).length
} rasters`);
