<script setup lang="ts">
/**
 * What the farmer cares about, as an input to the model rather than a filter
 * on its output.
 *
 * Each priority scales the metrics it cares about: pushing *conserve water*
 * up multiplies the weight on driest-month rainfall, dry-spell length, the
 * water balance and available water capacity, and the geometric mean then
 * re-ranks every enterprise. It also decides which rotation strategy gets put
 * forward. So these are not cosmetic — moving one repaints the district, the
 * ranking and the plan.
 *
 * Turning everything up is the same as turning nothing up, because the
 * aggregation divides by the weight sum. That is a feature: a farmer cannot
 * break the model by caring about everything.
 *
 * **None of the six is about money, and this says so rather than leaving it
 * to be noticed.** There is no price or market data in this project, so
 * nothing it suggests has been weighed against what you would be paid, and a
 * slider built on that absence would be worse than its absence.
 */

import { computed } from 'vue';
import { dataset, priorities, setPreset } from '@/store';
import { metric } from '@/engine/vocabulary';

const definitions = computed(() => dataset.value?.meta.suitability.priorities ?? {});
const presets = computed(() => dataset.value?.meta.suitability.priorityPresets ?? {});

/** Which metrics a priority actually moves, so the slider is not a mystery. */
function movedBy(key: string): string {
    const multipliers = definitions.value[key]?.metric_multipliers ?? {};

    const labels = Object.entries(multipliers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([m]) => metric(m)?.label ?? m);

    return labels.join(', ');
}

function label(value: number): string {
    if (value >= 0.85) return 'top priority';
    if (value >= 0.6) return 'important';
    if (value >= 0.35) return 'matters some';
    if (value > 0) return 'barely';

    return 'ignore it';
}

const activePreset = computed(() => {
    for (const [key, preset] of Object.entries(presets.value)) {
        const same = Object.entries(preset.weights).every(
            ([name, weight]) => Math.abs((priorities[name] ?? 0) - weight) < 0.01,
        );

        if (same) {
            return key;
        }
    }

    return null;
});
</script>

<template>
    <section class="card p-4">
        <h3 class="text-sm font-semibold">What matters most to you?</h3>
        <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
            These change the answer, not the presentation. Move one and the district repaints,
            the ranking reorders and a different rotation strategy comes forward.
        </p>

        <div class="mt-3 flex flex-wrap gap-1.5">
            <button
                v-for="(preset, key) in presets"
                :key="key"
                class="chip"
                :title="preset.description"
                :style="
                    activePreset === key
                        ? 'background: var(--accent); border-color: var(--accent); color: var(--accent-ink)'
                        : 'color: var(--ink-soft)'
                "
                @click="setPreset(key)"
            >
                {{ preset.label }}
            </button>
        </div>

        <p v-if="activePreset" class="mt-2 text-xs" style="color: var(--ink-faint)">
            {{ presets[activePreset].description }}
        </p>

        <div class="mt-4 space-y-3.5">
            <div v-for="(definition, key) in definitions" :key="key">
                <div class="flex items-baseline justify-between gap-2">
                    <label :for="`p-${key}`" class="text-sm font-medium">
                        {{ definition.label }}
                    </label>
                    <span class="text-xs tnum" style="color: var(--ink-faint)">
                        {{ label(priorities[key] ?? 0) }}
                    </span>
                </div>

                <input
                    :id="`p-${key}`"
                    v-model.number="priorities[key]"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    class="mt-1 w-full"
                    :aria-describedby="`p-${key}-desc`"
                />

                <p :id="`p-${key}-desc`" class="text-xs leading-relaxed" style="color: var(--ink-soft)">
                    {{ definition.description }}
                </p>
                <p class="mt-0.5 text-[11px]" style="color: var(--ink-faint)">
                    Weights: {{ movedBy(key) }}
                </p>
            </div>
        </div>

        <p class="mt-4 border-t pt-3 text-xs leading-relaxed" style="border-color: var(--border); color: var(--ink-faint)">
            <strong style="color: var(--ink-soft)">None of these is about money.</strong>
            There is no price or market data in this project, so nothing it suggests has been
            weighed against what you would be paid. What each enterprise asks in labour and
            capital <em>is</em> known and is shown on its own panel without touching the score —
            how much work a crop is says nothing about whether this ground suits it.
        </p>
    </section>
</template>
