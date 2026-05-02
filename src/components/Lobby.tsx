import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import { LogOut, PlayCircle, Sword, UserX, Users, DollarSign, Handshake, RotateCw } from 'lucide-react';

export function Lobby() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { roomId, playerId, setRoomInfo, setCurrentPlayer, setIsHost, resetGame } = useGameStore();

  // Leer código de sala desde la URL (?room=XXXX)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomCode(roomParam);
    }
  }, []);

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

  if (roomId && playerId) {
    return (
      <div className="min-h-screen bg-poker-dark bg-felt flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-black/90 p-8 rounded-3xl border-2 border-poker-gold shadow-2xl text-center">
          <h2 className="text-poker-gold text-2xl font-black mb-4 uppercase italic">PARTIDA EN CURSO</h2>
          <p className="text-gray-400 mb-8">Tienes una sesión pendiente en la familia. ¿Quieres volver o retirarte?</p>
          <div className="space-y-4">
            <button onClick={() => window.location.reload()} className="w-full bg-poker-gold text-black font-black py-4 rounded-xl hover:bg-yellow-500 flex items-center justify-center gap-2"><PlayCircle /> REANUDAR PARTIDA</button>
            <button onClick={() => window.location.reload()} className="w-full bg-gray-800 text-white font-bold py-4 rounded-xl hover:bg-gray-700 border border-white/10 flex items-center justify-center gap-2"><RotateCw size={20} /> ACTUALIZAR APP</button>
            <button onClick={() => resetGame()} className="w-full bg-gray-800 text-red-500 font-bold py-4 rounded-xl hover:bg-gray-700 border border-red-500/30 flex items-center justify-center gap-2"><LogOut size={20} /> ABANDONAR Y CERRAR</button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mafia-deep flex items-start sm:items-center justify-center p-4 lg:p-8 overflow-y-auto py-4 sm:py-8">
      <div className="max-w-6xl w-full flex flex-col lg:flex-row gap-6 lg:gap-16 items-start">
        
        {/* TÍTULO MÓVIL (Solo se ve en móvil arriba de todo) */}
        <div className="lg:hidden w-full text-center mb-6">
          <motion.div 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex justify-center mb-4"
          >
            <img src="/pwa-192x192.png" alt="Logo Alta Traición" className="w-24 h-24 rounded-3xl shadow-[0_0_30px_rgba(212,175,55,0.3)] border-2 border-poker-gold/30" />
          </motion.div>
          <motion.h1 
            animate={{ textShadow: ["0 0 10px #D4AF37", "0 0 20px #D4AF37", "0 0 10px #D4AF37"] }} 
            transition={{ repeat: Infinity, duration: 2 }} 
            className="text-5xl font-black text-poker-gold uppercase tracking-tighter leading-none"
          >
            ALTA<br/>TRAICIÓN
          </motion.h1>
          <p className="text-gray-500 mt-2 italic text-xs tracking-[0.2em] uppercase">"La lealtad tiene su precio"</p>
        </div>

        {/* COLUMNA IZQUIERDA: HISTORIA Y ACCIONES (Se mueve abajo en móvil) */}
        <motion.div 
          initial={{ opacity: 0, x: -30 }} 
          animate={{ opacity: 1, x: 0 }} 
          className="order-2 lg:order-1 flex-1 space-y-6 lg:space-y-10 py-4 lg:py-12"
        >
          <div className="hidden lg:block text-left">
            <motion.div 
              initial={{ x: -50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="mb-8"
            >
              <img src="/pwa-192x192.png" alt="Logo Alta Traición" className="w-32 h-32 rounded-[2.5rem] shadow-[0_0_50px_rgba(212,175,55,0.2)] border-2 border-poker-gold/20" />
            </motion.div>
            <motion.h1 
              animate={{ textShadow: ["0 0 10px #D4AF37", "0 0 20px #D4AF37", "0 0 10px #D4AF37"] }} 
              transition={{ repeat: Infinity, duration: 2 }} 
              className="text-5xl sm:text-7xl lg:text-8xl font-black text-poker-gold uppercase tracking-tighter leading-none"
            >
              ALTA<br/>TRAICIÓN
            </motion.h1>
            <p className="text-gray-500 mt-4 italic text-xl tracking-[0.2em] uppercase">"La lealtad tiene su precio"</p>
          </div>

          <div className="space-y-4 lg:space-y-6 max-w-xl">
            <div className="bg-black/40 border-l-4 border-poker-gold p-4 lg:p-6 rounded-r-2xl backdrop-blur-sm">
              <p className="text-gray-300 text-sm lg:text-lg leading-relaxed italic">
                "La Familia está en una encrucijada. El viejo Capo está por retirarse y busca un sucesor digno. 
                Nos envían a misiones donde la clave es cooperar para llenar las arcas, pero el dinero fácil tienta hasta al más leal."
              </p>
              <p className="text-gray-400 text-[10px] lg:text-sm mt-3 lg:mt-4 leading-relaxed">
                De vez en cuando, alguien traiciona por un botín extra. Aquel que acumule más fortuna al final de las 10 misiones será el nuevo <span className="text-poker-gold font-bold">Capo</span>.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:gap-4">
              <ActionDesc icon={<Handshake className="text-blue-400" />} title="Cooperar" desc="Todos ganan dinero si todos son leales." />
              <ActionDesc icon={<Sword className="text-red-400" />} title="Traicionar" desc="Robas el botín, pero te arriesgas al fuego cruzado." />
              <ActionDesc icon={<UserX className="text-purple-400" />} title="Trampa" desc="Castigas a los traidores y les robas su dinero." />
              <div className="bg-white/5 p-3 lg:p-4 rounded-2xl border border-white/5 flex items-center gap-4">
                <Users className="text-poker-gold shrink-0" size={24} />
                <p className="text-[9px] lg:text-[10px] text-gray-400 uppercase leading-tight font-bold">Interactúa con diferentes miembros cada ronda.</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* COLUMNA DERECHA: LOGIN (Primero en móvil) */}
        <motion.div 
          initial={{ opacity: 0, x: 30 }} 
          animate={{ opacity: 1, x: 0 }} 
          className="order-1 lg:order-2 w-full lg:w-[450px] flex flex-col justify-center"
        >
          <div className="bg-black/80 p-6 lg:p-10 rounded-[2rem] lg:rounded-[2.5rem] border-2 border-poker-gold shadow-[0_0_60px_rgba(212,175,55,0.15)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-poker-gold to-transparent opacity-50"></div>
            
            <div className="space-y-6 lg:space-y-8">
              <div>
                <label className="block text-poker-gold text-[10px] lg:text-xs font-black mb-2 lg:mb-3 uppercase tracking-[0.2em]">Identidad del Capo</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  className="w-full bg-gray-900 border-2 border-gray-700 rounded-xl lg:rounded-2xl px-4 lg:px-5 py-3 lg:py-4 text-white focus:outline-none focus:border-poker-gold transition-colors text-lg lg:text-xl font-bold shadow-inner" 
                  placeholder="Tu alias..." 
                />
              </div>

              <div className="space-y-4 lg:space-y-5">
                <button 
                  onClick={handleCreateRoom} 
                  disabled={loading} 
                  className="w-full bg-poker-gold text-black font-black py-4 lg:py-5 rounded-xl lg:rounded-2xl hover:bg-yellow-500 transition-all active:scale-95 shadow-[0_4px_0_#9a7d25] lg:shadow-[0_6px_0_#9a7d25] disabled:opacity-50 text-lg lg:text-xl tracking-tighter flex items-center justify-center gap-3"
                >
                  <DollarSign /> {loading ? 'FUNDANDO...' : 'FUNDAR NUEVA SALA'}
                </button>

                <div className="relative flex items-center py-2 lg:py-4">
                  <div className="flex-grow border-t border-gray-800"></div>
                  <span className="flex-shrink mx-4 lg:mx-6 text-gray-600 text-[10px] font-black uppercase tracking-[0.3em]">O unirse</span>
                  <div className="flex-grow border-t border-gray-800"></div>
                </div>

                <div className="space-y-3">
                  <input 
                    type="text" 
                    value={roomCode} 
                    onChange={(e) => setRoomCode(e.target.value)} 
                    className="w-full bg-gray-900 border-2 border-gray-700 rounded-xl lg:rounded-2xl px-4 lg:px-5 py-3 lg:py-4 text-white focus:outline-none focus:border-poker-gold transition-colors font-mono text-center tracking-widest text-base lg:text-lg" 
                    placeholder="CÓDIGO DE SALA" 
                  />
                  <button 
                    onClick={handleJoinRoom} 
                    disabled={loading} 
                    className="w-full bg-gray-800 text-poker-gold border-2 border-poker-gold/30 py-3 lg:py-4 rounded-xl lg:rounded-2xl hover:bg-gray-700 transition-all font-black uppercase tracking-widest text-xs lg:text-sm disabled:opacity-50"
                  >
                    UNIRSE A LA MISIÓN
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 lg:mt-8 text-center">
            <p className="text-[9px] lg:text-[10px] text-gray-600 font-black uppercase tracking-[0.4em]">Toda lealtad tiene su precio</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function ActionDesc({ icon, title, desc }: any) {
  return (
    <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex gap-4 items-start backdrop-blur-sm">
      <div className="bg-black/40 p-2 rounded-xl shrink-0">{icon}</div>
      <div>
        <h3 className="font-black text-xs uppercase text-poker-gold tracking-widest mb-1">{title}</h3>
        <p className="text-[10px] text-gray-400 leading-tight font-medium uppercase">{desc}</p>
      </div>
    </div>
  );
}
