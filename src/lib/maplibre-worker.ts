/**
 * Tell MapLibre where its own worker went.
 *
 * MapLibre builds the worker's URL at runtime, as a sibling of itself:
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. A bundler cannot
 * see a string assembled like that, so Rollup never emits the file and the
 * production build asks for `assets/maplibre-gl-worker.mjs`, gets
 * `index.html` back, and fails strict MIME checking — which shows up as a
 * map that renders its own layers and no basemap tiles at all.
 *
 * `?url` makes Vite copy the file into the build and hand back its real
 * path, and `setWorkerUrl` is MapLibre's own supported way to say so. The
 * worker ships pre-bundled with no imports of its own, so copying it is
 * enough; it does not need re-bundling.
 *
 * Imported for its side effect before any map is constructed.
 */

import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);
