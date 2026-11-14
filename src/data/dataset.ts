/**
 * Everything the engine needs, fetched once.
 *
 * The platform resolves climate per cell at query time so a 2050 scenario
 * can shift it without rewriting 68,000 rows. This keeps that split exactly:
 * terrain, soil and vegetation live in the grid rasters, climate lives
 * against four NASA POWER sampling points, and a site is assembled from both
 * at the moment somebody asks — which is also why switching scenario is
 * instant here and why no scenario is ever baked into a cell.
 *
 * The honest constraint behind that, from the platform's own README: POWER's
 * native grid is 0.5 x 0.625 degrees, about 55 x 69 km, and Sri Aman spans
 * roughly 1.1 x 0.64 degrees. So POWER resolves to two to four distinct
 * cells district-wide and cannot by itself produce a within-district map.
 * *Where* things differ comes from SRTM at 30 m, SoilGrids at 250 m and
 * MODIS; *when*, and *what changes*, comes from POWER and CMIP6.
 */

import { Grid } from './grid';
import { configureDerived, erosionExposure, pondTemperature } from '@/engine/derived';
import { configureSeverity } from '@/engine/membership';
import { configureSuitability } from '@/engine/suitability';
import { configureVocabulary, type Vocabulary } from '@/engine/vocabulary';
import type {
    AnnualStat,
    ClimateMetrics,
    ClimatePoint,
    DataSource,
    Enterprise,
    EnterpriseCategoryDefinition,
    GlossaryEntry,
    Intervention,
    Meta,
    MonthlyNormal,
    Scenario,
    Site,
} from '@/engine/types';

export interface ClimateBundle {
    points: ClimatePoint[];
    metrics: ClimateMetrics[];
    normals: MonthlyNormal[];
    projections: unknown[];
    built: unknown[];
    annual: AnnualStat[];
}

export interface Catalogue {
    enterprises: Enterprise[];
    interventions: Intervention[];
    categories: EnterpriseCategoryDefinition[];
}

export interface Dataset {
    meta: Meta;
    vocabulary: Vocabulary;
    catalogue: Catalogue;
    climate: ClimateBundle;
    datasets: DataSource[];
    glossary: GlossaryEntry[];
    boundary: GeoJSON.MultiPolygon | GeoJSON.Polygon;
    grid: Grid;

    /** Annual climate for one sampling point under one scenario. */
    climateFor(point: number, scenario: string): ClimateMetrics | undefined;
    /** The twelve monthly normals, in month order. */
    normalsFor(point: number, scenario: string): MonthlyNormal[];
    /** The observed (or shifted) annual record, oldest first. */
    annualFor(point: number, scenario: string): AnnualStat[];
    /** A fully resolved site for one cell of the baked grid. */
    siteForCell(index: number, scenario: string): Site;
    /** Scenarios that actually have data behind them. */
    availableScenarios(): Scenario[];
    enterprise(slug: string): Enterprise | undefined;
    dataSource(slug: string): DataSource | undefined;
    intervention(key: string): Intervention | undefined;
}

/* ------------------------------------------------------------- fetching -- */

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { cache: 'force-cache' });

    if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
    }

    return (await response.json()) as T;
}

async function getBuffer(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url, { cache: 'force-cache' });

    if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
    }

    return await response.arrayBuffer();
}

export interface LoadProgress {
    loaded: number;
    total: number;
    label: string;
}

/**
 * Loads the snapshot. The grid rasters come last and in parallel, because
 * they are the only part big enough to be worth a progress bar.
 */
export async function loadDataset(
    base = 'data',
    onProgress?: (progress: LoadProgress) => void,
): Promise<Dataset> {
    const report = (loaded: number, total: number, label: string) =>
        onProgress?.({ loaded, total, label });

    report(0, 1, 'Reading the district');

    const meta = await getJson<Meta>(`${base}/meta.json`);

    const [vocabulary, catalogue, climate, datasets, glossary, boundary] = await Promise.all([
        getJson<Vocabulary>(`${base}/vocabulary.json`),
        getJson<Catalogue>(`${base}/catalogue.json`),
        getJson<ClimateBundle>(`${base}/climate.json`),
        getJson<DataSource[]>(`${base}/datasets.json`),
        getJson<GlossaryEntry[]>(`${base}/glossary.json`),
        getJson<GeoJSON.MultiPolygon | GeoJSON.Polygon>(`${base}/boundary.json`),
    ]);

    // Config travels with the data rather than being restated in TypeScript,
    // so the thresholds, priority multipliers and rotation weights here are
    // the literals the platform scores with.
    configureVocabulary(vocabulary, meta.suitability.classThresholds);
    configureSuitability(meta.suitability);
    configureSeverity(meta.suitability.limitingFactors.severity);
    configureDerived(meta.suitability);

    const names = Object.entries(meta.grid.metrics)
        .filter(([, info]) => info !== null)
        .map(([key]) => key);

    const total = names.length + 1;
    let done = 0;

    const rasters: Record<string, ArrayBuffer> = {};

    await Promise.all(
        names.map(async (key) => {
            rasters[key] = await getBuffer(`${base}/grid/${key}.bin`);
            done++;
            report(done, total, 'Reading the 250 m grid');
        }),
    );

    const valid = await getBuffer(`${base}/grid/valid.bin`);
    report(total, total, 'Ready');

    const grid = new Grid(meta.grid, rasters, valid);

    return build(meta, vocabulary, catalogue, climate, datasets, glossary, boundary, grid);
}

