/// <reference lib="webworker" />

/**
 * Paints the district.
 *
 * The platform renders its suitability layer as vector tiles out of PostGIS:
 * every pan is a round trip, and a priority slider would mean re-scoring
 * 67,855 cells in SQL for every tile in view. So the platform's sliders
 * change the answer on the next request, and this one's change it while you
 * drag — the grid is already here, the engine is already here, and the only
 * thing between a weighting and a repainted district is one pass over an
 * Int16Array.
 *
 * It runs in a worker because that pass is 67,855 cells times up to fifteen
 * envelopes, and doing it on the main thread would drop frames on the very
 * interaction it exists to make smooth.
 *
 * The output is an RGBA buffer the same shape as the grid, handed back as a
 * transferable so nothing is copied. The map puts it up as an image source,
 * which is what a regular lattice deserves.
 */

import { loadDataset, type Dataset } from '@/data/dataset';
import { erosionExposure, pondTemperature } from '@/engine/derived';
import { scoreRequirement } from '@/engine/membership';
import { weightedRequirements } from '@/engine/suitability';
import { classFromScore, classInfo, metric } from '@/engine/vocabulary';
import type { ClassCode, MetricKey } from '@/engine/types';

let dataset: Dataset | null = null;

export interface PaintRequest {
    type: 'paint';
    id: number;
    mode: 'suitability' | 'metric';
    enterprise?: string;
    metric?: MetricKey;
    scenario: string;
    priorities?: Record<string, number>;
    theme: 'light' | 'dark';
    /** Sequential ramp for a metric layer, low to high, as hex. */
    ramp?: string[];
    /** True where high values should read as low on the ramp. */
    invert?: boolean;
}

type Incoming = { type: 'init'; base: string } | PaintRequest;

export interface PaintResult {
    type: 'painted';
    id: number;
    width: number;
    height: number;
    pixels: ArrayBuffer;
    /** Share of the district in each FAO class, for the legend. */
    classShares: Record<string, number>;
    /** Scored cells, and how many had enough data to score at all. */
    scored: number;
    /** For a metric layer: the range actually painted. */
    range: [number, number] | null;
    mean: number | null;
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
    const message = event.data;

    if (message.type === 'init') {
        dataset = await loadDataset(message.base);
        (self as unknown as Worker).postMessage({ type: 'ready' });

        return;
    }

    if (dataset === null) {
        return;
    }

    const result =
        message.mode === 'suitability' ? paintSuitability(dataset, message) : paintMetric(dataset, message);

    (self as unknown as Worker).postMessage(result, [result.pixels]);
};

/* ------------------------------------------------------------ the getters -- */

type Getter = (index: number, point: number) => number | null;

/**
 * How to read one metric for one cell.
 *
 * Three kinds, and the third is the interesting one. A stored metric is a
 * raster lookup. A climate metric is a lookup against the cell's own POWER
 * sampling point for the scenario being painted. A derived metric is
 * computed per cell, because it depends on both — which is the whole reason
 * the platform stopped storing it.
 */
function getterFor(dataset: Dataset, key: MetricKey, scenario: string): Getter | null {
    const grid = dataset.grid;
    const definition = metric(key);

    if (definition === undefined) {
        return null;
    }

    if (key === 'water_temp_mean') {
        const elevation = grid.raster('elevation');
        const elevationScale = grid.scale('elevation');
        const nodata = grid.meta.nodata;
        const air = climateByPoint(dataset, 'temp_mean_annual', scenario);
        const pointElevation = dataset.climate.points.map((p) => p.elevationM);

        if (elevation === undefined) {
            return () => null;
        }

        return (index, point) => {
            const packed = elevation[index];

            return pondTemperature(
                air[point] ?? null,
                packed === nodata ? null : packed / elevationScale,
                pointElevation[point] ?? null,
            );
        };
    }

    if (key === 'erosion_exposure') {
        const erosivity = climateByPoint(dataset, 'rainfall_erosivity', scenario);
        const slope = rasterReader(dataset, 'slope_pct');
        const sand = rasterReader(dataset, 'soil_sand_pct');
        const clay = rasterReader(dataset, 'soil_clay_pct');
        const carbon = rasterReader(dataset, 'soil_organic_carbon');
        const drainage = rasterReader(dataset, 'soil_drainage_class');

        return (index, point) =>
            erosionExposure(
                erosivity[point] ?? null,
                slope(index),
                sand(index),
                clay(index),
                carbon(index),
                drainage(index),
            );
    }

    if (definition.group === 'climate') {
        const byPoint = climateByPoint(dataset, key, scenario);

        return (_index, point) => byPoint[point] ?? null;
    }

    if (!grid.has(key)) {
        // A registered-but-never-ingested metric. Null, so the requirement
        // drops out of the mean and the coverage figure falls.
        return () => null;
    }

    const read = rasterReader(dataset, key);

    return (index) => read(index);
}

