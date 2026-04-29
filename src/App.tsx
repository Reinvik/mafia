import { Lobby } from './components/Lobby';
import { WaitingRoom } from './components/WaitingRoom';
import { GameBoard } from './components/GameBoard';
import { GameOver } from './components/GameOver';
import { useGameStore } from './store/gameStore';
import { useSupabaseGame } from './hooks/useSupabaseGame';

function App() {
  const { status, roomId, currentPlayer } = useGameStore();
  useSupabaseGame();

  if (roomId && !currentPlayer && status !== 'lobby') {
    return (
      <div className="w-full h-screen bg-poker-dark bg-felt flex items-center justify-center">
        <div className="text-poker-gold animate-pulse font-black italic text-2xl uppercase">
          Reconectando con la familia...
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen overflow-hidden selection:bg-poker-gold selection:text-black">
      {status === 'lobby' && <Lobby />}
      {status === 'waiting' && <WaitingRoom />}
      {status === 'playing' && <GameBoard />}
      {status === 'finished' && <GameOver />}
    </div>
  );
}

export default App;