/* -------------------------------------------------------------- the api -- */

function build(
    meta: Meta,
    vocabulary: Vocabulary,
    catalogue: Catalogue,
    climate: ClimateBundle,
    datasets: DataSource[],
    glossary: GlossaryEntry[],
    boundary: GeoJSON.MultiPolygon | GeoJSON.Polygon,
    grid: Grid,
): Dataset {
    const climateByKey = new Map<string, ClimateMetrics>();

    for (const row of climate.metrics) {
        climateByKey.set(`${row.point}:${row.scenario}`, row);
    }

    const normalsByKey = new Map<string, MonthlyNormal[]>();

    for (const row of climate.normals) {
        const key = `${row.point}:${row.scenario}`;
        const list = normalsByKey.get(key);

        if (list === undefined) {
            normalsByKey.set(key, [row]);
        } else {
            list.push(row);
        }
    }

    for (const list of normalsByKey.values()) {
        list.sort((a, b) => a.month - b.month);
    }

    const annualByKey = new Map<string, AnnualStat[]>();

    for (const row of climate.annual) {
        const key = `${row.point}:${row.scenario}`;
        const list = annualByKey.get(key);

        if (list === undefined) {
            annualByKey.set(key, [row]);
        } else {
            list.push(row);
        }
    }

    for (const list of annualByKey.values()) {
        list.sort((a, b) => a.year - b.year);
    }

    const enterpriseBySlug = new Map(catalogue.enterprises.map((e) => [e.slug, e]));
    const sourceBySlug = new Map(datasets.map((d) => [d.slug, d]));
    const interventionByKey = new Map(catalogue.interventions.map((i) => [i.key, i]));

    const cellMetrics = grid.available().filter((key) => key !== 'climate_point');

    const climateFor = (point: number, scenario: string) =>
        climateByKey.get(`${point}:${scenario}`);

    const dataset: Dataset = {
        meta,
        vocabulary,
        catalogue,
        climate,
        datasets,
        glossary,
        boundary,
        grid,

        climateFor,

        normalsFor: (point, scenario) => normalsByKey.get(`${point}:${scenario}`) ?? [],

        annualFor: (point, scenario) => annualByKey.get(`${point}:${scenario}`) ?? [],

        availableScenarios: () => meta.scenarios.filter((s) => s.available),

        enterprise: (slug) => enterpriseBySlug.get(slug),

        dataSource: (slug) => sourceBySlug.get(slug),

        intervention: (key) => interventionByKey.get(key),

        siteForCell(index, scenario) {
            const values: Record<string, number | null> = {};

            for (const key of cellMetrics) {
                values[key] = grid.read(key, index);
            }

            const pointIndex = grid.read('climate_point', index);
            const point = pointIndex === null ? null : Math.round(pointIndex);
            const annual = point === null ? undefined : climateFor(point, scenario);

            if (annual !== undefined) {
                for (const definition of vocabulary.metrics) {
                    if (definition.group !== 'climate') {
                        continue;
                    }

                    const value = annual[definition.key];
                    values[definition.key] = typeof value === 'number' ? value : null;
                }
            }

            // The two metrics the platform computes where they are read,
            // for the same reason: both follow the scenario, and a stored
            // copy of either silenced a hazard the engine is meant to fire.
            values.water_temp_mean = pondTemperature(
                typeof annual?.temp_mean_annual === 'number' ? annual.temp_mean_annual : null,
                values.elevation ?? null,
                point === null ? null : (climate.points[point]?.elevationM ?? null),
            );

            values.erosion_exposure = erosionExposure(
                typeof annual?.rainfall_erosivity === 'number' ? annual.rainfall_erosivity : null,
                values.slope_pct ?? null,
                values.soil_sand_pct ?? null,
                values.soil_clay_pct ?? null,
                values.soil_organic_carbon ?? null,
                values.soil_drainage_class ?? null,
            );

            const [lon, lat] = grid.centreOf(index);

            return { values, climatePoint: point, lat, lon, cellIndex: index };
        },
    };

    return dataset;
}
