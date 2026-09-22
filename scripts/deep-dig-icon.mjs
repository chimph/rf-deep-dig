import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Embed the game's original pixel orb so both previews work at any hosting path.
export async function addDeepDigIcon(outdir) {
  const svg = await readFile(new URL('../games/deep-dig/favicon.svg', import.meta.url));
  const icon = `<link rel="icon" type="image/svg+xml" sizes="any" href="data:image/svg+xml;base64,${svg.toString('base64')}">`;
  const file = join(outdir, 'index.html');
  const html = await readFile(file, 'utf8');
  await writeFile(file, html.replace(/<link\b[^>]*rel="icon"[^>]*>/g, '').replace('</head>', `${icon}</head>`));
}
