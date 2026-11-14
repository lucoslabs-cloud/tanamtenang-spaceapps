/**
 * The district as an image.
 *
 * The platform serves its 67,855 cells as Mapbox Vector Tiles out of
 * PostGIS, with zoom-dependent aggregation, because scoring and geometry
 * both live in the database. None of that survives the move to a static
 * host — but it does not have to, because `ST_SquareGrid` lays a *regular*
 * lattice. A regular lattice needs no geometry at all: an origin, a step and
 * two indices place every cell exactly.
 *
 * So the grid ships as one Int16 raster per metric over a 485 x 284 frame,
 * 1.8 MB gzipped for all twenty-five, and the browser treats it as what it
 * is — an image it can index, score and repaint. That is what makes the
 * priority sliders live here and inert in the platform.
 *
 * Int16 with -32768 reserved for "no data", and every read returns `null`
 * for it. The house rule throughout this project is that an unmeasured
 * value must never be representable as zero.
 */

import type { GridMeta, MetricKey } from '@/engine/types';

export class Grid {
    readonly meta: GridMeta;

    /** Metric key => packed raster, or absent where the metric was never ingested. */
    private readonly rasters = new Map<MetricKey, Int16Array>();

    private readonly scales = new Map<MetricKey, number>();

    /** 1 where a cell of the district sits, 0 outside the boundary. */
    private readonly valid: Uint8Array;

    constructor(meta: GridMeta, rasters: Record<string, ArrayBuffer>, valid: ArrayBuffer) {
        this.meta = meta;
        this.valid = new Uint8Array(valid);

        for (const [key, buffer] of Object.entries(rasters)) {
            const info = meta.metrics[key];

            if (!info) {
                continue;
            }

            this.rasters.set(key, new Int16Array(buffer));
            this.scales.set(key, info.scale);
        }
    }

    get cols(): number {
        return this.meta.cols;
    }

    get rows(): number {
        return this.meta.rows;
    }

    get size(): number {
        return this.meta.cols * this.meta.rows;
    }

    has(key: MetricKey): boolean {
        return this.rasters.has(key);
    }

    /** Metrics that actually have a raster behind them. */
    available(): MetricKey[] {
        return [...this.rasters.keys()];
    }

    isInside(index: number): boolean {
        return index >= 0 && index < this.valid.length && this.valid[index] === 1;
    }

    /** One cell's value for one metric, unscaled, or null where unmeasured. */
    read(key: MetricKey, index: number): number | null {
        const raster = this.rasters.get(key);

        if (raster === undefined || index < 0 || index >= raster.length) {
            return null;
        }

        const packed = raster[index];

        if (packed === this.meta.nodata) {
            return null;
        }

        return packed / (this.scales.get(key) ?? 1);
    }

    /** The raw raster, for a worker that wants to walk it without a closure per cell. */
    raster(key: MetricKey): Int16Array | undefined {
        return this.rasters.get(key);
    }

    scale(key: MetricKey): number {
        return this.scales.get(key) ?? 1;
    }

    validMask(): Uint8Array {
        return this.valid;
    }

    /* ----------------------------------------------------------- geometry -- */

    /** Raster index for a longitude and latitude, or -1 outside the frame. */
    indexAt(lon: number, lat: number): number {
        const col = Math.floor((lon - this.meta.west) / this.meta.stepLon);
        // Row 0 is the north edge, as an image expects.
        const row = Math.floor((this.meta.north - lat) / this.meta.stepLat);

        if (col < 0 || col >= this.meta.cols || row < 0 || row >= this.meta.rows) {
            return -1;
        }

        return row * this.meta.cols + col;
    }

    /** Centre of a cell, as [lon, lat]. */
    centreOf(index: number): [number, number] {
        const col = index % this.meta.cols;
        const row = Math.floor(index / this.meta.cols);

        return [
            this.meta.west + (col + 0.5) * this.meta.stepLon,
            this.meta.north - (row + 0.5) * this.meta.stepLat,
        ];
    }

    /** The cell's own square, as a closed ring of [lon, lat]. */
    ringOf(index: number): Array<[number, number]> {
        const col = index % this.meta.cols;
        const row = Math.floor(index / this.meta.cols);

        const west = this.meta.west + col * this.meta.stepLon;
        const east = west + this.meta.stepLon;
        const north = this.meta.north - row * this.meta.stepLat;
        const south = north - this.meta.stepLat;

        return [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
        ];
    }

