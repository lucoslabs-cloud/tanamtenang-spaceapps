<script setup lang="ts">
/**
 * An FAO suitability class, said three ways at once.
 *
 * Colour never carries the meaning alone: the code and a plain word are
 * always printed beside it, so the class survives greyscale, print,
 * forced-colors and the commonest colour vision deficiencies.
 */

import { computed } from 'vue';
import { classInfo } from '@/engine/vocabulary';
import { theme } from '@/store';
import type { ClassCode } from '@/engine/types';

const props = defineProps<{
    code: ClassCode;
    score?: number | null;
    size?: 'sm' | 'md';
}>();

const info = computed(() => classInfo(props.code));
const colour = computed(() =>
    theme.value === 'dark' ? (info.value?.color_dark ?? '#888') : (info.value?.color ?? '#888'),
);
</script>

<template>
    <span
        class="chip"
        :class="props.size === 'md' ? 'px-2 py-0.5 text-xs' : ''"
        :style="{ borderColor: colour, color: 'var(--ink)' }"
        :title="info?.description"
    >
        <span
            class="inline-block rounded-sm"
            :style="{ background: colour, width: '0.55rem', height: '0.55rem' }"
            aria-hidden="true"
        />
        <strong class="tnum">{{ props.code }}</strong>
        <span style="color: var(--ink-soft)">{{ info?.short_label }}</span>
        <span v-if="props.score !== undefined && props.score !== null" class="tnum" style="color: var(--ink-faint)">
            · {{ props.score.toFixed(0) }}
        </span>
    </span>
</template>
