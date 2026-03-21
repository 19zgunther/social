import type { MessageData, PoolBallState, PoolGameMessageData, ThreadMessage } from "@/app/types/interfaces";

/** Portrait phone layout: narrow width, long height (y grows downward — cue at bottom). */
export const DEFAULT_TABLE_W = 2;
export const DEFAULT_TABLE_H = 4;
export const DEFAULT_BALL_R = 0.07;

export function getPoolGameFromMessageData(data: MessageData | null | undefined): PoolGameMessageData | null {
  if (!data || typeof data !== "object" || !data.pool_game) {
    return null;
  }
  const g = data.pool_game;
  if (g.v !== 1 || typeof g.game_id !== "string" || !Array.isArray(g.balls)) {
    return null;
  }
  const pg = g as PoolGameMessageData;
  const playerB =
    pg.player_b_username === undefined || pg.player_b_username === "" ? null : pg.player_b_username;
  const currentTurn =
    pg.current_turn_username === undefined || pg.current_turn_username === ""
      ? null
      : pg.current_turn_username;
  return { ...pg, player_b_username: playerB, current_turn_username: currentTurn };
}

/**
 * Portrait triangle: cue at bottom (high y). Lead row (one ball) closest to cue; further rows toward top (−y).
 */
function rackBalls(tableW: number, tableH: number, r: number): PoolBallState[] {
  const d = 2 * r * 1.02;
  const rowDy = (d * Math.sqrt(3)) / 2;
  const centerX = tableW / 2;
  const leadY = tableH * 0.44;
  const balls: PoolBallState[] = [];
  let nextId = 1;
  for (let row = 0; row < 5; row += 1) {
    const y = leadY - row * rowDy;
    for (let j = 0; j <= row; j += 1) {
      const x = centerX + (j - row / 2) * d;
      balls.push({
        id: nextId,
        x,
        y,
        vx: 0,
        vy: 0,
        r,
        pocketed: false,
      });
      nextId += 1;
    }
  }
  balls.unshift({
    id: 0,
    x: tableW / 2,
    y: tableH * 0.78,
    vx: 0,
    vy: 0,
    r,
    pocketed: false,
  });
  return balls;
}

export function createInitialPoolGame(params: {
  gameId: string;
  playerAUsername: string;
  startingUsername: string;
}): PoolGameMessageData {
  return {
    v: 1,
    game_id: params.gameId,
    player_a_username: params.playerAUsername,
    player_b_username: null,
    current_turn_username: params.startingUsername,
    table_w: DEFAULT_TABLE_W,
    table_h: DEFAULT_TABLE_H,
    balls: rackBalls(DEFAULT_TABLE_W, DEFAULT_TABLE_H, DEFAULT_BALL_R),
  };
}

/** Whose shot it is (creator, first responder while seat open, or locked player B). */
export function isPoolTurnForUser(game: PoolGameMessageData, username: string): boolean {
  if (game.current_turn_username !== null) {
    return game.current_turn_username === username;
  }
  if (game.player_b_username === null) {
    return username !== game.player_a_username;
  }
  return username === game.player_b_username;
}

/**
 * When opening the table as the first non-creator after the break, claim the B seat locally
 * so physics/flipTurn see two players (server gets player_b on send).
 */
export function withSecondPlayerClaimed(game: PoolGameMessageData, username: string): PoolGameMessageData {
  if (game.player_b_username !== null || username === game.player_a_username) {
    return game;
  }
  return { ...game, player_b_username: username };
}

export function flipTurn(game: PoolGameMessageData): string | null {
  if (game.current_turn_username === null) {
    if (game.player_b_username === null) {
      return null;
    }
    return game.player_a_username;
  }
  if (game.player_b_username === null) {
    return null;
  }
  return game.current_turn_username === game.player_a_username
    ? game.player_b_username
    : game.player_a_username;
}

/** Latest pool message per game_id (by message order in array = chronological from API). */
export function latestPoolMessagesByGameId(
  messages: ThreadMessage[],
): Map<string, { message: ThreadMessage; game: PoolGameMessageData }> {
  const map = new Map<string, { message: ThreadMessage; game: PoolGameMessageData }>();
  for (const message of messages) {
    const game = getPoolGameFromMessageData(message.data);
    if (game) {
      map.set(game.game_id, { message, game });
    }
  }
  return map;
}

export function respawnCueBallInKitchen(balls: PoolBallState[], tableW: number, tableH: number): void {
  const cue = balls.find((b) => b.id === 0);
  if (!cue) {
    return;
  }
  cue.pocketed = false;
  cue.x = tableW / 2;
  cue.y = tableH * 0.78;
  cue.vx = 0;
  cue.vy = 0;
}
