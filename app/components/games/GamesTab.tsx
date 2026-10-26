"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon, GamepadIcon } from "@/app/components/Icons";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import TetrisGame from "@/app/components/games/tetris/TetrisGame";

type GameId = "tetris";

type GameEntry = {
  id: GameId;
  title: string;
  subtitle: string;
};

const GAMES: GameEntry[] = [
  {
    id: "tetris",
    title: "Tetris",
    subtitle: "Classic stack-and-clear. Local high scores.",
  },
];

export default function GamesTab({ isActive }: { isActive: boolean }) {
  const [activeGame, setActiveGame] = useState<GameId | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!isActive) setActiveGame(null);
  }, [isActive]);

  useEffect(() => {
    if (!activeGame) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [activeGame]);

  const fullscreen =
    portalReady && activeGame === "tetris"
      ? createPortal(
          <div
            className={`fixed inset-0 z-[2200] bg-black ${DONT_SWIPE_TABS_CLASSNAME}`}
            style={{ width: "100vw", height: "100dvh" }}
            role="dialog"
            aria-modal="true"
            aria-label="Tetris"
          >
            <TetrisGame onExit={() => setActiveGame(null)} />
          </div>,
          document.body,
        )
      : null;

  return (
    <section className="border-b border-border px-3 pb-4 w-full">
      <p className="mt-3 mb-2 text-xs font-semibold text-muted">Games</p>
      <ul className="flex flex-col gap-2">
        {GAMES.map((game) => (
          <li key={game.id}>
            <button
              type="button"
              onClick={() => setActiveGame(game.id)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition hover:bg-bg"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg border border-border">
                <GamepadIcon className="h-5 w-5 text-foreground" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{game.title}</span>
                <span className="block text-xs text-muted">{game.subtitle}</span>
              </span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {fullscreen}
    </section>
  );
}
