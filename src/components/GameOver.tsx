import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { supabase } from '../lib/supabase';
import { Trophy, LogOut, Skull } from 'lucide-react';

export function GameOver() {
  const { players, roomId, isHost, resetGame } = useGameStore();
  
  const sortedPlayers = [...players].sort((a, b) => b.balance - a.balance);

  return (
    <div className="min-h-screen bg-mafia-deep flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-xl w-full bg-black/95 p-6 sm:p-12 rounded-3xl sm:rounded-[4rem] border-4 border-poker-gold shadow-[0_0_100px_rgba(212,175,55,0.3)] text-center relative overflow-hidden mx-2"
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-poker-gold to-transparent"></div>
        
        <Trophy className="w-24 h-24 text-poker-gold mx-auto mb-6 animate-bounce" />
        
        <h1 className="text-4xl font-black text-white uppercase tracking-tighter mb-2 italic">PARTIDA FINALIZADA</h1>
        <p className="text-poker-gold font-bold tracking-[0.4em] text-xs mb-12 uppercase">La familia tiene un nuevo Capo</p>

        <div className="space-y-4 mb-12">
          {sortedPlayers.map((player, idx) => (
            <motion.div 
              key={player.id}
              initial={{ x: -50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: idx * 0.1 }}
              className={`flex items-center justify-between p-4 rounded-2xl border ${idx === 0 ? 'bg-poker-gold/20 border-poker-gold' : 'bg-gray-900/50 border-white/5'}`}
            >
              <div className="flex items-center gap-4">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${idx === 0 ? 'bg-poker-gold text-black' : 'bg-gray-800 text-gray-500'}`}>
                  {idx + 1}
                </span>
                <span className={`font-bold ${idx === 0 ? 'text-poker-gold' : 'text-white'}`}>{player.name}</span>
              </div>
              <span className="text-xl font-black text-white">${player.balance.toLocaleString()}</span>
            </motion.div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          {isHost ? (
            <button 
              onClick={async () => {
                if (!roomId) return;
                // 1. Resetear sala
                await supabase.from('mafia_rooms').update({
                  status: 'waiting',
                  round_number: 1,
                  global_pool: 2000,
                }).eq('id', roomId);
                
                // 2. Resetear jugadores (balanza y última acción)
                await supabase.from('mafia_players').update({ 
                  balance: 0,
                  last_action: null 
                }).eq('room_id', roomId);
                
                // 3. Limpiar historial completo (acciones, logs, stats)
                await supabase.from('mafia_actions').delete().eq('room_id', roomId);
                await supabase.from('mafia_logs').delete().eq('room_id', roomId);
                
                // En lugar de borrar las estadísticas (lo cual bloquea RLS), las reseteamos a cero
                await supabase.from('mafia_player_stats').update({
                  cooperate: 0,
                  betray: 0,
                  trap: 0
                }).eq('room_id', roomId);
              }}
              className="w-full bg-poker-gold text-black font-black py-5 rounded-2xl hover:bg-yellow-500 transition-all flex items-center justify-center gap-3 text-lg"
            >
              <Trophy /> REINICIAR PARTIDA
            </button>
          ) : (
            <div className="w-full bg-gray-900/50 text-poker-gold font-bold py-5 rounded-2xl border border-poker-gold/30 flex items-center justify-center gap-3 text-lg animate-pulse">
              ESPERANDO AL CAPO...
            </div>
          )}

          <button 
            onClick={() => resetGame()}
            className="w-full bg-transparent text-white/50 font-bold py-4 rounded-2xl hover:bg-white/5 hover:text-white transition-all flex items-center justify-center gap-3 text-sm"
          >
            <LogOut size={18} /> SALIR AL LOBBY
          </button>
        </div>
        
        <div className="mt-8 flex items-center justify-center gap-2 text-gray-600 text-[10px] font-black uppercase tracking-widest">
          <Skull size={12} /> TODA LEALTAD TIENE SU PRECIO <Skull size={12} />
        </div>
      </motion.div>
    </div>
  );
}
