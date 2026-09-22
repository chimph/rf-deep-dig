"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createFrameGameClient } from "./frame-bridge.js";
import { decodeGenerationSprites, type GenerationSprites } from "./generation-sprites.js";
import type { ChanceGameDefinition, GameClient } from "./game.js";

export type GameComponentProps = Readonly<{ friendId: bigint; client: GameClient; paused: boolean; soundMuted?: boolean; setSoundMuted?: (muted: boolean) => void; friendArtwork?: GenerationSprites; openFriendSelector?: () => void }>;

/** Game-side bridge. The runtime supplies one verified Friend and a fixed action client. */
export function GameSession({ definition, children }: {
  definition: ChanceGameDefinition; children: (props: GameComponentProps) => ReactNode;
}) {
  const [session, setSession] = useState<Omit<GameComponentProps, "paused"> | null>(null);
  const [paused, setPaused] = useState(false);
  const [documentId] = useState(() => crypto.getRandomValues(new Uint32Array(4)).join("-"));
  useEffect(() => {
    let connection: ReturnType<typeof createFrameGameClient> | undefined;
    const handshakeId = crypto.getRandomValues(new Uint32Array(4)).join("-");
    const ready = () => window.parent.postMessage({ type: "friendsdk:ready", documentId, handshakeId }, "*");
    const unloading = () => window.parent.postMessage({ type: "friendsdk:unloading", documentId, handshakeId }, "*");
    function receive(event: MessageEvent) {
      if (event.source !== window.parent) return;
      if (event.data?.type === "friendsdk:connect") { ready(); return; }
      if (connection || event.data?.type !== "friendsdk:init" ||
        event.data.documentId !== documentId || event.data.handshakeId !== handshakeId ||
        typeof event.data.friendId !== "bigint" || event.data.friendId < 1n || event.ports.length !== 1) return;
      connection = createFrameGameClient(event.ports[0], definition, setPaused, event.data.mode === "chain" ? "chain" : "preview");
      let friendArtwork: GenerationSprites | undefined;
      const artwork = event.data.friendArtwork;
      // Rebuild canonical clips from validated raw frames, bound to this selection.
      if (artwork?.tokenId === event.data.friendId && Array.isArray(artwork.frames)) {
        try { friendArtwork = decodeGenerationSprites(event.data.friendId, artwork.familyId, artwork.seed, artwork.frames); }
        catch { /* Invalid optional presentation data uses the game's existing fallback. */ }
      }
      setSession({ soundMuted: event.data.soundMuted === true, setSoundMuted: connection.setSoundMuted, friendArtwork, friendId: event.data.friendId, client: connection.client, openFriendSelector: connection.openFriendSelector });
    }
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", unloading);
    ready();
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("pagehide", unloading);
      window.parent.postMessage({ type: "friendsdk:reset", documentId, handshakeId }, "*");
      connection?.close(); setSession(null);
    };
  }, [definition, documentId]);
  return session ? children({ ...session, paused }) : <p role="status">Waiting for your Friend…</p>;
}
