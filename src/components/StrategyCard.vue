<script setup lang="ts">
/**
 * One rotation strategy, answering the five questions the brief asks about
 * every strategy: why it was suggested, what evidence supports it, what it
 * may offer, where the information gaps are, and what needs local review.
 *
 * They are in that order and none of them is optional. A sequence of crop
 * names without them is an instruction to trust the tool, which is the one
 * thing a decision-support tool is not for. **Gaps and risks are open by
 * default** on the strategy being put forward, because a farmer who reads
 * only the recommendation should still have met its limits.
 */

import { computed, ref } from 'vue';
import { ChevronDown, Sprout, TriangleAlert } from '@lucide/vue';
import ClassBadge from './ClassBadge.vue';
import { num } from '@/lib/format';
import type { PlannedStrategy } from '@/engine/rotation/planner';
import type { ClassCode } from '@/engine/types';

const props = defineProps<{
    strategy: PlannedStrategy;
    /** The strategy everything is measured against, for the delta chips. */
    reference: PlannedStrategy | null;
}>();

const open = ref<Record<string, boolean>>({
    why: true,
    evidence: false,
    benefits: false,
    gaps: props.strategy.isRecommended,
    risks: props.strategy.isRecommended,
});

function toggle(key: string): void {
    open.value[key] = !open.value[key];
}

const sections = computed(() => [
    { key: 'why', label: 'Why this', count: 1 },
    { key: 'evidence', label: 'What it rests on', count: props.strategy.evidence.length },
    { key: 'benefits', label: 'What it may offer', count: props.strategy.benefits.length },
    { key: 'gaps', label: 'What we do not know', count: props.strategy.gaps.length },
    { key: 'risks', label: 'Needs a local eye', count: props.strategy.risks.length },
]);

/** Against the baseline, so the trade a strategy makes is on the card. */
const deltas = computed(() => {
    const reference = props.reference;

    if (reference === null || reference.key === props.strategy.key) {
        return [];
    }

    const a = props.strategy.scores;
    const b = reference.scores;

    const out: Array<{ label: string; text: string; good: boolean | null }> = [];

    const harvest = a.returnMean - b.returnMean;

    out.push({
        label: 'What comes off the field',
        text: `${harvest >= 0 ? '+' : ''}${harvest.toFixed(1)} points`,
        good: Math.abs(harvest) < 0.5 ? null : harvest > 0,
    });

    if (a.waterMmTotal !== null && b.waterMmTotal !== null) {
        const water = a.waterMmTotal - b.waterMmTotal;

        out.push({
            label: 'Water over the sequence',
            text: `${water >= 0 ? '+' : ''}${num(water)} mm`,
            good: Math.abs(water) < 2 ? null : water < 0,
        });
    }

    const soil = a.soilIndex - b.soilIndex;

    out.push({
        label: 'What it leaves the soil',
        text: `${soil >= 0 ? '+' : ''}${soil.toFixed(2)} of 1`,
        good: Math.abs(soil) < 0.02 ? null : soil > 0,
    });

    const pest = a.pestBreakIndex - b.pestBreakIndex;

    out.push({
        label: 'Pest-cycle break',
        text: `${pest >= 0 ? '+' : ''}${pest.toFixed(2)} of 1`,
        good: Math.abs(pest) < 0.02 ? null : pest > 0,
    });

    return out;
});

function deltaColour(good: boolean | null): string {
    if (good === null) return 'var(--ink-faint)';

    return good ? 'var(--accent)' : 'var(--warn)';
}

const severityColour: Record<string, string> = {
    severe: 'var(--danger)',
    high: 'var(--danger)',
    moderate: 'var(--warn)',
    slight: 'var(--ink-faint)',
};
</script>

