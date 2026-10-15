import { writeFile } from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

/**
 * Writes examples/e2e/public/subject.png, the fake camera's default subject.
 *
 *   pnpm bake:subject
 *
 * The figure is drawn with canvas 2D in Chrome, so the PNG is exactly what a browser renders.
 * thresholds.ts is calibrated against the committed PNG, so re-run the suite after a re-bake.
 */

const OUT = path.join(import.meta.dirname, '..', '..', 'examples', 'e2e', 'public', 'subject.png');

/**
 * The subject rect of the default 640x480 camera, at 2x.
 *
 * The figure's proportions follow the rect it is drawn into, and the camera stretches the PNG
 * into the subject rect of each frame size, so the default camera shows the figure unstretched.
 */
const SIZE = { width: 768, height: 883 };

/**
 * A head-and-shoulders figure drawn from primitives, so the harness needs no licensed photo.
 *
 * mediapipe's selfie segmenter is trained on real photographs, so mask quality against this is
 * lower than against a real subject — fine for geometry, liveness and pipeline assertions,
 * which is most of the suite.
 *
 * Runs in the page, not in Node: main() injects its source as a script.
 */
function drawProceduralSubject(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const cx = x + w / 2;
  const headR = w * 0.26;
  const headCy = y + headR * 1.15;
  const shoulderY = headCy + headR * 1.5;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = Math.max(2, w * 0.025);

  // Torso. A vertical gradient reads as lit clothing rather than a flat fill, which the
  // segmenter handles noticeably better than a single colour.
  const shirt = ctx.createLinearGradient(0, shoulderY, 0, y + h);
  shirt.addColorStop(0, '#4a5a78');
  shirt.addColorStop(1, '#2d3850');
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.52, y + h);
  ctx.quadraticCurveTo(cx - w * 0.5, shoulderY + h * 0.1, cx - w * 0.3, shoulderY);
  ctx.quadraticCurveTo(cx, shoulderY - h * 0.06, cx + w * 0.3, shoulderY);
  ctx.quadraticCurveTo(cx + w * 0.5, shoulderY + h * 0.1, cx + w * 0.52, y + h);
  ctx.closePath();
  ctx.fill();

  // Neck, shaded towards the jaw.
  const neck = ctx.createLinearGradient(0, headCy, 0, shoulderY);
  neck.addColorStop(0, '#a8764f');
  neck.addColorStop(1, '#c99a72');
  ctx.fillStyle = neck;
  ctx.fillRect(cx - headR * 0.34, headCy + headR * 0.5, headR * 0.68, headR * 1.1);

  // Head, lit from the upper left.
  const skin = ctx.createRadialGradient(
    cx - headR * 0.3,
    headCy - headR * 0.35,
    headR * 0.1,
    cx,
    headCy,
    headR * 1.25,
  );
  skin.addColorStop(0, '#f0c9a4');
  skin.addColorStop(0.6, '#d9a377');
  skin.addColorStop(1, '#a8764f');
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, headCy, headR * 0.84, headR, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath();
  ctx.ellipse(
    cx - headR * 0.84,
    headCy + headR * 0.05,
    headR * 0.13,
    headR * 0.22,
    0,
    0,
    Math.PI * 2,
  );
  ctx.ellipse(
    cx + headR * 0.84,
    headCy + headR * 0.05,
    headR * 0.13,
    headR * 0.22,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.shadowBlur = 0;

  // Hair
  ctx.fillStyle = '#3a2b23';
  ctx.beginPath();
  ctx.ellipse(cx, headCy - headR * 0.18, headR * 0.9, headR * 0.78, 0, Math.PI, 0);
  ctx.fill();

  // Eyes, brows and mouth. Interior facial detail is what most distinguishes a face from an
  // oval to the segmenter.
  ctx.fillStyle = '#ffffff';
  const eyeY = headCy - headR * 0.05;
  const eyeDx = headR * 0.33;
  const eyeRx = headR * 0.17;
  const eyeRy = headR * 0.1;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sign * eyeDx, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#2b2119';
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + sign * eyeDx, eyeY, eyeRy * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#3a2b23';
  ctx.lineWidth = Math.max(1, headR * 0.07);
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + sign * eyeDx, eyeY - headR * 0.22, eyeRx * 1.1, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  ctx.strokeStyle = '#8f5a44';
  ctx.lineWidth = Math.max(1, headR * 0.06);
  ctx.beginPath();
  ctx.arc(cx, headCy + headR * 0.28, headR * 0.3, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();

  // Nose
  ctx.strokeStyle = 'rgba(140, 92, 60, 0.7)';
  ctx.lineWidth = Math.max(1, headR * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + headR * 0.05);
  ctx.lineTo(cx - headR * 0.08, headCy + headR * 0.14);
  ctx.stroke();

  ctx.restore();
}

async function main() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: drawProceduralSubject.toString() });
    const dataUrl = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get a 2d context');
      // Drawn exactly to the rect, so the shoulders' ±0.52w and the shadow are clipped and the
      // PNG never paints outside the rect that subjectRect() reports as ground truth.
      drawProceduralSubject(ctx, 0, 0, width, height);
      return canvas.toDataURL('image/png');
    }, SIZE);
    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    await writeFile(OUT, png);
    console.log(`wrote ${path.relative(process.cwd(), OUT)} (${png.length} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
