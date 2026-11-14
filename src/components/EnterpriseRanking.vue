<script setup lang="ts">
/**
 * Everything the catalogue holds, scored for this field and sorted into the
 * three answers a farmer can act on: what suits it now, what would suit it
 * after work, and what is not worth trying.
 *
 * **A farm is not only crops.** Oil palm, paddy, kangkung, tilapia and a goat
 * herd all pass through the same engine with the same shape of envelope,
 * because weather hits fish and livestock hardest and they are usually left
 * out of a tool like this. A heat wave strips dissolved oxygen out of a pond;
 * a drought turns pond top-up into a cost you cannot avoid.
 *
 * Cover crops are scored with the rest and listed apart from them. Nobody is
 * deciding between sunn hemp and chilli — a green manure surfaces inside a
 * rotation, not in a list of things to grow for sale.
 */

import { computed, ref } from 'vue';
import { ChevronDown } from '@lucide/vue';
import ClassBadge from './ClassBadge.vue';
import FactorList from './FactorList.vue';
import { choosable, coverCrops, dataset, selection } from '@/store';
import { metric } from '@/engine/vocabulary';
import { percent } from '@/lib/format';
import type { RankingRow } from '@/engine/ranking';

const expanded = ref<string | null>(null);

const groups = computed(() => [
    {
        key: 'now',
        title: 'Suits this ground now',
        note: 'FAO classes S1 to S3. S3 is marginal — viable with careful management and slim in a bad year.',
        rows: choosable.value.filter((r) => r.classCode.startsWith('S')),
    },
    {
        key: 'work',
        title: 'Possible, after work',
        note:
            'Fails something today, but on a limitation investment can fix — drainage, lime, ' +
            'bunding, water storage. The platform build sizes that work; this one names it.',
        rows: choosable.value.filter((r) => r.classCode === 'N1'),
    },
    {
        key: 'no',
        title: 'Not worth trying here',
        note:
            'Fails on something nobody can change: open water, built-up ground, peat too deep ' +
            'for the crop. That is an honest "look elsewhere" rather than a work order.',
        rows: choosable.value.filter((r) => r.classCode === 'N2'),
    },
]);

const isPlot = computed(() => selection.value.kind === 'plot');

function limitingLabels(row: RankingRow): string {
    return row.limiting.map((key) => metric(key)?.label ?? key).join(', ');
}

function enterpriseOf(slug: string) {
    return dataset.value?.enterprise(slug);
}

function categoryLabel(key: string): string {
    return dataset.value?.catalogue.categories.find((c) => c.value === key)?.label ?? key;
}
</script>

