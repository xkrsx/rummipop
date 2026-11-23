/**
 * Match record for one fixed player.
 * `fastestWin` is that player's own completed turns in their quickest win,
 * counting draws and the winning play. It stays null until the first win.
 */
export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  longestWinStreak: number;
  currentWinStreak: number;
  fastestWin: number | null;
}

export interface Player extends PlayerStats {
  id: string;
  pin: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
}

/** Player fields safe to render after sign-in. The PIN stays on the server. */
export type SessionPlayer = Omit<Player, "pin">;

export interface GameState {
  id: string;
  status: "waiting" | "playing" | "finished";
  board: unknown;
  deck: unknown;
  player_racks: Record<string, unknown>;
  opened_players: string[];
  current_turn_pin: string | null;
  turn_started_at: string | null;
  game_started_at: string | null;
  winner_pin: string | null;
  updated_at: string;
}

/**
 * One message in the shared two-player chat.
 * `createdAt` is the time the server stored the row.
 * The thread is kept across new matches and sign-outs.
 */
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}
