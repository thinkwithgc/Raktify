#!/usr/bin/env node
/**
 * Render the OG preview SVG to a PNG at 1200×630.
 *
 * WhatsApp, Facebook, LinkedIn and iMessage scrape <meta property="og:image">
 * and expect a PNG / JPG (SVG support is patchy). We author the source as SVG
 * (so it stays editable in any vector tool / a text editor) and rasterise
 * it to PNG at the standard 1200×630 OG dimensions during the build.
 *
 * Usage:
 *   node scripts/build_og_image.js
 *
 * Output:
 *   frontend/public/og-image.png   ← committed; Vite copies it to dist/
 */
const fs = require('fs');
const path = require('path');

(async () => {
  // npm workspaces hoist common deps to the root node_modules. Try the root
  // first, then the workspace folder as a fallback.
  let sharp;
  try {
    sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
  } catch {
    sharp = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'sharp'));
  }

  const svgPath = path.join(__dirname, '..', 'frontend', 'public', 'og-image.svg');
  const pngPath = path.join(__dirname, '..', 'frontend', 'public', 'og-image.png');

  const svg = fs.readFileSync(svgPath);

  await sharp(svg, { density: 200 })
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(pngPath);

  const { size } = fs.statSync(pngPath);
  // eslint-disable-next-line no-console
  console.log(`✓ wrote ${pngPath} (${(size / 1024).toFixed(1)} KiB)`);
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('OG image build failed:', err.message);
  process.exit(1);
});
