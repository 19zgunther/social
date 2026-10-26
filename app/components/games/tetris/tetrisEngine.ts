export const BOARD_COLS = 10;
export const BOARD_ROWS = 20;
export const HIDDEN_ROWS = 2;
export const TOTAL_ROWS = BOARD_ROWS + HIDDEN_ROWS;
export const NEXT_COUNT = 3;
/** Lines cleared per level-up (score multiplier / HUD only — gravity is per-line). */
export const LINES_PER_LEVEL = 10;
const BASE_GRAVITY_MS = 720;
const MIN_GRAVITY_MS = 45;
/** Each cleared line multiplies gravity interval by this (2% faster). */
const GRAVITY_PER_LINE = 0.98;
export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;

export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export type Cell = PieceType | null;

export type ActivePiece = {
  type: PieceType;
  rotation: number;
  x: number;
  y: number;
};

export type GamePhase = "playing" | "clearing" | "gameover";

export type TetrisSnapshot = {
  board: Cell[][];
  active: ActivePiece | null;
  ghostY: number;
  hold: PieceType | null;
  canHold: boolean;
  next: PieceType[];
  score: number;
  level: number;
  lines: number;
  phase: GamePhase;
  clearingRows: number[];
  clearFlashMs: number;
};

const PIECE_TYPES: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];

/** Shapes as [y][x] offsets for rotation 0..3 (SRS-ish). */
const SHAPES: Record<PieceType, number[][][]> = {
  I: [
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 1], [1, 1], [2, 1], [3, 1]],
  ],
  O: [
    [[0, 1], [0, 2], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [1, 2]],
  ],
  T: [
    [[0, 1], [1, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 1]],
    [[0, 1], [1, 0], [1, 1], [2, 1]],
  ],
  S: [
    [[0, 1], [0, 2], [1, 0], [1, 1]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 1], [1, 2], [2, 0], [2, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
  ],
  Z: [
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 2], [1, 1], [1, 2], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
  ],
  J: [
    [[0, 0], [1, 0], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 0], [2, 1]],
  ],
  L: [
    [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [1, 2], [2, 0]],
    [[0, 0], [0, 1], [1, 1], [2, 1]],
  ],
};

const WALL_KICKS: [number, number][] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-2, 0],
  [2, 0],
  [-1, -1],
  [1, -1],
  [0, -2],
];

const LINE_SCORES = [0, 100, 300, 500, 800];
/** Full white↔black cycle length while clearing rows. */
export const CLEAR_FLASH_PERIOD_MS = 300;
/** How many full flash cycles before rows disappear. */
export const CLEAR_FLASH_CYCLES = 3;
export const CLEAR_FLASH_MS = CLEAR_FLASH_PERIOD_MS * CLEAR_FLASH_CYCLES;

function emptyBoard(): Cell[][] {
  return Array.from({ length: TOTAL_ROWS }, () => Array.from({ length: BOARD_COLS }, () => null));
}

function shuffleBag(): PieceType[] {
  const bag = [...PIECE_TYPES];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = bag[i]!;
    bag[i] = bag[j]!;
    bag[j] = tmp;
  }
  return bag;
}

function cellsFor(piece: ActivePiece): [number, number][] {
  const shape = SHAPES[piece.type][piece.rotation % 4]!;
  return shape.map(([dy, dx]) => [piece.y + dy, piece.x + dx]);
}

function collides(board: Cell[][], piece: ActivePiece): boolean {
  for (const [y, x] of cellsFor(piece)) {
    if (x < 0 || x >= BOARD_COLS || y < 0 || y >= TOTAL_ROWS) return true;
    if (board[y]![x]) return true;
  }
  return false;
}

function spawnPiece(type: PieceType): ActivePiece {
  return {
    type,
    rotation: 0,
    x: type === "O" ? 4 : 3,
    y: 0,
  };
}

/** Gravity interval (ms): 2% faster for every line cleared, floored for playability. */
function gravityMsForLines(lines: number): number {
  const n = Math.max(0, lines);
  return Math.max(MIN_GRAVITY_MS, BASE_GRAVITY_MS * Math.pow(GRAVITY_PER_LINE, n));
}

