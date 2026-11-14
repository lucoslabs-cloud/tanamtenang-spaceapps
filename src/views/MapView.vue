<script setup lang="ts">
/**
 * The district, and time.
 *
 * Two modes. **What grows** paints FAO suitability for one enterprise under
 * one climate and the farmer's own weighting. **Evidence** paints the raw
 * layers behind it, each citing its dataset.
 *
 * The timeline is the point of the view. Stepping Today → 2030 → 2050 → 2070
 * rescores all 67,855 cells against monthly normals shifted by the CMIP6
 * ensemble and recounted, and the district changes colour under the cursor.
 * Only the scenarios that actually have data are on the slider — the
 * platform once offered seven and had one, which made the map for 2070
 * pixel-identical to today's, and a farmer taking comfort from that has been
 * misled by a feature that looked like it worked.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { Layers, Loader, Sprout } from '@lucide/vue';
import MapCanvas from '@/components/MapCanvas.vue';
import PrioritySliders from '@/components/PrioritySliders.vue';
import ClassBadge from './../components/ClassBadge.vue';
import { classes, metric, metricGroups, metricsInGroup } from '@/engine/vocabulary';
import { lastResult, paint, painting, RAMPS, rampFor } from '@/lib/painter';
import {
    dataset,
    growingSlug,
    priorities,
    scenario,
    selectCell,
    selectLive,
    theme,
    view,
} from '@/store';
import { metricValue, percent } from '@/lib/format';
import type { MetricKey } from '@/engine/types';

type Mode = 'suitability' | 'metric';

const mode = ref<Mode>('suitability');
const enterprise = ref<string>('');
const layer = ref<MetricKey>('flood_hazard');
const showPriorities = ref(false);
const outsideNote = ref<string | null>(null);

const meta = computed(() => dataset.value?.meta ?? null);

/** Only enterprises with envelopes can be painted. */
const paintable = computed(() =>
    (dataset.value?.catalogue.enterprises ?? []).filter((e) => e.requirements.length > 0),
);

const byCategory = computed(() => {
    const data = dataset.value;

    if (data === null) {
        return [];
    }

    return data.catalogue.categories
        .map((category) => ({
            ...category,
            enterprises: paintable.value.filter((e) => e.category === category.value),
        }))
        .filter((category) => category.enterprises.length > 0);
});

/** Only metrics with something behind them at this point in the project. */
const layerGroups = computed(() => {
    const data = dataset.value;

    if (data === null) {
        return [];
    }

    const grid = data.grid;

    return metricGroups()
        .map((group) => ({
            ...group,
            metrics: metricsInGroup(group.key).filter((definition) => {
                if (definition.key === 'water_temp_mean' || definition.key === 'erosion_exposure') {
                    return true;
                }

                if (definition.group === 'climate') {
                    const row = data.climateFor(0, scenario.value);

                    return typeof row?.[definition.key] === 'number';
                }

                return grid.has(definition.key);
            }),
        }))
        .filter((group) => group.metrics.length > 0);
});

const currentMetric = computed(() => metric(layer.value));
const currentSource = computed(() =>
    currentMetric.value === undefined
        ? null
        : (dataset.value?.dataSource(currentMetric.value.dataset) ?? null),
);

/** The timeline: one step per built scenario, in the order time runs. */
const timeline = computed(() => {
    const available = meta.value?.scenarios.filter((s) => s.available) ?? [];
    const baseline = available.filter((s) => s.ssp === null);
    const pathway = ssp.value;

    return [...baseline, ...available.filter((s) => s.ssp === pathway)];
});

const ssp = ref('ssp245');

const pathways = computed(() => {
    const keys = new Set(
        (meta.value?.scenarios ?? [])
            .filter((s) => s.available && s.ssp !== null)
            .map((s) => s.ssp as string),
    );

    return [...keys].sort();
});

const timelineIndex = computed({
    get: () => Math.max(0, timeline.value.findIndex((s) => s.key === scenario.value)),
    set: (index: number) => {
        const next = timeline.value[index];

        if (next !== undefined) {
            scenario.value = next.key;
        }
    },
});

function pathwayLabel(key: string): string {
    return key === 'ssp245' ? 'Middle road' : key === 'ssp585' ? 'High emissions' : key;
}

/* ------------------------------------------------------------- repainting -- */

function repaint(): void {
    const data = dataset.value;

    if (data === null) {
        return;
    }

    if (mode.value === 'suitability') {
        void paint({
            mode: 'suitability',
            enterprise: enterprise.value,
            scenario: scenario.value,
            priorities: { ...priorities },
            theme: theme.value,
        });

        return;
    }

    const choice = rampFor(layer.value);

    void paint({
        mode: 'metric',
        metric: layer.value,
        scenario: scenario.value,
        theme: theme.value,
        ramp: RAMPS[choice.name][theme.value],
        invert: choice.invert,
    });
}

onMounted(() => {
    if (enterprise.value === '') {
        enterprise.value =
            growingSlug.value && paintable.value.some((e) => e.slug === growingSlug.value)
                ? growingSlug.value
                : (paintable.value.find((e) => e.category === 'seasonal')?.slug ??
                  paintable.value[0]?.slug ??
                  '');
    }

    repaint();
});