function rasterReader(dataset: Dataset, key: MetricKey): (index: number) => number | null {
    const raster = dataset.grid.raster(key);
    const scale = dataset.grid.scale(key);
    const nodata = dataset.grid.meta.nodata;

    if (raster === undefined) {
        return () => null;
    }

    return (index) => {
        const packed = raster[index];

        return packed === nodata ? null : packed / scale;
    };
}

function climateByPoint(
    dataset: Dataset,
    key: string,
    scenario: string,
): Array<number | null> {
    return dataset.climate.points.map((_, index) => {
        const row = dataset.climateFor(index, scenario);
        const value = row?.[key];

        return typeof value === 'number' ? value : null;
    });
}

/* ------------------------------------------------------------ the painter -- */

function paintSuitability(dataset: Dataset, request: PaintRequest): PaintResult {
    const grid = dataset.grid;
    const enterprise = dataset.enterprise(request.enterprise ?? '');

    const width = grid.cols;
    const height = grid.rows;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const valid = grid.validMask();
    const pointRaster = rasterReader(dataset, 'climate_point');

    const classShares: Record<string, number> = { S1: 0, S2: 0, S3: 0, N1: 0, N2: 0 };
    let scored = 0;
    let scoreSum = 0;

    if (enterprise === undefined || enterprise.requirements.length === 0) {
        return {
            type: 'painted',
            id: request.id,
            width,
            height,
            pixels: pixels.buffer,
            classShares,
            scored: 0,
            range: null,
            mean: null,
        };
    }

    const weighted = weightedRequirements(enterprise, request.priorities ?? {});

    const plan = weighted
        .map(({ requirement, weight }) => {
            const definition = metric(requirement.metric);

            return {
                requirement,
                weight,
                categorical: definition?.categorical ?? false,
                get: getterFor(dataset, requirement.metric, request.scenario),
            };
        })
        .filter((step) => step.get !== null);

    const colours = new Map<ClassCode, [number, number, number]>();

    for (const code of ['S1', 'S2', 'S3', 'N1', 'N2'] as ClassCode[]) {
        const info = classInfo(code);
        const hex = request.theme === 'dark' ? info?.color_dark : info?.color;
        colours.set(code, hexToRgb(hex ?? '#888888'));
    }

    const floor = dataset.meta.suitability.aggregation.score_floor;
    const pull = dataset.meta.suitability.aggregation.minimum_factor_pull;

    for (let index = 0; index < valid.length; index++) {
        if (valid[index] === 0) {
            continue;
        }

        const pointValue = pointRaster(index);
        const point = pointValue === null ? 0 : Math.round(pointValue);

        let logSum = 0;
        let scoredWeight = 0;
        let totalWeight = 0;
        let worst = Number.POSITIVE_INFINITY;
        let criticalFail = false;
        let permanentFail = false;

        for (let i = 0; i < plan.length; i++) {
            const step = plan[i];
            totalWeight += step.weight;

            const s = scoreRequirement(
                step.requirement,
                step.get!(index, point),
                step.categorical,
            );

            if (s === null) {
                continue;
            }

            scoredWeight += step.weight;
            logSum += step.weight * Math.log(s > floor ? s : floor);

            if (s < worst) {
                worst = s;
            }

            if (s === 0 && step.requirement.isCritical) {
                criticalFail = true;

                if (step.requirement.isPermanentWhenFailed) {
                    permanentFail = true;
                }
            }
        }

        if (scoredWeight === 0) {
            continue;
        }

        const gmean = Math.exp(logSum / scoredWeight);
        const pulled = Math.max(0, Math.min(1, gmean - pull * (gmean - worst)));
        const score = pulled * 100;
        const code = classFromScore(score, criticalFail, permanentFail);

        classShares[code]++;
        scored++;
        scoreSum += score;

        // Coverage is not painted — it would turn one map into two claims —
        // but a cell judged on under half the model is drawn faintly so it
        // cannot be read as confidently as its neighbours.
        const thin = totalWeight > 0 && scoredWeight / totalWeight < 0.5;
        const [r, g, b] = colours.get(code)!;
        const at = index * 4;

        pixels[at] = r;
        pixels[at + 1] = g;
        pixels[at + 2] = b;
        pixels[at + 3] = thin ? 110 : 215;
    }

    for (const code of Object.keys(classShares)) {
        classShares[code] = scored === 0 ? 0 : classShares[code] / scored;
    }

    return {
        type: 'painted',
        id: request.id,
        width,
        height,
        pixels: pixels.buffer,
        classShares,
        scored,
        range: null,
        mean: scored === 0 ? null : scoreSum / scored,
    };
}

