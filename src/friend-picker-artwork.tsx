"use client";

import { useEffect, useRef, useState } from "react";
import { spriteFrame, type createGenerationSpriteReader } from "./generation-sprites.js";

/** Artwork is presentation only; the host freshly verifies a selection before play. */
export function FriendPickerArtwork({ friendId, reader }: {
  friendId: bigint; reader: ReturnType<typeof createGenerationSpriteReader>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    void reader.read(friendId).then(sprites => {
      if (!alive) return;
      const context = canvas.current?.getContext("2d");
      if (!context) { setStatus("error"); return; }
      const rows = spriteFrame(sprites, "down", false, 0).frame.rows;
      const pixels = rows.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === "#" ? [[x, y]] : []));
      context.clearRect(0, 0, 64, 64); context.imageSmoothingEnabled = false;
      // Exact black mask and clipped one-pixel white halo at integer 4× scale.
      context.fillStyle = "#fff";
      for (const [x, y] of pixels) context.fillRect(x * 4 - 4, y * 4 - 4, 12, 12);
      context.fillStyle = "#000";
      for (const [x, y] of pixels) context.fillRect(x * 4, y * 4, 4, 4);
      setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [friendId, reader]);
  return <span className="rf-friend-artwork" data-artwork-status={status}>
    <canvas ref={canvas} width={64} height={64} aria-hidden="true" hidden={status !== "ready"} />
    {status !== "ready" && <small>{status === "loading" ? "Loading art…" : "Artwork unavailable"}</small>}
  </span>;
}