watch([mode, enterprise, layer, scenario, theme, () => ({ ...priorities })], repaint, {
    deep: true,
});

/* ----------------------------------------------------------------- legend -- */

const shares = computed(() => lastResult.value?.classShares ?? {});
const scored = computed(() => lastResult.value?.scored ?? 0);
const range = computed(() => lastResult.value?.range ?? null);
const mean = computed(() => lastResult.value?.mean ?? null);

const ramp = computed(() => RAMPS[rampFor(layer.value).name][theme.value]);

function onPick(lon: number, lat: number, inside: boolean): void {
    if (inside) {
        outsideNote.value = null;
        selectCell(lon, lat);
        view.value = 'field';

        return;
    }

    outsideNote.value = `${lat.toFixed(4)}, ${lon.toFixed(4)} is outside the district.`;
    void selectLive(lat, lon).then(() => {
        view.value = 'field';
    });
}
</script>

<template>
    <div class="mx-auto max-w-7xl px-4 py-4">
        <div class="grid gap-4 lg:grid-cols-[1fr_21rem]">
            <!-- The map -->
            <div class="card relative h-[28rem] overflow-hidden lg:h-[42rem]">
                <MapCanvas mode="pick" @pick="onPick" />

                <div
                    v-if="painting"
                    class="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
                    style="border-color: var(--border); background: var(--surface-raised); color: var(--ink-soft)"
                >
                    <Loader :size="12" class="animate-spin" />
                    scoring {{ meta?.counts.cells.toLocaleString('en-US') }} cells
                </div>

                <!-- Legend -->
                <div
                    class="absolute bottom-7 left-2 max-w-[18rem] rounded-lg border p-2.5 text-[11px] shadow-lg"
                    style="border-color: var(--border); background: color-mix(in srgb, var(--surface-raised) 94%, transparent)"
                >
                    <template v-if="mode === 'suitability'">
                        <p class="font-medium">
                            {{ paintable.find((e) => e.slug === enterprise)?.name }}
                        </p>
                        <ul class="mt-1.5 space-y-0.5">
                            <li
                                v-for="info in classes()"
                                :key="info.value"
                                class="flex items-center justify-between gap-2"
                            >
                                <span class="flex items-center gap-1.5">
                                    <span
                                        class="inline-block h-2.5 w-2.5 rounded-sm"
                                        :style="{ background: theme === 'dark' ? info.color_dark : info.color }"
                                    />
                                    <strong>{{ info.value }}</strong>
                                    <span style="color: var(--ink-soft)">{{ info.short_label }}</span>
                                </span>
                                <span class="tnum" style="color: var(--ink-faint)">
                                    {{ percent(shares[info.value] ?? 0) }}
                                </span>
                            </li>
                        </ul>
                        <p class="mt-1.5" style="color: var(--ink-faint)">
                            Of {{ scored.toLocaleString('en-US') }} cells scored.
                            <template v-if="mean !== null">
                                Mean {{ mean.toFixed(0) }} out of 100.
                            </template>
                            Faint cells were judged on under half the model.
                        </p>
                    </template>

                    <template v-else>
                        <p class="font-medium">{{ currentMetric?.label }}</p>
                        <div class="mt-1.5 flex h-2.5 overflow-hidden rounded-sm">
                            <span
                                v-for="(colour, i) in ramp"
                                :key="i"
                                class="flex-1"
                                :style="{ background: colour }"
                            />
                        </div>
                        <p v-if="range" class="mt-1 flex justify-between tnum" style="color: var(--ink-soft)">
                            <span>{{ metricValue(layer, range[0]) }}</span>
                            <span>{{ metricValue(layer, range[1]) }}</span>
                        </p>
                        <p class="mt-1 leading-snug" style="color: var(--ink-faint)">
                            {{ currentMetric?.describe }}
                        </p>
                    </template>
                </div>
            </div>

            <!-- Controls -->
            <div class="space-y-3">
                <!-- Mode -->
                <div class="card p-3">
                    <div class="flex gap-1.5">
                        <button
                            class="btn flex-1 px-2 py-1.5 text-xs"
                            :style="mode === 'suitability' ? 'border-color: var(--accent); color: var(--accent)' : undefined"
                            @click="mode = 'suitability'"
                        >
                            <Sprout :size="13" /> What grows
                        </button>
                        <button
                            class="btn flex-1 px-2 py-1.5 text-xs"
                            :style="mode === 'metric' ? 'border-color: var(--accent); color: var(--accent)' : undefined"
                            @click="mode = 'metric'"
                        >
                            <Layers :size="13" /> Evidence
                        </button>
                    </div>

                    <div v-if="mode === 'suitability'" class="mt-3">
                        <label for="ent" class="text-xs font-medium">Which enterprise?</label>
                        <select
                            id="ent"
                            v-model="enterprise"
                            class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                            style="border-color: var(--border); background: var(--surface-raised); color: var(--ink)"
                        >
                            <optgroup
                                v-for="category in byCategory"
                                :key="category.value"
                                :label="category.label"
                            >
                                <option v-for="e in category.enterprises" :key="e.slug" :value="e.slug">
                                    {{ e.name }}{{ e.localName ? ` — ${e.localName}` : '' }}
                                </option>
                            </optgroup>
                        </select>
                        <p class="mt-1.5 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                            Fish and livestock are in here too. Weather hits them hardest and they
                            are usually left out — a heat wave strips dissolved oxygen out of a
                            pond, and a drought turns pond top-up into a cost you cannot avoid.
                        </p>
                    </div>

                    <div v-else class="mt-3">
                        <label for="layer" class="text-xs font-medium">Which layer?</label>
                        <select
                            id="layer"
                            v-model="layer"
                            class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                            style="border-color: var(--border); background: var(--surface-raised); color: var(--ink)"
                        >
                            <optgroup v-for="group in layerGroups" :key="group.key" :label="group.label">
                                <option v-for="m in group.metrics" :key="m.key" :value="m.key">
                                    {{ m.label }}
                                </option>
                            </optgroup>
                        </select>
                        <p v-if="currentSource" class="mt-1.5 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                            {{ currentSource.name }}<template v-if="currentSource.resolution">,
                            {{ currentSource.resolution }}</template>.
                            {{ currentSource.usedFor }}
                        </p>
                    </div>
                </div>

                <!-- Time -->
                <div class="card p-3">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 class="text-sm font-semibold">Move through time</h3>
                        <span class="text-xs tnum" style="color: var(--ink-faint)">
                            {{ timeline[timelineIndex]?.label }}
                        </span>
                    </div>

                    <div v-if="pathways.length > 1" class="mt-2 flex gap-1.5">
                        <button
                            v-for="key in pathways"
                            :key="key"
                            class="chip"
                            :style="
                                ssp === key
                                    ? 'background: var(--accent); border-color: var(--accent); color: var(--accent-ink)'
                                    : 'color: var(--ink-soft)'
                            "
                            @click="ssp = key"
                        >
                            {{ pathwayLabel(key) }}
                        </button>
                    </div>

                    <input
                        v-model.number="timelineIndex"
                        type="range"
                        min="0"
                        :max="Math.max(0, timeline.length - 1)"
                        step="1"
                        class="mt-2 w-full"
                        aria-label="Climate scenario"
                    />

                    <div class="flex justify-between text-[10px]" style="color: var(--ink-faint)">
                        <span v-for="s in timeline" :key="s.key">
                            {{ s.horizon ?? 'now' }}
                        </span>
                    </div>

                    <p
                        v-if="timeline[timelineIndex]?.projection"
                        class="mt-2 text-[11px] leading-relaxed"
                        style="color: var(--ink-soft)"
                    >
                        {{ timeline[timelineIndex]!.projection!.warming.toFixed(1) }} °C warmer and
                        rainfall {{ timeline[timelineIndex]!.projection!.rainPct > 0 ? '+' : '' }}{{
                            timeline[timelineIndex]!.projection!.rainPct.toFixed(1)
                        }}% than 1995–2014, from a
                        {{ timeline[timelineIndex]!.projection!.memberCount }}-model ensemble.
                        Month by month the rainfall change runs
                        {{ timeline[timelineIndex]!.projection!.driestMonthPct.toFixed(0) }}% to
                        {{ timeline[timelineIndex]!.projection!.wettestMonthPct.toFixed(0) }}%,
                        which is what moves dry spells and erosion even where the annual total
                        barely shifts.
                    </p>

                    <p v-else class="mt-2 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                        Observed 1991–2020 normal from NASA POWER. Nothing projected.
                    </p>
                </div>

                <!-- Priorities -->
                <div>
                    <button
                        class="btn w-full px-2.5 py-1.5 text-xs"
                        :aria-expanded="showPriorities"
                        @click="showPriorities = !showPriorities"
                    >
                        {{ showPriorities ? 'Hide' : 'Show' }} what matters to you
                    </button>
                    <p class="mt-1 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                        Moving a slider rescores every cell in this browser, so the district
                        repaints while you drag it.
                    </p>
                </div>

                <PrioritySliders v-if="showPriorities" />

                <p v-if="outsideNote" class="text-[11px]" style="color: var(--warn)">
                    {{ outsideNote }} Fetching what the open APIs will give for it.
                </p>

                <p class="text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                    Tap anywhere to open the field report for that spot. Each pixel is one 250 m
                    analysis cell — 6.25 hectares — drawn without smoothing, because smoothing
                    would show a precision the data does not have.
                </p>

                <!-- A reminder that is not a footnote -->
                <div v-if="mode === 'suitability'" class="card p-3 text-[11px] leading-relaxed" style="color: var(--ink-soft)">
                    <p>
                        <ClassBadge code="N1" class="mr-1 align-middle" />
                        is the useful part of this scheme. It fails today on something investment
                        can fix — drainage, lime, bunding, water storage — which turns a red patch
                        into a work order.
                        <ClassBadge code="N2" class="mx-1 align-middle" />
                        fails on something nobody can change, and that is an honest "look
                        elsewhere".
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>