/**
 * One raw layer, on a sequential ramp.
 *
 * The range is taken from the exported minimum and maximum for the metric
 * rather than from what is on screen, so panning does not restretch the
 * colours and a 2070 layer can climb the scale instead of being renormalised
 * back onto it.
 */
function paintMetric(dataset: Dataset, request: PaintRequest): PaintResult {
    const grid = dataset.grid;
    const key = request.metric ?? '';

    const width = grid.cols;
    const height = grid.rows;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const valid = grid.validMask();
    const pointRaster = rasterReader(dataset, 'climate_point');

    const get = getterFor(dataset, key, request.scenario);
    const ramp = (request.ramp ?? ['#f0f0f0', '#333333']).map(hexToRgb);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let scored = 0;

    if (get === null) {
        return {
            type: 'painted',
            id: request.id,
            width,
            height,
            pixels: pixels.buffer,
            classShares: {},
            scored: 0,
            range: null,
            mean: null,
        };
    }

    // Two passes: the first finds the range the layer actually occupies in
    // this scenario, the second paints against it. A climate or derived layer
    // has no exported range to reuse, so it has to be measured.
    const values = new Float32Array(valid.length);
    values.fill(Number.NaN);

    for (let index = 0; index < valid.length; index++) {
        if (valid[index] === 0) {
            continue;
        }

        const pointValue = pointRaster(index);
        const value = get(index, pointValue === null ? 0 : Math.round(pointValue));

        if (value === null || !Number.isFinite(value)) {
            continue;
        }

        values[index] = value;

        if (value < min) min = value;
        if (value > max) max = value;

        sum += value;
        scored++;
    }

    if (scored === 0) {
        return {
            type: 'painted',
            id: request.id,
            width,
            height,
            pixels: pixels.buffer,
            classShares: {},
            scored: 0,
            range: null,
            mean: null,
        };
    }

    const span = max - min || 1;

    for (let index = 0; index < valid.length; index++) {
        const value = values[index];

        if (Number.isNaN(value)) {
            continue;
        }

        let t = (value - min) / span;

        if (request.invert === true) {
            t = 1 - t;
        }

        const [r, g, b] = sample(ramp, t);
        const at = index * 4;

        pixels[at] = r;
        pixels[at + 1] = g;
        pixels[at + 2] = b;
        pixels[at + 3] = 215;
    }

    return {
        type: 'painted',
        id: request.id,
        width,
        height,
        pixels: pixels.buffer,
        classShares: {},
        scored,
        range: [min, max],
        mean: sum / scored,
    };
}

/* ------------------------------------------------------------ plumbing -- */

function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    const value = Number.parseInt(
        clean.length === 3
            ? clean
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : clean,
        16,
    );

    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function sample(ramp: Array<[number, number, number]>, t: number): [number, number, number] {
    const clamped = Math.max(0, Math.min(1, t));
    const scaled = clamped * (ramp.length - 1);
    const low = Math.floor(scaled);
    const high = Math.min(ramp.length - 1, low + 1);
    const f = scaled - low;

    return [
        Math.round(ramp[low][0] + (ramp[high][0] - ramp[low][0]) * f),
        Math.round(ramp[low][1] + (ramp[high][1] - ramp[low][1]) * f),
        Math.round(ramp[low][2] + (ramp[high][2] - ramp[low][2]) * f),
    ];
}
