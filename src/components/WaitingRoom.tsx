import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { supabase } from '../lib/supabase';
import { botEngine } from '../lib/botEngine';
import { Users, Play, Bot, Copy, Share2, UserMinus } from 'lucide-react';

export function WaitingRoom() {
  const { players, roomId, isHost, playerId } = useGameStore();
  const [maxRounds, setMaxRounds] = React.useState(10);

  const handleKickPlayer = async (targetId: string) => {
    if (!roomId || !isHost) return;
    if (targetId === playerId) return; // No te puedes expulsar a ti mismo
    
    const { error } = await supabase
      .from('mafia_players')
      .delete()
      .eq('id', targetId);
      
    if (error) {
      console.error("Error al expulsar:", error);
      alert("No se pudo expulsar al jugador.");
    }
  };

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
      const inviteUrl = `${window.location.origin}/?room=${roomId}`;
      navigator.clipboard.writeText(inviteUrl);
      alert('¡Link de invitación copiado!');
    }
  };

  const shareToWhatsApp = () => {
    if (!roomId) return;
    const inviteUrl = `${window.location.origin}/?room=${roomId}`;
    const text = encodeURIComponent(`¡Es hora de la Alta Traición! 🗡️⚖️\nLa lealtad tiene su precio. Únete directamente aquí: ${inviteUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-mafia-deep flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-2xl w-full bg-black/90 p-6 sm:p-10 rounded-[2.5rem] border-4 border-poker-gold/30 shadow-2xl overflow-hidden relative mx-2">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h2 className="text-3xl font-black text-poker-gold uppercase flex items-center gap-3">
              <Users className="w-8 h-8" /> 
              SALA DE ESPERA
            </h2>
            <div className="mt-3 flex gap-2">
              <div onClick={copyCode} className="inline-flex items-center gap-2 bg-gray-900 px-4 py-2 rounded-xl border border-gray-700 cursor-pointer hover:border-poker-gold transition-colors group">
                <span className="text-xs font-mono text-gray-400 group-hover:text-poker-gold">ID: {roomId?.slice(0,8)}...</span>
                <Copy className="w-3 h-3 text-poker-gold" />
              </div>
              <button onClick={shareToWhatsApp} className="inline-flex items-center gap-2 bg-green-600/20 px-4 py-2 rounded-xl border border-green-600/50 hover:bg-green-600/40 transition-colors text-green-400 text-xs font-bold uppercase tracking-widest">
                <Share2 size={14} /> WhatsApp
              </button>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <span className="text-6xl font-black text-white/10 select-none">{players.length}/10</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <AnimatePresence>
            {players.map((player, idx) => (
              <motion.div key={player.id} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }} className="bg-gray-800/50 p-4 rounded-2xl border border-white/5 flex items-center gap-4 group hover:bg-gray-800 transition-colors">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-poker-gold to-yellow-700 flex items-center justify-center text-black font-black text-xl shadow-lg">{player.name[0].toUpperCase()}</div>
                <div className="flex-1">
                  <p className="font-bold text-white group-hover:text-poker-gold transition-colors truncate">{player.name}</p>
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">{player.id === playerId ? 'TÚ (Capo)' : 'Jugador'}</p>
                </div>
                {player.name.includes('(Bot)') && <Bot className="w-4 h-4 text-gray-600" />}
                
                {isHost && player.id !== playerId && (
                  <button 
                    onClick={() => handleKickPlayer(player.id)}
                    className="opacity-0 group-hover:opacity-100 p-2 text-gray-600 hover:text-red-500 transition-all"
                    title="Expulsar de la sala"
                  >
                    <UserMinus size={18} />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        
        {isHost && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8 p-6 bg-poker-gold/5 border border-poker-gold/20 rounded-3xl">
            <div className="flex justify-between items-center mb-3">
              <label className="text-poker-gold text-xs font-black uppercase tracking-widest">Duración de la Partida</label>
              <span className="text-white font-black">{maxRounds} RONDAS</span>
            </div>
            <input type="range" min="5" max="30" step="5" value={maxRounds} onChange={(e) => setMaxRounds(parseInt(e.target.value))} className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-poker-gold" />
            <p className="text-[10px] text-gray-500 mt-3 italic text-center">"Una guerra corta es una guerra barata."</p>
          </motion.div>
        )}

        <div className="flex flex-col sm:flex-row gap-4">
          {isHost && (
            <>
              <button onClick={handleAddBot} className="flex-1 bg-gray-800 text-white font-bold py-5 rounded-2xl hover:bg-gray-700 border border-white/10 flex items-center justify-center gap-2 transition-all active:scale-95"><Bot className="w-5 h-5" /> RECLUTAR BOT</button>
              <button onClick={handleStartGame} disabled={players.length < 2} className="flex-1 bg-poker-gold text-black font-black py-5 rounded-2xl hover:bg-yellow-500 shadow-[0_6px_0_#9a7d25] flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale text-lg"><Play className="w-5 h-5" /> INICIAR PARTIDA</button>
            </>
          )}
          {!isHost && (
            <div className="w-full text-center p-6 bg-gray-900/50 rounded-2xl border border-dashed border-gray-700">
              <p className="text-gray-400 italic">Esperando que el Capo inicie el golpe...</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
