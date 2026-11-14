<script setup lang="ts">
/**
 * Which climate the answer is scored against.
 *
 * **Only built scenarios are offered.** The platform once declared seven and
 * had data for one: the picker showed all seven, the engine fell back to the
 * baseline, and the map for 2070 was pixel-identical to the map for today. A
 * farmer who checks whether their land still suits oil palm in 2050, sees the
 * same answer as today and takes comfort from it has been actively misled by
 * a feature that looked like it worked. So availability is a fact read from
 * the data, not a flag.
 *
 * The ensemble's own disagreement travels with the label, because a choice
 * between futures should be made with the uncertainty visible rather than
 * hidden behind a tidy year.
 */

import { computed } from 'vue';
import { dataset, scenario, selection } from '@/store';

const props = defineProps<{ compact?: boolean }>();

const scenarios = computed(() => dataset.value?.meta.scenarios.filter((s) => s.available) ?? []);
const current = computed(() => scenarios.value.find((s) => s.key === scenario.value) ?? null);

/** A live point has no projections: the change factors were built for Sri Aman. */
const inert = computed(() => selection.value.kind === 'live');
</script>

<template>
    <div v-if="props.compact" class="flex items-center gap-1.5">
        <label class="sr-only" for="scenario-compact">Climate scenario</label>
        <select
            id="scenario-compact"
            v-model="scenario"
            class="rounded-md border px-2 py-1 text-xs"
            style="border-color: var(--border); background: var(--surface-raised); color: var(--ink)"
            :disabled="inert"
            :title="inert ? 'Projections exist only for the Sri Aman district' : undefined"
        >
            <option v-for="s in scenarios" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
    </div>

    <div v-else class="card p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-semibold">Which climate are we talking about?</h3>
            <span class="text-xs" style="color: var(--ink-faint)">
                {{ scenarios.length }} built, from NEX-GDDP-CMIP6
            </span>
        </div>

        <p v-if="inert" class="mt-2 text-xs" style="color: var(--warn)">
            This point is outside the district, and the CMIP6 change factors were built for
            Sri Aman only. It is scored against the observed climatology and the picker does
            nothing here.
        </p>

        <div class="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Climate scenario">
            <button
                v-for="s in scenarios"
                :key="s.key"
                class="chip"
                :disabled="inert"
                :style="
                    scenario === s.key
                        ? 'background: var(--accent); border-color: var(--accent); color: var(--accent-ink)'
                        : 'color: var(--ink-soft)'
                "
                @click="scenario = s.key"
            >
                {{ s.label }}
            </button>
        </div>

        <p v-if="current?.description" class="mt-3 text-xs leading-relaxed" style="color: var(--ink-soft)">
            {{ current.description }}
        </p>

        <div v-if="current?.projection" class="mt-3 space-y-2 text-xs">
            <p style="color: var(--ink-soft)">
                A {{ current.projection.memberCount }}-model ensemble puts this
                <strong style="color: var(--ink)">
                    {{ current.projection.warming.toFixed(1) }} °C warmer
                </strong>
                than 1995–2014 — the models spread from
                {{ current.projection.warmingLow.toFixed(1) }} to
                {{ current.projection.warmingHigh.toFixed(1) }} °C — with annual rainfall
                <strong style="color: var(--ink)">
                    {{ current.projection.rainPct > 0 ? '+' : '' }}{{ current.projection.rainPct.toFixed(1) }}%
                </strong>
                (spread {{ current.projection.rainPctLow.toFixed(1) }} to
                {{ current.projection.rainPctHigh.toFixed(1) }}%).
            </p>

            <p style="color: var(--ink-faint)">
                The annual figure hides the part that matters. Month by month the change runs
                from {{ current.projection.driestMonthPct.toFixed(0) }}% to
                {{ current.projection.wettestMonthPct.toFixed(0) }}%, so the same year's rain
                arrives differently — which is what moves dry spells, erosion and the months a
                crop cannot feed itself.
            </p>

            <p v-if="current.projection.models" style="color: var(--ink-faint)">
                Models: {{ current.projection.models }}.
                Each is differenced against its own 1995–2014 run, and the monthly change
                factors are applied day by day to the whole 45-year observed record, so dry
                spells and extremes are recounted rather than scaled.
            </p>
        </div>

        <p v-else-if="!inert" class="mt-3 text-xs" style="color: var(--ink-faint)">
            Observed 1991–2020 climate normal from NASA POWER. Nothing projected.
        </p>
    </div>
</template>