export function getPieceColor(type: PieceType): string {
  switch (type) {
    case "I":
      return "#22d3ee";
    case "O":
      return "#facc15";
    case "T":
      return "#a855f7";
    case "S":
      return "#4ade80";
    case "Z":
      return "#f87171";
    case "J":
      return "#60a5fa";
    case "L":
      return "#fb923c";
  }
}

export function getPieceCells(type: PieceType, rotation = 0): [number, number][] {
  return SHAPES[type][rotation % 4]!.map(([y, x]) => [y, x]);
}

export class TetrisEngine {
  board: Cell[][] = emptyBoard();
  active: ActivePiece | null = null;
  hold: PieceType | null = null;
  canHold = true;
  nextQueue: PieceType[] = [];
  bag: PieceType[] = [];
  score = 0;
  level = 1;
  lines = 0;
  phase: GamePhase = "playing";
  clearingRows: number[] = [];
  clearFlashRemaining = 0;
  gravityAccumulator = 0;
  lockTimer = 0;
  lockResets = 0;
  isGrounded = false;
  /** Set when a piece locks; cleared at the start of the next `update`. */
  justLocked = false;

  startNewGame(): void {
    this.board = emptyBoard();
    this.active = null;
    this.hold = null;
    this.canHold = true;
    this.nextQueue = [];
    this.bag = [];
    this.score = 0;
    this.level = 1;
    this.lines = 0;
    this.phase = "playing";
    this.clearingRows = [];
    this.clearFlashRemaining = 0;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.isGrounded = false;
    this.justLocked = false;
    this.fillNextQueue();
    this.spawnNext();
  }

  private fillNextQueue(): void {
    while (this.nextQueue.length < NEXT_COUNT + 1) {
      if (this.bag.length === 0) this.bag = shuffleBag();
      this.nextQueue.push(this.bag.shift()!);
    }
  }

  private takeFromQueue(): PieceType {
    this.fillNextQueue();
    return this.nextQueue.shift()!;
  }

  private spawnNext(): boolean {
    const type = this.takeFromQueue();
    const piece = spawnPiece(type);
    if (collides(this.board, piece)) {
      this.active = piece;
      this.phase = "gameover";
      return false;
    }
    this.active = piece;
    this.canHold = true;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.isGrounded = false;
    return true;
  }

  ghostY(): number {
    if (!this.active) return 0;
    let ghost = { ...this.active };
    while (!collides(this.board, { ...ghost, y: ghost.y + 1 })) {
      ghost = { ...ghost, y: ghost.y + 1 };
    }
    return ghost.y;
  }

  snapshot(): TetrisSnapshot {
    return {
      board: this.board.map((row) => [...row]),
      active: this.active ? { ...this.active } : null,
      ghostY: this.ghostY(),
      hold: this.hold,
      canHold: this.canHold,
      next: this.nextQueue.slice(0, NEXT_COUNT),
      score: this.score,
      level: this.level,
      lines: this.lines,
      phase: this.phase,
      clearingRows: [...this.clearingRows],
      clearFlashMs: this.clearFlashRemaining,
    };
  }

  private tryMove(dx: number, dy: number): boolean {
    if (!this.active || this.phase !== "playing") return false;
    const next = { ...this.active, x: this.active.x + dx, y: this.active.y + dy };
    if (collides(this.board, next)) return false;
    this.active = next;
    this.onSuccessfulMove(dy === 0);
    return true;
  }

  private onSuccessfulMove(resetLock: boolean): void {
    const grounded = this.active
      ? collides(this.board, { ...this.active, y: this.active.y + 1 })
      : false;
    if (grounded) {
      if (!this.isGrounded || (resetLock && this.lockResets < MAX_LOCK_RESETS)) {
        this.lockTimer = 0;
        if (resetLock && this.isGrounded) this.lockResets += 1;
      }
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
      this.lockTimer = 0;
      this.lockResets = 0;
    }
  }

  moveLeft(): boolean {
    return this.tryMove(-1, 0);
  }

  moveRight(): boolean {
    return this.tryMove(1, 0);
  }

