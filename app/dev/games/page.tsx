"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import Pool from "@/app/components/games/Pool";
import { createInitialPoolGame } from "@/app/components/games/poolGameUtils";
import type { PoolGameMessageData } from "@/app/types/interfaces";

const DEV_USER = "dev";

function newDevPoolGame(): PoolGameMessageData {
  return createInitialPoolGame({
    gameId: `dev-${Date.now()}`,
    playerAUsername: DEV_USER,
    playerBUsername: DEV_USER,
    startingUsername: DEV_USER,
  });
}

export default function DevGamesPage() {
  const [screen, setScreen] = useState<"menu" | "pool">("menu");
  const [poolGame, setPoolGame] = useState<PoolGameMessageData | null>(null);

  const openPool = useCallback(() => {
    setPoolGame(newDevPoolGame());
    setScreen("pool");
  }, []);

  const resetPoolRack = useCallback(() => {
    setPoolGame(newDevPoolGame());
  }, []);

  if (screen === "pool" && poolGame) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-primary-background text-foreground">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-accent-1 bg-secondary-background px-3 py-2">
          <Link href="/" className="text-xs font-medium text-accent-2 underline-offset-2 hover:text-foreground hover:underline">
            Home
          </Link>
          <p className="truncate text-center text-xs text-accent-2">/dev/games — local only</p>
          <button
            type="button"
            onClick={resetPoolRack}
            className="shrink-0 rounded-lg border border-accent-1 px-2 py-1 text-xs font-semibold text-foreground hover:border-accent-2"
          >
            Reset rack
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <Pool
            game={poolGame}
            currentUsername={DEV_USER}
            exitAfterTurn={false}
            backLabel="Games"
            onBack={() => {
              setScreen("menu");
              setPoolGame(null);
            }}
            onTurnComplete={async (next) => {
              setPoolGame(next);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 bg-primary-background px-4 py-8 text-foreground">
      <header>
        <h1 className="text-lg font-semibold">Games (dev)</h1>
        <p className="mt-1 text-sm text-accent-2">
          Run games outside threads. Nothing here hits the API; state stays in this tab.
        </p>
      </header>

      <ul className="space-y-2">
        <li>
          <button
            type="button"
            onClick={openPool}
            className="w-full rounded-xl border border-accent-1 bg-secondary-background px-4 py-4 text-left transition hover:border-accent-2"
          >
            <span className="block font-medium">Pool</span>
            <span className="mt-0.5 block text-xs text-accent-2">
              Turn-based table; shots stay on the table until you use Back or Reset rack.
            </span>
          </button>
        </li>
      </ul>

      <Link
        href="/"
        className="text-center text-sm text-accent-2 underline-offset-2 hover:text-foreground hover:underline"
      >
        Back to app
      </Link>
    </div>
  );
}
