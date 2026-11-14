<script setup lang="ts">
/**
 * Every requirement behind one score, with its envelope and its provenance.
 *
 * This is where the tool stops being an oracle. A farmer or an agronomist who
 * disagrees with a score can see which metric moved it, what the published
 * range is, what this ground measured, and which dataset the measurement came
 * from — so the argument is with the source rather than with the output.
 *
 * A requirement with no data behind it is printed as such and never as a
 * zero. The two are different claims and only one of them is ours to make.
 */

import { computed } from 'vue';
import { envelope, metricValue } from '@/lib/format';
import { dataset } from '@/store';
import { metric, metricGroup } from '@/engine/vocabulary';
import type { FactorScore } from '@/engine/types';

const props = defineProps<{ factors: FactorScore[] }>();

const sorted = computed(() =>
    [...props.factors].sort((a, b) => {
        const aScore = a.score ?? 2;
        const bScore = b.score ?? 2;

        return aScore - bScore;
    }),
);

function sourceName(slug: string): string {
    return dataset.value?.dataSource(slug)?.name ?? slug;
}

function bar(score: number | null): { width: string; colour: string } {
    if (score === null) {
        return { width: '100%', colour: 'var(--border-strong)' };
    }

    return {
        width: `${Math.max(2, score * 100)}%`,
        colour:
            score < 0.35
                ? 'var(--danger)'
                : score < 0.6
                  ? 'var(--warn)'
                  : score < 0.8
                    ? 'var(--info)'
                    : 'var(--accent)',
    };
}
</script>

<template>
    <div>
        <table class="w-full text-left text-[11px]">
            <caption class="sr-only">
                Every requirement behind this score, worst first
            </caption>
            <thead>
                <tr style="color: var(--ink-faint)">
                    <th scope="col" class="pb-1 font-normal">Requirement</th>
                    <th scope="col" class="pb-1 font-normal">Here</th>
                    <th scope="col" class="pb-1 font-normal">Wants</th>
                    <th scope="col" class="pb-1 text-right font-normal">Score</th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="factor in sorted"
                    :key="factor.metric"
                    class="border-t align-top"
                    style="border-color: var(--border)"
                >
                    <td class="py-1.5 pr-2">
                        <span class="font-medium" :title="metric(factor.metric)?.describe">
                            {{ factor.label }}
                        </span>
                        <span
                            v-if="factor.isCritical"
                            class="ml-1 chip"
                            style="border-color: var(--danger); color: var(--danger)"
                            title="Make or break: outside its absolute range this enterprise cannot run here"
                        >
                            make or break
                        </span>
                        <span class="block" style="color: var(--ink-faint)">
                            {{ metricGroup(metric(factor.metric)?.group ?? 'climate')?.label }}
                            · {{ sourceName(factor.dataset) }}
                        </span>
                    </td>

                    <td class="py-1.5 pr-2 tnum" :style="factor.value === null ? 'color: var(--ink-faint)' : undefined">
                        {{ metricValue(factor.metric, factor.value) }}
                        <span v-if="factor.direction" :style="{ color: 'var(--warn)' }">
                            ({{ factor.direction }})
                        </span>
                    </td>

                    <td class="py-1.5 pr-2" style="color: var(--ink-soft)">
                        {{
                            envelope(
                                factor.absMin,
                                factor.optMin,
                                factor.optMax,
                                factor.absMax,
                                factor.unit,
                            ) || 'no bound given'
                        }}
                    </td>

                    <td class="w-20 py-1.5 text-right">
                        <span class="tnum">
                            {{ factor.score === null ? 'no data' : factor.score.toFixed(2) }}
                        </span>
                        <span
                            class="mt-0.5 block h-1 w-full overflow-hidden rounded-full"
                            style="background: var(--surface-sunken)"
                        >
                            <span
                                class="block h-full rounded-full"
                                :style="{ width: bar(factor.score).width, background: bar(factor.score).colour }"
                            />
                        </span>
                    </td>
                </tr>
            </tbody>
        </table>

        <p class="mt-2 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
            Scores combine as a weighted <em>geometric</em> mean, pulled a quarter of the way
            toward the weakest one. That is Liebig's law of the minimum: a farmer cannot eat the
            average of good rainfall and impossible soil, so one badly limiting factor drags the
            whole score down instead of being hidden by four good ones. A requirement with no
            data is left out of the mean and counted against the coverage figure.
        </p>
    </div>
</template>
