<script setup lang="ts">
/**
 * When in the year the crop already on this field is uncomfortable.
 *
 * The suitability score answers *where*. This answers *when*, which an annual
 * figure cannot: hottest-month maximum is a MAX over twelve monthly normals,
 * so scoring one month's figure against the same envelope asks "is August too
 * hot for this crop" in the crop's own published terms, with nothing new
 * calibrated.
 *
 * It moves with the scenario, and that is the adaptation argument of the whole
 * project: a crop uncomfortable for two months now and five months in 2070 is
 * a farmer who needs to know before they plant a tree that stands for
 * twenty-five years. The baseline count travels alongside so the comparison is
 * on the panel rather than in the reader's memory.
 */

import { computed } from 'vue';
import { MONTH_SHORT, monthList } from '@/lib/format';
import { scenario, scenarioLabel, stress } from '@/store';

const data = computed(() => stress.value);

const W = 720;
const H = 120;
const PAD = { top: 10, right: 12, bottom: 24, left: 12 };

const bars = computed(() => {
    const current = data.value;

    if (current === null) {
        return [];
    }

    const step = (W - PAD.left - PAD.right) / 12;
    const height = H - PAD.top - PAD.bottom;

    return current.months.map((month, i) => {
        const pressure = month.pressure ?? 0;

        return {
            month: month.month,
            label: MONTH_SHORT[month.month - 1],
            x: PAD.left + step * i + step * 0.12,
            width: step * 0.76,
            y: PAD.top + height * (1 - pressure),
            height: Math.max(1, height * pressure),
            pressure: month.pressure,
            strained: month.strained,
            tightest: month.tightest,
        };
    });
});

const baseline = computed(() => data.value?.baseline ?? null);

const severityColour: Record<string, string> = {
    severe: 'var(--danger)',
    moderate: 'var(--warn)',
    slight: 'var(--info)',
};

function barColour(strained: boolean, severity: string | null | undefined): string {
    if (!strained) {
        return 'var(--border-strong)';
    }

    return severityColour[severity ?? 'slight'] ?? 'var(--warn)';
}
</script>

