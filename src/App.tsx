import { Lobby } from './components/Lobby';
import { WaitingRoom } from './components/WaitingRoom';
import { GameBoard } from './components/GameBoard';
import { GameOver } from './components/GameOver';
import { useGameStore } from './store/gameStore';
import { useSupabaseGame } from './hooks/useSupabaseGame';
import { AnimatePresence, motion } from 'framer-motion';

function App() {
  const { status } = useGameStore();
  useSupabaseGame();

  return (
    <div className="w-full h-screen overflow-hidden selection:bg-poker-gold selection:text-black bg-mafia-deep">
      <AnimatePresence mode="wait">
        {status === 'lobby' && (
          <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full">
            <Lobby />
          </motion.div>
        )}
        {status === 'waiting' && (
          <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full">
            <WaitingRoom />
          </motion.div>
        )}
        {status === 'playing' && (
          <motion.div key="playing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full">
            <GameBoard />
          </motion.div>
        )}
        {status === 'finished' && (
          <motion.div key="finished" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full">
            <GameOver />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
