<script setup lang="ts">
/**
 * One minute, three questions.
 *
 * Where is your field, what is on it now, and what matters to you. That is
 * everything the engine needs, and a farmer should not have to read a manual
 * or make an account to answer it. Nothing is required except the first, and
 * the tool says what each answer changes rather than collecting it silently.
 *
 * The district is the flagship because the data behind it is real at 250 m.
 * Anywhere else on Earth is offered on the same screen and with its gaps
 * named, because a tool that only works where its authors live is not a tool
 * for farmers.
 */

import { computed, ref } from 'vue';
import { Crosshair, Globe, MapPin, PencilLine, Sprout } from '@lucide/vue';
import MapCanvas from '@/components/MapCanvas.vue';
import PrioritySliders from '@/components/PrioritySliders.vue';
import ScenarioPicker from '@/components/ScenarioPicker.vue';
import {
    dataset,
    growingSlug,
    hasField,
    liveError,
    liveLoading,
    plotAreaHa,
    priorities,
    scenario,
    selectCell,
    selection,
    selectLive,
    selectPlot,
    view,
} from '@/store';
import { isRotatable } from '@/engine/rotation/planner';
import { coordinates, hectares } from '@/lib/format';
import { paint } from '@/lib/painter';

type Step = 1 | 2 | 3;

const step = ref<Step>(1);
const mapMode = ref<'pick' | 'draw'>('pick');
const outside = ref<{ lon: number; lat: number } | null>(null);
const geoError = ref<string | null>(null);
const manual = ref('');

const meta = computed(() => dataset.value?.meta ?? null);

/** A demo field that shows the tool at its most useful: the peat edge. */
function tryDemoField(): void {
    const data = dataset.value;

    if (data === null) {
        return;
    }

    // Cropped ground on the low hills south-east of Simanggang: gentle slope,
    // flood hazard under a third, peat only indicated rather than deep, and a
    // pH of about 5 — ordinary Sarawak farmland rather than a corner picked to
    // flatter the tool. It is land where several crops come out suitable, so
    // the rotation comparison has a real choice to show.
    const candidates: Array<[number, number]> = [
        [111.48482, 1.21807],
        [111.48933, 1.23836],
        [111.44651, 1.2316],
        [data.meta.region.centroid[0], data.meta.region.centroid[1]],
    ];

    for (const [lon, lat] of candidates) {
        if (selectCell(lon, lat)) {
            growingSlug.value ??= 'wet-paddy';
            step.value = 2;

            return;
        }
    }
}

function onPick(lon: number, lat: number, inside: boolean): void {
    geoError.value = null;

    if (inside) {
        outside.value = null;
        selectCell(lon, lat);
        step.value = 2;

        return;
    }

    // Outside the snapshot. Offered rather than refused, and the panel that
    // appears says exactly what is missing out there.
    outside.value = { lon, lat };
}

async function useOutside(): Promise<void> {
    const point = outside.value;

    if (point === null) {
        return;
    }

    await selectLive(point.lat, point.lon);
    outside.value = null;

    if (liveError.value === null) {
        step.value = 2;
    }
}

function locate(): void {
    geoError.value = null;

    if (!('geolocation' in navigator)) {
        geoError.value = 'This browser will not share a location.';

        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { longitude, latitude } = position.coords;

            if (selectCell(longitude, latitude)) {
                step.value = 2;

                return;
            }

            outside.value = { lon: longitude, lat: latitude };
        },
        (error) => {
            geoError.value =
                error.code === error.PERMISSION_DENIED
                    ? 'Location permission was declined. Pick your field on the map instead.'
                    : 'Could not get a location from this device.';
        },
        { enableHighAccuracy: true, timeout: 10_000 },
    );
}