  softDrop(): boolean {
    if (!this.active || this.phase !== "playing") return false;
    if (this.tryMove(0, 1)) {
      this.score += 1;
      this.gravityAccumulator = 0;
      return true;
    }
    return false;
  }

  hardDrop(): number {
    if (!this.active || this.phase !== "playing") return 0;
    let dropped = 0;
    while (this.tryMove(0, 1)) {
      dropped += 1;
    }
    this.score += dropped * 2;
    this.lockPiece();
    return dropped;
  }

  rotate(dir: 1 | -1): boolean {
    if (!this.active || this.phase !== "playing") return false;
    if (this.active.type === "O") return true;
    const nextRot = (this.active.rotation + dir + 4) % 4;
    for (const [kx, ky] of WALL_KICKS) {
      const next = {
        ...this.active,
        rotation: nextRot,
        x: this.active.x + kx,
        y: this.active.y + ky,
      };
      if (!collides(this.board, next)) {
        this.active = next;
        this.onSuccessfulMove(true);
        return true;
      }
    }
    return false;
  }

  holdPiece(): boolean {
    if (!this.active || this.phase !== "playing" || !this.canHold) return false;
    const current = this.active.type;
    if (this.hold === null) {
      this.hold = current;
      this.active = null;
      this.canHold = false;
      this.spawnNext();
      return true;
    }
    const swapped = this.hold;
    const piece = spawnPiece(swapped);
    if (collides(this.board, piece)) return false;
    this.hold = current;
    this.active = piece;
    this.canHold = false;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.isGrounded = false;
    return true;
  }

  private lockPiece(): void {
    if (!this.active) return;
    for (const [y, x] of cellsFor(this.active)) {
      if (y >= 0 && y < TOTAL_ROWS && x >= 0 && x < BOARD_COLS) {
        this.board[y]![x] = this.active.type;
      }
    }
    this.active = null;
    this.isGrounded = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.justLocked = true;

    const fullRows: number[] = [];
    for (let y = 0; y < TOTAL_ROWS; y += 1) {
      if (this.board[y]!.every((cell) => cell !== null)) {
        fullRows.push(y);
      }
    }

    if (fullRows.length > 0) {
      this.clearingRows = fullRows;
      this.clearFlashRemaining = CLEAR_FLASH_MS;
      this.phase = "clearing";
      return;
    }

    this.spawnNext();
  }

  private finishClear(): void {
    const count = this.clearingRows.length;
    const sorted = [...this.clearingRows].sort((a, b) => a - b);
    for (const row of sorted) {
      this.board.splice(row, 1);
      this.board.unshift(Array.from({ length: BOARD_COLS }, () => null));
    }
    this.score += (LINE_SCORES[count] ?? 0) * this.level;
    this.lines += count;
    this.level = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
    this.clearingRows = [];
    this.clearFlashRemaining = 0;
    this.phase = "playing";
    this.spawnNext();
  }

  isGameOver(): boolean {
    return this.phase === "gameover";
  }

  /**
   * Advance the simulation by `dtMs` milliseconds.
   * Returns true if phase became gameover this tick.
   */
  update(dtMs: number, softDropping: boolean): boolean {
    this.justLocked = false;
    if (this.phase === "gameover") return false;

    if (this.phase === "clearing") {
      this.clearFlashRemaining -= dtMs;
      if (this.clearFlashRemaining <= 0) {
        this.finishClear();
      }
      return this.isGameOver();
    }

    if (!this.active) return false;

    const gravity = softDropping
      ? Math.min(gravityMsForLines(this.lines), 50)
      : gravityMsForLines(this.lines);

    this.gravityAccumulator += dtMs;
    while (this.gravityAccumulator >= gravity && this.phase === "playing" && this.active) {
      this.gravityAccumulator -= gravity;
      if (!this.tryMove(0, 1)) {
        this.isGrounded = true;
        break;
      }
      if (softDropping) this.score += 1;
    }

    if (this.phase === "playing" && this.active && this.isGrounded) {
      this.lockTimer += dtMs;
      if (this.lockTimer >= LOCK_DELAY_MS) {
        this.lockPiece();
      }
    }

    return this.isGameOver();
  }
}
