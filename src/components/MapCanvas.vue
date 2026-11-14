<script setup lang="ts">
/**
 * The district, as one image.
 *
 * The platform serves this layer as vector tiles out of PostGIS, with
 * zoom-dependent aggregation so an overview tile ships 12 KB instead of
 * 68,000 polygons. Here the grid is already in the browser, so there are no
 * tiles: the worker scores every cell into an RGBA buffer the shape of the
 * lattice and the map puts it up as a single image source. One pass, no
 * network, and the whole district repaints while a slider moves.
 *
 * `raster-resampling: nearest` on purpose. Each pixel is a 250 m analysis
 * cell and 6.25 hectares of ground; smoothing it into its neighbours would
 * draw a precision the data does not have.
 */

import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
    GeolocateControl,
    Map as MapLibreMap,
    NavigationControl,
    ScaleControl,
    type GeoJSONSource,
    type ImageSource,
    type LngLatLike,
    type MapMouseEvent,
    type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@/lib/maplibre-worker';
import { dataset, selection, selectionCentre, theme } from '@/store';
import { lastResult } from '@/lib/painter';

const props = defineProps<{
    /** Click behaviour: pick a cell, or trace a plot outline. */
    mode: 'pick' | 'draw';
}>();

const emit = defineEmits<{
    pick: [lon: number, lat: number, inside: boolean];
    drawn: [ring: Array<[number, number]>];
}>();

const container = ref<HTMLDivElement | null>(null);
const map = shallowRef<MapLibreMap | null>(null);
const draft = ref<Array<[number, number]>>([]);
const loaded = ref(false);

const EMPTY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

function basemapStyle(): StyleSpecification {
    const dark = theme.value === 'dark';

    return {
        version: 8,
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 19,
                attribution:
                    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            },
        },
        layers: [
            {
                id: 'background',
                type: 'background',
                paint: { 'background-color': dark ? '#0a0c09' : '#f2f0ea' },
            },
            {
                id: 'osm',
                type: 'raster',
                source: 'osm',
                paint: {
                    // The basemap is context, not the subject. Dimmed and
                    // desaturated in both themes so the scored layer over it
                    // is what the eye lands on.
                    'raster-opacity': dark ? 0.38 : 0.62,
                    'raster-saturation': -0.6,
                    'raster-brightness-min': dark ? 0 : 0.1,
                    'raster-brightness-max': dark ? 0.6 : 1,
                },
            },
        ],
    };
}

function addLayers(instance: MapLibreMap): void {
    const data = dataset.value;

    if (data === null) {
        return;
    }

    const grid = data.meta.grid;

    // The image's four corners, clockwise from the north-west, which is the
    // order MapLibre wants and the order the raster is written in.
    instance.addSource('scores', {
        type: 'image',
        url: EMPTY_PNG,
        coordinates: [
            [grid.west, grid.north],
            [grid.east, grid.north],
            [grid.east, grid.south],
            [grid.west, grid.south],
        ],
    });

    instance.addLayer({
        id: 'scores',
        type: 'raster',
        source: 'scores',
        paint: {
            'raster-opacity': 1,
            'raster-resampling': 'nearest',
            'raster-fade-duration': 0,
        },
    });

    instance.addSource('boundary', {
        type: 'geojson',
        data: { type: 'Feature', geometry: data.boundary, properties: {} },
    });

    instance.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: {
            'line-color': theme.value === 'dark' ? '#eef1ec' : '#1b1d19',
            'line-width': 1.4,
            'line-opacity': 0.55,
        },
    });

    instance.addSource('selection', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
    });

    instance.addLayer({
        id: 'selection-fill',
        type: 'fill',
        source: 'selection',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.12 },
    });

    instance.addLayer({
        id: 'selection-line',
        type: 'line',
        source: 'selection',
        paint: {
            'line-color': theme.value === 'dark' ? '#ffffff' : '#111111',
            'line-width': 2.2,
        },
    });

    instance.addLayer({
        id: 'selection-point',
        type: 'circle',
        source: 'selection',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
            'circle-radius': 4,
            'circle-color': theme.value === 'dark' ? '#ffffff' : '#111111',
            'circle-stroke-width': 2,
            'circle-stroke-color': theme.value === 'dark' ? '#10130f' : '#ffffff',
        },
    });

    loaded.value = true;
    drawSelection();
    pushImage();
}

