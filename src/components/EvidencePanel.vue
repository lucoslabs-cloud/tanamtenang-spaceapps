<script setup lang="ts">
/**
 * Every number this tool holds about this field, with the dataset behind it.
 *
 * Grouped the way the ingest pipelines are, because that is also how the
 * evidence divides: the shape of the land, what the soil is made of, what the
 * weather does, how much water there is, and what already grows.
 *
 * A metric with no data says so, names the dataset that would have supplied
 * it, and says whether that dataset is registered-and-not-ingested or simply
 * unreachable from a browser. A table of layers with a role each is a claim
 * about what the scores rest on, and only the ingested ones are doing that
 * work.
 */

import { computed } from 'vue';
import { metricGroups, metricsInGroup } from '@/engine/vocabulary';
import { dataset, selection, site } from '@/store';
import { landCoverName, drainageName, textureName } from '@/engine/soil';
import { metricValue } from '@/lib/format';

const values = computed(() => site.value?.values ?? {});

const groups = computed(() =>
    metricGroups().map((group) => ({
        ...group,
        metrics: metricsInGroup(group.key).map((definition) => {
            const raw = values.value[definition.key] ?? null;

            return {
                ...definition,
                raw,
                /** Class codes mean nothing as a number; name them. */
                display:
                    definition.key === 'soil_texture_class'
                        ? (textureName(raw) ?? 'no data')
                        : definition.key === 'soil_drainage_class'
                          ? (drainageName(raw) ?? 'no data')
                          : definition.key === 'land_cover'
                            ? (landCoverName(raw) ?? 'no data')
                            : metricValue(definition.key, raw),
                source: dataset.value?.dataSource(definition.dataset) ?? null,
            };
        }),
    })),
);

const isLive = computed(() => selection.value.kind === 'live');
</script>

<template>
    <section class="space-y-3">
        <div>
            <h2 class="text-lg font-semibold tracking-tight">The evidence, layer by layer</h2>
            <p class="text-xs leading-relaxed" style="color: var(--ink-soft)">
                Everything the scores are built from, with the dataset behind each figure. Where a
                row says no data, nothing in this tool scores against it — that is a gap, not a
                zero, and the coverage figure beside each enterprise is how much of the model
                survived it.
            </p>
        </div>

        <div v-for="group in groups" :key="group.key" class="card overflow-hidden">
            <header class="border-b px-3.5 py-2.5" style="border-color: var(--border)">
                <h3 class="text-sm font-semibold" :style="{ color: group.color }">
                    {{ group.label }}
                </h3>
                <p class="mt-0.5 text-[11px] leading-relaxed" style="color: var(--ink-faint)">
                    {{ group.description }}
                </p>
            </header>

            <table class="w-full text-left text-xs">
                <tbody>
                    <tr
                        v-for="m in group.metrics"
                        :key="m.key"
                        class="border-t align-top"
                        style="border-color: var(--border)"
                    >
                        <th scope="row" class="w-2/5 px-3.5 py-2 font-medium">
                            {{ m.label }}
                            <span class="block font-normal leading-snug" style="color: var(--ink-faint)">
                                {{ m.describe }}
                            </span>
                        </th>
                        <td
                            class="px-2 py-2 tnum whitespace-nowrap"
                            :style="m.raw === null ? 'color: var(--ink-faint)' : undefined"
                        >
                            {{ m.display }}
                        </td>
                        <td class="px-3.5 py-2" style="color: var(--ink-faint)">
                            <template v-if="m.source">
                                {{ m.source.name }}
                                <span v-if="m.source.resolution"> · {{ m.source.resolution }}</span>
                                <span v-if="m.raw === null && m.source.lastIngestedAt === null">
                                    · registered, never ingested
                                </span>
                                <span v-else-if="m.raw === null && isLive">
                                    · not reachable from a browser
                                </span>
                            </template>
                            <template v-else>{{ m.dataset }}</template>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>
