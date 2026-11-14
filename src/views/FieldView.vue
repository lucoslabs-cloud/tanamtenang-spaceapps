<script setup lang="ts">
/**
 * The field report.
 *
 * The rotation comparison comes first, before the ranking and before the
 * evidence, because it is the question the brief asks and the question a
 * farmer with one hectare actually has. "What grows here" is a step on the
 * way to "what do I plant, and in what order".
 *
 * Underneath it, in order: the year at this point, when the standing crop is
 * uncomfortable, what the ground will carry, and every layer behind all of
 * it. A reader who stops after the first section has the answer; a reader who
 * goes to the bottom can check it.
 */

import { computed, ref } from 'vue';
import { ChevronDown, Pencil } from '@lucide/vue';
import EnterpriseRanking from '@/components/EnterpriseRanking.vue';
import EvidencePanel from '@/components/EvidencePanel.vue';
import PrioritySliders from '@/components/PrioritySliders.vue';
import RotationComparison from '@/components/RotationComparison.vue';
import ScenarioPicker from '@/components/ScenarioPicker.vue';
import SeasonalStressPanel from '@/components/SeasonalStressPanel.vue';
import YearChart from '@/components/YearChart.vue';
import {
    baselineNormals,
    coveredCells,
    dataset,
    growing,
    liveError,
    liveLoading,
    liveSite,
    monthlyNormals,
    plotAreaHa,
    scenario,
    scenarioLabel,
    selection,
    selectionCentre,
    site,
    view,
} from '@/store';
import { coordinates, hectares } from '@/lib/format';

const showSettings = ref(false);

const centre = computed(() => selectionCentre.value);
const isLive = computed(() => selection.value.kind === 'live');
const isPlot = computed(() => selection.value.kind === 'plot');

const where = computed(() => {
    const data = dataset.value;

    if (isLive.value) {
        return 'A point outside the district, scored from live NASA POWER and SoilGrids';
    }

    if (isPlot.value) {
        return `An outline of ${hectares(plotAreaHa.value)} across ${coveredCells.value.length} analysis ${
            coveredCells.value.length === 1 ? 'cell' : 'cells'
        } in ${data?.meta.region.name}`;
    }

    return `One 250 m analysis cell — 6.25 hectares — in ${data?.meta.region.name}, ${data?.meta.region.adm1}`;
});

const climatePointLabel = computed(() => {
    const data = dataset.value;
    const index = site.value?.climatePoint ?? null;

    if (data === null || index === null) {
        return null;
    }

    const point = data.climate.points[index];

    return point === undefined
        ? null
        : `${point.label ?? 'POWER point'} at ${coordinates(point.lon, point.lat)}`;
});
</script>

<template>
    <!-- A live point is fetched rather than looked up, so it has a wait. -->
    <div v-if="site === null && liveLoading" class="mx-auto max-w-3xl px-4 py-10 text-center">
        <p class="text-sm font-medium">Asking NASA POWER and SoilGrids about this point…</p>
        <p class="mx-auto mt-2 max-w-md text-xs leading-relaxed" style="color: var(--ink-soft)">
            The climate comes back in a second or two. SoilGrids is a free service that allows
            only a few requests a minute, so the soil can take up to twenty — and if it does not
            answer, the report still appears and says the soil is missing.
        </p>
    </div>

    <div v-else-if="site === null" class="mx-auto max-w-3xl px-4 py-10 text-center">
        <p class="text-sm" style="color: var(--ink-soft)">
            {{ liveError ?? 'No field picked yet.' }}
        </p>
        <button class="btn btn-primary mt-3" @click="view = 'start'">Pick a field</button>
    </div>

    <div v-else class="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <!-- Where, and what that means -->
        <header class="card p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                    <h1 class="text-lg font-semibold tracking-tight">Your field</h1>
                    <p class="mt-0.5 text-xs" style="color: var(--ink-soft)">
                        {{ where }}<template v-if="centre">
                            · {{ coordinates(centre[0], centre[1]) }}</template>
                    </p>
                    <p v-if="climatePointLabel" class="mt-0.5 text-[11px]" style="color: var(--ink-faint)">
                        Climate read from {{ climatePointLabel }} — NASA POWER's grid is about
                        55 × 69 km, so it says <em>when</em> rather than <em>where</em>. Where
                        things differ within the district comes from SRTM at 30 m and SoilGrids
                        at 250 m.
                    </p>
                </div>

                <div class="flex flex-wrap items-center gap-1.5">
                    <button class="btn px-2.5 py-1.5 text-xs" @click="view = 'start'">
                        <Pencil :size="13" /> Change field
                    </button>
                    <button
                        class="btn px-2.5 py-1.5 text-xs"
                        :aria-expanded="showSettings"
                        @click="showSettings = !showSettings"
                    >
                        Priorities and climate
                        <ChevronDown :size="13" :style="{ transform: showSettings ? 'rotate(180deg)' : 'none' }" />
                    </button>
                </div>
            </div>

            <!-- A live point says what it is missing, before anything else -->
            <div v-if="isLive && liveSite" class="mt-3 border-t pt-3" style="border-color: var(--border)">
                <p class="text-xs font-medium" style="color: var(--warn)">
                    This point is scored on less of the model than a district cell.
                </p>
                <ul class="mt-1.5 space-y-1.5 text-[11px] leading-relaxed" style="color: var(--ink-soft)">
                    <li v-for="(gap, i) in liveSite.gaps" :key="i">{{ gap.reason }}</li>
                </ul>
                <ul class="mt-2 space-y-1 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                    <li v-for="(caveat, i) in liveSite.caveats" :key="i">{{ caveat }}</li>
                </ul>
                <p class="mt-2 text-[11px]" style="color: var(--ink-faint)">
                    <template v-for="(source, i) in liveSite.sources" :key="source.name">
                        <strong>{{ source.name }}</strong> — {{ source.detail }}{{
                            i < liveSite.sources.length - 1 ? ' ' : ''
                        }}
                    </template>
                </p>
            </div>

            <!-- A plot says it is a plot, and what that buys -->
            <p v-else-if="isPlot" class="mt-2 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                Scored from every cell your outline touches, weighted by how much of each it
                covers, rather than from the nearest one. A plot across the peat edge here can
                span 60 to 120 cm of peat and a flood hazard from 0.41 to 0.91 — one end of it
                land a drainage design will work with and the other end land it refuses. Where
                the cells disagree, the ranking says so instead of averaging it away.
            </p>
        </header>

        <!-- Priorities and climate, folded away until wanted -->
        <div v-if="showSettings" class="grid gap-4 lg:grid-cols-[24rem_1fr]">
            <PrioritySliders />
            <ScenarioPicker />
        </div>

        <!-- The lead: four strategies -->
        <RotationComparison />

        <!-- Time -->
        <YearChart
            :months="monthlyNormals"
            :scenario-label="scenarioLabel"
            :baseline="scenario === 'baseline' ? undefined : baselineNormals"
        />

        <SeasonalStressPanel v-if="growing" />

        <p v-else class="card p-3 text-xs leading-relaxed" style="color: var(--ink-faint)">
            Say what is growing on this field and a second chart appears: which months of the
            year that crop is uncomfortable here, and how many more months it would be under
            each climate scenario. On a 25-year perennial that comparison is the whole decision.
        </p>

        <!-- What the ground will carry -->
        <EnterpriseRanking />

        <!-- The receipts -->
        <EvidencePanel />
    </div>
</template>
