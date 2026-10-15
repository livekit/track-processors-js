import fs from 'fs';
import path, { resolve } from 'path';
import { defineConfig } from 'vite';

/**
 * The mediapipe fileset, as it ships inside the dependency the library itself pins.
 *
 * Nothing is copied and nothing is committed: `@mediapipe/tasks-vision` carries `wasm/` in the
 * published tarball, so the dev server streams it straight out of `node_modules` and the local
 * copy can never drift from the version `BackgroundTransformer` asks the CDN for.
 */
const WASM_DIR = path.resolve(__dirname, '../../node_modules/@mediapipe/tasks-vision/wasm');

/**
 * The segmentation model does not ship with the package and has no npm home — the library's
 * default `modelAssetPath` is a bare storage.googleapis.com URL — so the only way to serve it
 * locally is to keep a copy. It is fetched once into `node_modules/.cache` rather than
 * committed: 244 KB of third-party binary in a library repo for the sake of one harness is a
 * poor trade, and the harness already refuses to commit media for the same reason
 * (examples/e2e/README.md). After the first fetch the whole asset path is offline.
 */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const MODEL_CACHE = path.resolve(__dirname, '../../node_modules/.cache/mediapipe');
const MODEL_FILE = path.join(MODEL_CACHE, 'selfie_segmenter.tflite');

const CONTENT_TYPES = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
};

/** One download per server, however many requests race for it. */
let modelDownload;

function ensureModel() {
  if (fs.existsSync(MODEL_FILE)) return Promise.resolve(MODEL_FILE);
  modelDownload ??= (async () => {
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`${MODEL_URL} responded ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(MODEL_CACHE, { recursive: true });
    // Written beside the target and renamed: a half-written model would otherwise be served
    // forever, and a truncated tflite fails inside mediapipe with nothing pointing back here.
    const partial = `${MODEL_FILE}.${process.pid}.part`;
    fs.writeFileSync(partial, body);
    fs.renameSync(partial, MODEL_FILE);
    return MODEL_FILE;
  })();
  return modelDownload;
}

function sendFile(res, file) {
  const body = fs.readFileSync(file);
  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream');
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

/**
 * Serves the mediapipe assets under `/mediapipe`, which is where `?assets=local` points
 * `assetPaths`.
 *
 * A page load otherwise fetches ~9 MB of wasm from jsdelivr plus the model from
 * storage.googleapis.com. That dominates per-test cost and puts a network dependency in a suite
 * that is otherwise hermetic (e2e/AGENTS.md, "Known slow spot"), and it is the whole subject of
 * `I2`: with both CDNs blocked at the route level, this is the only thing left that can answer.
 */
function mediapipeAssets() {
  return {
    name: 'e2e-mediapipe-assets',
    configureServer(server) {
      // Registered in `configureServer` directly rather than from its returned hook, so it runs
      // before vite's own static handling — which would 404 these paths, since they are under
      // neither the vite root nor `public/`.
      server.middlewares.use('/mediapipe', (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];

        if (pathname === '/selfie_segmenter.tflite') {
          ensureModel().then(
            (file) => sendFile(res, file),
            (err) => {
              res.statusCode = 502;
              res.end(`could not fetch the segmentation model: ${err.message}`);
            },
          );
          return;
        }

        if (pathname.startsWith('/wasm/')) {
          const file = path.join(WASM_DIR, path.basename(pathname));
          // `basename` already defeats traversal; the check is what makes that explicit rather
          // than incidental.
          if (file.startsWith(WASM_DIR) && fs.existsSync(file)) {
            sendFile(res, file);
            return;
          }
          res.statusCode = 404;
          res.end(`no such mediapipe asset: ${pathname} (looked in ${WASM_DIR})`);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [mediapipeAssets()],
  server: {
    // E2E_PORT lets a second checkout serve the harness without colliding with this one.
    port: Number(process.env.E2E_PORT) || 8081,
    // The test runner starts this server itself; opening a browser on every run would be
    // noise. `pnpm dev:e2e` passes --open explicitly.
    open: false,
    // Both apps import from ../../src, which is outside the vite root.
    fs: { strict: false },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
