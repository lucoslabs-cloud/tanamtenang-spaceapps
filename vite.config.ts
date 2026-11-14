import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * A plain static build. No backend, no proxy, no server-rendered shell: the
 * whole point of this version is that `dist/` can be dropped on any host and
 * a judge can open it.
 *
 * `base: './'` so it also works from a subdirectory or straight off the file
 * system, which is the fallback when conference wifi has given up.
 */
export default defineConfig({
    base: './',
    plugins: [vue(), tailwind()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    build: {
        target: 'es2022',
        // MapLibre is most of the bundle and changes on its own schedule, so
        // it gets its own chunk: a redeploy of the app then leaves it in the
        // browser cache. Everything else is small enough that one chunk
        // loads faster than four.
        rollupOptions: {
            output: {
                manualChunks: {
                    maplibre: ['maplibre-gl'],
                },
            },
        },
        chunkSizeWarningLimit: 1200,
    },
    worker: {
        format: 'es',
    },
});