<template>
    <section class="space-y-3">
        <div>
            <h2 class="text-lg font-semibold tracking-tight">What this ground will carry</h2>
            <p class="text-xs" style="color: var(--ink-soft)">
                {{ choosable.length }} enterprises scored — crops, fish and livestock through one
                engine. Click one to see which requirement decided it and what the envelope says.
            </p>
        </div>

        <div v-for="group in groups" :key="group.key" class="card overflow-hidden">
            <header class="border-b px-3.5 py-2.5" style="border-color: var(--border)">
                <h3 class="text-sm font-semibold">
                    {{ group.title }}
                    <span class="tnum font-normal" style="color: var(--ink-faint)">
                        {{ group.rows.length }}
                    </span>
                </h3>
                <p class="mt-0.5 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                    {{ group.note }}
                </p>
            </header>

            <p v-if="group.rows.length === 0" class="px-3.5 py-3 text-xs" style="color: var(--ink-faint)">
                Nothing in this group.
            </p>

            <ul v-else class="divide-y" style="border-color: var(--border)">
                <li v-for="row in group.rows" :key="row.slug">
                    <button
                        class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-left"
                        :aria-expanded="expanded === row.slug"
                        @click="expanded = expanded === row.slug ? null : row.slug"
                    >
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium">
                                {{ row.name }}
                                <span v-if="row.localName" class="font-normal italic" style="color: var(--ink-faint)">
                                    · {{ row.localName }}
                                </span>
                            </span>
                            <span class="block truncate text-[11px]" style="color: var(--ink-faint)">
                                {{ categoryLabel(row.category) }}
                                <template v-if="row.limiting.length > 0">
                                    · held back by {{ limitingLabels(row) }}
                                </template>
                            </span>
                        </span>

                        <ClassBadge :code="row.classCode" :score="row.score" size="md" />

                        <span
                            v-if="row.coverage < 0.95"
                            class="chip"
                            style="border-color: var(--warn); color: var(--warn)"
                            title="Share of the weighted requirements that had data behind them"
                        >
                            judged on {{ percent(row.coverage) }}
                        </span>

                        <span
                            v-if="isPlot && !row.uniform"
                            class="chip"
                            style="color: var(--ink-soft)"
                            :title="`Best ${row.bestClass}, worst ${row.worstClass} across the cells your field covers`"
                        >
                            mixed: {{ row.bestClass }}–{{ row.worstClass }}
                        </span>

                        <ChevronDown
                            :size="14"
                            style="color: var(--ink-faint)"
                            :style="{ transform: expanded === row.slug ? 'rotate(180deg)' : 'none' }"
                        />
                    </button>

                    <div v-if="expanded === row.slug" class="border-t px-3.5 py-3" style="border-color: var(--border)">
                        <p v-if="enterpriseOf(row.slug)?.farmerNote" class="text-xs leading-relaxed" style="color: var(--ink-soft)">
                            {{ enterpriseOf(row.slug)?.farmerNote }}
                        </p>

                        <dl v-if="isPlot" class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                            <div>
                                <dt class="inline" style="color: var(--ink-faint)">Suitable over</dt>
                                <dd class="ml-1 inline font-medium tnum">{{ percent(row.suitableShare) }} of the field</dd>
                            </div>
                            <div v-if="row.failingShare > 0">
                                <dt class="inline" style="color: var(--ink-faint)">Fails outright on</dt>
                                <dd class="ml-1 inline font-medium tnum" style="color: var(--danger)">
                                    {{ percent(row.failingShare) }}
                                </dd>
                            </div>
                        </dl>

                        <FactorList
                            v-if="row.assessment"
                            class="mt-3"
                            :factors="row.assessment.factors"
                        />

                        <!-- Labour and capital, beside the score and never in it. -->
                        <p
                            v-if="enterpriseOf(row.slug)?.labourIntensity || enterpriseOf(row.slug)?.capitalIntensity"
                            class="mt-3 text-[11px] leading-relaxed"
                            style="color: var(--ink-faint)"
                        >
                            Labour {{ enterpriseOf(row.slug)?.labourIntensity ?? '?' }}/5, capital
                            up front {{ enterpriseOf(row.slug)?.capitalIntensity ?? '?' }}/5. Neither
                            touches the score — how much work a crop is says nothing about whether
                            this ground suits it.
                        </p>
                    </div>
                </li>
            </ul>
        </div>

        <!-- Cover crops, apart -->
        <div v-if="coverCrops.length > 0" class="card p-3.5">
            <h3 class="text-sm font-semibold">Green manures</h3>
            <p class="mt-0.5 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                Scored like everything else and listed apart, because nobody is choosing between
                sunn hemp and chilli. These earn nothing, so one only earns a season inside a
                rotation where what it builds is worth the harvest it costs.
            </p>

            <ul class="mt-2 space-y-1.5">
                <li v-for="row in coverCrops" :key="row.slug" class="flex items-center gap-2 text-sm">
                    <span class="flex-1 truncate">{{ row.name }}</span>
                    <ClassBadge :code="row.classCode" :score="row.score" />
                </li>
            </ul>
        </div>
    </section>
</template>
