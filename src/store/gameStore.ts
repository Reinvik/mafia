import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type GameStatus = 'lobby' | 'waiting' | 'playing' | 'shop' | 'finished';

export interface Player {
  id: string;
  room_id: string;
  name: string;
  balance: number;
  is_capo: boolean;
  is_incognito: boolean;
  has_accountant: boolean;
}

export interface GameState {
  roomId: string | null;
  playerId: string | null;
  status: GameStatus;
  globalPool: number;
  roundNumber: number;
  maxRounds: number;
  players: Player[];
  currentPlayer: Player | null;
  timeRemaining: number;
  isHost: boolean;
  
  setRoomInfo: (info: { id: string, status: GameStatus, globalPool: number, roundNumber: number, max_rounds?: number }) => void;
  setPlayers: (players: Player[]) => void;
  setCurrentPlayer: (player: Player) => void;
  setTimeRemaining: (time: number) => void;
  setIsHost: (isHost: boolean) => void;
  resetGame: () => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      roomId: null,
      playerId: null,
      status: 'lobby',
      globalPool: 2000,
      roundNumber: 1,
      maxRounds: 10,
      players: [],
      currentPlayer: null,
      timeRemaining: 30,
      isHost: false,

      setRoomInfo: (info) => set((state) => ({ 
        ...state, 
        roomId: info.id, 
        status: info.status, 
        globalPool: info.globalPool, 
        roundNumber: info.roundNumber,
        maxRounds: info.max_rounds || state.maxRounds
      })),
      setPlayers: (players) => set({ players }),
      setCurrentPlayer: (player) => set({ currentPlayer: player, playerId: player.id }),
      setTimeRemaining: (time) => set({ timeRemaining: time }),
      setIsHost: (isHost) => set({ isHost }),
      resetGame: () => {
        localStorage.removeItem('mafia-session');
        set({ roomId: null, playerId: null, status: 'lobby', players: [], currentPlayer: null, isHost: false });
      }
    }),
    {
      name: 'mafia-session',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        roomId: state.roomId, 
        playerId: state.playerId, 
        isHost: state.isHost 
      }),
    }
  )
);
