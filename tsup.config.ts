import { Options } from 'tsup';

const defaultOptions: Options = {
  entry: ['src/index.ts'],
  format: ['cjs', 'esm', 'iife'],
  splitting: true,
  sourcemap: true,
  globalName: 'track_processor',
  minify: 'terser',
  // for the type maps to work, we use tsc's declaration-only command
  dts: false,
  clean: true,
  external: ['livekit-client'],
};
export default defaultOptions;
