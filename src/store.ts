/**
 * One reactive object the whole app reads.
 *
 * There is no router and no server, so there is nothing to synchronise: the
 * farmer's field, their priorities and the scenario they are looking at are
 * the whole state, and everything else on screen is derived from them. That
 * is deliberate — the reason the sliders can move the map, the ranking, the
 * rotation comparison and the seasonal chart at once is that all four are
 * computed from the same three answers rather than fetched separately.
 *
 * What gets remembered is only what a farmer would be annoyed to retype: the
 * field, the crop and the sliders. It lives in this browser and nowhere else;
 * nothing in this build has anywhere to send it.
 */

import { computed, reactive, ref, shallowRef, watch, type Ref } from 'vue';
import { loadDataset, type Dataset, type LoadProgress } from './data/dataset';
import { areaHectares, centroidOf } from './data/grid';
import { loadLiveSite, type LiveSite } from './data/live';
import { plan as planRotation, type RotationPlan } from './engine/rotation/planner';
import { configureAxes } from './engine/rotation/axes';
import { configureSearch } from './engine/rotation/search';
import { configureExplainer } from './engine/rotation/explainer';
import { configurePlanner } from './engine/rotation/planner';
import { rankPlot, rankPoint, type RankingRow } from './engine/ranking';
import { seasonalStress, type SeasonalStress } from './engine/seasonal';
import { defaultPriorities } from './engine/suitability';
import type { Enterprise, MonthlyNormal, Site } from './engine/types';

export type View = 'start' | 'field' | 'map' | 'learn';

export type Selection =
    | { kind: 'none' }
    | { kind: 'cell'; index: number }
    | { kind: 'plot'; ring: Array<[number, number]> }
    | { kind: 'live'; lat: number; lon: number };

const STORAGE_KEY = 'tanamtenang.field.v1';

interface Remembered {
    selection?: Selection;
    growing?: string | null;
    priorities?: Record<string, number>;
    scenario?: string;
}

/* ------------------------------------------------------------------ state -- */

export const dataset = shallowRef<Dataset | null>(null);
export const loadError = ref<string | null>(null);
export const progress = ref<LoadProgress>({ loaded: 0, total: 1, label: 'Starting' });

export const view = ref<View>('start');
export const scenario = ref('baseline');
export const priorities = reactive<Record<string, number>>({});
export const growingSlug = ref<string | null>(null);
export const selection = ref<Selection>({ kind: 'none' });

export const liveSite = shallowRef<LiveSite | null>(null);
export const liveLoading = ref(false);
export const liveError = ref<string | null>(null);

export const theme = ref<'light' | 'dark'>(preferredTheme());

/* ------------------------------------------------------------------ boot -- */

export async function boot(): Promise<void> {
    try {
        const loaded = await loadDataset('data', (p) => {
            progress.value = p;
        });

        // The rotation engine's constants come from the platform's config,
        // which travels with the data. Doing this before anything scores is
        // what keeps the weights here identical to the weights there.
        configureSearch(loaded.meta.rotation);
        configureAxes(loaded.meta.rotation);
        configurePlanner(loaded.meta.suitability.priorities);
        configureExplainer(new Map(loaded.datasets.map((d) => [d.slug, d.name])));

        Object.assign(priorities, defaultPriorities());

        dataset.value = loaded;

        restore();
    } catch (error) {
        loadError.value = error instanceof Error ? error.message : String(error);
    }
}

/* ---------------------------------------------------------------- derived -- */

/** The cells a selection covers, with the share of each inside it. */
export const coveredCells = computed<Array<{ index: number; weight: number }>>(() => {
    const data = dataset.value;
    const current = selection.value;

    if (data === null) {
        return [];
    }

    if (current.kind === 'cell') {
        return [{ index: current.index, weight: 1 }];
    }

    if (current.kind === 'plot') {
        return data.grid.coverage(current.ring);
    }

    return [];
});

export const plotAreaHa = computed(() => {
    const current = selection.value;

    return current.kind === 'plot' ? areaHectares(current.ring) : null;
});

