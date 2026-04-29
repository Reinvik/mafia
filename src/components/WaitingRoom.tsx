import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { supabase } from '../lib/supabase';
import { botEngine } from '../lib/botEngine';
import { Users, Play, Bot, Copy } from 'lucide-react';

export function WaitingRoom() {
  const { players, roomId, isHost } = useGameStore();
  const [maxRounds, setMaxRounds] = React.useState(10);

  const handleAddBot = async () => {
    if (!roomId) return;
    await botEngine.addBot(roomId);
  };

  const handleStartGame = async () => {
    if (!roomId) return;
    if (players.length < 2) return alert('Se necesitan al menos 2 mafiosos para empezar.');
    
    await supabase
      .from('mafia_rooms')
      .update({ 
        status: 'playing',
        max_rounds: maxRounds 
      })
      .eq('id', roomId);
  };

  const copyCode = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      alert('Código copiado: ¡Llama a tus sicarios!');
    }
  };

  return (
    <div className="min-h-screen bg-poker-dark bg-felt flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-2xl w-full bg-black/90 p-8 rounded-[3rem] border-4 border-poker-gold/30 shadow-2xl overflow-hidden relative"
      >
        <div className="flex justify-between items-start mb-8">
          <div>
            <h2 className="text-3xl font-black text-poker-gold uppercase flex items-center gap-3">
              <Users className="w-8 h-8" /> 
              SALA DE ESPERA
            </h2>
            <div 
              onClick={copyCode}
              className="mt-2 inline-flex items-center gap-2 bg-gray-900 px-3 py-1 rounded-full border border-gray-700 cursor-pointer hover:border-poker-gold transition-colors"
            >
              <span className="text-xs font-mono text-gray-400">ID: {roomId?.slice(0,8)}...</span>
              <Copy className="w-3 h-3 text-poker-gold" />
            </div>
          </div>
          <div className="text-right">
            <span className="text-5xl font-black text-white/10 select-none">{players.length}/10</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <AnimatePresence>
            {players.map((player, idx) => (
              <motion.div
                key={player.id}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: idx * 0.1 }}
                className="bg-gray-800/50 p-4 rounded-2xl border border-white/5 flex items-center gap-4 group hover:bg-gray-800 transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-poker-gold to-yellow-700 flex items-center justify-center text-black font-black text-xl shadow-lg">
                  {player.name[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-white group-hover:text-poker-gold transition-colors truncate">
                    {player.name}
                  </p>
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Sicario Jr.</p>
                </div>
                {player.name.includes('(Bot)') && <Bot className="w-4 h-4 text-gray-600" />}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        
        {isHost && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-4 bg-poker-gold/5 border border-poker-gold/20 rounded-2xl"
          >
            <div className="flex justify-between items-center mb-2">
              <label className="text-poker-gold text-xs font-black uppercase tracking-widest">Duración de la Partida</label>
              <span className="text-white font-black">{maxRounds} RONDAS</span>
            </div>
            <input 
              type="range" min="5" max="30" step="5"
              value={maxRounds}
              onChange={(e) => setMaxRounds(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-poker-gold"
            />
            <p className="text-[10px] text-gray-500 mt-2 italic text-center">"Una guerra corta es una guerra barata."</p>
          </motion.div>
        )}

        <div className="flex flex-col sm:flex-row gap-4">
          {isHost && (
            <>
              <button 
                onClick={handleAddBot}
                className="flex-1 bg-gray-800 text-white font-bold py-4 rounded-2xl hover:bg-gray-700 border border-white/10 flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                <Bot className="w-5 h-5" /> RECLUTAR BOT
              </button>
              <button 
                onClick={handleStartGame}
                disabled={players.length < 2}
                className="flex-1 bg-poker-gold text-black font-black py-4 rounded-2xl hover:bg-yellow-500 shadow-[0_5px_0_#9a7d25] flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
              >
                <Play className="w-5 h-5" /> COMENZAR PARTIDA
              </button>
            </>
          )}
          {!isHost && (
            <div className="w-full text-center p-4 bg-gray-900/50 rounded-2xl border border-dashed border-gray-700">
              <p className="text-gray-400 italic">Esperando que el Capo inicie el juego...</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
