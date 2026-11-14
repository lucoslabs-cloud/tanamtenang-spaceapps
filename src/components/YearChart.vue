<script setup lang="ts">
/**
 * The year at this point.
 *
 * Monthly rainfall with its one-in-ten wet and dry years, the water the air
 * pulls back drawn on the same axis, and the temperature band under it. The
 * single most useful mark on it is the one where a dry year's rainfall falls
 * below what a reference crop loses to the air: that is a month which, one
 * year in ten, does not feed itself.
 *
 * On today's record that happens nowhere in Sri Aman. Under SSP5-8.5 at 2070
 * it happens in July and September. Switching the scenario above and watching
 * those two months acquire a mark is the clearest thing this project shows
 * about what is actually changing here — which is why the chart is in the
 * farmer's field view and not buried in an evidence tab.
 *
 * Drawn as inline SVG rather than through a chart library: it is twelve
 * values, it has to be legible in both themes and in print, and a library
 * would be larger than the whole engine.
 */

import { computed } from 'vue';
import { MONTH_SHORT, mm, monthList, num } from '@/lib/format';
import type { MonthlyNormal } from '@/engine/types';

const props = defineProps<{
    months: MonthlyNormal[];
    scenarioLabel: string;
    /** Set where the chart is of a projection, for the comparison line. */
    baseline?: MonthlyNormal[];
}>();

const W = 720;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 56, left: 44 };

const plot = computed(() => ({
    width: W - PAD.left - PAD.right,
    rainHeight: H - PAD.top - PAD.bottom - 64,
    tempTop: H - PAD.bottom - 56,
    tempHeight: 48,
}));

interface Row {
    month: number;
    label: string;
    x: number;
    rain: number | null;
    p10: number | null;
    p90: number | null;
    demand: number | null;
    tMax: number | null;
    tMin: number | null;
    /** One year in ten, this month does not feed itself. */
    dryYearShort: boolean;
}

const rows = computed<Row[]>(() => {
    const step = plot.value.width / 12;

    return props.months.map((m, i) => ({
        month: m.month,
        label: MONTH_SHORT[m.month - 1] ?? String(m.month),
        x: PAD.left + step * (i + 0.5),
        rain: m.precipMean,
        p10: m.precipP10,
        p90: m.precipP90,
        demand: m.et0,
        tMax: m.t2mMaxMean,
        tMin: m.t2mMinMean,
        dryYearShort: m.precipP10 !== null && m.et0 !== null && m.precipP10 < m.et0,
    }));
});

const rainMax = computed(() => {
    const seen = rows.value
        .flatMap((r) => [r.rain, r.p90, r.demand])
        .filter((v): v is number => v !== null);

    return Math.max(100, ...seen) * 1.08;
});

const tempRange = computed(() => {
    const seen = rows.value
        .flatMap((r) => [r.tMax, r.tMin])
        .filter((v): v is number => v !== null);

    if (seen.length === 0) {
        return null;
    }

    const low = Math.floor(Math.min(...seen) - 1);
    const high = Math.ceil(Math.max(...seen) + 1);

    return { low, high, span: Math.max(1, high - low) };
});

const barWidth = computed(() => (plot.value.width / 12) * 0.46);

function rainY(value: number): number {
    return PAD.top + plot.value.rainHeight * (1 - value / rainMax.value);
}

function tempY(value: number): number {
    const range = tempRange.value;

    if (range === null) {
        return plot.value.tempTop;
    }

    return (
        plot.value.tempTop +
        plot.value.tempHeight * (1 - (value - range.low) / range.span)
    );
}

const hasDemand = computed(() => rows.value.some((r) => r.demand !== null));
const hasBands = computed(() => rows.value.some((r) => r.p10 !== null));

/**
 * The demand line as segments rather than one polyline: a month with no
 * figure should break the line rather than be interpolated across.
 */
const demandSegments = computed(() => {
    const out: string[] = [];
    let run: string[] = [];

    for (const row of rows.value) {
        if (row.demand === null) {
            if (run.length > 1) out.push(run.join(' '));
            run = [];
            continue;
        }

        run.push(`${row.x.toFixed(1)},${rainY(row.demand).toFixed(1)}`);
    }

    if (run.length > 1) out.push(run.join(' '));

    return out;
});

const shortMonths = computed(() => rows.value.filter((r) => r.dryYearShort).map((r) => r.month));

const baselineShortMonths = computed(() => {
    if (props.baseline === undefined) {
        return null;
    }

    return props.baseline
        .filter((m) => m.precipP10 !== null && m.et0 !== null && m.precipP10 < m.et0)
        .map((m) => m.month);
});