    /**
     * Cells a polygon covers, each with the share of its own area inside.
     *
     * A drawn plot is almost always smaller than one 250 m cell and almost
     * never aligned to it, so a plot report that read the nearest cell and
     * stopped would be answering about 6.25 hectares of somebody else's
     * land. The weights are what make a plot score mean the plot.
     *
     * The overlap is computed by sampling the cell on a 4 x 4 lattice rather
     * than by clipping the polygon. Exact clipping needs a geometry library
     * and the extra precision changes nothing a farmer would notice: at 250 m
     * a sixteenth of a cell is 0.39 ha, well inside the error the cell size
     * already imposes. `Analysis cell` in the glossary says as much.
     */
    coverage(ring: Array<[number, number]>): Array<{ index: number; weight: number }> {
        if (ring.length < 4) {
            return [];
        }

        let west = Infinity;
        let east = -Infinity;
        let south = Infinity;
        let north = -Infinity;

        for (const [lon, lat] of ring) {
            if (lon < west) west = lon;
            if (lon > east) east = lon;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
        }

        const colFrom = Math.max(0, Math.floor((west - this.meta.west) / this.meta.stepLon));
        const colTo = Math.min(
            this.meta.cols - 1,
            Math.floor((east - this.meta.west) / this.meta.stepLon),
        );
        const rowFrom = Math.max(0, Math.floor((this.meta.north - north) / this.meta.stepLat));
        const rowTo = Math.min(
            this.meta.rows - 1,
            Math.floor((this.meta.north - south) / this.meta.stepLat),
        );

        const out: Array<{ index: number; weight: number }> = [];
        const samples = 4;

        for (let row = rowFrom; row <= rowTo; row++) {
            for (let col = colFrom; col <= colTo; col++) {
                const index = row * this.meta.cols + col;

                if (!this.isInside(index)) {
                    continue;
                }

                const cellWest = this.meta.west + col * this.meta.stepLon;
                const cellNorth = this.meta.north - row * this.meta.stepLat;

                let hits = 0;

                for (let sy = 0; sy < samples; sy++) {
                    for (let sx = 0; sx < samples; sx++) {
                        const lon = cellWest + ((sx + 0.5) / samples) * this.meta.stepLon;
                        const lat = cellNorth - ((sy + 0.5) / samples) * this.meta.stepLat;

                        if (pointInRing(lon, lat, ring)) {
                            hits++;
                        }
                    }
                }

                if (hits > 0) {
                    out.push({ index, weight: hits / (samples * samples) });
                }
            }
        }

        // A plot smaller than a sixteenth of a cell samples to nothing. It is
        // still on a cell, and that cell is the honest answer.
        if (out.length === 0) {
            const centre = centroidOf(ring);
            const index = this.indexAt(centre[0], centre[1]);

            if (index >= 0 && this.isInside(index)) {
                out.push({ index, weight: 1 });
            }
        }

        return out;
    }
}

/** Ray casting, the usual way. */
export function pointInRing(lon: number, lat: number, ring: Array<[number, number]>): boolean {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }

    return inside;
}

export function centroidOf(ring: Array<[number, number]>): [number, number] {
    let lon = 0;
    let lat = 0;
    const n = ring.length - 1;

    for (let i = 0; i < n; i++) {
        lon += ring[i][0];
        lat += ring[i][1];
    }

    return [lon / n, lat / n];
}

/**
 * Area of a ring in hectares, on the sphere.
 *
 * The shoelace formula on a local equirectangular projection. Over a plot a
 * farmer would draw — hundreds of metres, not hundreds of kilometres — the
 * error against a geodesic area is far below the precision anybody cares
 * about, and it needs no projection library.
 */
export function areaHectares(ring: Array<[number, number]>): number {
    if (ring.length < 4) {
        return 0;
    }

    const lat0 = (ring.reduce((sum, p) => sum + p[1], 0) / ring.length) * (Math.PI / 180);
    const mPerDegLat = 111_132.92 - 559.82 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0);
    const mPerDegLon = 111_412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0);

    let twice = 0;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0] * mPerDegLon;
        const yi = ring[i][1] * mPerDegLat;
        const xj = ring[j][0] * mPerDegLon;
        const yj = ring[j][1] * mPerDegLat;

        twice += xj * yi - xi * yj;
    }

    return Math.abs(twice / 2) / 10_000;
}