/** The site to score: one cell, the widest cell of a plot, or a live point. */
export const site = computed<Site | null>(() => {
    const data = dataset.value;

    if (data === null) {
        return null;
    }

    if (selection.value.kind === 'live') {
        return liveSite.value?.site ?? null;
    }

    const cells = coveredCells.value;

    if (cells.length === 0) {
        return null;
    }

    const widest = cells.reduce((a, b) => (b.weight > a.weight ? b : a));
    const base = data.siteForCell(widest.index, scenario.value);

    return { ...base, cells };
});

export const growing = computed<Enterprise | null>(() => {
    const data = dataset.value;

    if (data === null || growingSlug.value === null) {
        return null;
    }

    return data.enterprise(growingSlug.value) ?? null;
});

/** Every enterprise scored for this field, best first. */
export const ranking = computed<RankingRow[]>(() => {
    const data = dataset.value;
    const current = site.value;

    if (data === null || current === null) {
        return [];
    }

    const enterprises = data.catalogue.enterprises;
    const cells = selection.value.kind === 'plot' ? coveredCells.value : [];

    if (cells.length > 1) {
        return rankPlot(
            cells.map(({ index, weight }) => ({
                site: data.siteForCell(index, scenario.value),
                weight,
            })),
            enterprises,
            { ...priorities },
        );
    }

    return rankPoint(current, enterprises, { ...priorities });
});

/** The ranking a farmer is choosing between: no green manures in it. */
export const choosable = computed(() => ranking.value.filter((row) => !row.isCoverCrop));

export const coverCrops = computed(() => ranking.value.filter((row) => row.isCoverCrop));

export const scenarioLabel = computed(() => {
    const data = dataset.value;

    return (
        data?.meta.scenarios.find((s) => s.key === scenario.value)?.label ?? scenario.value
    );
});

/** The four rotation strategies, or a statement of why a rotation is not the question. */
export const rotation = computed<RotationPlan | null>(() => {
    const data = dataset.value;

    if (data === null || ranking.value.length === 0) {
        return null;
    }

    const enterprises = new Map(data.catalogue.enterprises.map((e) => [e.slug, e]));

    return planRotation(
        ranking.value,
        enterprises,
        growing.value,
        scenarioLabel.value,
        scenario.value,
        { ...priorities },
    );
});

/** The twelve monthly normals behind the year chart. */
export const monthlyNormals = computed<MonthlyNormal[]>(() => {
    const data = dataset.value;
    const current = site.value;

    if (data === null || current === null) {
        return [];
    }

    if (selection.value.kind === 'live') {
        return liveSite.value?.months ?? [];
    }

    if (current.climatePoint === null) {
        return [];
    }

    return data.normalsFor(current.climatePoint, scenario.value);
});

export const baselineNormals = computed<MonthlyNormal[]>(() => {
    const data = dataset.value;
    const current = site.value;

    if (data === null || current === null || current.climatePoint === null) {
        return [];
    }

    return data.normalsFor(current.climatePoint, 'baseline');
});

/** When in the year the crop already on this field is under pressure. */
export const stress = computed<SeasonalStress | null>(() => {
    const data = dataset.value;
    const current = site.value;
    const crop = growing.value;

    if (data === null || current === null || crop === null || monthlyNormals.value.length < 12) {
        return null;
    }

    const pointElevation =
        current.climatePoint === null
            ? (current.values.elevation ?? null)
            : (data.climate.points[current.climatePoint]?.elevationM ?? null);

    return seasonalStress(
        crop,
        monthlyNormals.value,
        baselineNormals.value,
        scenario.value,
        current.values.elevation ?? null,
        pointElevation,
    );
});

/** Where the selection sits, for the map and the header. */
export const selectionCentre = computed<[number, number] | null>(() => {
    const current = selection.value;
    const data = dataset.value;

    if (current.kind === 'cell' && data !== null) {
        return data.grid.centreOf(current.index);
    }

    if (current.kind === 'plot') {
        return centroidOf(current.ring);
    }

    if (current.kind === 'live') {
        return [current.lon, current.lat];
    }

    return null;
});

export const hasField = computed(() => selection.value.kind !== 'none');

/* ---------------------------------------------------------------- actions -- */

export function selectCell(lon: number, lat: number): boolean {
    const data = dataset.value;

    if (data === null) {
        return false;
    }

    const index = data.grid.indexAt(lon, lat);

    if (index < 0 || !data.grid.isInside(index)) {
        return false;
    }

    selection.value = { kind: 'cell', index };
    liveSite.value = null;
    liveError.value = null;
    remember();

    return true;
}

