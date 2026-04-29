import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { useSupabaseGame } from '../hooks/useSupabaseGame';
import { supabase } from '../lib/supabase';
import { roundEngine } from '../lib/roundEngine';
import { Shield, Sword, UserX, Crown, Clock, ShoppingBag, EyeOff, Search, ChevronRight, CheckCircle2, History, MessageSquare, TrendingUp, TrendingDown, AlertTriangle, LogOut } from 'lucide-react';

interface GameLog {
  id: string;
  round_number: number;
  message: string;
  type: 'info' | 'success' | 'danger' | 'warning';
  created_at: string;
}

export function GameBoard() {
  const { globalPool, roundNumber, maxRounds, players, currentPlayer, roomId, isHost, resetGame } = useGameStore();
  const { sendActionLockIn } = useSupabaseGame();
  const [shake, setShake] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [showShop, setShowShop] = useState(false);
  const [purchased, setPurchased] = useState<string[]>([]);
  const [logs, setLogs] = useState<GameLog[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  if (!currentPlayer) return null;

  useEffect(() => {
    // Cargar logs iniciales
    if (roomId) {
      supabase.from('mafia_logs')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (data) setLogs(data as GameLog[]);
        });

      // Suscribirse a nuevos logs
      const logChannel = supabase.channel(`logs:${roomId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mafia_logs', filter: `room_id=eq.${roomId}` }, (payload) => {
          setLogs(prev => [...prev, payload.new as GameLog]);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(logChannel);
      };
    }
  }, [roomId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    setSelectedAction(null);
    setTimeLeft(30);
    setPurchased([]);

    const handleShake = () => {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    };
    
    window.addEventListener('screenshake', handleShake);
    
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === 1 && isHost) {
          roundEngine.resolveRound(roomId!, roundNumber);
        }
        return prev > 0 ? prev - 1 : 0;
      });
    }, 1000);

    return () => {
      window.removeEventListener('screenshake', handleShake);
      clearInterval(timer);
    };
  }, [roundNumber, isHost, roomId]);

  const handleAction = async (type: string) => {
    if (selectedAction || !roomId || !currentPlayer) return;
    setSelectedAction(type);
    const otherPlayers = players.filter(p => p.id !== currentPlayer.id);
    const target = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
    await supabase.from('mafia_actions').insert([{
      room_id: roomId,
      round_number: roundNumber,
      player_id: currentPlayer.id,
      target_id: target?.id || currentPlayer.id,
      action_type: type
    }]);
    await sendActionLockIn();
  };

  const buyItem = async (id: string, cost: number, field: string) => {
    if (!currentPlayer || currentPlayer.balance < cost || purchased.includes(id)) return;
    const { error } = await supabase.from('mafia_players').update({ balance: currentPlayer.balance - cost, [field]: true }).eq('id', currentPlayer.id);
    if (!error) {
      setPurchased(prev => [...prev, id]);
      new Audio('/cash-register.mp3').play().catch(() => {});
    }
  };

  return (
    <div className="w-full h-screen bg-felt bg-poker-dark flex overflow-hidden">
      {/* Área Principal de Juego */}
      <motion.div 
        className="flex-1 flex flex-col p-4 relative"
        animate={{ x: shake ? [-5, 5, -5, 5, 0] : 0 }}
      >
        {/* HUD Superior */}
        <div className="flex justify-between items-start z-10">
          <div className="flex gap-4 items-start">
            <div className="bg-black/60 p-4 rounded-2xl border border-poker-gold/20 flex gap-6 backdrop-blur-md">
              <div className="text-center">
                <p className="text-[10px] text-poker-gold font-black uppercase tracking-tighter">Balance</p>
                <p className="text-2xl font-black text-white">${currentPlayer?.balance.toLocaleString()}</p>
              </div>
              <div className="w-px h-10 bg-gray-700"></div>
              <div className="text-center">
                <p className="text-[10px] text-poker-gold font-black uppercase tracking-tighter">Progreso</p>
                <p className="text-2xl font-black text-white">{roundNumber}/{maxRounds}</p>
              </div>
            </div>
            
            <button 
              onClick={() => { if(confirm('¿Seguro que quieres abandonar a la familia?')) resetGame(); }}
              className="bg-red-900/40 hover:bg-red-600 text-white/50 hover:text-white p-3 rounded-xl border border-white/5 transition-all flex items-center gap-2 group"
            >
              <LogOut size={16} className="group-hover:rotate-180 transition-transform" />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Abandonar</span>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowShop(!showShop)}
              className={`flex items-center gap-2 px-6 py-3 rounded-full border-2 transition-all font-black text-sm uppercase tracking-widest ${
                showShop ? 'bg-poker-gold text-black border-poker-gold' : 'bg-black/40 text-poker-gold border-poker-gold/30 hover:bg-black/60'
              }`}
            >
              <ShoppingBag size={18} /> Tienda
            </button>

            <div className="relative w-20 h-20 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90">
                <circle cx="40" cy="40" r="35" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-gray-800" />
                <motion.circle 
                  cx="40" cy="40" r="35" stroke="currentColor" strokeWidth="4" fill="transparent" 
                  strokeDasharray="220"
                  animate={{ strokeDashoffset: 220 - (timeLeft / 30) * 220 }}
                  className={timeLeft <= 10 ? 'text-red-600' : 'text-poker-gold'}
                />
              </svg>
              <span className={`absolute font-mono font-bold text-xl ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                {timeLeft}
              </span>
            </div>
          </div>
        </div>

        {/* Mesa de Juego */}
        <div className="flex-1 flex flex-col items-center justify-center relative">
          <div className="text-center relative z-10">
            <h1 className="text-poker-gold text-sm font-black uppercase tracking-[0.3em] mb-2 drop-shadow-lg">EL POZO GLOBAL</h1>
            <motion.div 
              key={globalPool}
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              className="text-8xl font-black text-white italic drop-shadow-2xl"
            >
              ${globalPool.toLocaleString()}
            </motion.div>
          </div>

          {/* Jugadores */}
          <div className="absolute inset-0 pointer-events-none">
            {players.map((p, i) => {
              const angle = (i / players.length) * (2 * Math.PI);
              const x = Math.cos(angle) * 350;
              const y = Math.sin(angle) * 200;
              return (
                <motion.div 
                  key={p.id} className="absolute left-1/2 top-1/2 flex flex-col items-center gap-2"
                  style={{ x, y }}
                >
                  <div className="relative">
                    <div className={`w-16 h-16 rounded-full border-4 ${p.is_capo ? 'border-poker-gold shadow-[0_0_20px_#D4AF37]' : 'border-white/20'} bg-gray-900 flex items-center justify-center text-xl font-bold`}>
                      {p.name[0]}
                    </div>
                    {p.is_capo && <Crown className="absolute -top-6 left-1/2 -translate-x-1/2 w-8 h-8 text-poker-gold animate-bounce" />}
                  </div>
                  <span className="bg-black/80 px-3 py-1 rounded-full text-[10px] font-bold text-white border border-white/10">
                    {p.is_incognito ? '???' : p.name}
                    {currentPlayer.has_accountant && <span className="ml-2 text-green-400">${p.balance.toLocaleString()}</span>}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Acciones */}
        <div className="mt-auto flex justify-center gap-8 p-8 relative z-20">
          <ActionCard 
            type="cooperate" label="Cooperar" icon={<Shield />} 
            selected={selectedAction === 'cooperate'} disabled={!!selectedAction}
            onClick={() => handleAction('cooperate')} color="from-blue-600 to-blue-900"
          />
          <ActionCard 
            type="betray" label="Traicionar" icon={<Sword />} 
            selected={selectedAction === 'betray'} disabled={!!selectedAction}
            onClick={() => handleAction('betray')} color="from-red-600 to-red-900"
          />
          <ActionCard 
            type="trap" label="Trampa" icon={<UserX />} 
            selected={selectedAction === 'trap'} disabled={!!selectedAction}
            onClick={() => handleAction('trap')} color="from-purple-600 to-purple-900"
          />
        </div>

        {/* Shop Overlay (Panel Derecho Interno) */}
        <AnimatePresence>
          {showShop && (
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              className="absolute right-0 top-0 h-full w-80 bg-black/95 border-l-2 border-poker-gold/30 z-50 p-6 flex flex-col backdrop-blur-xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-poker-gold font-black italic text-xl uppercase flex items-center gap-2"><ShoppingBag /> Suministros</h3>
                <button onClick={() => setShowShop(false)} className="text-gray-500 hover:text-white"><ChevronRight size={24} /></button>
              </div>
              <div className="space-y-6">
                <MiniShopItem title="Incógnito" cost={500} icon={<EyeOff size={16} />} purchased={purchased.includes('incognito')} onBuy={() => buyItem('incognito', 500, 'is_incognito')} canAfford={(currentPlayer?.balance || 0) >= 500} />
                <MiniShopItem title="Contador" cost={500} icon={<Search size={16} />} purchased={purchased.includes('accountant')} onBuy={() => buyItem('accountant', 500, 'has_accountant')} canAfford={(currentPlayer?.balance || 0) >= 500} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Log de Operaciones (Lado Derecho) */}
      <aside className="w-96 bg-black/40 border-l border-white/10 flex flex-col backdrop-blur-md">
        <div className="p-6 border-b border-white/10 flex items-center gap-3">
          <History className="text-poker-gold" size={20} />
          <h2 className="text-poker-gold font-black uppercase tracking-widest text-sm">Log de Operaciones</h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
          <AnimatePresence initial={false}>
            {logs.map((log) => (
              <motion.div 
                key={log.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-3 rounded-lg border-l-4 text-xs font-medium leading-relaxed ${
                  log.type === 'success' ? 'bg-green-500/10 border-green-500 text-green-200' :
                  log.type === 'danger' ? 'bg-red-500/10 border-red-500 text-red-200' :
                  log.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500 text-yellow-200' :
                  'bg-blue-500/10 border-poker-gold text-blue-200'
                }`}
              >
                <div className="flex justify-between items-center mb-1 opacity-50 text-[10px] font-black">
                  <span>RONDA #{log.round_number}</span>
                  <span>{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="flex gap-2">
                  {log.type === 'success' && <TrendingUp size={14} className="shrink-0" />}
                  {log.type === 'danger' && <TrendingDown size={14} className="shrink-0" />}
                  {log.type === 'warning' && <AlertTriangle size={14} className="shrink-0" />}
                  {log.type === 'info' && <MessageSquare size={14} className="shrink-0" />}
                  <p>{log.message}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={logEndRef} />
        </div>

        <div className="p-4 bg-black/60 text-[10px] text-gray-500 text-center uppercase font-bold tracking-tighter border-t border-white/5">
          "Las palabras se las lleva el viento, las balas no."
        </div>
      </aside>
    </div>
  );
}

function MiniShopItem({ title, cost, icon, purchased, onBuy, canAfford }: any) {
  return (
    <div className={`p-4 rounded-xl border-2 transition-all ${purchased ? 'border-green-500 bg-green-500/10' : 'border-white/10 bg-white/5'}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2 text-poker-gold font-bold text-sm uppercase">{icon} {title}</div>
        <span className="text-white font-black text-sm">${cost}</span>
      </div>
      <button onClick={onBuy} disabled={purchased || !canAfford} className={`w-full py-2 rounded-lg font-black text-xs transition-all ${purchased ? 'bg-green-600 text-white' : canAfford ? 'bg-poker-gold text-black' : 'bg-gray-800 text-gray-500'}`}>
        {purchased ? 'ACTIVO' : 'COMPRAR'}
      </button>
    </div>
  );
}

function ActionCard({ type, label, icon, selected, onClick, color, disabled }: any) {
  return (
    <motion.div
      whileHover={!disabled ? { y: -20, scale: 1.05 } : {}}
      whileTap={!disabled ? { scale: 0.95 } : {}}
      onClick={onClick}
      className={`relative w-36 h-56 rounded-2xl cursor-pointer group transition-opacity ${disabled && !selected ? 'opacity-40 grayscale cursor-default' : 'opacity-100'}`}
    >
      <div className={`w-full h-full rounded-2xl bg-gradient-to-br ${color} border-2 ${selected ? 'border-poker-gold ring-4 ring-poker-gold/50 shadow-[0_0_30px_rgba(212,175,55,0.4)]' : 'border-white/20'} flex flex-col items-center justify-center gap-4 transition-all duration-500`}>
        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-white relative">
          {React.cloneElement(icon, { size: 32 })}
          {selected && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-2 -right-2 bg-poker-gold text-black rounded-full p-1 border-2 border-black">
              <CheckCircle2 size={12} />
            </motion.div>
          )}
        </div>
        <span className="font-black text-base uppercase tracking-widest text-white">{label}</span>
      </div>
    </motion.div>
  );
}