function useManual(): void {
    geoError.value = null;

    const parts = manual.value.split(/[,\s]+/).filter((p) => p !== '');

    if (parts.length < 2) {
        geoError.value = 'Give a latitude and a longitude, like 1.24, 111.46.';

        return;
    }

    const lat = Number(parts[0]);
    const lon = Number(parts[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        geoError.value = 'That does not read as a latitude and longitude.';

        return;
    }

    if (selectCell(lon, lat)) {
        step.value = 2;

        return;
    }

    outside.value = { lon, lat };
}

function onDrawn(ring: Array<[number, number]>): void {
    selectPlot(ring);
    mapMode.value = 'pick';
    step.value = 2;
}

const standing = computed(() => {
    const data = dataset.value;

    if (data === null) {
        return { rotatable: [], other: [] };
    }

    const all = data.catalogue.enterprises.filter((e) => !e.isCoverCrop);

    return {
        rotatable: all.filter((e) => isRotatable(e)).sort((a, b) => a.sortOrder - b.sortOrder),
        other: all.filter((e) => !isRotatable(e)).sort((a, b) => a.sortOrder - b.sortOrder),
    };
});

function finish(): void {
    view.value = 'field';

    // The district paints itself behind the field report, so the map tab is
    // already drawn when they reach it.
    const best = dataset.value?.catalogue.enterprises.find((e) => e.category === 'seasonal');

    if (best !== undefined) {
        void paint({
            mode: 'suitability',
            enterprise: best.slug,
            scenario: scenario.value,
            priorities: { ...priorities },
            theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        });
    }
}

const whereLabel = computed(() => {
    const current = selection.value;

    if (current.kind === 'cell') {
        const centre = dataset.value?.grid.centreOf(current.index);

        return centre === undefined
            ? 'a cell of the district'
            : `one 250 m cell at ${coordinates(centre[0], centre[1])}`;
    }

    if (current.kind === 'plot') {
        return `an outline of ${hectares(plotAreaHa.value)}`;
    }

    if (current.kind === 'live') {
        return `a live point at ${coordinates(current.lon, current.lat)}`;
    }

    return null;
});
</script>

<template>
    <div class="mx-auto max-w-6xl px-4 py-6">
        <!-- The pitch, once -->
        <section v-if="step === 1" class="mb-5 max-w-3xl">
            <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
                What should you grow here, and in what order?
            </h1>
            <p class="mt-2 text-sm leading-relaxed" style="color: var(--ink-soft)">
                Farmers lose crops to weather they could not plan for. By the time the damage is
                visible, the decision that caused it was made months earlier, when the seed went
                in the ground. The satellite record that would have warned them exists — it is
                just not in a form a farmer can use.
            </p>
            <p class="mt-2 text-sm leading-relaxed" style="color: var(--ink-soft)">
                This turns that record into the question a farmer actually asks. Pick a field and
                it compares four ways of cropping it over the next
                {{ meta?.rotation.horizon_seasons ?? 4 }} seasons — including carrying on exactly
                as you are — and says for each one why, on what evidence, for what gain, with
                what still unknown.
            </p>

            <dl class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs" style="color: var(--ink-faint)">
                <div>
                    <dt class="inline">Analysis cells</dt>
                    <dd class="ml-1 inline font-semibold tnum" style="color: var(--ink)">
                        {{ meta?.counts.cells.toLocaleString('en-US') }}
                    </dd>
                </div>
                <div>
                    <dt class="inline">Enterprises</dt>
                    <dd class="ml-1 inline font-semibold tnum" style="color: var(--ink)">
                        {{ meta?.counts.enterprises }}
                    </dd>
                </div>
                <div>
                    <dt class="inline">Requirement envelopes</dt>
                    <dd class="ml-1 inline font-semibold tnum" style="color: var(--ink)">
                        {{ meta?.counts.requirements }}
                    </dd>
                </div>
                <div>
                    <dt class="inline">Rotation rules</dt>
                    <dd class="ml-1 inline font-semibold tnum" style="color: var(--ink)">
                        {{ meta?.counts.rotationRules }}
                    </dd>
                </div>
                <div>
                    <dt class="inline">Climate futures</dt>
                    <dd class="ml-1 inline font-semibold tnum" style="color: var(--ink)">
                        {{ meta?.counts.scenariosAvailable }}
                    </dd>
                </div>
            </dl>
        </section>

        <!-- Steps -->
        <ol class="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <li
                v-for="(label, i) in ['Your field', 'What you grow', 'What matters']"
                :key="label"
                class="flex items-center gap-2"
            >
                <button
                    class="chip"
                    :disabled="i > 0 && !hasField"
                    :style="
                        step === i + 1
                            ? 'background: var(--accent); border-color: var(--accent); color: var(--accent-ink)'
                            : 'color: var(--ink-soft)'
                    "
                    @click="(i === 0 || hasField) && (step = (i + 1) as Step)"
                >
                    <span class="tnum">{{ i + 1 }}</span>
                    {{ label }}
                </button>
                <span v-if="i < 2" style="color: var(--ink-faint)">→</span>
            </li>
        </ol>

        <!-- Step 1: where -->
        <div v-if="step === 1" class="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <div class="card h-[26rem] overflow-hidden lg:h-[32rem]">
                <MapCanvas :mode="mapMode" @pick="onPick" @drawn="onDrawn" />
            </div>

            <div class="space-y-3">
                <section class="card p-4">
                    <h2 class="text-sm font-semibold">Where is your field?</h2>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        Tap it on the map. Inside
                        <strong>{{ meta?.region.name }}, {{ meta?.region.adm1 }}</strong>
                        the tool has 250 m data already loaded; anywhere else it will fetch what
                        the open NASA and soil APIs will give and tell you what is missing.
                    </p>

                    <div class="mt-3 flex flex-wrap gap-1.5">
                        <button
                            class="btn px-2.5 py-1.5 text-xs"
                            :style="mapMode === 'pick' ? 'border-color: var(--accent); color: var(--accent)' : undefined"
                            @click="mapMode = 'pick'"
                        >
                            <MapPin :size="13" /> Tap one spot
                        </button>
                        <button
                            class="btn px-2.5 py-1.5 text-xs"
                            :style="mapMode === 'draw' ? 'border-color: var(--accent); color: var(--accent)' : undefined"
                            @click="mapMode = 'draw'"
                        >
                            <PencilLine :size="13" /> Trace the outline
                        </button>
                        <button class="btn px-2.5 py-1.5 text-xs" @click="locate">
                            <Crosshair :size="13" /> Where I am
                        </button>
                    </div>

                    <div class="mt-3">
                        <label for="manual" class="text-xs font-medium">Or type a position</label>
                        <div class="mt-1 flex gap-1.5">
                            <input
                                id="manual"
                                v-model="manual"
                                placeholder="1.24, 111.46"
                                class="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm"
                                style="border-color: var(--border); background: var(--surface-raised); color: var(--ink)"
                                @keyup.enter="useManual"
                            />
                            <button class="btn px-2.5 py-1 text-xs" @click="useManual">Go</button>
                        </div>
                    </div>

                    <p v-if="geoError" class="mt-2 text-xs" style="color: var(--danger)">
                        {{ geoError }}
                    </p>

                    <button class="btn mt-3 w-full px-2.5 py-1.5 text-xs" @click="tryDemoField">
                        <Sprout :size="13" /> Show me a field to look at
                    </button>
                    <p class="mt-1 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                        Cropped ground on the low hills south-east of Simanggang, with wet paddy
                        on it. Ordinary Sarawak farmland rather than a corner picked to flatter
                        the tool.
                    </p>
                </section>

                <!-- Outside the snapshot -->
                <section
                    v-if="outside !== null"
                    class="card p-4"
                    style="border-color: var(--warn)"
                >
                    <h3 class="flex items-center gap-1.5 text-sm font-semibold">
                        <Globe :size="14" /> That is outside the district
                    </h3>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        {{ coordinates(outside.lon, outside.lat) }}. The tool can still answer
                        there, from NASA POWER for the climate and ISRIC SoilGrids for the soil,
                        both fetched live from this browser.
                    </p>
                    <p class="mt-1.5 text-xs leading-relaxed" style="color: var(--warn)">
                        What it will not have: any elevation model, so no slope, wetness, height
                        above drainage or flood hazard; no dry-spell length or rainfall
                        variability, which need the daily record; no land cover, so nothing is
                        ruled out on what currently covers the ground; and no climate projection,
                        because the CMIP6 change factors were built for Sri Aman. The coverage
                        figure on every score will say how much of the model was left.
                    </p>
                    <div class="mt-3 flex gap-1.5">
                        <button class="btn btn-primary px-2.5 py-1.5 text-xs" :disabled="liveLoading" @click="useOutside">
                            {{ liveLoading ? 'Asking NASA…' : 'Score it anyway' }}
                        </button>
                        <button class="btn px-2.5 py-1.5 text-xs" @click="outside = null">
                            Pick somewhere else
                        </button>
                    </div>
                    <p v-if="liveError" class="mt-2 text-xs" style="color: var(--danger)">
                        {{ liveError }}
                    </p>
                </section>

                <section v-if="hasField" class="card p-4">
                    <p class="text-xs" style="color: var(--ink-soft)">
                        Picked: <strong style="color: var(--ink)">{{ whereLabel }}</strong>
                    </p>
                    <button class="btn btn-primary mt-2 w-full" @click="step = 2">
                        Next: what you grow
                    </button>
                </section>
            </div>
        </div>

        <!-- Step 2: what is on it -->
        <div v-else-if="step === 2" class="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <section class="card p-4">
                <h2 class="text-sm font-semibold">What is on this field now?</h2>
                <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                    This is the one answer that changes what the comparison can show you. The
                    brief these plans answer asks for the rotation you already run to be put
                    beside the alternatives — and without knowing what is in the ground, there is
                    no baseline to beat. It is also what the first rotation rule applies to.
                </p>
                <p class="mt-1.5 text-xs leading-relaxed" style="color: var(--ink-faint)">
                    You can skip it. The three searched strategies still appear; only your own
                    does not.
                </p>

                <div class="mt-4 space-y-4">
                    <div>
                        <p class="text-xs font-medium" style="color: var(--ink-soft)">
                            Crops that rotate
                        </p>
                        <div class="mt-1.5 flex flex-wrap gap-1.5">
                            <button
                                v-for="e in standing.rotatable"
                                :key="e.slug"
                                class="chip"
                                :style="
                                    growingSlug === e.slug
                                        ? 'background: var(--accent); border-color: var(--accent); color: var(--accent-ink)'
                                        : 'color: var(--ink-soft)'
                                "
                                @click="growingSlug = growingSlug === e.slug ? null : e.slug"
                            >
                                {{ e.name }}
                            </button>
                        </div>
                    </div>

                    <div>
                        <p class="text-xs font-medium" style="color: var(--ink-soft)">
                            Standing crops, fish and stock
                        </p>
                        <p class="text-[11px]" style="color: var(--ink-faint)">
                            Pick one of these and the tool will say plainly that a rotation is not
                            the question on this field, and what is.
                        </p>
                        <div class="mt-1.5 flex flex-wrap gap-1.5">
                            <button
                                v-for="e in standing.other"
                                :key="e.slug"
                                class="chip"
                                :style="
                                    growingSlug === e.slug
                                        ? 'background: var(--accent); border-color: var(--accent); color: var(--accent-ink)'
                                        : 'color: var(--ink-faint)'
                                "
                                @click="growingSlug = growingSlug === e.slug ? null : e.slug"
                            >
                                {{ e.name }}
                            </button>
                        </div>
                    </div>
                </div>

                <div class="mt-5 flex gap-1.5">
                    <button class="btn px-2.5 py-1.5 text-xs" @click="step = 1">Back</button>
                    <button class="btn btn-primary px-2.5 py-1.5 text-xs" @click="step = 3">
                        Next: what matters
                    </button>
                    <button class="btn px-2.5 py-1.5 text-xs" @click="finish">
                        Skip to the answer
                    </button>
                </div>
            </section>

            <ScenarioPicker />
        </div>

        <!-- Step 3: priorities -->
        <div v-else class="grid gap-4 lg:grid-cols-[24rem_1fr]">
            <PrioritySliders />

            <div class="space-y-3">
                <ScenarioPicker />

                <section class="card p-4">
                    <h3 class="text-sm font-semibold">That is everything.</h3>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        Your field is {{ whereLabel }}. Everything from here is computed in this
                        browser from the data already downloaded — the ranking, the four rotation
                        strategies, the year chart and the district map all come from the same
                        three answers, which is why changing one changes all of them at once.
                    </p>
                    <button class="btn btn-primary mt-3 w-full" @click="finish">
                        Show me the field report
                    </button>
                </section>
            </div>
        </div>
    </div>
</template>
