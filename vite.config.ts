import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import dts from 'vite-plugin-dts';

export default defineConfig({
    plugins: [
        dts({
            entryRoot: 'src',
            include: ['src'],
            rollupTypes: true,
        }),
    ],
    build: {
        lib: {
            entry: fileURLToPath(new URL('src/index.ts', import.meta.url)),
            name: 'BpmnEditor',
            fileName: (format) => (format === 'es' ? 'bpmn-editor.js' : 'bpmn-editor.umd.cjs'),
            formats: ['es', 'umd'],
        },
        rollupOptions: {
            external: ['@maxgraph/core'],
            output: {
                globals: {
                    '@maxgraph/core': 'MaxGraph',
                },
            },
        },
        sourcemap: true,
    },
});
