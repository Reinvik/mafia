import React, { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { useSupabaseGame } from '../hooks/useSupabaseGame';
import { supabase } from '../lib/supabase';
import { roundEngine } from '../lib/roundEngine';
import { UserX, Crown, ShoppingBag, EyeOff, Search, History, X, HelpCircle, Check, BarChart2, Zap, Handshake } from 'lucide-react';

const Revolver = ({ size = 24, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 10h11a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2" />
    <path d="M9 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
    <path d="M11 12h3" />
    <circle cx="15" cy="12" r="1.5" />
    <path d="M17 11V8a1 1 0 0 0-1-1h-4" />
  </svg>
);

interface GameLog {
  id: string;
  round_number: number;
  message: string;
  type: 'info' | 'success' | 'danger' | 'warning';
  created_at: string;
}

export function GameBoard() {
  const { globalPool, roundNumber, maxRounds, players, currentPlayer, roomId, isHost } = useGameStore();
  const { sendActionLockIn } = useSupabaseGame();
  const [timeLeft, setTimeLeft] = useState(30);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [showShop, setShowShop] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [purchased, setPurchased] = useState<string[]>([]);
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [revealedActions, setRevealedActions] = useState<Record<string, string>>(() => {
    return players.reduce((acc, p) => ({ ...acc, [p.id]: (p as any).last_action || '' }), {});
  });
  const [readyPlayers, setReadyPlayers] = useState<Set<string>>(new Set());
  const [activeEvent, setActiveEvent] = useState<{ id: string; label: string } | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  // Estados para animaciones de flujo de dinero
  const [poolChange, setPoolChange] = useState<{ amount: number; type: 'gain' | 'loss' } | null>(null);
  const [playerChanges, setPlayerChanges] = useState<Record<string, { amount: number; type: 'gain' | 'loss' | 'neutral' }>>({});
  
  const prevPoolRef = useRef<number>(globalPool);
  const prevBalancesRef = useRef<Record<string, number>>({});
  const prevRoundRef = useRef<number>(roundNumber);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Monitor de flujo de dinero Colectivo
  useEffect(() => {
    // 1. Detectar cambio en el Pozo
    const poolDiff = globalPool - prevPoolRef.current;
    if (poolDiff !== 0) {
      setPoolChange({
        amount: Math.abs(poolDiff),
        type: poolDiff > 0 ? 'gain' : 'loss'
      });
      
      // Sonido para el pozo
      if (poolDiff > 0) {
        new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3').play().catch(() => {});
      } else {
        new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3').play().catch(() => {});
      }

      setTimeout(() => setPoolChange(null), 3000);
      prevPoolRef.current = globalPool;
    }

    // 2. Detectar cambios en Jugadores tras resolución
    if (roundNumber !== prevRoundRef.current) {
      const newChanges: Record<string, { amount: number; type: 'gain' | 'loss' | 'neutral' }> = {};
      let hasChangeSound = false;
      
      players.forEach(p => {
        const prevBalance = prevBalancesRef.current[p.id] ?? p.balance;
        const diff = p.balance - prevBalance;
        
        if (diff !== 0) hasChangeSound = true;

        newChanges[p.id] = {
          amount: Math.abs(diff),
          type: diff > 0 ? 'gain' : diff < 0 ? 'loss' : 'neutral'
        };

        // Guardar nuevo balance de referencia
        prevBalancesRef.current[p.id] = p.balance;
      });

      if (hasChangeSound) {
        // Sonido de resolución colectiva
        new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3').play().catch(() => {});
      }

      setPlayerChanges(newChanges);
      setTimeout(() => setPlayerChanges({}), 4000);
      prevRoundRef.current = roundNumber;
    } else {
      // Si no ha cambiado la ronda, solo actualizamos los balances de referencia en silencio
      players.forEach(p => {
        prevBalancesRef.current[p.id] = p.balance;
      });
    }
  }, [globalPool, players, roundNumber]);

  if (!currentPlayer) return null;

  const playerGroups = useMemo(() => {
    const shuffled = [...players].sort((a, b) => {
      const hashA = (a.id.charCodeAt(0) || 0) + roundNumber;
      const hashB = (b.id.charCodeAt(0) || 0) + roundNumber;
      return (hashA % 10) - (hashB % 10);
    });
    const groups: any[][] = [];
    const n = shuffled.length;
    if (n <= 3) {
      groups.push(shuffled);
    } else {
      const numGroups = Math.ceil(n / 3);
      for (let i = 0; i < numGroups; i++) groups.push([]);
      shuffled.forEach((p, i) => {
        groups[i % numGroups].push(p);
      });
    }
    return groups;
  }, [players, roundNumber]);

  useEffect(() => {
    if (roomId) {
      supabase.from('mafia_logs').select('*').eq('room_id', roomId).order('created_at', { ascending: true })
        .then(({ data }) => { if (data) setLogs(data as GameLog[]); });

      // Cargar evento activo de la sala
      supabase.from('mafia_rooms').select('active_event, active_event_label').eq('id', roomId).single()
        .then(({ data }) => {
          if (data?.active_event) setActiveEvent({ id: data.active_event, label: data.active_event_label || '' });
          else setActiveEvent(null);
        });

      // Cargar estadísticas
      supabase.from('mafia_player_stats').select('*').eq('room_id', roomId)
        .then(({ data }) => { if (data) setStats(data); });

      const logChannel = supabase.channel(`logs:${roomId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mafia_logs', filter: `room_id=eq.${roomId}` }, (payload) => {
          setLogs(prev => [...prev, payload.new as GameLog]);
        }).subscribe();

      const actionsChannel = supabase.channel(`ready_check:${roomId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mafia_actions', filter: `room_id=eq.${roomId}` }, (payload: any) => {
           if (payload.new.round_number === roundNumber) {
             setReadyPlayers(prev => {
               const newSet = new Set([...prev, payload.new.player_id]);
               // Sonido click-clack cuando alguien (tú o rival) selecciona
               new Audio('/click-clack.mp3').play().catch(() => {});
               return newSet;
             });
           }
        }).subscribe();

      // Escuchar cambios de evento en la sala
      const roomChannel = supabase.channel(`room_event:${roomId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mafia_rooms', filter: `id=eq.${roomId}` }, (payload: any) => {
          if (payload.new.active_event) setActiveEvent({ id: payload.new.active_event, label: payload.new.active_event_label || '' });
          else setActiveEvent(null);
          // Refrescar stats
          supabase.from('mafia_player_stats').select('*').eq('room_id', roomId)
            .then(({ data }) => { if (data) setStats(data); });
        }).subscribe();

      return () => { 
        supabase.removeChannel(logChannel);
        supabase.removeChannel(actionsChannel);
        supabase.removeChannel(roomChannel);
      };
    }
  }, [roomId, roundNumber]);

  useEffect(() => {
    const fetchResults = async (rNum: number) => {
      if (!roomId || rNum <= 0) return;
      const { data } = await supabase.from('mafia_actions').select('player_id, action_type').eq('room_id', roomId).eq('round_number', rNum);
      if (data) {
        const mapping: Record<string, string> = {};
        let hasBetrayal = false;
        data.forEach(a => {
          mapping[a.player_id] = a.action_type;
          if (a.action_type === 'betray') hasBetrayal = true;
        });
        setRevealedActions(mapping);
        if (hasBetrayal) {
          new Audio('/gunshot.mp3').play().catch(() => {});
        }
      }
    };

    // Al cambiar de ronda (normal)
    if (roundNumber > 1) {
      fetchResults(roundNumber - 1);
    }

    // Escuchar broadcast de resolución (para respuesta inmediata y última ronda)
    const onResolved = () => fetchResults(roundNumber);
    window.addEventListener('round_resolved', onResolved);
    return () => window.removeEventListener('round_resolved', onResolved);
  }, [roundNumber, roomId]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // Auto-resolución cuando todos están listos (Solo Host)
  useEffect(() => {
    if (isHost && !isResolving && players.length > 0 && readyPlayers.size >= players.length) {
      // Pequeño delay para que se escuche el último click-clack
      setTimeout(() => {
        if (!isResolving) {
          setIsResolving(true);
          new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3').play().catch(() => {});
          roundEngine.resolveRound(roomId!, roundNumber).finally(() => {});
        }
      }, 500);
    }
  }, [readyPlayers.size, players.length, isHost, isResolving, roomId, roundNumber]);

  useEffect(() => {
    setIsResolving(false);
    setSelectedAction(null);
    setTimeLeft(30);
    setPurchased([]);
    setReadyPlayers(new Set());

    const intervalId = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId);
          if (isHost && !isResolving) {
            setIsResolving(true);
            new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3').play().catch(() => {});
            supabase.from('mafia_actions').select('player_id, action_type').eq('room_id', roomId!).eq('round_number', roundNumber)
              .then(({ data }) => {
                if (data) {
                  const mapping: Record<string, string> = {};
                  data.forEach(a => mapping[a.player_id] = a.action_type);
                  setRevealedActions(mapping);
                }
                roundEngine.resolveRound(roomId!, roundNumber).finally(() => {});
              });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [roundNumber, isHost, roomId]);

  const handleAction = async (type: string) => {
    if (selectedAction || isResolving || !roomId || !currentPlayer) return;
    // El sonido ahora lo maneja el canal ready_check para que sea uniforme para todos
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
      new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3').play().catch(() => {});
    }
  };

  const getActionIcon = (type: string, size = 24) => {
    switch (type) {
      case 'cooperate': return <Handshake className="text-blue-400" size={size} />;
      case 'betray': return <Revolver size={size} className="text-red-400" />;
      case 'trap': return <UserX className="text-purple-400" size={size} />;
      default: return <HelpCircle className="text-gray-500" size={size} />;
    }
  };

  return (
    <div className="w-full h-screen bg-mafia-deep flex flex-col lg:flex-row overflow-hidden relative selection:bg-poker-gold selection:text-black">
      <AnimatePresence>
        {isResolving && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[200] bg-black/95 backdrop-blur-2xl flex items-center justify-center flex-col gap-8">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-poker-gold border-t-transparent rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center"><Handshake className="text-poker-gold" size={32} /></div>
            </div>
            <h2 className="text-poker-gold font-black text-2xl sm:text-4xl tracking-[0.5em] uppercase italic">ALTA TRAICIÓN</h2>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col p-4 sm:p-6 relative overflow-hidden">
        {/* HUD Superior */}
        <div className="flex justify-between items-center z-30 h-16 sm:h-20">
          <div className="bg-black/90 p-3 sm:p-4 rounded-2xl border border-poker-gold/30 flex gap-4 sm:gap-6 backdrop-blur-xl shadow-2xl relative">
            <div className="text-center relative">
              <p className="text-[7px] sm:text-[9px] text-poker-gold font-black uppercase tracking-widest">Balance</p>
              <motion.p key={currentPlayer?.balance} initial={{ scale: 1 }} animate={{ scale: [1, 1.2, 1] }} className="text-xs sm:text-2xl font-black text-white italic">${currentPlayer?.balance.toLocaleString()}</motion.p>
              
              <AnimatePresence>
                {playerChanges[currentPlayer.id] && (
                  <FloatingMoney 
                    amount={playerChanges[currentPlayer.id].amount} 
                    type={playerChanges[currentPlayer.id].type} 
                  />
                )}
              </AnimatePresence>
            </div>
            <div className="w-px h-6 sm:h-10 bg-gray-700/50"></div>
            <div className="text-center">
              <p className="text-[7px] sm:text-[9px] text-poker-gold font-black uppercase tracking-widest">Ronda</p>
              <p className="text-xs sm:text-2xl font-black text-white italic">{roundNumber}/{maxRounds}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => { new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3').play().catch(() => {}); setShowLogs(true); }} className="lg:hidden bg-black/80 text-poker-gold p-3 rounded-xl border border-poker-gold/40 shadow-xl"><History size={20} /></button>
            <button onClick={() => { new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3').play().catch(() => {}); setShowStats(true); }} className="bg-black/80 text-poker-gold p-3 rounded-xl border border-poker-gold/40 shadow-xl"><BarChart2 size={20} /></button>
            <button onClick={() => { new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3').play().catch(() => {}); setShowShop(true); }} className="bg-black/80 text-poker-gold p-3 rounded-xl border border-poker-gold/40 shadow-xl"><ShoppingBag size={20} /></button>
            <div className="relative w-12 h-12 sm:w-20 sm:h-20 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90">
                <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-gray-900" />
                <motion.circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray="100%" animate={{ strokeDashoffset: `${100 - (timeLeft / 30) * 100}%` }} className={timeLeft <= 10 ? 'text-red-500' : 'text-poker-gold'} />
              </svg>
              <span className={`absolute font-mono font-black text-xs sm:text-xl ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{timeLeft}s</span>
            </div>
          </div>
        </div>

        {/* EVENTO ACTIVO + POZO GLOBAL */}
        <div className="flex flex-col items-center justify-center z-20 mb-2 relative">
          <AnimatePresence>
            {activeEvent && (
              <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
                className="mb-2 px-4 py-1.5 rounded-full bg-yellow-500/20 border border-yellow-400/50 flex items-center gap-2 shadow-lg backdrop-blur-md">
                <Zap size={12} className="text-yellow-400 animate-pulse" />
                <span className="text-yellow-300 font-black text-[9px] sm:text-xs uppercase tracking-widest">{activeEvent.label}</span>
                <Zap size={12} className="text-yellow-400 animate-pulse" />
              </motion.div>
            )}
          </AnimatePresence>
           <h2 className="text-poker-gold text-[8px] sm:text-xs font-black uppercase tracking-[0.4em] italic mb-1">BOTÍN ACUMULADO</h2>
          <div className="relative">
            <motion.div key={globalPool} initial={{ scale: 0.9 }} animate={{ scale: [0.9, 1.05, 1] }} className="text-3xl sm:text-7xl font-black text-white italic drop-shadow-[0_0_20px_rgba(255,255,255,0.4)] tracking-tighter">
              ${globalPool.toLocaleString()}
            </motion.div>
            <AnimatePresence>
              {poolChange && <FloatingMoney amount={poolChange.amount} type={poolChange.type} isPool />}
            </AnimatePresence>
          </div>
        </div>

        {/* MESA DE JUEGO */}
        <div className="flex-1 relative flex flex-wrap items-center justify-center gap-4 sm:gap-12 min-h-0 py-4 px-2 overflow-y-auto scrollbar-hide">
          {playerGroups.map((group, groupIdx) => (
            <div key={`group-${groupIdx}`} className="relative w-48 h-48 sm:w-72 sm:h-72 rounded-3xl border-2 border-poker-gold/10 bg-black/5 flex items-center justify-center">
                {group.map((p, i) => {
                  const pAngle = (i / group.length) * (2 * Math.PI) - (Math.PI / 2);
                  const pRadius = isMobile ? 65 : 110; // Radio aumentado para evitar colisiones
                  const px = Math.cos(pAngle) * pRadius;
                  const py = Math.sin(pAngle) * pRadius;
                  const hasAction = !!revealedActions[p.id];
                  const isReady = readyPlayers.has(p.id);
                  const change = playerChanges[p.id];

                  return (
                    <motion.div key={p.id} initial={{ x: px, y: py }} className="absolute z-30">
                      <div className="flex flex-col items-center relative">
                        {/* ANIMACIÓN DE DINERO EN LA FICHA */}
                        <AnimatePresence>
                          {change && <FloatingMoney amount={change.amount} type={change.type} />}
                        </AnimatePresence>

                        <div className="relative w-10 h-10 sm:w-16 sm:h-16 [perspective:1000px]">
                          <motion.div 
                            className="w-full h-full relative [transform-style:preserve-3d]" 
                            animate={{ rotateY: (isResolving && hasAction) || (!isReady && hasAction) ? 180 : 0 }} 
                            transition={{ duration: 0.6, type: 'spring' }}
                          >
                            <div className={`absolute inset-0 backface-hidden rounded-full border-2 sm:border-4 ${p.id === currentPlayer.id ? 'border-blue-400' : p.is_capo ? 'border-poker-gold shadow-[0_0_10px_#D4AF37]' : 'border-white/20'} bg-gray-900 flex items-center justify-center text-[10px] sm:text-xl font-black text-white`}>{p.name[0].toUpperCase()}</div>
                            <div className={`absolute inset-0 backface-hidden rounded-full border-2 sm:border-4 ${p.is_capo ? 'border-poker-gold' : 'border-white/20'} bg-gray-950 flex items-center justify-center [transform:rotateY(180deg)]`}>{getActionIcon(revealedActions[p.id], isMobile ? 18 : 28)}</div>
                          </motion.div>
                          {p.is_capo && <Crown className="absolute -top-6 sm:-top-10 left-1/2 -translate-x-1/2 w-4 h-4 sm:w-8 sm:h-8 text-poker-gold drop-shadow-[0_0_8px_rgba(212,175,55,0.6)]" />}
                          
                          <AnimatePresence>
                            {isReady && !isResolving && !hasAction && (
                              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute -bottom-1 -right-1 sm:-bottom-2 sm:-right-2 bg-green-500 text-white rounded-full p-0.5 sm:p-1 border-2 border-black z-40 shadow-lg"><Check size={isMobile ? 10 : 14} strokeWidth={4} /></motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <div className="mt-1 bg-black/90 px-2 py-0.5 rounded-lg border border-white/10 flex flex-col items-center">
                          <span className="text-[7px] sm:text-[9px] font-black text-white uppercase">{p.is_incognito ? '???' : p.name.split(' ')[0]}</span>
                          {currentPlayer.has_accountant && <span className="text-[6px] sm:text-[8px] text-green-400 font-bold">${p.balance}</span>}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
          ))}
        </div>

        {/* ACCIONES */}
        <div className="mt-auto flex justify-center gap-2 sm:gap-8 p-4 sm:p-8 z-30">
          <ActionCard label="Cooperar" icon={<Handshake />} selected={selectedAction === 'cooperate'} disabled={!!selectedAction || isResolving} onClick={() => handleAction('cooperate')} color="from-blue-600 to-blue-950" isMobile={isMobile} />
          <ActionCard label="Traicionar" icon={<Revolver />} selected={selectedAction === 'betray'} disabled={!!selectedAction || isResolving} onClick={() => handleAction('betray')} color="from-red-700 to-red-950" isMobile={isMobile} />
          <ActionCard label="Trampa" icon={<UserX />} selected={selectedAction === 'trap'} disabled={!!selectedAction || isResolving} onClick={() => handleAction('trap')} color="from-purple-700 to-purple-950" isMobile={isMobile} />
        </div>

        <AnimatePresence>
          {showShop && (
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="fixed inset-0 lg:absolute lg:right-0 lg:top-0 h-full w-full lg:w-96 bg-black/95 z-[110] p-8 flex flex-col backdrop-blur-3xl">
              <div className="flex justify-between items-center mb-10"><h3 className="text-poker-gold font-black italic text-xl uppercase flex items-center gap-3"><ShoppingBag /> Mercado Negro</h3><button onClick={() => setShowShop(false)} className="text-white bg-white/10 p-2 rounded-full"><X size={24} /></button></div>
              <div className="space-y-6">
                <MiniShopItem title="Incógnito" cost={500} icon={<EyeOff size={24} />} purchased={purchased.includes('incognito')} onBuy={() => buyItem('incognito', 500, 'is_incognito')} canAfford={(currentPlayer?.balance || 0) >= 500} />
                <MiniShopItem title="Contador" cost={500} icon={<Search size={24} />} purchased={purchased.includes('accountant')} onBuy={() => buyItem('accountant', 500, 'has_accountant')} canAfford={(currentPlayer?.balance || 0) >= 500} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PANEL DE ESTADÍSTICAS */}
        <AnimatePresence>
          {showStats && (
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="fixed inset-0 bg-black/98 z-[130] flex flex-col backdrop-blur-3xl">
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3 text-poker-gold"><BarChart2 size={20} /><h2 className="font-black uppercase tracking-widest text-sm italic">Estadísticas de la Partida</h2></div>
                <button onClick={() => setShowStats(false)} className="text-white bg-white/10 p-2 rounded-full"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 scrollbar-hide">
                {stats.length === 0 ? (
                  <p className="text-gray-600 text-center mt-20 italic">No hay datos aún. Completa al menos una ronda.</p>
                ) : (
                  <div className="space-y-2">
                    {[...stats].sort((a, b) => b.total_earned - a.total_earned).map((s) => (
                      <div key={s.player_id} className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-800 border-2 border-poker-gold/40 flex items-center justify-center text-xs font-black text-white flex-shrink-0">
                          {s.player_name[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-black text-xs uppercase truncate">{s.player_name}</p>
                          <div className="flex gap-3 mt-1 flex-wrap">
                            <span className="text-blue-400 text-[9px] font-bold">🤝 {s.total_cooperate}</span>
                            <span className="text-red-400 text-[9px] font-bold">🗡 {s.total_betray}</span>
                            <span className="text-purple-400 text-[9px] font-bold">🪤 {s.total_trap}</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-green-400 text-xs font-black">+${s.total_earned.toLocaleString()}</p>
                          <p className="text-red-400 text-[9px] font-bold">-${s.total_lost.toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {(showLogs || !isMobile) && (
          <motion.aside initial={isMobile ? { x: '100%' } : {}} animate={{ x: 0 }} exit={{ x: '100%' }} className="fixed lg:relative inset-0 lg:inset-auto right-0 top-0 h-full w-full lg:w-96 bg-black/40 border-l border-white/10 flex flex-col backdrop-blur-3xl z-[120] lg:z-10 shadow-2xl">
            <div className="p-6 border-b border-white/10 flex items-center justify-between"><div className="flex items-center gap-3 text-poker-gold"><History size={20} /><h2 className="font-black uppercase tracking-widest text-sm italic">Reportes</h2></div><button onClick={() => setShowLogs(false)} className="lg:hidden text-white"><X size={24} /></button></div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
              {logs.map((log) => (
                <div key={log.id} className={`p-4 rounded-xl border-l-4 ${log.type === 'success' ? 'bg-green-500/10 border-green-500 text-green-100' : log.type === 'danger' ? 'bg-red-500/10 border-red-500 text-red-100' : log.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500 text-yellow-100' : 'bg-blue-500/10 border-poker-gold text-blue-100'}`}>
                  <p className="text-[8px] font-black opacity-50 mb-1 tracking-widest uppercase">Operación {log.round_number}</p>
                  <p className="text-xs font-bold leading-relaxed italic">"{log.message}"</p>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

// COMPONENTE DE DINERO FLOTANTE UNIVERSAL
function FloatingMoney({ amount, type, isPool = false }: { amount: number; type: 'gain' | 'loss' | 'neutral'; isPool?: boolean }) {
  const color = type === 'gain' ? 'text-green-400' : type === 'loss' ? 'text-red-500' : 'text-gray-500';
  const prefix = type === 'gain' ? '+' : type === 'loss' ? '-' : '=';
  
  return (
    <motion.div
      initial={{ y: 0, opacity: 0, scale: 0.5 }}
      animate={{ y: isPool ? -60 : -40, opacity: [0, 1, 1, 0], scale: [0.5, 1.2, 1, 0.8] }}
      transition={{ duration: 3, times: [0, 0.2, 0.8, 1] }}
      className={`absolute left-1/2 -translate-x-1/2 font-black italic z-50 whitespace-nowrap drop-shadow-lg ${color} ${isPool ? 'text-2xl sm:text-5xl' : 'text-xs sm:text-xl'}`}
    >
      {prefix}${amount.toLocaleString()}
    </motion.div>
  );
}

function ActionCard({ label, icon, selected, onClick, color, disabled, isMobile }: any) {
  return (
    <motion.div whileHover={!disabled ? { y: -10, scale: 1.05 } : {}} whileTap={!disabled ? { scale: 0.95 } : {}} onClick={onClick} className={`relative ${isMobile ? 'w-24 h-36' : 'w-40 h-64'} cursor-pointer rounded-2xl overflow-hidden transition-all duration-300 ${disabled && !selected ? 'opacity-30 grayscale blur-[1px]' : 'opacity-100'}`}>
      <div className={`w-full h-full bg-gradient-to-br ${color} border-2 ${selected ? 'border-poker-gold ring-4 ring-poker-gold/30 shadow-[0_0_20px_rgba(212,175,55,0.4)]' : 'border-white/10'} flex flex-col items-center justify-center gap-4`}>
         <div className="bg-white/10 p-4 rounded-full text-white shadow-inner">{React.cloneElement(icon as React.ReactElement, { size: isMobile ? 24 : 40 } as any)}</div>
         <span className="font-black text-white uppercase tracking-widest italic text-[10px] sm:text-sm">{label}</span>
      </div>
      {selected && <div className="absolute inset-0 bg-poker-gold/10 flex items-center justify-center"><div className="bg-poker-gold text-black px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter transform -rotate-12">SELECCIONADO</div></div>}
    </motion.div>
  );
}

function MiniShopItem({ title, cost, icon, purchased, onBuy, canAfford }: any) {
  return (
    <div className={`p-6 rounded-3xl border-2 transition-all ${purchased ? 'border-green-500 bg-green-500/10' : 'border-white/10 bg-white/5'}`}>
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-4 text-poker-gold font-black text-sm uppercase">{icon} {title}</div>
        <span className="text-white font-black text-xl">${cost}</span>
      </div>
      <button onClick={onBuy} disabled={purchased || !canAfford} className={`w-full py-4 rounded-xl font-black text-xs ${purchased ? 'bg-green-600' : canAfford ? 'bg-poker-gold text-black' : 'bg-gray-800 text-gray-500'}`}>{purchased ? 'EN POSESIÓN' : 'ADQUIRIR'}</button>
    </div>
  );
}