export function selectPlot(ring: Array<[number, number]>): void {
    selection.value = { kind: 'plot', ring };
    liveSite.value = null;
    liveError.value = null;
    remember();
}

/**
 * A point outside the snapshot: fetched live, with its gaps named.
 *
 * A scenario other than today means nothing here — the CMIP6 change factors
 * were built for Sri Aman — so the picker is reset rather than left showing a
 * future the point has no data for.
 */
export async function selectLive(lat: number, lon: number): Promise<void> {
    const data = dataset.value;

    if (data === null) {
        return;
    }

    selection.value = { kind: 'live', lat, lon };
    scenario.value = 'baseline';
    liveSite.value = null;
    liveError.value = null;
    liveLoading.value = true;

    try {
        liveSite.value = await loadLiveSite(lat, lon, data.meta.climateConstants.dryMonthMm);
        remember();
    } catch (error) {
        liveError.value =
            error instanceof Error
                ? error.message
                : 'Could not reach NASA POWER or SoilGrids from this browser.';
    } finally {
        liveLoading.value = false;
    }
}

export function clearField(): void {
    selection.value = { kind: 'none' };
    liveSite.value = null;
    liveError.value = null;
    remember();
}

export function setPreset(key: string): void {
    const data = dataset.value;
    const preset = data?.meta.suitability.priorityPresets[key];

    if (preset === undefined) {
        return;
    }

    Object.assign(priorities, preset.weights);
    remember();
}

export function setTheme(next: 'light' | 'dark'): void {
    theme.value = next;
    document.documentElement.dataset.theme = next;

    try {
        localStorage.setItem('tanamtenang.theme', next);
    } catch {
        // A private window with site data blocked. The theme still applies
        // for this session; only remembering it is lost.
    }
}

/* ------------------------------------------------------------ persistence -- */

function remember(): void {
    const payload: Remembered = {
        selection: selection.value,
        growing: growingSlug.value,
        priorities: { ...priorities },
        scenario: scenario.value,
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Nothing here needs to survive, so a blocked store is not an error
        // worth telling the farmer about.
    }
}

function restore(): void {
    let payload: Remembered | null = null;

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        payload = raw === null ? null : (JSON.parse(raw) as Remembered);
    } catch {
        payload = null;
    }

    if (payload === null) {
        return;
    }

    const data = dataset.value;

    if (payload.priorities !== undefined) {
        for (const [key, value] of Object.entries(payload.priorities)) {
            if (key in priorities && typeof value === 'number') {
                priorities[key] = Math.max(0, Math.min(1, value));
            }
        }
    }

    if (
        typeof payload.scenario === 'string' &&
        data?.meta.scenarios.some((s) => s.key === payload!.scenario && s.available)
    ) {
        scenario.value = payload.scenario;
    }

    if (typeof payload.growing === 'string' && data?.enterprise(payload.growing)) {
        growingSlug.value = payload.growing;
    }

    const saved = payload.selection;

    if (saved === undefined || saved.kind === 'none' || data === null) {
        return;
    }

    if (saved.kind === 'cell' && data.grid.isInside(saved.index)) {
        selection.value = saved;
        view.value = 'field';
    } else if (saved.kind === 'plot' && Array.isArray(saved.ring) && saved.ring.length >= 4) {
        selection.value = saved;
        view.value = 'field';
    } else if (saved.kind === 'live') {
        // Re-fetched rather than cached: a climatology is small and the
        // alternative is showing figures whose provenance nobody can check.
        void selectLive(saved.lat, saved.lon);
        view.value = 'field';
    }
}

function preferredTheme(): 'light' | 'dark' {
    try {
        const stored = localStorage.getItem('tanamtenang.theme');

        if (stored === 'light' || stored === 'dark') {
            document.documentElement.dataset.theme = stored;

            return stored;
        }
    } catch {
        // Fall through to the system preference.
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* Remember the sliders and the crop as they move, not only on navigation. */
watch([() => ({ ...priorities }), growingSlug, scenario], remember, { deep: true });

export function useProgress(): Ref<LoadProgress> {
    return progress;
}
