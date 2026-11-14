<script setup lang="ts">
/**
 * What the words mean, where the numbers come from, and what this cannot know.
 *
 * The brief asks for scientific terms to be explained. Explaining them where
 * they appear is half of it — every metric carries its definition in a
 * tooltip and in the evidence panel — and the other half is a place to look
 * them up. The metric definitions come from the same source as those
 * tooltips, so the glossary and the panels cannot drift.
 *
 * The dataset table is deliberately not a list of logos. A table of layers
 * with a role each is a claim about what the scores rest on, so it says which
 * ones are actually doing that work and which are registered and carrying
 * nothing.
 */

import { computed, ref } from 'vue';
import { dataset } from '@/store';
import { metricGroups, metrics } from '@/engine/vocabulary';

const tab = ref<'terms' | 'data' | 'limits'>('terms');
const query = ref('');

const meta = computed(() => dataset.value?.meta ?? null);

/** The glossary, with every metric's own definition folded in. */
const terms = computed(() => {
    const concepts = (dataset.value?.glossary ?? []).map((entry) => ({
        term: entry.term,
        also: (entry.also as string | null) ?? null,
        body: entry.body,
        source: null as string | null,
        group: 'Ideas this rests on',
    }));

    const fromMetrics = metrics().map((definition) => ({
        term: definition.label,
        also: definition.unit === '' ? null : definition.unit,
        body: definition.describe,
        source: dataset.value?.dataSource(definition.dataset)?.name ?? definition.dataset,
        group:
            metricGroups().find((g) => g.key === definition.group)?.label ?? definition.group,
    }));

    const all = [...concepts, ...fromMetrics];
    const needle = query.value.trim().toLowerCase();

    const filtered =
        needle === ''
            ? all
            : all.filter(
                  (entry) =>
                      entry.term.toLowerCase().includes(needle) ||
                      entry.body.toLowerCase().includes(needle) ||
                      (entry.also ?? '').toLowerCase().includes(needle),
              );

    const grouped = new Map<string, typeof filtered>();

    for (const entry of filtered) {
        const list = grouped.get(entry.group);

        if (list === undefined) {
            grouped.set(entry.group, [entry]);
        } else {
            list.push(entry);
        }
    }

    return [...grouped.entries()];
});

/** Datasets split by whether anything in this tool actually rests on them. */
const datasets = computed(() => {
    const all = dataset.value?.datasets ?? [];

    return {
        ingested: all.filter((d) => d.lastIngestedAt !== null),
        registered: all.filter((d) => d.lastIngestedAt === null),
    };
});

/**
 * The nine NASA dataset families the challenge brief names, and which of them
 * are behind a number here. Said plainly rather than implied by a table.
 */
const BRIEF_FAMILIES = [
    { name: 'SRTM / NASADEM', slug: 'srtmgl1', role: 'Slope, wetness, height above drainage, flood hazard' },
    { name: 'NASA POWER', slug: 'nasa_power', role: 'Rainfall and temperature seasonality, ET₀, dry spells, extremes' },
    { name: 'MODIS', slug: 'modis_landcover', role: 'Land cover, and the model’s permanent exclusions' },
    { name: 'GPM / IMERG', slug: 'gpm_imerg', role: 'Would give storm depth-duration-frequency for drainage sizing' },
    { name: 'SMAP', slug: 'smap_l4', role: 'Would give observed root-zone soil moisture to check the water balance against' },
    { name: 'GRACE / GRACE-FO', slug: 'grace_fo', role: 'Would give multi-year groundwater depletion' },
    { name: 'ECOSTRESS', slug: null, role: 'Would give land-surface temperature and ET at high resolution' },
    { name: 'Landsat', slug: null, role: 'Would give 30 m reflectance and vegetation indices' },
    { name: 'GEDI', slug: null, role: 'Would give canopy structure and biomass around the fields' },
];

function status(slug: string | null): 'ingested' | 'registered' | 'absent' {
    if (slug === null) {
        return 'absent';
    }

    const source = dataset.value?.dataSource(slug);

    if (source === undefined) {
        return 'absent';
    }

    return source.lastIngestedAt === null ? 'registered' : 'ingested';
}

