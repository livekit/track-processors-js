import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/index.ts',
  output: {
    // dir: 'dist',
    file: 'dist/track-processor.js',
    format: 'umd',
    name: 'track_processor',
    sourcemap: true
  },
  plugins: [nodeResolve(), json(), typescript(), terser()]
};