<template>
    <section v-if="data !== null" class="card p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-semibold">
                When {{ data.enterprise.name.toLowerCase() }} is under pressure
            </h3>
            <span class="text-xs" style="color: var(--ink-faint)">{{ scenarioLabel }}</span>
        </div>

        <p v-if="!data.seasonal" class="mt-2 text-xs leading-relaxed" style="color: var(--ink-soft)">
            Nothing in this crop's climate requirements moves enough across the year to call a
            season here. That is the finding — a flat chart would invite you to read a pattern
            into noise. Whatever limits it limits it all year, and the list below says what.
        </p>

        <template v-else>
            <p class="mt-1 text-xs leading-relaxed" style="color: var(--ink-soft)">
                <template v-if="data.strainedMonths.length === 0">
                    No month falls below the comfort threshold for this crop here.
                </template>
                <template v-else>
                    Uncomfortable in
                    <strong style="color: var(--ink)">
                        {{ data.strainedMonths.length }} of 12 months</strong>
                    — {{ monthList(data.strainedMonths) }}.
                </template>

                <template v-if="baseline !== null">
                    Today it is
                    {{ baseline.strainedMonths.length }} of 12, peaking at
                    {{ ((baseline.peakPressure ?? 0) * 100).toFixed(0) }} against
                    {{ ((data.peakPressure ?? 0) * 100).toFixed(0) }} here. The count can stop
                    moving once every month is already strained, so the peak is what to watch.
                </template>
            </p>

            <svg
                :viewBox="`0 0 ${W} ${H}`"
                class="mt-2 w-full"
                role="img"
                :aria-label="`Monthly pressure on ${data.enterprise.name}, ${scenarioLabel}`"
            >
                <line
                    :x1="PAD.left"
                    :x2="W - PAD.right"
                    :y1="H - PAD.bottom"
                    :y2="H - PAD.bottom"
                    stroke="var(--border)"
                />

                <g v-for="bar in bars" :key="bar.month">
                    <rect
                        :x="bar.x"
                        :y="bar.y"
                        :width="bar.width"
                        :height="bar.height"
                        :fill="barColour(bar.strained, bar.tightest?.severity)"
                        rx="2"
                    >
                        <title>
                            {{ bar.label }}:
                            {{ bar.pressure === null ? 'no data' : `pressure ${(bar.pressure * 100).toFixed(0)} of 100` }}{{
                                bar.tightest ? `, tightest is ${bar.tightest.label} at ${bar.tightest.value} ${bar.tightest.unit}` : ''
                            }}
                        </title>
                    </rect>
                    <text
                        :x="bar.x + bar.width / 2"
                        :y="H - PAD.bottom + 13"
                        text-anchor="middle"
                        font-size="10"
                        :fill="bar.strained ? 'var(--ink)' : 'var(--ink-faint)'"
                    >
                        {{ bar.label }}
                    </text>
                </g>
            </svg>

            <!-- What binds, month by month -->
            <ul class="mt-2 space-y-1 text-[11px]">
                <li
                    v-for="month in data.months.filter((m) => m.strained && m.tightest)"
                    :key="month.month"
                    style="color: var(--ink-soft)"
                >
                    <strong style="color: var(--ink)">{{ MONTH_SHORT[month.month - 1] }}</strong>
                    — {{ month.tightest!.label.toLowerCase() }} is
                    {{ month.tightest!.value }} {{ month.tightest!.unit }}
                    <template v-if="month.tightest!.direction">
                        ({{ month.tightest!.direction }} what it wants)</template>,
                    scoring {{ month.tightest!.score.toFixed(2) }}.
                </li>
            </ul>
        </template>

        <!-- Limits that are not seasons -->
        <div v-if="data.constant.length > 0" class="mt-3 border-t pt-2.5" style="border-color: var(--border)">
            <p class="text-[11px] font-medium">Flat all year</p>
            <p class="mt-0.5 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                These requirements score the same in every month. Some because the figure
                itself barely moves; some because it moves a long way and the crop's envelope
                does not notice. Either way they are not a season — they are already in the
                annual score and in the limiting factors.
            </p>
            <ul class="mt-1.5 space-y-0.5 text-[11px]" style="color: var(--ink-soft)">
                <li v-for="factor in data.constant" :key="factor.metric">
                    <strong style="color: var(--ink)">{{ factor.label }}</strong>
                    scores {{ factor.score.toFixed(2) }} every month
                    <template
                        v-if="
                            factor.valueMin !== undefined &&
                            factor.valueMax !== undefined &&
                            factor.valueMax - factor.valueMin > 0.05
                        "
                    >
                        while running from {{ factor.valueMin }} to {{ factor.valueMax }}
                        {{ factor.unit }} across the year.
                    </template>
                    <template v-else>
                        at {{ factor.value }} {{ factor.unit }}.
                    </template>
                </li>
            </ul>
        </div>

        <!-- What this panel cannot look at -->
        <div v-if="data.skipped.length > 0" class="mt-3 border-t pt-2.5" style="border-color: var(--border)">
            <p class="text-[11px] font-medium">Not checked month by month</p>
            <p class="mt-1 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                <template v-for="(item, i) in data.skipped" :key="item.label">
                    {{ item.label }} ({{ item.reason }}){{ i < data.skipped.length - 1 ? '; ' : '.' }}
                </template>
                An envelope over a yearly total describes the year, not a month — annual rainfall
                wants 1,500 to 3,000 mm, and scoring a 250 mm January against it would report
                lethal drought in the wettest district in Borneo, every month, for every crop.
            </p>
        </div>

        <p v-if="scenario !== 'baseline'" class="mt-3 text-[11px]" style="color: var(--ink-faint)">
            Monthly normals shifted by the CMIP6 change factors and recounted, not scaled.
        </p>
    </section>
</template>
