<script setup lang="ts">
/**
 * Four strategies, side by side, with what each one costs and buys.
 *
 * This is the front door of the whole build, because it is what the brief
 * asks for in as many words: at least three rotation strategies, including
 * the one the farmer already runs. One plan is an instruction. Several plans
 * with their trades shown is a decision the farmer makes.
 *
 * The one put forward follows the priority sliders rather than the
 * arithmetic, and the panel says so. Nothing here is a ranking to obey.
 */

import { computed } from 'vue';
import { CircleHelp } from '@lucide/vue';
import StrategyCard from './StrategyCard.vue';
import { dataset, growing, growingSlug, rotation } from '@/store';
import { isRotatable } from '@/engine/rotation/planner';

const plan = computed(() => rotation.value);

const reference = computed(() => {
    const current = plan.value;

    if (current === null || current.comparedAgainst === null) {
        return null;
    }

    return current.strategies.find((s) => s.key === current.comparedAgainst) ?? null;
});

/** Crops a farmer could say is in the ground now: the rotatable ones. */
const standing = computed(() => {
    const data = dataset.value;

    if (data === null) {
        return [];
    }

    return data.catalogue.enterprises
        .filter((e) => !e.isCoverCrop)
        .sort((a, b) => {
            const rotatableDiff = Number(isRotatable(b)) - Number(isRotatable(a));

            return rotatableDiff !== 0 ? rotatableDiff : a.sortOrder - b.sortOrder;
        });
});

const noteColour: Record<string, string> = {
    severe: 'var(--danger)',
    moderate: 'var(--warn)',
    slight: 'var(--ink-faint)',
};
</script>

<template>
    <section class="space-y-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
            <div>
                <h2 class="text-lg font-semibold tracking-tight">
                    What to plant, and in what order
                </h2>
                <p class="text-xs" style="color: var(--ink-soft)">
                    Four strategies over the next
                    {{ plan?.horizonSeasons ?? 4 }} seasons, each searching the same space of
                    legal sequences and differing only in what it is trying to do.
                </p>
            </div>
        </div>

        <!-- What is in the ground now: the baseline depends on it -->
        <div class="card flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
            <label for="growing" class="text-sm font-medium">What is on this field now?</label>
            <select
                id="growing"
                v-model="growingSlug"
                class="rounded-md border px-2 py-1 text-sm"
                style="border-color: var(--border); background: var(--surface-raised); color: var(--ink)"
            >
                <option :value="null">Nothing / I would rather not say</option>
                <option v-for="e in standing" :key="e.slug" :value="e.slug">
                    {{ e.name }}{{ e.localName ? ` — ${e.localName}` : '' }}
                </option>
            </select>

            <p class="text-xs" style="color: var(--ink-faint)">
                <CircleHelp :size="12" class="inline align-text-top" />
                This is what the first rotation rule applies to, and it is the only way the
                comparison can include the rotation you already run.
            </p>
        </div>

        <!-- Not the right question on this field -->
        <div v-if="plan !== null && !plan.possible" class="card p-4">
            <p class="text-sm font-medium">A rotation is not the question here.</p>
            <p class="mt-1.5 text-sm leading-relaxed" style="color: var(--ink-soft)">
                {{ plan.reason }}
            </p>
        </div>

        <template v-else-if="plan !== null">
            <!-- Why this one -->
            <div
                v-if="plan.recommendedBecause"
                class="card p-3 text-xs leading-relaxed"
                style="border-color: var(--accent); color: var(--ink-soft)"
            >
                <strong style="color: var(--ink)">
                    {{ plan.strategies.find((s) => s.isRecommended)?.label }}
                </strong>
                — {{ plan.recommendedBecause }}
                <template v-if="reference">
                    Everything is measured against
                    <strong style="color: var(--ink)">{{ reference.label.toLowerCase() }}</strong>.
                </template>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
                <StrategyCard
                    v-for="strategy in plan.strategies"
                    :key="strategy.key"
                    :strategy="strategy"
                    :reference="reference"
                />
            </div>

            <ul v-if="plan.notes.length > 0" class="space-y-1.5">
                <li
                    v-for="(note, i) in plan.notes"
                    :key="i"
                    class="text-xs leading-relaxed"
                    :style="{ color: noteColour[note.severity] ?? 'var(--ink-faint)' }"
                >
                    {{ note.message }}
                </li>
            </ul>

            <p class="text-xs leading-relaxed" style="color: var(--ink-faint)">
                The search is exhaustive rather than greedy, which is the only way a legume can
                earn a place: its value is not in its own season but in the nitrogen it leaves
                for the season behind it, and a planner that picks the best crop each season in
                turn can never see that. Eight candidates over
                {{ plan.horizonSeasons }} seasons is 4,096 sequences, walked once per strategy.
                <template v-if="growing === null">
                    Say what is in the ground and a fifth row appears: your own rotation,
                    scored with the rules applied in full.
                </template>
            </p>
        </template>
    </section>
</template>
