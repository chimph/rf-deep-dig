import { spriteFrame, type GenerationSprites } from '@rarefriends/friendsdk/sprites';

/** Exact canonical black mask + clipped white one-pixel halo, at integer 2× scale. */
export function drawFriend(ctx: CanvasRenderingContext2D, sprites: GenerationSprites) {
  ctx.clearRect(0, 0, 32, 32); ctx.imageSmoothingEnabled = false;
  // Present one canonical face, independent of movement direction.
  const rows = spriteFrame(sprites, 'down', false, 0).frame.rows;
  const pixels = rows.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '#' ? [[x, y]] : []));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 32, 32); ctx.clip();
  ctx.fillStyle = '#fff'; for (const [x, y] of pixels) ctx.fillRect(x * 2 - 2, y * 2 - 2, 6, 6);
  ctx.fillStyle = '#000'; for (const [x, y] of pixels) ctx.fillRect(x * 2, y * 2, 2, 2);
  ctx.restore();
}
