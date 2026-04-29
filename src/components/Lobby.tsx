import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import { LogOut, PlayCircle } from 'lucide-react';

export function Lobby() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { roomId, playerId, setRoomInfo, setCurrentPlayer, setIsHost, resetGame } = useGameStore();

  const handleCreateRoom = async () => {
    if (!name) return alert('Dime tu nombre, forastero.');
    setLoading(true);
    
    const { data: room, error: roomErr } = await supabase
      .from('mafia_rooms')
      .insert([{ status: 'waiting', global_pool: 2000, round_number: 1 }])
      .select()
      .single();

    if (roomErr || !room) {
      setLoading(false);
      return alert('Error creando la sala.');
    }

    const { data: player, error: playerErr } = await supabase
      .from('mafia_players')
      .insert([{ room_id: room.id, name, balance: 0, is_capo: false }])
      .select()
      .single();

    if (playerErr || !player) {
      setLoading(false);
      return alert('Error al registrarte como capo.');
    }

    setRoomInfo({ id: room.id, status: room.status as any, globalPool: room.global_pool, roundNumber: room.round_number });
    setCurrentPlayer(player);
    setIsHost(true);
    setLoading(false);
  };

  const handleJoinRoom = async () => {
    const code = roomCode.trim();
    if (!name || !code) return alert('Falta tu nombre o el código de la sala.');
    setLoading(true);

    const { data: room, error: roomErr } = await supabase
      .from('mafia_rooms')
      .select('*')
      .eq('id', code)
      .single();

    if (roomErr || !room) {
      setLoading(false);
      return alert('Esa sala no existe.');
    }

    const { data: player, error: playerErr } = await supabase
      .from('mafia_players')
      .insert([{ room_id: room.id, name, balance: 0, is_capo: false }])
      .select()
      .single();

    if (playerErr || !player) {
      setLoading(false);
      return alert('No pudiste entrar a la familia.');
    }

    setRoomInfo({ id: room.id, status: room.status as any, globalPool: room.global_pool, roundNumber: room.round_number });
    setCurrentPlayer(player);
    setIsHost(false);
    setLoading(false);
  };

  // UI para sesión pendiente
  if (roomId && playerId) {
    return (
      <div className="min-h-screen bg-poker-dark bg-felt flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-black/90 p-8 rounded-3xl border-2 border-poker-gold shadow-2xl text-center"
        >
          <h2 className="text-poker-gold text-2xl font-black mb-4 uppercase italic">PARTIDA EN CURSO</h2>
          <p className="text-gray-400 mb-8">Tienes una sesión pendiente en la familia. ¿Quieres volver o retirarte?</p>
          
          <div className="space-y-4">
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-poker-gold text-black font-black py-4 rounded-xl hover:bg-yellow-500 flex items-center justify-center gap-2"
            >
              <PlayCircle /> REANUDAR PARTIDA
            </button>
            <button 
              onClick={() => resetGame()}
              className="w-full bg-gray-800 text-red-500 font-bold py-4 rounded-xl hover:bg-gray-700 border border-red-500/30 flex items-center justify-center gap-2"
            >
              <LogOut size={20} /> ABANDONAR Y CERRAR
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-poker-dark bg-felt flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-black/80 p-8 rounded-3xl border-2 border-poker-gold shadow-[0_0_50px_rgba(212,175,55,0.2)]"
      >
        <div className="text-center mb-8">
          <motion.h1 
            animate={{ textShadow: ["0 0 10px #D4AF37", "0 0 20px #D4AF37", "0 0 10px #D4AF37"] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="text-7xl font-black text-poker-gold uppercase tracking-tighter"
          >
            MAFIA
          </motion.h1>
          <p className="text-gray-400 mt-2 italic">"Toda lealtad tiene su precio"</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-poker-gold text-sm font-bold mb-2 uppercase tracking-widest">Tu Nombre</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-900 border-2 border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-poker-gold transition-colors text-lg"
              placeholder="Ej: Vito Corleone"
            />
          </div>

          <div className="pt-4 space-y-4">
            <button 
              onClick={handleCreateRoom}
              disabled={loading}
              className="w-full bg-poker-gold text-black font-black py-4 rounded-xl hover:bg-yellow-500 transition-all active:scale-95 shadow-[0_5px_0_#9a7d25] disabled:opacity-50"
            >
              {loading ? 'CREANDO...' : 'FUNDAR NUEVA SALA'}
            </button>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-gray-700"></div>
              <span className="flex-shrink mx-4 text-gray-500 text-xs font-bold uppercase tracking-widest">O únete a una</span>
              <div className="flex-grow border-t border-gray-700"></div>
            </div>

            <div className="flex gap-2">
              <input 
                type="text" 
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                className="flex-1 bg-gray-900 border-2 border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-poker-gold transition-colors font-mono"
                placeholder="Código de Sala"
              />
              <button 
                onClick={handleJoinRoom}
                disabled={loading}
                className="bg-gray-800 text-poker-gold border-2 border-poker-gold/50 px-6 py-3 rounded-xl hover:bg-gray-700 transition-all font-bold disabled:opacity-50"
              >
                UNIRSE
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