<template>
    <article
        class="card flex flex-col overflow-hidden"
        :style="
            props.strategy.isRecommended
                ? 'border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset'
                : undefined
        "
    >
        <header class="border-b p-3.5" style="border-color: var(--border)">
            <div class="flex flex-wrap items-center gap-1.5">
                <h4 class="text-sm font-semibold">{{ props.strategy.label }}</h4>

                <span
                    v-if="props.strategy.isRecommended"
                    class="chip"
                    style="background: var(--accent); border-color: var(--accent); color: var(--accent-ink)"
                >
                    put forward
                </span>
                <span
                    v-if="props.strategy.isBaseline"
                    class="chip"
                    style="color: var(--ink-soft)"
                    title="What the field does if nothing changes. A baseline, never a recommendation."
                >
                    your rotation now
                </span>
                <span
                    v-if="!props.strategy.legal"
                    class="chip"
                    style="border-color: var(--danger); color: var(--danger)"
                >
                    breaks a rotation rule
                </span>
                <span
                    v-if="props.strategy.scores.coverSeasons > 0"
                    class="chip"
                    style="border-color: var(--warn); color: var(--warn)"
                >
                    <Sprout :size="11" />
                    {{ props.strategy.scores.coverSeasons }} season no harvest
                </span>
                <span v-if="props.strategy.sameAs" class="chip" style="color: var(--ink-faint)">
                    same order as another
                </span>
            </div>

            <p class="mt-1.5 text-xs leading-relaxed" style="color: var(--ink-soft)">
                {{ props.strategy.summary }}
            </p>
        </header>

        <!--
            The sequence. Four columns where there is room and four stacked
            rows on a phone: a farmer reading this on a handset should not be
            given four 60-pixel columns of broken words.
        -->
        <ol
            class="flex flex-col divide-y sm:flex-row sm:divide-x sm:divide-y-0"
            style="border-color: var(--border)"
        >
            <li
                v-for="slot in props.strategy.sequence"
                :key="slot.season"
                class="min-w-0 flex-1 p-2.5"
                :style="
                    slot.isCoverCrop
                        ? 'background: var(--warn-soft)'
                        : !slot.legal
                          ? 'background: var(--danger-soft)'
                          : undefined
                "
            >
                <p class="text-[10px] uppercase tracking-wide" style="color: var(--ink-faint)">
                    Season {{ slot.season }}
                </p>
                <p class="truncate text-xs font-medium" :title="slot.name">{{ slot.name }}</p>
                <p class="truncate text-[10px] italic" style="color: var(--ink-faint)">
                    {{ slot.family ?? 'no family recorded' }}
                </p>

                <div class="mt-1 flex flex-wrap items-center gap-1">
                    <ClassBadge :code="slot.classCode as ClassCode" />
                </div>

                <p class="mt-1 text-[10px] tnum" style="color: var(--ink-faint)">
                    <template v-if="slot.modifier !== 1">
                        order {{ slot.modifier > 1 ? '+' : '' }}{{ ((slot.modifier - 1) * 100).toFixed(0) }}%
                        → {{ slot.slotScore.toFixed(0) }}
                    </template>
                    <template v-else>no rule fires</template>
                </p>

                <p v-if="slot.cycleDays" class="text-[10px]" style="color: var(--ink-faint)">
                    {{ slot.cycleDays }} days
                </p>

                <!-- The rules that fired on this season, in the catalogue's words. -->
                <ul v-if="slot.effects.length > 0" class="mt-1.5 space-y-1">
                    <li
                        v-for="(effect, i) in slot.effects"
                        :key="i"
                        class="text-[10px] leading-snug"
                        :style="{
                            color:
                                effect.effect === 'forbidden'
                                    ? 'var(--danger)'
                                    : effect.effect === 'harmful'
                                      ? 'var(--warn)'
                                      : effect.effect === 'beneficial'
                                        ? 'var(--accent)'
                                        : 'var(--ink-faint)',
                        }"
                    >
                        <strong>{{ effect.effect }}</strong>
                        <template v-if="effect.family"> after {{ effect.family }}</template>
                        <template v-if="effect.reason">: {{ effect.reason }}</template>
                    </li>
                </ul>
            </li>
        </ol>

        <!-- The axes, against the baseline -->
        <div v-if="deltas.length > 0" class="grid gap-x-3 gap-y-1.5 border-t p-3 sm:grid-cols-2" style="border-color: var(--border)">
            <div v-for="delta in deltas" :key="delta.label" class="flex items-baseline justify-between gap-2 text-xs">
                <span style="color: var(--ink-soft)">{{ delta.label }}</span>
                <span class="tnum font-medium" :style="{ color: deltaColour(delta.good) }">
                    {{ delta.text }}
                </span>
            </div>
        </div>

        <div v-else class="grid gap-x-3 gap-y-1.5 border-t p-3 sm:grid-cols-2" style="border-color: var(--border)">
            <div class="flex items-baseline justify-between gap-2 text-xs">
                <span style="color: var(--ink-soft)">What comes off the field</span>
                <span class="tnum font-medium">{{ props.strategy.scores.returnMean.toFixed(1) }} / 100</span>
            </div>
            <div class="flex items-baseline justify-between gap-2 text-xs">
                <span style="color: var(--ink-soft)">What it leaves the soil</span>
                <span class="tnum font-medium">{{ props.strategy.scores.soilIndex.toFixed(2) }} of 1</span>
            </div>
            <div class="flex items-baseline justify-between gap-2 text-xs">
                <span style="color: var(--ink-soft)">Plant families</span>
                <span class="tnum font-medium">{{ props.strategy.scores.families }}</span>
            </div>
            <div class="flex items-baseline justify-between gap-2 text-xs">
                <span style="color: var(--ink-soft)">Water over the sequence</span>
                <span class="tnum font-medium">
                    {{ props.strategy.scores.waterMmTotal === null ? 'no data' : `${num(props.strategy.scores.waterMmTotal)} mm` }}
                </span>
            </div>
        </div>

        <!-- The five questions -->
        <div class="divide-y" style="border-color: var(--border)">
            <section v-for="section in sections" :key="section.key" class="border-t" style="border-color: var(--border)">
                <button
                    class="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left"
                    :aria-expanded="open[section.key]"
                    @click="toggle(section.key)"
                >
                    <span class="flex items-center gap-1.5 text-xs font-medium">
                        <TriangleAlert
                            v-if="section.key === 'risks'"
                            :size="12"
                            :style="{ color: 'var(--warn)' }"
                        />
                        {{ section.label }}
                        <span class="tnum" style="color: var(--ink-faint)">{{ section.count }}</span>
                    </span>
                    <ChevronDown
                        :size="14"
                        style="color: var(--ink-faint)"
                        :style="{ transform: open[section.key] ? 'rotate(180deg)' : 'none' }"
                    />
                </button>

                <div v-if="open[section.key]" class="px-3.5 pb-3 text-xs leading-relaxed">
                    <p v-if="section.key === 'why'" style="color: var(--ink-soft)">
                        {{ props.strategy.why }}
                    </p>

                    <ul v-else-if="section.key === 'evidence'" class="space-y-2">
                        <li v-for="(item, i) in props.strategy.evidence" :key="i">
                            <p class="font-medium">{{ item.label }}</p>
                            <p style="color: var(--ink-soft)">{{ item.detail }}</p>
                            <p v-if="item.dataset" class="mt-0.5 text-[11px]" style="color: var(--ink-faint)">
                                Source: {{ item.dataset }}
                            </p>
                        </li>
                    </ul>

                    <ul v-else-if="section.key === 'benefits'" class="space-y-2">
                        <li v-for="(item, i) in props.strategy.benefits" :key="i">
                            <p class="font-medium">{{ item.label }}</p>
                            <p style="color: var(--ink-soft)">{{ item.detail }}</p>
                        </li>
                    </ul>

                    <ul v-else-if="section.key === 'gaps'" class="space-y-1.5">
                        <li v-for="(gap, i) in props.strategy.gaps" :key="i" style="color: var(--ink-soft)">
                            {{ gap }}
                        </li>
                    </ul>

                    <ul v-else class="space-y-1.5">
                        <li v-for="(risk, i) in props.strategy.risks" :key="i">
                            <span
                                class="chip mr-1.5 align-middle"
                                :style="{ borderColor: severityColour[risk.severity], color: severityColour[risk.severity] }"
                            >
                                {{ risk.severity }}
                            </span>
                            <span style="color: var(--ink-soft)">{{ risk.message }}</span>
                        </li>
                    </ul>
                </div>
            </section>
        </div>
    </article>
</template>