const statusColour: Record<string, string> = {
    ingested: 'var(--accent)',
    registered: 'var(--warn)',
    absent: 'var(--ink-faint)',
};

const statusWord: Record<string, string> = {
    ingested: 'behind a number here',
    registered: 'registered, no data',
    absent: 'not in this project',
};
</script>

<template>
    <div class="mx-auto max-w-4xl px-4 py-6">
        <nav class="mb-4 flex flex-wrap gap-1.5" aria-label="Reference sections">
            <button
                v-for="item in [
                    { key: 'terms', label: 'Every word, defined' },
                    { key: 'data', label: 'Where the numbers come from' },
                    { key: 'limits', label: 'What this cannot know' },
                ]"
                :key="item.key"
                class="chip"
                :style="
                    tab === item.key
                        ? 'background: var(--accent); border-color: var(--accent); color: var(--accent-ink)'
                        : 'color: var(--ink-soft)'
                "
                @click="tab = item.key as typeof tab"
            >
                {{ item.label }}
            </button>
        </nav>

        <!-- Glossary -->
        <section v-if="tab === 'terms'" class="space-y-4">
            <div>
                <h1 class="text-lg font-semibold tracking-tight">Every word, defined</h1>
                <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                    Read from the same source as the tooltips, with the dataset behind each
                    figure printed beside it, so the glossary and the panels cannot disagree.
                    One entry is for something this tool does <em>not</em> have — a reader who
                    meets "soil moisture anomaly" in NASA material is better served by being
                    told it is absent and why than by finding nothing and assuming they missed
                    it.
                </p>
            </div>

            <input
                v-model="query"
                type="search"
                placeholder="Search for a term…"
                class="w-full rounded-md border px-3 py-1.5 text-sm"
                style="border-color: var(--border); background: var(--surface-raised); color: var(--ink)"
                aria-label="Search the glossary"
            />

            <div v-for="[group, entries] in terms" :key="group" class="card overflow-hidden">
                <h2 class="border-b px-3.5 py-2 text-sm font-semibold" style="border-color: var(--border)">
                    {{ group }}
                </h2>
                <dl class="divide-y" style="border-color: var(--border)">
                    <div v-for="entry in entries" :key="entry.term" class="px-3.5 py-2.5">
                        <dt class="text-sm font-medium">
                            {{ entry.term }}
                            <span v-if="entry.also" class="font-normal italic" style="color: var(--ink-faint)">
                                · {{ entry.also }}
                            </span>
                        </dt>
                        <dd class="mt-0.5 text-xs leading-relaxed" style="color: var(--ink-soft)">
                            {{ entry.body }}
                        </dd>
                        <dd v-if="entry.source" class="mt-0.5 text-[11px]" style="color: var(--ink-faint)">
                            From {{ entry.source }}
                        </dd>
                    </div>
                </dl>
            </div>

            <p v-if="terms.length === 0" class="text-sm" style="color: var(--ink-soft)">
                Nothing matches that.
            </p>
        </section>

        <!-- Provenance -->
        <section v-else-if="tab === 'data'" class="space-y-4">
            <div>
                <h1 class="text-lg font-semibold tracking-tight">Where the numbers come from</h1>
                <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                    Snapshot taken {{ meta?.generatedAt?.slice(0, 10) }} from the full platform's
                    own database, which is what makes this build and that one agree: one is a
                    photograph of the other. Nothing is recomputed on the way out, and the
                    thresholds, priority multipliers and rotation weights here are the same
                    literals the platform scores with.
                </p>
            </div>

            <!-- The brief's own list -->
            <div class="card overflow-hidden">
                <header class="border-b px-3.5 py-2.5" style="border-color: var(--border)">
                    <h2 class="text-sm font-semibold">
                        The nine NASA families the challenge names
                    </h2>
                    <p class="mt-0.5 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                        Said plainly rather than implied by a table of logos. Three of the nine
                        are behind a number here. NEX-GDDP-CMIP6 is ingested too and is not one of
                        the nine — the brief does not name a projection dataset.
                    </p>
                </header>
                <ul class="divide-y" style="border-color: var(--border)">
                    <li
                        v-for="family in BRIEF_FAMILIES"
                        :key="family.name"
                        class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2 text-xs"
                    >
                        <span class="w-36 font-medium">{{ family.name }}</span>
                        <span
                            class="chip"
                            :style="{ borderColor: statusColour[status(family.slug)], color: statusColour[status(family.slug)] }"
                        >
                            {{ statusWord[status(family.slug)] }}
                        </span>
                        <span class="min-w-0 flex-1" style="color: var(--ink-soft)">
                            {{ family.role }}
                        </span>
                    </li>
                </ul>
            </div>

            <div class="card overflow-hidden">
                <header class="border-b px-3.5 py-2.5" style="border-color: var(--border)">
                    <h2 class="text-sm font-semibold">Ingested — the scores rest on these</h2>
                </header>
                <ul class="divide-y" style="border-color: var(--border)">
                    <li v-for="source in datasets.ingested" :key="source.slug" class="px-3.5 py-2.5">
                        <p class="text-sm font-medium">
                            {{ source.name }}
                            <span class="font-normal" style="color: var(--ink-faint)">
                                · {{ source.provider }}
                            </span>
                        </p>
                        <p class="mt-0.5 text-xs leading-relaxed" style="color: var(--ink-soft)">
                            {{ source.usedFor }}
                        </p>
                        <p class="mt-0.5 text-[11px]" style="color: var(--ink-faint)">
                            <template v-if="source.product">{{ source.product }} · </template>
                            <template v-if="source.resolution">{{ source.resolution }} · </template>
                            <template v-if="source.temporalResolution">{{ source.temporalResolution }} · </template>
                            {{ source.licence }}
                        </p>
                        <p v-if="source.citation" class="mt-0.5 text-[11px] italic" style="color: var(--ink-faint)">
                            {{ source.citation }}
                        </p>
                        <a
                            v-if="source.url"
                            :href="source.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="mt-0.5 inline-block text-[11px] underline"
                            style="color: var(--info)"
                        >
                            {{ source.doi ?? source.url }}
                        </a>
                    </li>
                </ul>
            </div>

            <div class="card overflow-hidden">
                <header class="border-b px-3.5 py-2.5" style="border-color: var(--border)">
                    <h2 class="text-sm font-semibold">Registered, and carrying nothing</h2>
                    <p class="mt-0.5 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                        These have an endpoint, a DOI and a citation and no data in the database.
                        Their columns exist and are null for all
                        {{ meta?.counts.cells.toLocaleString('en-US') }} cells. The distinction
                        is here rather than in a footnote because nothing in this tool scores
                        against them.
                    </p>
                </header>
                <ul class="divide-y" style="border-color: var(--border)">
                    <li v-for="source in datasets.registered" :key="source.slug" class="px-3.5 py-2">
                        <p class="text-xs font-medium">
                            {{ source.name }}
                            <span class="font-normal" style="color: var(--ink-faint)">
                                · {{ source.resolution }}
                            </span>
                        </p>
                        <p class="text-[11px] leading-relaxed" style="color: var(--ink-soft)">
                            {{ source.usedFor }}
                        </p>
                    </li>
                </ul>
            </div>

            <p class="text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                NASA datasets are public domain. SoilGrids and ESA WorldCover are CC BY 4.0;
                OpenStreetMap is ODbL. NASA does not endorse this project, and this project is
                not a NASA product.
            </p>
        </section>

        <!-- Limits -->
        <section v-else class="space-y-4">
            <div>
                <h1 class="text-lg font-semibold tracking-tight">What this cannot know</h1>
                <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                    Written to be argued with rather than obeyed. If you read one section of this
                    tool, read this one.
                </p>
            </div>

            <div class="card divide-y" style="border-color: var(--border)">
                <article class="p-3.5">
                    <h2 class="text-sm font-semibold">The pixel is bigger than your field</h2>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        Every figure is one value for a 250 m square — 6.25 hectares, almost
                        certainly larger than your field and in the wrong place. Tracing your
                        outline fixes part of it: the plot is then scored from every cell it
                        touches, weighted by how much of each it covers, and where those cells
                        disagree the ranking says so instead of averaging it away. It does not fix
                        the fact that the smallest thing the data can see is still bigger than the
                        wet corner you already know about.
                    </p>
                </article>

                <article class="p-3.5">
                    <h2 class="text-sm font-semibold">It has no memory of this ground</h2>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        The rotation rules are general agronomy by plant family, published
                        generalities rather than this valley's disease history. A pathogen already
                        in your soil, or a pest your neighbours are fighting, is not in them. Nor
                        is the fact that continuous cropping has worked on your field for fifteen
                        years — if it has, that is evidence the model does not have, and it
                        outranks the model.
                    </p>
                </article>

                <article class="p-3.5">
                    <h2 class="text-sm font-semibold">Nothing here is about money</h2>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        There is no price or market data in this project, so no plan it offers has
                        been weighed against what you would be paid. A rotation that scores well
                        agronomically may still be the wrong one to sell, and the cost of giving a
                        season to a green manure is a judgement only you can make, because it
                        depends on what else the household has coming in that year.
                    </p>
                </article>

                <article class="p-3.5">
                    <h2 class="text-sm font-semibold">It is an order, not a calendar</h2>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        Every score behind a rotation is an annual figure, so the planner can say
                        what to plant after what and cannot say which month to plant in. That
                        comes from the rains and from your own seasons. Each season carries its
                        cycle length so you can lay the sequence against a real one.
                    </p>
                </article>

                <article class="p-3.5">
                    <h2 class="text-sm font-semibold">A projection is not a forecast</h2>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        The future scenarios come from a six-model CMIP6 ensemble, each model
                        differenced against its own 1995–2014 run, with the monthly change factors
                        applied day by day to the whole 45-year observed record so dry spells and
                        extremes are recounted rather than scaled. The models disagree more about
                        when than about direction. Treat a scenario as the rough size and
                        direction of a change, never as what a given year will do — and note that
                        wind is observed and carried into every scenario unchanged, because these
                        projections cover temperature and rainfall.
                    </p>
                </article>

                <article class="p-3.5">
                    <h2 class="text-sm font-semibold">Where it disagrees with you, you are probably right</h2>
                    <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                        You have stood on this ground in a wet year. The satellite has not.
                        Anywhere this tool quotes a cost or a design, take the figures to somebody
                        who can stand in the field before spending them.
                    </p>
                </article>
            </div>

            <div class="card p-3.5">
                <h2 class="text-sm font-semibold">How a score is actually built</h2>
                <ol class="mt-1.5 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed" style="color: var(--ink-soft)">
                    <li>
                        Each enterprise carries a requirement envelope per metric: an absolute
                        range outside which it fails, and an optimal range inside which it is
                        unconstrained. {{ meta?.counts.requirements }} envelopes across
                        {{ meta?.counts.enterprises }} enterprises.
                    </li>
                    <li>
                        One value scores 0 to 1 on a trapezoid over that envelope. A value with no
                        measurement behind it scores <em>null</em>, never zero — "we did not
                        measure this" and "this is lethal" are different claims.
                    </li>
                    <li>
                        Your priorities multiply the weight on the metrics they care about, so
                        caring about water genuinely changes which crop comes first.
                    </li>
                    <li>
                        The per-metric scores combine as a weighted <em>geometric</em> mean, then
                        get pulled a quarter of the way toward the weakest one. That is Liebig's
                        law of the minimum: one badly limiting factor drags the whole score down,
                        because a farmer cannot eat the average of good rainfall and impossible
                        soil.
                    </li>
                    <li>
                        The result lands in FAO classes S1 → S2 → S3 → N1 → N2 (FAO Soils Bulletin
                        32). A requirement marked make-or-break that fails outright forces the N
                        band regardless of the rest.
                    </li>
                    <li>
                        Coverage travels alongside: the share of the weighted requirements that
                        had data behind them. Without it, a cell missing its soil data would score
                        the same as one with genuinely good soil.
                    </li>
                </ol>
            </div>
        </section>
    </div>
</template>
