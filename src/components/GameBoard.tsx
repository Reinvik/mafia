import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { sendRoundResolving } from '../hooks/useSupabaseGame';
import { supabase } from '../lib/supabase';
import { roundEngine } from '../lib/roundEngine';
import { botEngine } from '../lib/botEngine';
import { soundEngine } from '../lib/soundEngine';
import {
  Check, ShoppingBag, History, BarChart2, Crown, Zap, X, RotateCw,
  Handshake, UserX, HelpCircle, EyeOff, Search, Volume2, VolumeX,
  ShieldAlert, Sparkles, Lock, Bot
} from 'lucide-react';

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

const ACTION_LABELS: Record<string, string> = {
  cooperate: 'COOPERAR',
  betray: 'TRAICIONAR',
  trap: 'TRAMPA',
};

export function GameBoard() {
  const { globalPool, roundNumber, maxRounds, players, currentPlayer, roomId, isHost, gameMode, setPlayers, setCurrentPlayer } = useGameStore();

  const [timeLeft, setTimeLeft] = useState(30);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [purchased, setPurchased] = useState<string[]>([]);
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [readyPlayers, setReadyPlayers] = useState<Set<string>>(new Set());
  const [activeEvent, setActiveEvent] = useState<{ id: string; label: string } | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const [isMuted, setIsMuted] = useState(() => soundEngine.isMuted());
  const [isSyncing, setIsSyncing] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  const roundNumberRef = useRef<number>(roundNumber);
  useEffect(() => {
    roundNumberRef.current = roundNumber;
  }, [roundNumber]);

  // === MÁQUINA DE ESTADOS DE FICHAS ===
  type ChipPhase = 'playing' | 'revealed';
  const [chipPhase, setChipPhase] = useState<ChipPhase>('playing');
  const [revealedActions, setRevealedActions] = useState<Record<string, string>>({});
  const [isResolving, setIsResolving] = useState(false);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estado para mantener las posiciones fijas hasta que termine la revelación de la ronda anterior
  const [layoutRound, setLayoutRound] = useState(roundNumber);

  // Estados para animaciones de flujo de dinero
  const [poolChange, setPoolChange] = useState<{ amount: number; type: 'gain' | 'loss' } | null>(null);
  const [playerChanges, setPlayerChanges] = useState<Record<string, { amount: number; type: 'gain' | 'loss' | 'neutral' }>>({});

  const prevPoolRef = useRef<number>(globalPool);
  const prevBalancesRef = useRef<Record<string, number>>({});
  const prevRoundRef = useRef<number>(roundNumber);

  // Inicializar balances base cuando entran los jugadores
  useEffect(() => {
    players.forEach(p => {
      if (prevBalancesRef.current[p.id] === undefined) {
        prevBalancesRef.current[p.id] = p.balance;
      }
    });
  }, [players]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Escuchar evento round_resolving verificando estrictamente que corresponda a la ronda actual
  useEffect(() => {
    const onResolving = (e: Event) => {
      const customEvent = e as CustomEvent;
      const targetRound = customEvent.detail?.round;
      if (!targetRound || targetRound === roundNumberRef.current) {
        setIsResolving(true);
      }
    };
    window.addEventListener('round_resolving', onResolving);
    return () => window.removeEventListener('round_resolving', onResolving);
  }, []);

  // Watchdog de seguridad: Si isResolving queda en true más de 5.5s (por microcorte de red),
  // forzar la resolución (si es Host) y liberar los controles para que NUNCA se bloquee el juego.
  useEffect(() => {
    if (!isResolving || !roomId) return;
    const watchdog = setTimeout(async () => {
      if (isHost) {
        await roundEngine.resolveRound(roomId, roundNumberRef.current);
      }
      window.dispatchEvent(new CustomEvent('force_game_sync'));
      setIsResolving(false);
    }, 5500);
    return () => clearTimeout(watchdog);
  }, [isResolving, isHost, roomId]);

  // 1. Monitor exclusivo de cambio en el Pozo Global
  useEffect(() => {
    const poolDiff = globalPool - prevPoolRef.current;
    if (poolDiff !== 0) {
      setPoolChange({
        amount: Math.abs(poolDiff),
        type: poolDiff > 0 ? 'gain' : 'loss'
      });
      prevPoolRef.current = globalPool;
      const t = setTimeout(() => setPoolChange(null), 3200);
      return () => clearTimeout(t);
    }
  }, [globalPool]);

  // 2. Monitor de transición de Ronda y Revelación de Cartas (sin carrera con globalPool)
  useEffect(() => {
    if (!roomId) return;

    if (roundNumber > 1 && roundNumber !== prevRoundRef.current) {
      const completedRound = prevRoundRef.current;
      // Actualizar ref sincrónicamente para impedir ejecuciones duplicadas
      prevRoundRef.current = roundNumber;

      // Entrar en fase de revelación inmediatamente y programar salida garantizada en 3.4s
      setChipPhase('revealed');
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = setTimeout(() => {
        setPlayerChanges({});
        setChipPhase('playing');
        setRevealedActions({});
        setLayoutRound(roundNumber);
      }, 3400);

      const fetchResolutionData = async () => {
        try {
          // Consultar jugadores, acciones pasadas, sala y estadísticas en PARALELO para respuesta instantánea
          const [playersRes, actionsRes, roomRes, statsRes] = await Promise.all([
            supabase.from('mafia_players').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
            supabase.from('mafia_actions').select('*').eq('room_id', roomId).eq('round_number', completedRound),
            supabase.from('mafia_rooms').select('active_event, active_event_label').eq('id', roomId).single(),
            supabase.from('mafia_player_stats').select('*').eq('room_id', roomId),
          ]);

          const updatedPlayers = playersRes.data;
          const pastActions = actionsRes.data;

          if (roomRes.data) {
            if (roomRes.data.active_event) {
              setActiveEvent({ id: roomRes.data.active_event, label: roomRes.data.active_event_label || '' });
            } else {
              setActiveEvent(null);
            }
          }

          if (statsRes.data) {
            setStats(statsRes.data);
          }

          // Disparar sonido de resolución al instante (0ms latencia con soundEngine)
          let hasChangeSound = false;
          if (updatedPlayers) {
            const newChanges: Record<string, { amount: number; type: 'gain' | 'loss' | 'neutral' }> = {};
            updatedPlayers.forEach(p => {
              const prevBalance = prevBalancesRef.current[p.id] ?? 0;
              const diff = p.balance - prevBalance;
              if (diff !== 0) hasChangeSound = true;
              newChanges[p.id] = {
                amount: Math.abs(diff),
                type: diff > 0 ? 'gain' : diff < 0 ? 'loss' : 'neutral'
              };
              prevBalancesRef.current[p.id] = p.balance;
            });

            setPlayers(updatedPlayers as any[]);
            const me = updatedPlayers.find(p => p.id === currentPlayer?.id);
            if (me) setCurrentPlayer(me as any);
            setPlayerChanges(newChanges);
          }

          if (pastActions && pastActions.length > 0) {
            const actionsMap = Object.fromEntries(pastActions.map(a => [a.player_id, a.action_type]));
            setRevealedActions(actionsMap);

            const hasBetrayal = pastActions.some(a => a.action_type === 'betray');
            if (hasBetrayal) {
              soundEngine.playGunshot();
            } else {
              soundEngine.playCooperateSuccess();
              if (hasChangeSound) {
                setTimeout(() => soundEngine.playCash(), 250);
              }
            }
          } else if (hasChangeSound) {
            soundEngine.playCash();
          }
        } catch (err) {
          console.warn('Error obteniendo datos de resolución:', err);
        }
      };

      fetchResolutionData();
    } else if (roundNumber === 1 && prevRoundRef.current !== 1) {
      // Reinicio de partida a ronda 1
      players.forEach(p => { prevBalancesRef.current[p.id] = 0; });
      prevRoundRef.current = 1;
      setChipPhase('playing');
      setRevealedActions({});
      setPlayerChanges({});
      setLayoutRound(1);
    }
  }, [roundNumber, roomId]);

  // Limpiar timeout de revelación al desmontar
  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    };
  }, []);

  // ⚠️ REGLA DE HOOKS: useMemo antes de cualquier early return
  const playerGroups = useMemo(() => {
    const seedString = roomId + layoutRound.toString();
    let seed = 0;
    for (let i = 0; i < seedString.length; i++) {
      seed += seedString.charCodeAt(i);
    }

    const seededRandom = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const shuffled = [...players].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const groups: any[][] = [];
    if (gameMode === 'circle') {
      groups.push(shuffled);
    } else {
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
    }
    return groups;
  }, [players, layoutRound, roomId, gameMode]);

  // Suscripción a logs, acciones en tiempo real y eventos de sala
  useEffect(() => {
    if (!roomId) return;

    supabase.from('mafia_logs').select('*').eq('room_id', roomId).order('created_at', { ascending: true })
      .then(({ data }) => { if (data) setLogs(data as GameLog[]); });

    supabase.from('mafia_rooms').select('active_event, active_event_label').eq('id', roomId).single()
      .then(({ data }) => {
        if (data?.active_event) setActiveEvent({ id: data.active_event, label: data.active_event_label || '' });
        else setActiveEvent(null);
      });

    supabase.from('mafia_player_stats').select('*').eq('room_id', roomId)
      .then(({ data }) => { if (data) setStats(data); });

    const logChannel = supabase.channel(`logs:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mafia_logs', filter: `room_id=eq.${roomId}` }, (payload) => {
        setLogs(prev => {
          if (prev.some(l => l.id === payload.new.id)) return prev;
          return [...prev, payload.new as GameLog];
        });
      }).subscribe(undefined, 30000);

    const actionsChannel = supabase.channel(`ready_check:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mafia_actions', filter: `room_id=eq.${roomId}` }, (payload: any) => {
        if (payload.new.round_number === roundNumberRef.current) {
          setReadyPlayers(prev => {
            if (prev.has(payload.new.player_id)) return prev;
            const newSet = new Set([...prev, payload.new.player_id]);
            // Si el voto es de otro jugador/bot, reproducir sonido click-clack (el jugador local ya sonó a 0ms al hacer clic)
            if (payload.new.player_id !== currentPlayer?.id) {
              soundEngine.playLockIn(0.6);
            }
            return newSet;
          });
        }
      }).subscribe(undefined, 30000);

    const roomChannel = supabase.channel(`room_event:${roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mafia_rooms', filter: `id=eq.${roomId}` }, (payload: any) => {
        if (payload.new.active_event) setActiveEvent({ id: payload.new.active_event, label: payload.new.active_event_label || '' });
        else setActiveEvent(null);
        supabase.from('mafia_player_stats').select('*').eq('room_id', roomId)
          .then(({ data }) => { if (data) setStats(data); });
      }).subscribe(undefined, 30000);

    return () => {
      supabase.removeChannel(logChannel);
      supabase.removeChannel(actionsChannel);
      supabase.removeChannel(roomChannel);
    };
  }, [roomId, currentPlayer?.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Reset sincrónico y consulta de acciones al iniciar cada ronda
  const syncCurrentRoundActions = useCallback(async (targetRound: number, isCancelledRef?: { current: boolean }) => {
    if (!roomId) return;
    const { data: currentActions } = await supabase
      .from('mafia_actions')
      .select('player_id, action_type')
      .eq('room_id', roomId)
      .eq('round_number', targetRound);

    // Ignorar respuesta si la ronda ya cambió mientras la petición viajaba por red
    if (isCancelledRef?.current || roundNumberRef.current !== targetRound) return;

    if (currentActions && currentActions.length > 0) {
      setReadyPlayers(new Set(currentActions.map(a => a.player_id)));
      const myAction = currentActions.find(a => a.player_id === currentPlayer?.id);
      if (myAction) {
        setSelectedAction(myAction.action_type);
      }
    } else {
      setReadyPlayers(new Set());
    }
  }, [roomId, currentPlayer?.id]);

  useEffect(() => {
    // 1. RESET SINCRÓNICO INMEDIATO al cambiar de ronda (impide que readyPlayers de la ronda anterior dispare resolveRound)
    setSelectedAction(null);
    setIsSubmitting(false);
    setReadyPlayers(new Set());
    setTimeLeft(30);
    setPurchased([]);
    setIsResolving(false);

    const isCancelledRef = { current: false };
    syncCurrentRoundActions(roundNumber, isCancelledRef);

    // Polling de respaldo cada 1.8s validando estrictamente el número de ronda
    const actionsPoll = setInterval(() => {
      if (!isCancelledRef.current && roundNumberRef.current === roundNumber) {
        syncCurrentRoundActions(roundNumber, isCancelledRef);
      }
    }, 1800);

    return () => {
      isCancelledRef.current = true;
      clearInterval(actionsPoll);
    };
  }, [roundNumber, roomId, syncCurrentRoundActions]);

  // Cronómetro de ronda: Solo descuenta cuando chipPhase === 'playing' y no está resolviendo
  useEffect(() => {
    if (chipPhase !== 'playing' || isResolving) return;

    const intervalId = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId);
          if (isHost) {
            setIsResolving(true);
            sendRoundResolving(roomId!, roundNumberRef.current).finally(() => {
              roundEngine.resolveRound(roomId!, roundNumberRef.current);
            });
          }
          return 0;
        }
        const nextVal = prev - 1;
        if (nextVal <= 8 && nextVal > 0) {
          soundEngine.playTick(nextVal <= 3);
        }
        return nextVal;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [chipPhase, isResolving, isHost, roomId, roundNumber]);

  // Acelerar bots automáticamente en cuanto todos los jugadores humanos hayan elegido su jugada
  useEffect(() => {
    if (!isHost || !roomId || isResolving || chipPhase !== 'playing' || players.length === 0) return;

    const humanPlayers = players.filter(p => !p.name.includes('(Bot)'));
    const allHumansReady = humanPlayers.length > 0 && humanPlayers.every(h => readyPlayers.has(h.id));

    if (allHumansReady && readyPlayers.size < players.length) {
      botEngine.accelerateBots(roomId, roundNumber, players);
    }
  }, [readyPlayers, players, isHost, isResolving, chipPhase, roomId, roundNumber]);

  // Auto-resolución cuando todos están listos (Solo Host, y solo cuando estamos en fase 'playing')
  useEffect(() => {
    if (isHost && chipPhase === 'playing' && !isResolving && players.length > 0 && readyPlayers.size >= players.length) {
      const targetRound = roundNumber;
      const timer = setTimeout(async () => {
        if (roundNumberRef.current !== targetRound) return;
        setIsResolving(true);
        await sendRoundResolving(roomId!, targetRound);
        await roundEngine.resolveRound(roomId!, targetRound);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [readyPlayers.size, players.length, isHost, isResolving, chipPhase, roomId, roundNumber]);

  if (!currentPlayer) return null;

  // Ejecutar acción con sonido a 0ms y actualización optimista protegida
  const handleAction = async (type: string) => {
    if (selectedAction || isSubmitting || isResolving || chipPhase !== 'playing' || !roomId || !currentPlayer) return;

    // 1. Feedback sonoro y visual instantáneo (0ms)
    soundEngine.playLockIn();
    setIsSubmitting(true);
    setSelectedAction(type);
    setReadyPlayers(prev => new Set([...prev, currentPlayer.id]));

    try {
      // Verificar si ya existe acción en esta ronda para evitar duplicados
      const { data: existing } = await supabase
        .from('mafia_actions')
        .select('id, action_type')
        .eq('room_id', roomId)
        .eq('round_number', roundNumber)
        .eq('player_id', currentPlayer.id)
        .maybeSingle();

      if (existing) {
        setSelectedAction(existing.action_type);
        setIsSubmitting(false);
        return;
      }

      const otherPlayers = players.filter(p => p.id !== currentPlayer.id);
      const target = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];

      const { error } = await supabase.from('mafia_actions').insert([{
        room_id: roomId,
        round_number: roundNumber,
        player_id: currentPlayer.id,
        target_id: target?.id || currentPlayer.id,
        action_type: type
      }]);

      if (error) {
        console.error('Error guardando jugada:', error);
        setSelectedAction(null);
        setReadyPlayers(prev => {
          const next = new Set(prev);
          next.delete(currentPlayer.id);
          return next;
        });
      }
    } catch (err) {
      console.error('Excepción guardando jugada:', err);
      setSelectedAction(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSync = async () => {
    soundEngine.playClick();
    setIsSyncing(true);
    setIsResolving(false);
    setChipPhase('playing');
    window.dispatchEvent(new CustomEvent('force_game_sync'));
    await syncCurrentRoundActions(roundNumberRef.current);
    setTimeout(() => setIsSyncing(false), 600);
  };

  const buyItem = async (id: string, cost: number, field: string) => {
    if (!currentPlayer || currentPlayer.balance < cost || purchased.includes(id)) return;
    soundEngine.playCash();
    const newBalance = currentPlayer.balance - cost;
    const { error } = await supabase.from('mafia_players').update({ balance: newBalance, [field]: true }).eq('id', currentPlayer.id);
    if (!error) {
      setPurchased(prev => [...prev, id]);
      setCurrentPlayer({ ...currentPlayer, balance: newBalance, [field]: true } as any);
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

  const cooperateRewardText = activeEvent?.id === 'double_cooperate' ? '+$2,000 DOBLE' : '+$1,000 seguro';
  const trapRewardText = activeEvent?.id === 'trap_refund' ? 'Roba $2,000' : 'Roba $1,000';

  return (
    <div className={`w-full h-screen flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden relative selection:bg-poker-gold selection:text-black transition-colors duration-1000 ${
      timeLeft <= 10 && chipPhase === 'playing'
        ? 'bg-[radial-gradient(ellipse_at_50%_40%,_#1c0709_0%,_#0a0203_55%,_#020001_100%)]' 
        : 'bg-[radial-gradient(ellipse_at_50%_40%,_#091710_0%,_#050d08_50%,_#020403_85%,_#000000_100%)]'
    }`}>
      {/* Luz cenital cálida sobre la mesa (Lámpara de Garito) */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_50%_at_50%_45%,_rgba(212,175,55,0.08)_0%,_transparent_70%)] z-0" />

      {/* Viñeta roja de alta tensión en los últimos 10 segundos */}
      {timeLeft <= 10 && chipPhase === 'playing' && (
        <div className="fixed inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(220,38,38,0.35)] animate-pulse z-40 transition-opacity duration-500" />
      )}

      <div className="flex-1 flex flex-col p-3 sm:p-6 relative min-h-0">
        {/* HUD Superior */}
        <div className="flex justify-between items-center z-30 h-14 sm:h-20 shrink-0">
          <div className="bg-black/90 px-3 py-2 sm:p-4 rounded-2xl border border-poker-gold/30 flex items-center gap-3 sm:gap-6 backdrop-blur-xl shadow-2xl relative">
            <div className="text-center relative">
              <p className="text-[7px] sm:text-[9px] text-poker-gold font-black uppercase tracking-widest">Tu Fortuna</p>
              <motion.p key={currentPlayer?.balance} initial={{ scale: 1 }} animate={{ scale: [1, 1.18, 1] }} className="text-sm sm:text-2xl font-black text-white italic">
                ${currentPlayer?.balance.toLocaleString()}
              </motion.p>
              
              <AnimatePresence>
                {playerChanges[currentPlayer.id] && (
                  <FloatingMoney 
                    amount={playerChanges[currentPlayer.id].amount} 
                    type={playerChanges[currentPlayer.id].type} 
                  />
                )}
              </AnimatePresence>
            </div>
            <div className="w-px h-6 sm:h-10 bg-poker-gold/20"></div>
            <div className="text-center">
              <p className="text-[7px] sm:text-[9px] text-poker-gold font-black uppercase tracking-widest">Operación</p>
              <p className="text-sm sm:text-2xl font-black text-white italic">{roundNumber}<span className="text-gray-500 text-xs sm:text-base">/{maxRounds}</span></p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setIsMuted(soundEngine.toggleMute())}
              title={isMuted ? "Activar Sonido" : "Silenciar"}
              className={`bg-black/80 p-2.5 sm:p-3 rounded-xl border shadow-xl transition-colors ${isMuted ? 'text-gray-500 border-white/10' : 'text-poker-gold border-poker-gold/30 hover:bg-poker-gold/10'}`}
            >
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <button 
              onClick={handleManualSync} 
              title="Sincronizar Mesa Instantáneamente"
              className="bg-black/80 text-white p-2.5 sm:p-3 rounded-xl border border-white/20 shadow-xl hover:bg-white/10 transition-colors"
            >
              <RotateCw size={18} className={isSyncing ? 'animate-spin text-poker-gold' : ''} />
            </button>
            {isHost && (
              <button 
                onClick={async () => { 
                  soundEngine.playClick();
                  useGameStore.setState({ status: 'finished' });
                  supabase.from('mafia_rooms').update({ status: 'finished' }).eq('id', roomId).then(() => {});
                }} 
                title="Terminar Partida"
                className="bg-black/80 text-red-500 p-2.5 sm:p-3 rounded-xl border border-red-500/40 shadow-xl hover:bg-red-500/20 transition-colors"
              >
                <X size={18} />
              </button>
            )}
            <button onClick={() => { soundEngine.playClick(); setShowLogs(true); }} className="lg:hidden bg-black/80 text-poker-gold p-2.5 sm:p-3 rounded-xl border border-poker-gold/40 shadow-xl relative">
              <History size={18} />
            </button>
            <button onClick={() => { soundEngine.playClick(); setShowStats(true); }} className="bg-black/80 text-poker-gold p-2.5 sm:p-3 rounded-xl border border-poker-gold/40 shadow-xl" title="Estadísticas">
              <BarChart2 size={18} />
            </button>
            <button onClick={() => { soundEngine.playClick(); setShowShop(true); }} className="bg-black/80 text-poker-gold p-2.5 sm:p-3 rounded-xl border border-poker-gold/40 shadow-xl" title="Mercado Negro">
              <ShoppingBag size={18} />
            </button>
            <div className="relative w-11 h-11 sm:w-16 sm:h-16 flex items-center justify-center ml-1">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-gray-900" />
                <motion.circle
                  cx="32"
                  cy="32"
                  r="26"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="transparent"
                  strokeDasharray={163.36}
                  animate={{ strokeDashoffset: 163.36 - (timeLeft / 30) * 163.36 }}
                  transition={{ duration: 0.4 }}
                  className={timeLeft <= 10 && chipPhase === 'playing' ? 'text-red-500' : 'text-poker-gold'}
                />
              </svg>
              <span className={`absolute font-mono font-black text-[11px] sm:text-base ${timeLeft <= 10 && chipPhase === 'playing' ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                {chipPhase === 'revealed' ? '••' : `${timeLeft}s`}
              </span>
            </div>
          </div>
        </div>

        {/* EVENTO ACTIVO + POZO GLOBAL */}
        <div className="flex flex-col items-center justify-center z-20 mb-1 sm:mb-2 relative shrink-0">
          <AnimatePresence>
            {activeEvent && (
              <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
                className="mb-1.5 px-3.5 py-1 rounded-full bg-yellow-500/20 border border-yellow-400/50 flex items-center gap-2 shadow-[0_0_20px_rgba(234,179,8,0.25)] backdrop-blur-md">
                <Zap size={12} className="text-yellow-400 animate-pulse shrink-0" />
                <span className="text-yellow-300 font-black text-[8px] sm:text-xs uppercase tracking-widest text-center">{activeEvent.label}</span>
                <Zap size={12} className="text-yellow-400 animate-pulse shrink-0" />
              </motion.div>
            )}
          </AnimatePresence>
          <h2 className="text-poker-gold text-[8px] sm:text-[10px] font-black uppercase tracking-[0.4em] italic">BOTÍN ACUMULADO</h2>
          <div className="relative">
            <motion.div key={globalPool} initial={{ scale: 0.9 }} animate={{ scale: [0.9, 1.06, 1] }} className="text-2xl sm:text-5xl font-black text-white italic drop-shadow-[0_0_20px_rgba(212,175,55,0.35)] tracking-tighter">
              ${globalPool.toLocaleString()}
            </motion.div>
            <AnimatePresence>
              {poolChange && <FloatingMoney amount={poolChange.amount} type={poolChange.type} isPool />}
            </AnimatePresence>
          </div>
        </div>

        {/* MESA DE PÓKER VIP */}
        <div className="flex-1 relative flex flex-wrap items-center justify-center gap-4 sm:gap-20 min-h-0 py-1 px-2 overflow-y-auto scrollbar-hide">
          {playerGroups.map((group, groupIdx) => {
            const myIndexInGroup = group.findIndex(p => p.id === currentPlayer.id);
            const leftNeighborId = gameMode === 'circle' && myIndexInGroup !== -1 && group.length > 1
              ? group[(myIndexInGroup - 1 + group.length) % group.length]?.id
              : null;
            const rightNeighborId = gameMode === 'circle' && myIndexInGroup !== -1 && group.length > 1
              ? group[(myIndexInGroup + 1) % group.length]?.id
              : null;

            return (
              <div 
                key={`group-${groupIdx}`} 
                className={`relative ${gameMode === 'circle' ? 'w-72 h-72 sm:w-[38rem] sm:h-[38rem] rounded-full' : 'w-52 h-52 sm:w-80 sm:h-80 rounded-[3.5rem]'} border-[10px] sm:border-[20px] poker-leather-rail poker-felt-surface flex items-center justify-center transition-all duration-700 shadow-2xl overflow-visible`}
              >
                {/* Línea concéntrica de apuesta grabada en oro */}
                <div className={`absolute pointer-events-none ${gameMode === 'circle' ? 'inset-6 sm:inset-12 rounded-full' : 'inset-4 sm:inset-8 rounded-[2.5rem]'} border border-dashed border-poker-gold/25`} />

                {/* Logo Oficial de Alta Traición en bajo relieve en el centro del paño */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
                  <div className="relative flex flex-col items-center justify-center">
                    <div className="absolute w-28 h-28 sm:w-60 sm:h-60 rounded-full border border-poker-gold/25 shadow-[inset_0_0_25px_rgba(212,175,55,0.15)] pointer-events-none" />
                    <div className="absolute w-24 h-24 sm:w-52 sm:h-52 rounded-full border border-dashed border-poker-gold/20 pointer-events-none" />

                    <img 
                      src="/pwa-512x512.png" 
                      alt="Logo Alta Traición" 
                      className="w-24 h-24 sm:w-48 sm:h-48 object-contain mix-blend-screen opacity-25 sm:opacity-35 drop-shadow-[0_0_20px_rgba(212,175,55,0.25)] filter contrast-125"
                    />

                    <span className="text-[5px] sm:text-[8px] font-mono uppercase tracking-[0.3em] text-poker-gold/50 mt-1">
                      CLUB PRIVADO • SALÓN VIP
                    </span>
                  </div>
                </div>

                {/* Asientos incrustados para cada jugador (Seat Pods) */}
                {group.map((p, i) => {
                  const pAngle = (i / group.length) * (2 * Math.PI) - (Math.PI / 2);
                  const pRadius = gameMode === 'circle' 
                    ? (isMobile ? 112 : 240) 
                    : (isMobile ? 70 : 125); 
                  const px = Math.cos(pAngle) * pRadius;
                  const py = Math.sin(pAngle) * pRadius;

                  return (
                    <div
                      key={`seat-${p.id}`}
                      className="absolute pointer-events-none rounded-full bg-black/50 border border-poker-gold/20 shadow-[inset_0_4px_12px_rgba(0,0,0,0.95)]"
                      style={{
                        left: '50%',
                        top: '50%',
                        width: isMobile ? '46px' : '72px',
                        height: isMobile ? '46px' : '72px',
                        transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`,
                        transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    />
                  );
                })}

                {/* Fichas Interactivas de los Jugadores */}
                {group.map((p, i) => {
                  const pAngle = (i / group.length) * (2 * Math.PI) - (Math.PI / 2);
                  const pRadius = gameMode === 'circle' 
                    ? (isMobile ? 112 : 240) 
                    : (isMobile ? 70 : 125); 
                  const px = Math.cos(pAngle) * pRadius;
                  const py = Math.sin(pAngle) * pRadius;

                  const isMe = p.id === currentPlayer?.id;
                  const isDirectNeighbor = !isMe && (p.id === leftNeighborId || p.id === rightNeighborId);
                  const isBot = p.name.includes('(Bot)');
                  const cleanName = p.name.replace(' (Bot)', '');

                  const backIcon = chipPhase === 'revealed'
                    ? revealedActions[p.id]
                    : (p as any).last_action || '';

                  const isReady = readyPlayers.has(p.id);
                  const isFlipped =
                    chipPhase === 'revealed'
                    || (chipPhase === 'playing' && !isReady && !!backIcon);

                  const showCheck = isReady && chipPhase === 'playing';
                  const change = playerChanges[p.id];

                  return (
                    <div
                      key={p.id}
                      className={`absolute z-30 transition-all duration-500 ${isMe ? 'scale-110 z-40' : ''}`}
                      style={{
                        left: '50%',
                        top: '50%',
                        transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`,
                        filter: isMe ? 'drop-shadow(0 0 15px rgba(59,130,246,0.45))' : 'none',
                        transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.3s ease',
                      }}
                    >
                      <div className="flex flex-col items-center relative">
                        <AnimatePresence>
                          {change && <FloatingMoney amount={change.amount} type={change.type} />}
                        </AnimatePresence>

                        <div className="relative w-10 h-10 sm:w-16 sm:h-16 [perspective:1000px]">
                          <motion.div
                            className="w-full h-full relative [transform-style:preserve-3d]"
                            animate={{ rotateY: isFlipped ? 180 : 0 }}
                            transition={{ duration: 0.6, type: 'spring' }}
                          >
                            {/* Cara frontal: inicial del nombre */}
                            <div className={`absolute inset-0 backface-hidden rounded-full border-2 sm:border-4 ${
                              isMe
                                ? 'border-blue-400 shadow-[0_0_15px_#3b82f6]'
                                : p.is_capo
                                ? 'border-poker-gold shadow-[0_0_12px_#D4AF37]'
                                : isDirectNeighbor
                                ? 'border-amber-500/80 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                                : 'border-amber-900/50 shadow-md'
                            } bg-gradient-to-br from-gray-900 via-gray-950 to-black flex items-center justify-center text-[11px] sm:text-xl font-black text-white shadow-xl`}>
                              {cleanName[0]?.toUpperCase()}
                            </div>
                            {/* Cara trasera: icono de acción */}
                            <div className={`absolute inset-0 backface-hidden rounded-full border-2 sm:border-4 ${
                              isMe
                                ? 'border-blue-400 shadow-[0_0_15px_#3b82f6]'
                                : p.is_capo
                                ? 'border-poker-gold'
                                : 'border-amber-900/50 shadow-md'
                            } bg-gradient-to-br from-gray-950 to-black flex items-center justify-center [transform:rotateY(180deg)] shadow-xl`}>
                              {getActionIcon(backIcon, isMobile ? 18 : 28)}
                            </div>
                          </motion.div>

                          {p.is_capo && (
                            <Crown className="absolute -top-5 sm:-top-8 left-1/2 -translate-x-1/2 w-4 h-4 sm:w-7 sm:h-7 text-poker-gold drop-shadow-[0_0_8px_rgba(212,175,55,0.8)]" />
                          )}

                          {/* Checkmark: jugador listo y en fase playing */}
                          <AnimatePresence>
                            {showCheck && (
                              <motion.div
                                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                                className="absolute -bottom-1 -right-1 sm:-bottom-1.5 sm:-right-1.5 bg-emerald-500 text-white rounded-full p-0.5 sm:p-1 border-2 border-black z-40 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
                              >
                                <Check size={isMobile ? 10 : 14} strokeWidth={4} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* Placa de Identidad y Fortuna */}
                        <div className={`mt-1 max-w-[86px] sm:max-w-[125px] bg-black/95 px-2 py-0.5 rounded-lg border ${
                          isMe
                            ? 'border-blue-500/70 shadow-[0_0_10px_rgba(59,130,246,0.3)]'
                            : isDirectNeighbor
                            ? 'border-amber-500/40 shadow-md'
                            : 'border-poker-gold/20 shadow-md'
                        } flex flex-col items-center backdrop-blur-md`}>
                          <div className="flex items-center gap-1">
                            {isMe && (
                              <span className="text-[5px] sm:text-[7px] bg-blue-500/20 text-blue-300 px-1 rounded font-black uppercase">
                                TÚ
                              </span>
                            )}
                            {isDirectNeighbor && (
                              <span className="text-[5px] sm:text-[7px] bg-amber-500/20 text-amber-300 px-1 rounded font-black uppercase">
                                VECINO
                              </span>
                            )}
                            {isBot && (
                              <Bot size={isMobile ? 8 : 10} className="text-gray-400 shrink-0" />
                            )}
                          </div>
                          <span className={`text-[7px] sm:text-[9px] font-black uppercase truncate w-full text-center ${isMe ? 'text-blue-400' : 'text-white'}`}>
                            {isMe ? cleanName : (p.is_incognito ? '🕵️ ???' : cleanName)}
                          </span>
                          <span className="text-[7px] sm:text-[9px] text-emerald-400 font-black">
                            ${p.balance.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* BANNER DE ESTADO DE FASE EN VIVO */}
        <div className="flex justify-center items-center z-30 my-1 shrink-0">
          <AnimatePresence mode="wait">
            {chipPhase === 'revealed' ? (
              <motion.div
                key="phase-revealed"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="px-4 py-1.5 rounded-full bg-amber-500/15 border border-amber-400/50 text-amber-300 text-[9px] sm:text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-[0_0_20px_rgba(245,158,11,0.2)] backdrop-blur-md"
              >
                <Sparkles size={13} className="animate-spin" />
                <span>Revelando jugadas de la Operación #{Math.max(1, roundNumber - 1)}...</span>
              </motion.div>
            ) : isResolving ? (
              <motion.div
                key="phase-resolving"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="px-4 py-1.5 rounded-full bg-red-500/20 border border-red-400/50 text-red-300 text-[9px] sm:text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-[0_0_20px_rgba(239,68,68,0.25)] animate-pulse backdrop-blur-md"
              >
                <ShieldAlert size={13} />
                <span>Ejecutando el golpe • Calculando botín...</span>
              </motion.div>
            ) : selectedAction ? (
              <motion.div
                key="phase-locked"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="px-4 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/50 text-emerald-300 text-[9px] sm:text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.2)] backdrop-blur-md"
              >
                <Lock size={12} />
                <span>
                  Jugada Sellada: <strong className="text-white">{ACTION_LABELS[selectedAction] || 'LISTO'}</strong> • Esperando a la Familia ({readyPlayers.size}/{players.length})
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="phase-playing"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="px-4 py-1.5 rounded-full bg-black/80 border border-poker-gold/40 text-poker-gold text-[9px] sm:text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-lg backdrop-blur-md"
              >
                <span>🎯 Tu turno: Elige tu carta táctica ({readyPlayers.size}/{players.length} listos)</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* CARTAS DE ACCIÓN TÁCTICAS VIP */}
        <div className="mt-auto flex justify-center gap-2.5 sm:gap-5 pt-1 pb-2 sm:p-3 z-30 shrink-0">
          <ActionCard
            label="Cooperar"
            subtitle={cooperateRewardText}
            badge="LEALTAD"
            icon={<Handshake />}
            selected={selectedAction === 'cooperate'}
            disabled={!!selectedAction || isSubmitting || isResolving || chipPhase !== 'playing'}
            onClick={() => handleAction('cooperate')}
            color="from-blue-600 via-blue-800 to-slate-950"
            accentBorder="border-blue-400/40 hover:border-blue-400"
            isMobile={isMobile}
          />
          <ActionCard
            label="Traicionar"
            subtitle="Roba el Pozo Global"
            badge="SABOTAJE"
            icon={<Revolver />}
            selected={selectedAction === 'betray'}
            disabled={!!selectedAction || isSubmitting || isResolving || chipPhase !== 'playing'}
            onClick={() => handleAction('betray')}
            color="from-red-600 via-red-900 to-slate-950"
            accentBorder="border-red-400/40 hover:border-red-400"
            isMobile={isMobile}
          />
          <ActionCard
            label="Trampa"
            subtitle={trapRewardText}
            badge="EMBOSCADA"
            icon={<UserX />}
            selected={selectedAction === 'trap'}
            disabled={!!selectedAction || isSubmitting || isResolving || chipPhase !== 'playing'}
            onClick={() => handleAction('trap')}
            color="from-purple-600 via-purple-900 to-slate-950"
            accentBorder="border-purple-400/40 hover:border-purple-400"
            isMobile={isMobile}
          />
        </div>

        {/* MERCADO NEGRO */}
        <AnimatePresence>
          {showShop && (
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="fixed inset-0 lg:absolute lg:right-0 lg:top-0 h-full w-full lg:w-96 bg-black/95 z-[110] p-6 sm:p-8 flex flex-col backdrop-blur-3xl border-l border-poker-gold/20">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-poker-gold font-black italic text-xl uppercase flex items-center gap-3">
                  <ShoppingBag /> Mercado Negro
                </h3>
                <button onClick={() => { soundEngine.playClick(); setShowShop(false); }} className="text-white bg-white/10 p-2 rounded-full hover:bg-white/20">
                  <X size={22} />
                </button>
              </div>
              <div className="space-y-5">
                <MiniShopItem
                  title="Modo Incógnito"
                  desc="Oculta tu nombre en la mesa durante esta operación para despistar a tus vecinos."
                  cost={500}
                  icon={<EyeOff size={22} />}
                  purchased={purchased.includes('incognito') || currentPlayer.is_incognito}
                  onBuy={() => buyItem('incognito', 500, 'is_incognito')}
                  canAfford={(currentPlayer?.balance || 0) >= 500}
                />
                <MiniShopItem
                  title="Contador de la Mafia"
                  desc="Blindaje contable de prestigio para operaciones de alto riesgo."
                  cost={500}
                  icon={<Search size={22} />}
                  purchased={purchased.includes('accountant') || currentPlayer.has_accountant}
                  onBuy={() => buyItem('accountant', 500, 'has_accountant')}
                  canAfford={(currentPlayer?.balance || 0) >= 500}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PANEL DE ESTADÍSTICAS */}
        <AnimatePresence>
          {showStats && (
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="fixed inset-0 bg-black/95 z-[130] flex flex-col backdrop-blur-3xl">
              <div className="p-6 border-b border-white/10 flex items-center justify-between max-w-3xl w-full mx-auto">
                <div className="flex items-center gap-3 text-poker-gold">
                  <BarChart2 size={20} />
                  <h2 className="font-black uppercase tracking-widest text-sm sm:text-base italic">Expediente de la Familia</h2>
                </div>
                <button onClick={() => { soundEngine.playClick(); setShowStats(false); }} className="text-white bg-white/10 p-2 rounded-full hover:bg-white/20">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 scrollbar-hide max-w-3xl w-full mx-auto">
                {stats.length === 0 ? (
                  <p className="text-gray-500 text-center mt-20 italic">No hay registros aún. Completa al menos una operación.</p>
                ) : (
                  <div className="space-y-3">
                    {[...stats].sort((a, b) => b.total_earned - a.total_earned).map((s, idx) => (
                      <div key={s.player_id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-gray-900 border-2 border-poker-gold/50 flex items-center justify-center text-sm font-black text-poker-gold flex-shrink-0">
                          #{idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-black text-xs sm:text-sm uppercase truncate">{s.player_name}</p>
                          <div className="flex gap-3 mt-1.5 flex-wrap">
                            <span className="text-blue-400 text-[10px] font-bold bg-blue-500/10 px-2 py-0.5 rounded-md">🤝 {s.total_cooperate} Leales</span>
                            <span className="text-red-400 text-[10px] font-bold bg-red-500/10 px-2 py-0.5 rounded-md">🗡 {s.total_betray} Traiciones</span>
                            <span className="text-purple-400 text-[10px] font-bold bg-purple-500/10 px-2 py-0.5 rounded-md">🪤 {s.total_trap} Trampas</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-emerald-400 text-xs sm:text-sm font-black">+${s.total_earned.toLocaleString()}</p>
                          <p className="text-red-400 text-[10px] font-bold">-${s.total_lost.toLocaleString()}</p>
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

      {/* BITÁCORA DE REPORTES LATERAL */}
      <AnimatePresence>
        {(showLogs || !isMobile) && (
          <motion.aside
            initial={isMobile ? { x: '100%' } : {}}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            className="fixed lg:relative inset-0 lg:inset-auto right-0 top-0 h-full w-full lg:w-88 xl:w-96 bg-black/60 border-l border-poker-gold/15 flex flex-col backdrop-blur-3xl z-[120] lg:z-10 shadow-2xl"
          >
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3 text-poker-gold">
                <History size={18} />
                <h2 className="font-black uppercase tracking-widest text-xs sm:text-sm italic">Bitácora de Operaciones</h2>
              </div>
              <button onClick={() => { soundEngine.playClick(); setShowLogs(false); }} className="lg:hidden text-white bg-white/10 p-1.5 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
              {logs.length === 0 ? (
                <div className="text-center text-gray-500 text-xs italic mt-12 px-4">
                  Los informes de inteligencia aparecerán aquí al finalizar la primera operación.
                </div>
              ) : (
                logs.map((log) => {
                  const isLatestRound = log.round_number === roundNumber - 1;
                  return (
                    <div
                      key={log.id}
                      className={`p-3.5 rounded-xl border-l-4 transition-all ${
                        log.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-100'
                          : log.type === 'danger'
                          ? 'bg-red-500/10 border-red-500 text-red-100'
                          : log.type === 'warning'
                          ? 'bg-amber-500/10 border-amber-500 text-amber-100'
                          : 'bg-blue-500/10 border-poker-gold text-blue-100'
                      } ${isLatestRound ? 'ring-1 ring-white/15 shadow-lg' : 'opacity-75'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[8px] font-black opacity-60 tracking-widest uppercase">
                          Operación #{log.round_number}
                        </p>
                        {isLatestRound && (
                          <span className="text-[7px] bg-poker-gold/20 text-poker-gold px-1.5 py-0.5 rounded font-black uppercase">
                            Reciente
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold leading-relaxed italic">"{log.message}"</p>
                    </div>
                  );
                })
              )}
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
  const color = type === 'gain' ? 'text-emerald-400' : type === 'loss' ? 'text-red-500' : 'text-gray-400';
  const prefix = type === 'gain' ? '+' : type === 'loss' ? '-' : '=';
  
  return (
    <motion.div
      initial={{ y: 0, opacity: 0, scale: 0.5 }}
      animate={{ y: isPool ? -55 : -38, opacity: [0, 1, 1, 0], scale: [0.5, 1.2, 1, 0.85] }}
      transition={{ duration: 3, times: [0, 0.18, 0.82, 1] }}
      className={`absolute left-1/2 -translate-x-1/2 font-black italic z-50 whitespace-nowrap drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] pointer-events-none ${color} ${isPool ? 'text-2xl sm:text-5xl' : 'text-xs sm:text-lg'}`}
    >
      {prefix}${amount.toLocaleString()}
    </motion.div>
  );
}

function ActionCard({ label, subtitle, badge, icon, selected, onClick, color, accentBorder, disabled, isMobile }: any) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileHover={!disabled ? { y: -8, scale: 1.04 } : {}}
      whileTap={!disabled ? { scale: 0.96 } : {}}
      onClick={onClick}
      className={`relative ${isMobile ? 'w-28 h-36' : 'w-44 h-56'} rounded-2xl overflow-hidden transition-all duration-300 select-none text-left ${
        selected
          ? '-translate-y-2.5 scale-105 z-20 cursor-default'
          : disabled
          ? 'opacity-35 grayscale-[60%] cursor-not-allowed'
          : 'opacity-100 cursor-pointer hover:shadow-[0_10px_30px_rgba(0,0,0,0.8)]'
      }`}
    >
      <div
        className={`w-full h-full bg-gradient-to-br ${color} border-2 ${
          selected
            ? 'border-poker-gold ring-4 ring-poker-gold/30 shadow-[0_0_25px_rgba(212,175,55,0.5)]'
            : accentBorder || 'border-white/15'
        } flex flex-col items-center justify-between p-2.5 sm:p-4 relative`}
      >
        {/* Encabezado de Naipe Táctico */}
        <div className="w-full flex items-center justify-between opacity-75">
          <span className="text-[7px] sm:text-[8px] font-mono font-black uppercase tracking-widest text-poker-gold">
            {badge}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-poker-gold/60" />
        </div>

        {/* Medallón Central */}
        <div className={`p-3 sm:p-4 rounded-full transition-transform ${selected ? 'bg-poker-gold/25 text-poker-gold scale-110' : 'bg-black/40 text-white border border-white/10'} shadow-inner`}>
          {React.cloneElement(icon as React.ReactElement, { size: isMobile ? 24 : 36 } as any)}
        </div>

        {/* Pie de Carta: Nombre y Efecto */}
        <div className="w-full text-center">
          <div className="font-black text-white uppercase tracking-wider italic text-[11px] sm:text-base leading-tight">
            {label}
          </div>
          <div className="text-[8px] sm:text-[10px] text-gray-300/90 font-bold mt-0.5 truncate">
            {subtitle}
          </div>
        </div>
      </div>

      {/* Sello de Jugada Seleccionada */}
      {selected && (
        <div className="absolute inset-0 bg-poker-gold/10 flex items-center justify-center pointer-events-none">
          <div className="bg-poker-gold text-black px-2.5 py-0.5 rounded-md text-[8px] sm:text-[10px] font-black uppercase tracking-widest transform -rotate-12 shadow-xl border border-black/30">
            ✓ SELLADO
          </div>
        </div>
      )}
    </motion.button>
  );
}

function MiniShopItem({ title, desc, cost, icon, purchased, onBuy, canAfford }: any) {
  return (
    <div className={`p-5 rounded-3xl border-2 transition-all ${purchased ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-3 text-poker-gold font-black text-sm uppercase">
          {icon} {title}
        </div>
        <span className="text-white font-black text-lg">${cost}</span>
      </div>
      {desc && <p className="text-gray-400 text-xs mb-4 leading-relaxed">{desc}</p>}
      <button
        onClick={onBuy}
        disabled={purchased || !canAfford}
        className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
          purchased
            ? 'bg-emerald-600 text-white'
            : canAfford
            ? 'bg-poker-gold text-black hover:bg-yellow-400 active:scale-95'
            : 'bg-gray-800 text-gray-500 cursor-not-allowed'
        }`}
      >
        {purchased ? '✓ ACTIVO ESTA RONDA' : 'ADQUIRIR'}
      </button>
    </div>
  );
}