const rainTotal = computed(() => sum((r) => r.rain));
const demandTotal = computed(() => sum((r) => r.demand));

function sum(pick: (row: Row) => number | null): number | null {
    const values = rows.value.map(pick).filter((v): v is number => v !== null);

    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

const ticks = computed(() => {
    const step = rainMax.value > 600 ? 200 : rainMax.value > 300 ? 100 : 50;
    const out: number[] = [];

    for (let value = 0; value <= rainMax.value; value += step) {
        out.push(value);
    }

    return out;
});

const verdict = computed(() => {
    const total = rainTotal.value;
    const demand = demandTotal.value;

    if (total === null) {
        return 'No rainfall record reached this point.';
    }

    if (demand === null) {
        return `${mm(total)} of rain over the year. No evapotranspiration figure here, so the demand side is missing.`;
    }

    const margin =
        total > demand * 1.5
            ? 'comfortably more than the air pulls back over a year'
            : total > demand
              ? 'a little more than the air pulls back over a year'
              : 'less than the air pulls back over a year';

    return `${mm(total)} of rain against ${mm(demand)} of reference demand — ${margin}. The annual figure is not the decision, though: a month is.`;
});
</script>

<template>
    <section class="card p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-semibold">The year at this point</h3>
            <span class="text-xs" style="color: var(--ink-faint)">{{ props.scenarioLabel }}</span>
        </div>

        <p v-if="rows.length === 0" class="mt-3 text-sm" style="color: var(--ink-soft)">
            No monthly climate reached this point.
        </p>

        <template v-else>
            <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                {{ verdict }}
            </p>

            <svg
                :viewBox="`0 0 ${W} ${H}`"
                class="mt-3 w-full"
                role="img"
                :aria-label="`Monthly rainfall and crop water demand, ${props.scenarioLabel}`"
            >
                <!-- Rainfall gridlines -->
                <g>
                    <template v-for="tick in ticks" :key="`g${tick}`">
                        <line
                            :x1="PAD.left"
                            :x2="W - PAD.right"
                            :y1="rainY(tick)"
                            :y2="rainY(tick)"
                            stroke="var(--border)"
                            stroke-width="1"
                        />
                        <text
                            :x="PAD.left - 6"
                            :y="rainY(tick) + 3.5"
                            text-anchor="end"
                            font-size="9"
                            fill="var(--ink-faint)"
                        >
                            {{ tick }}
                        </text>
                    </template>
                    <text
                        :x="PAD.left - 6"
                        :y="PAD.top - 5"
                        text-anchor="end"
                        font-size="9"
                        fill="var(--ink-faint)"
                    >
                        mm
                    </text>
                </g>

                <!-- One-in-ten wet and dry years -->
                <g v-if="hasBands">
                    <line
                        v-for="row in rows.filter((r) => r.p10 !== null && r.p90 !== null)"
                        :key="`band${row.month}`"
                        :x1="row.x"
                        :x2="row.x"
                        :y1="rainY(row.p10 as number)"
                        :y2="rainY(row.p90 as number)"
                        stroke="var(--rain)"
                        stroke-width="1.5"
                        stroke-opacity="0.45"
                        stroke-linecap="round"
                    />
                </g>

                <!-- Mean rainfall -->
                <g>
                    <rect
                        v-for="row in rows.filter((r) => r.rain !== null)"
                        :key="`bar${row.month}`"
                        :x="row.x - barWidth / 2"
                        :y="rainY(row.rain as number)"
                        :width="barWidth"
                        :height="Math.max(1, rainY(0) - rainY(row.rain as number))"
                        fill="var(--rain)"
                        fill-opacity="0.75"
                        rx="1.5"
                    />
                </g>

                <!-- Crop water demand -->
                <g v-if="hasDemand">
                    <polyline
                        v-for="(segment, i) in demandSegments"
                        :key="`d${i}`"
                        :points="segment"
                        fill="none"
                        stroke="var(--demand)"
                        stroke-width="2"
                        stroke-linejoin="round"
                    />
                    <!-- Marked on the demand line itself, where the shortfall is. -->
                    <circle
                        v-for="row in rows.filter((r) => r.dryYearShort)"
                        :key="`s${row.month}`"
                        :cx="row.x"
                        :cy="rainY(row.demand as number)"
                        r="4"
                        fill="var(--danger)"
                        stroke="var(--surface-raised)"
                        stroke-width="1.5"
                    />
                </g>

                <!-- Temperature band -->
                <g v-if="tempRange !== null">
                    <text
                        :x="PAD.left - 6"
                        :y="plot.tempTop + 4"
                        text-anchor="end"
                        font-size="9"
                        fill="var(--ink-faint)"
                    >
                        {{ tempRange.high }}°
                    </text>
                    <text
                        :x="PAD.left - 6"
                        :y="plot.tempTop + plot.tempHeight + 4"
                        text-anchor="end"
                        font-size="9"
                        fill="var(--ink-faint)"
                    >
                        {{ tempRange.low }}°
                    </text>

                    <polygon
                        :points="[
                            ...rows
                                .filter((r) => r.tMax !== null)
                                .map((r) => `${r.x.toFixed(1)},${tempY(r.tMax as number).toFixed(1)}`),
                            ...rows
                                .filter((r) => r.tMin !== null)
                                .reverse()
                                .map((r) => `${r.x.toFixed(1)},${tempY(r.tMin as number).toFixed(1)}`),
                        ].join(' ')"
                        fill="var(--temp)"
                        fill-opacity="0.22"
                    />
                    <polyline
                        :points="
                            rows
                                .filter((r) => r.tMax !== null)
                                .map((r) => `${r.x.toFixed(1)},${tempY(r.tMax as number).toFixed(1)}`)
                                .join(' ')
                        "
                        fill="none"
                        stroke="var(--temp)"
                        stroke-width="1.5"
                    />
                </g>

                <!-- Months -->
                <g>
                    <text
                        v-for="row in rows"
                        :key="`m${row.month}`"
                        :x="row.x"
                        :y="H - PAD.bottom + 14"
                        text-anchor="middle"
                        font-size="10"
                        :fill="row.dryYearShort ? 'var(--danger)' : 'var(--ink-soft)'"
                        :font-weight="row.dryYearShort ? 600 : 400"
                    >
                        {{ row.label }}
                    </text>
                </g>
            </svg>

            <!-- Legend -->
            <div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style="color: var(--ink-soft)">
                <span class="inline-flex items-center gap-1.5">
                    <span class="inline-block h-2.5 w-2.5 rounded-sm" style="background: var(--rain)" />
                    rain in an average month
                </span>
                <span v-if="hasBands" class="inline-flex items-center gap-1.5">
                    <span class="inline-block h-3 w-0.5" style="background: var(--rain); opacity: 0.5" />
                    the wettest and driest year in ten
                </span>
                <span v-if="hasDemand" class="inline-flex items-center gap-1.5">
                    <span class="inline-block h-0.5 w-4" style="background: var(--demand)" />
                    what the air pulls back (ET₀)
                </span>
                <span v-if="shortMonths.length > 0" class="inline-flex items-center gap-1.5">
                    <span class="inline-block h-2.5 w-2.5 rounded-full" style="background: var(--danger)" />
                    a dry year here does not feed itself
                </span>
                <span v-if="tempRange" class="inline-flex items-center gap-1.5">
                    <span class="inline-block h-2.5 w-2.5 rounded-sm" style="background: var(--temp); opacity: 0.5" />
                    daily high to low
                </span>
            </div>

            <!-- What the chart says -->
            <div class="mt-3 space-y-2 border-t pt-3 text-xs leading-relaxed" style="border-color: var(--border)">
                <p v-if="shortMonths.length > 0" style="color: var(--danger)">
                    <strong>{{ monthList(shortMonths) }}</strong>
                    {{ shortMonths.length === 1 ? 'falls' : 'fall' }} short in a dry year: one
                    year in ten the rain is less than a reference crop loses to the air that
                    month, so a crop in the ground then is living on stored water or on
                    irrigation.
                    <template v-if="baselineShortMonths !== null && baselineShortMonths.length === 0">
                        On today's record that happens in no month at all — this is what the
                        scenario changes.
                    </template>
                </p>

                <p v-else-if="hasBands" style="color: var(--ink-soft)">
                    Even in one year in ten, every month covers what the air pulls back. That is
                    unusual and it is why this district grows what it grows — but it is a
                    monthly margin, not a weekly one, and a three-week dry spell inside a wet
                    month does not show up here.
                </p>

                <p v-else style="color: var(--ink-faint)">
                    No one-in-ten bands at this point: a climatology carries a mean and no
                    distribution, so the chart can draw the average month and not the bad year.
                    Inside the district it has 45 years of daily record and can.
                </p>

                <p style="color: var(--ink-faint)">
                    Rainfall and ET₀ from NASA POWER, with evapotranspiration by FAO-56
                    Penman-Monteith. ET₀ is a reference grass crop, not your crop — what you
                    plant uses more at mid-season and less at the ends.
                    <template v-if="rainTotal !== null && demandTotal !== null">
                        Over the year: {{ num(rainTotal) }} mm of rain, {{ num(demandTotal) }} mm
                        of demand.
                    </template>
                </p>
            </div>
        </template>
    </section>
</template>
