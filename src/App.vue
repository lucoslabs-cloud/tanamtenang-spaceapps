<script setup lang="ts">
/**
 * The shell: a header, four views, and a line at the bottom nobody should be
 * able to miss.
 *
 * The loading screen is not decoration. It is 1.8 MB of grid arriving before
 * anything can be scored, and a farmer on a phone deserves to be told what is
 * happening rather than shown a spinner. It also says where the numbers come
 * from, because that is the first question anybody sensible asks.
 */

import { computed, ref } from 'vue';
import { Moon, Sun } from '@lucide/vue';
import {
    dataset,
    hasField,
    loadError,
    progress,
    setTheme,
    theme,
    view,
    type View,
} from './store';
import StartView from './views/StartView.vue';
import FieldView from './views/FieldView.vue';
import MapView from './views/MapView.vue';
import LearnView from './views/LearnView.vue';
import ScenarioPicker from './components/ScenarioPicker.vue';

const ready = computed(() => dataset.value !== null);
const showCaveat = ref(false);

const tabs = computed<Array<{ key: View; label: string; enabled: boolean }>>(() => [
    { key: 'start', label: 'Start', enabled: true },
    { key: 'field', label: 'Your field', enabled: hasField.value },
    { key: 'map', label: 'The district', enabled: true },
    { key: 'learn', label: 'What this means', enabled: true },
]);

function reload(): void {
    globalThis.location.reload();
}

const pct = computed(() =>
    progress.value.total === 0 ? 0 : Math.round((progress.value.loaded / progress.value.total) * 100),
);
</script>

<template>
    <div class="flex h-full flex-col">
        <!-- Loading -->
        <div v-if="!ready && loadError === null" class="flex flex-1 items-center justify-center p-6">
            <div class="w-full max-w-md text-center">
                <p class="text-2xl font-semibold tracking-tight">TanamTenang</p>
                <p class="mt-1 text-sm italic" style="color: var(--ink-soft)">plant calmly</p>

                <div
                    class="mt-6 h-1.5 w-full overflow-hidden rounded-full"
                    style="background: var(--surface-sunken)"
                    role="progressbar"
                    :aria-valuenow="pct"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="progress.label"
                >
                    <div
                        class="h-full rounded-full transition-all"
                        style="background: var(--accent)"
                        :style="{ width: `${pct}%` }"
                    />
                </div>

                <p class="mt-3 text-sm" style="color: var(--ink-soft)">
                    {{ progress.label }}
                </p>

                <p class="mt-6 text-xs leading-relaxed" style="color: var(--ink-faint)">
                    Loading 67,855 analysis cells of the Sri Aman district — NASA SRTM
                    terrain, NASA POWER climate, MODIS land cover and ISRIC SoilGrids,
                    with CMIP6 projections to 2070. Everything is scored in your browser;
                    nothing you enter is sent anywhere.
                </p>
            </div>
        </div>

        <!-- Failed to load -->
        <div v-else-if="loadError !== null" class="flex flex-1 items-center justify-center p-6">
            <div class="card max-w-md p-5">
                <p class="font-semibold">The data did not load.</p>
                <p class="mt-2 text-sm" style="color: var(--ink-soft)">{{ loadError }}</p>
                <p class="mt-3 text-xs" style="color: var(--ink-faint)">
                    This build reads its own files from <code>data/</code> beside the page. If
                    you are serving it from a file path rather than a web server, the browser
                    will refuse those reads.
                </p>
                <button class="btn mt-4" @click="reload">Try again</button>
            </div>
        </div>

        <template v-else>
            <header
                class="sticky top-0 z-20 border-b"
                style="border-color: var(--border); background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(8px)"
            >
                <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                    <div class="flex items-baseline gap-2">
                        <span class="text-base font-semibold tracking-tight">TanamTenang</span>
                        <span class="hidden text-xs italic sm:inline" style="color: var(--ink-faint)">
                            plant calmly
                        </span>
                    </div>

                    <nav class="flex flex-wrap items-center gap-1" aria-label="Sections">
                        <button
                            v-for="tab in tabs"
                            :key="tab.key"
                            class="rounded-md px-2.5 py-1 text-sm font-medium transition-colors"
                            :disabled="!tab.enabled"
                            :aria-current="view === tab.key ? 'page' : undefined"
                            :style="
                                view === tab.key
                                    ? 'background: var(--accent-soft); color: var(--accent)'
                                    : tab.enabled
                                      ? 'color: var(--ink-soft)'
                                      : 'color: var(--ink-faint); cursor: not-allowed'
                            "
                            @click="tab.enabled && (view = tab.key)"
                        >
                            {{ tab.label }}
                        </button>
                    </nav>

                    <div class="ml-auto flex items-center gap-2">
                        <ScenarioPicker compact />
                        <button
                            class="rounded-md p-1.5"
                            style="color: var(--ink-soft)"
                            :aria-label="theme === 'dark' ? 'Use the light theme' : 'Use the dark theme'"
                            @click="setTheme(theme === 'dark' ? 'light' : 'dark')"
                        >
                            <Sun v-if="theme === 'dark'" :size="16" />
                            <Moon v-else :size="16" />
                        </button>
                    </div>
                </div>
            </header>

            <main class="flex-1 overflow-y-auto">
                <StartView v-if="view === 'start'" />
                <FieldView v-else-if="view === 'field'" />
                <MapView v-else-if="view === 'map'" />
                <LearnView v-else />
            </main>

            <!--
                Never a dismissable banner and never a modal nobody reads.
                The first sentence is always on screen; on a phone the rest
                is one tap away rather than half the viewport.
            -->
            <footer class="border-t px-4 py-2.5" style="border-color: var(--border)">
                <p class="mx-auto max-w-6xl text-xs leading-relaxed" style="color: var(--ink-faint)">
                    <strong style="color: var(--ink-soft)">This tool supports your judgement; it
                    does not replace it.</strong>
                    <span :class="showCaveat ? '' : 'hidden sm:inline'">
                        Every analysis cell is 6.25 hectares, which is almost certainly larger
                        than your field and in the wrong place. Nothing here knows your soil's
                        history, your labour, your market or your water rights. Take anything it
                        suggests to an agricultural extension officer or an agronomist who has
                        stood in this district before you commit seed or money to it — and where
                        it disagrees with you about your own ground, you are probably right.
                    </span>
                    <button
                        class="ml-1 underline sm:hidden"
                        style="color: var(--ink-soft)"
                        :aria-expanded="showCaveat"
                        @click="showCaveat = !showCaveat"
                    >
                        {{ showCaveat ? 'Less' : 'Why' }}
                    </button>
                </p>
            </footer>
        </template>
    </div>
</template>
