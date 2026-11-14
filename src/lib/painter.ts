/**
 * The bridge to the scoring worker.
 *
 * One worker for the whole session, kept warm with its own copy of the grid.
 * Requests are numbered and stale replies are dropped, because a farmer
 * dragging a priority slider generates one request per step and only the last
 * one is worth drawing.
 *
 * It coalesces too: while a paint is in flight the newest request waits and
 * everything between is discarded. That keeps the district repainting at the
 * rate it can actually be scored rather than queueing forty frames of work
 * behind a slider.
 */

import { ref, shallowRef } from 'vue';
import type { PaintRequest, PaintResult } from '@/workers/paint.worker';

type Request = Omit<PaintRequest, 'type' | 'id'>;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
let inFlight = 0;
let pending: Request | null = null;

export const painting = ref(false);
export const lastResult = shallowRef<PaintResult | null>(null);
export const paintError = ref<string | null>(null);

function ensure(): Promise<void> {
    if (ready !== null) {
        return ready;
    }

    ready = new Promise<void>((resolve, reject) => {
        try {
            worker = new Worker(new URL('../workers/paint.worker.ts', import.meta.url), {
                type: 'module',
            });
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));

            return;
        }

        worker.onerror = (event) => {
            paintError.value = event.message || 'The scoring worker failed to start.';
            reject(new Error(paintError.value));
        };

        worker.onmessage = (event: MessageEvent) => {
            const message = event.data as { type: 'ready' | 'painted' } & Partial<
                Omit<PaintResult, 'type'>
            >;

            if (message.type === 'ready') {
                resolve();

                return;
            }

            if (message.type === 'painted') {
                inFlight--;

                // Only the newest reply is worth drawing; a slider drag can
                // leave several behind it.
                if (message.id === nextId - 1 || pending === null) {
                    lastResult.value = message as PaintResult;
                }

                if (pending !== null) {
                    const next = pending;
                    pending = null;
                    void paint(next);
                } else {
                    painting.value = false;
                }
            }
        };

        // Absolute, because a relative fetch inside a worker resolves
        // against the *worker script's* URL rather than the page's — which
        // silently returns the dev server's index.html and fails as a JSON
        // parse error three frames later.
        worker.postMessage({
            type: 'init',
            base: new URL('data', globalThis.location.href).toString(),
        });
    });

    return ready;
}

export async function paint(request: Request): Promise<void> {
    try {
        await ensure();
    } catch {
        return;
    }

    if (worker === null) {
        return;
    }

    if (inFlight > 0) {
        pending = request;

        return;
    }

    inFlight++;
    painting.value = true;

    worker.postMessage({ type: 'paint', id: nextId++, ...request } satisfies PaintRequest);
}

/**
 * Sequential ramps for the raw layers.
 *
 * Single-hue and monotone in lightness, for the same reason the suitability
 * ramp is: a value map is sequential, so one hue is the honest encoding and a
 * rainbow would make the order unreadable at a glance. Each is given in both
 * themes, re-stepped against the surface rather than inverted.
 */
export const RAMPS: Record<string, { light: string[]; dark: string[]; invert?: boolean }> = {
    water: {
        light: ['#eaf4f8', '#9fd0e0', '#4d9ab8', '#1e6f8f', '#0b3d53'],
        dark: ['#07222d', '#123a4a', '#1e6f8f', '#59b2d0', '#b4e2f0'],
    },
    earth: {
        light: ['#f6f0e4', '#ddc79b', '#bb9a5d', '#8a6b2f', '#4f3c14'],
        dark: ['#2a2110', '#56431c', '#8a6b2f', '#c2a263', '#eeddba'],
    },
    heat: {
        light: ['#fdf0e6', '#f6c9a0', '#e2965c', '#b4652a', '#6b3610'],
        dark: ['#2d1808', '#5e3414', '#b4652a', '#e8a66d', '#fadcc2'],
    },
    green: {
        light: ['#eef4ec', '#b9d4b0', '#78ab6c', '#3d7c34', '#174411'],
        dark: ['#0f2a0c', '#245c1d', '#4e9641', '#8dc881', '#d7eed0'],
    },
};

/** Which ramp a metric reads best on, and whether high values are the bad end. */
export function rampFor(metricKey: string): { name: keyof typeof RAMPS; invert: boolean } {
    if (
        metricKey.startsWith('precip') ||
        metricKey.startsWith('soil_moisture') ||
        metricKey === 'twi' ||
        metricKey === 'flood_hazard' ||
        metricKey === 'water_balance_annual' ||
        metricKey === 'soil_awc' ||
        metricKey === 'distance_to_water_m' ||
        metricKey === 'et0_annual'
    ) {
        return { name: 'water', invert: false };
    }

    if (
        metricKey.startsWith('temp') ||
        metricKey === 'thi_max' ||
        metricKey === 'heat_stress_days' ||
        metricKey === 'erosion_exposure' ||
        metricKey === 'water_temp_mean' ||
        metricKey === 'max_dry_spell_days' ||
        metricKey === 'dry_months' ||
        metricKey === 'solar_radiation'
    ) {
        return { name: 'heat', invert: false };
    }

    if (metricKey.startsWith('ndvi')) {
        return { name: 'green', invert: false };
    }

    return { name: 'earth', invert: false };
}