onMounted(() => {
    const data = dataset.value;

    if (container.value === null || data === null) {
        return;
    }

    const instance = new MapLibreMap({
        container: container.value,
        style: basemapStyle(),
        bounds: [
            [data.meta.region.bbox[0], data.meta.region.bbox[1]],
            [data.meta.region.bbox[2], data.meta.region.bbox[3]],
        ],
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        // The grid is 250 m; past about zoom 15 the map would promise a
        // precision the data cannot keep.
        maxZoom: 15,
        minZoom: 6,
    });

    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    instance.addControl(
        new GeolocateControl({ trackUserLocation: false }),
        'top-right',
    );

    instance.on('load', () => addLayers(instance));

    instance.on('click', (event: MapMouseEvent) => {
        const { lng, lat } = event.lngLat;

        if (props.mode === 'draw') {
            draft.value = [...draft.value, [lng, lat]];
            drawDraft();

            return;
        }

        const inside = dataset.value?.grid.indexAt(lng, lat) ?? -1;
        emit('pick', lng, lat, inside >= 0 && (dataset.value?.grid.isInside(inside) ?? false));
    });

    instance.on('dblclick', (event: MapMouseEvent) => {
        if (props.mode !== 'draw' || draft.value.length < 3) {
            return;
        }

        event.preventDefault();
        finishDraft();
    });

    map.value = instance;
});

onBeforeUnmount(() => {
    map.value?.remove();
    map.value = null;
});

/* ----------------------------------------------------------- the painting -- */

function pushImage(): void {
    const instance = map.value;
    const result = lastResult.value;

    if (instance === null || result === null || !loaded.value) {
        return;
    }

    const source = instance.getSource('scores');

    if (source === undefined || !('updateImage' in source)) {
        return;
    }

    const image = new ImageData(
        new Uint8ClampedArray(result.pixels),
        result.width,
        result.height,
    );

    (source as ImageSource).updateImage({ image });
}

watch(lastResult, pushImage);

/* --------------------------------------------------------- the selection -- */

function drawSelection(): void {
    const instance = map.value;
    const data = dataset.value;

    if (instance === null || data === null || !loaded.value) {
        return;
    }

    const source = instance.getSource('selection');

    if (source === undefined || !('setData' in source)) {
        return;
    }

    const features: GeoJSON.Feature[] = [];
    const current = selection.value;

    if (current.kind === 'cell') {
        features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [data.grid.ringOf(current.index)] },
        });
    } else if (current.kind === 'plot') {
        features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [current.ring] },
        });
    } else if (current.kind === 'live') {
        features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [current.lon, current.lat] },
        });
    }

    (source as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features,
    });
}

function drawDraft(): void {
    const instance = map.value;
    const source = instance?.getSource('selection');

    if (instance === null || source === undefined || !('setData' in source)) {
        return;
    }

    const points = draft.value;

    (source as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [
            ...(points.length >= 2
                ? [
                      {
                          type: 'Feature' as const,
                          properties: {},
                          geometry: { type: 'LineString' as const, coordinates: points },
                      },
                  ]
                : []),
            ...points.map((point) => ({
                type: 'Feature' as const,
                properties: {},
                geometry: { type: 'Point' as const, coordinates: point },
            })),
        ],
    });
}

function finishDraft(): void {
    const points = draft.value;

    if (points.length < 3) {
        return;
    }

    const ring: Array<[number, number]> = [...points, points[0]];
    draft.value = [];
    emit('drawn', ring);
}

function undoPoint(): void {
    draft.value = draft.value.slice(0, -1);
    drawDraft();
}

watch(selection, () => {
    drawSelection();

    const centre = selectionCentre.value;

    if (centre !== null && map.value !== null) {
        const zoom = map.value.getZoom();

        map.value.easeTo({
            center: centre as LngLatLike,
            zoom: Math.max(zoom, 11),
            duration: 500,
        });
    }
});

watch(theme, () => {
    const instance = map.value;

    if (instance === null) {
        return;
    }

    loaded.value = false;
    instance.setStyle(basemapStyle());
    instance.once('styledata', () => addLayers(instance));
});

defineExpose({ finishDraft, undoPoint, draft });
</script>

<template>
    <div class="relative h-full w-full">
        <div ref="container" class="h-full w-full" />

        <!-- Drawing a plot -->
        <div
            v-if="props.mode === 'draw'"
            class="pointer-events-auto absolute left-2 top-2 max-w-xs rounded-lg border p-2.5 text-xs shadow-lg"
            style="border-color: var(--border); background: var(--surface-raised)"
        >
            <p class="font-medium">Trace your field</p>
            <p class="mt-1 leading-relaxed" style="color: var(--ink-soft)">
                Tap each corner, then double-tap to close it.
                {{ draft.length }} corner{{ draft.length === 1 ? '' : 's' }} so far.
            </p>
            <p class="mt-1 leading-relaxed" style="color: var(--ink-faint)">
                A field is almost always smaller than one 250 m cell and never aligned to it, so
                an outline is scored from every cell it touches, weighted by how much of each it
                covers.
            </p>
            <div class="mt-2 flex gap-1.5">
                <button class="btn px-2 py-1 text-xs" :disabled="draft.length === 0" @click="undoPoint">
                    Undo
                </button>
                <button
                    class="btn btn-primary px-2 py-1 text-xs"
                    :disabled="draft.length < 3"
                    @click="finishDraft"
                >
                    Done
                </button>
            </div>
        </div>
    </div>
</template>
