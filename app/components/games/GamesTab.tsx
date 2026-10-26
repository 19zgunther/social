"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import TetrisGame from "@/app/components/games/tetris/TetrisGame";

type GameId = "tetris";

const TETRIS_BLOCKS = [
  { color: "#22d3ee", rotate: "0deg", x: 2, y: 10 },
  { color: "#facc15", rotate: "0deg", x: 14, y: 2 },
  { color: "#a855f7", rotate: "0deg", x: 26, y: 10 },
  { color: "#4ade80", rotate: "0deg", x: 10, y: 22 },
  { color: "#f87171", rotate: "0deg", x: 22, y: 22 },
] as const;

function TetrisRowIcon() {
  return (
    <span
      className="relative h-12 w-12 shrink-0 border-[3px] border-cyan-400 bg-[#0b1220] shadow-[3px_3px_0_#000]"
      aria-hidden
    >
      {TETRIS_BLOCKS.map((block, i) => (
        <span
          key={i}
          className="absolute h-2.5 w-2.5 border border-black/40"
          style={{
            background: block.color,
            left: block.x,
            top: block.y,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${block.color} 40%, white)`,
          }}
        />
      ))}
    </span>
  );
}

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
      <p className="tetris-pixel-font mt-3 mb-3 text-[0.65rem] text-muted">GAMES</p>
      <ul className="flex flex-col gap-3">
        <li>
          <button
            type="button"
            onClick={() => setActiveGame("tetris")}
            className="tetris-games-row group flex w-full items-center gap-3 px-3 py-3 text-left"
          >
            <TetrisRowIcon />
            <span className="min-w-0 flex-1">
              <span className="tetris-title-mark block text-[0.95rem] leading-tight">TETRIS</span>
              <span className="tetris-pixel-font mt-1.5 block text-[0.55rem] text-slate-400 group-hover:text-slate-300">
                Clear lines. Don&apos;t top out.
              </span>
            </span>
            <span className="tetris-pixel-font shrink-0 text-[0.7rem] text-cyan-300" aria-hidden>
              ▶
            </span>
          </button>
        </li>
      </ul>
      {fullscreen}
    </section>
  );
}
