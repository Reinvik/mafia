import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore, type Player } from '../store/gameStore';
import { supabase } from '../lib/supabase';
import { soundEngine } from '../lib/soundEngine';
import { Trophy, LogOut, Skull, Star, Zap, Shield, Target, Ghost, Medal, Crown } from 'lucide-react';

interface Award {
  title: string;
  description: string;
  icon: React.ReactNode;
  playerNames: string[];
  playerIds: string[];
}

export function GameOver() {
  const { players, roomId, isHost, resetGame } = useGameStore();
  const [localPlayers, setLocalPlayers] = useState<Player[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [currentAwardIdx, setCurrentAwardIdx] = useState(-1);
  const [isBonusPhase, setIsBonusPhase] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (!roomId) return;
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    let isMounted = true;

    const initGameOver = async () => {
      const { data: room } = await supabase.from('mafia_rooms').select('bonus_enabled, active_event').eq('id', roomId).single();
      const { data: stats } = await supabase.from('mafia_player_stats').select('*').eq('room_id', roomId);
      const { data: dbPlayers } = await supabase.from('mafia_players').select('*').eq('room_id', roomId).order('created_at', { ascending: true });

      if (!isMounted) return;

      const initialPlayers: Player[] = dbPlayers && dbPlayers.length > 0 ? (dbPlayers as Player[]) : [...players];
      setLocalPlayers(initialPlayers);

      // Si las bonificaciones ya fueron procesadas previamente (por ejemplo, al recargar la pantalla)
      const alreadyProcessed = room?.active_event === 'awards_processed';

      if (room?.bonus_enabled && stats && stats.length > 0) {
        const calculatedAwards: Award[] = [];

        // 1. Mente Siniestra: Traiciones ejecutadas con éxito (en clásico o círculo donde 1 traición puede acertar a 2 vecinos)
        const sinister = stats.filter(s => s.total_betray > 0 && s.successful_betrayals >= s.total_betray)
          .map(s => ({ id: s.player_id, name: s.player_name }));
        if (sinister.length > 0) {
          calculatedAwards.push({
            title: "Mente Siniestra",
            description: "Traiciones implacables ejecutadas con éxito",
            icon: <Ghost className="text-purple-400" />,
            playerIds: sinister.map(s => s.id),
            playerNames: sinister.map(s => s.name)
          });
        }

        // 2. Jugador de Equipo
        const maxCoop = Math.max(...stats.map(s => s.total_cooperate));
        if (maxCoop > 0) {
          const teamPlayers = stats.filter(s => s.total_cooperate === maxCoop)
            .map(s => ({ id: s.player_id, name: s.player_name }));
          calculatedAwards.push({
            title: "Jugador de Equipo",
            description: "El más cooperador de la familia",
            icon: <Shield className="text-blue-400" />,
            playerIds: teamPlayers.map(s => s.id),
            playerNames: teamPlayers.map(s => s.name)
          });
        }

        // 3. Instinto Cazador
        const maxTraps = Math.max(...stats.map(s => s.successful_traps));
        if (maxTraps > 0) {
          const hunters = stats.filter(s => s.successful_traps === maxTraps)
            .map(s => ({ id: s.player_id, name: s.player_name }));
          calculatedAwards.push({
            title: "Instinto Cazador",
            description: "Trampas que atraparon traidores",
            icon: <Target className="text-red-400" />,
            playerIds: hunters.map(s => s.id),
            playerNames: hunters.map(s => s.name)
          });
        }

        // 4. Paranoico
        const maxFailedTraps = Math.max(...stats.map(s => s.failed_traps));
        if (maxFailedTraps > 0) {
          const paranoics = stats.filter(s => s.failed_traps === maxFailedTraps)
            .map(s => ({ id: s.player_id, name: s.player_name }));
          calculatedAwards.push({
            title: "Paranoico",
            description: "Levantó más trampas fallidas por miedo",
            icon: <Zap className="text-yellow-400" />,
            playerIds: paranoics.map(s => s.id),
            playerNames: paranoics.map(s => s.name)
          });
        }

        // 5. Contracorriente
        const rebels = stats.filter(s => s.event_benefits === 0)
          .map(s => ({ id: s.player_id, name: s.player_name }));
        if (rebels.length > 0 && rebels.length < stats.length) {
          calculatedAwards.push({
            title: "Contracorriente",
            description: "No aprovechó ninguna bonificación de escenario",
            icon: <Medal className="text-gray-400" />,
            playerIds: rebels.map(s => s.id),
            playerNames: rebels.map(s => s.name)
          });
        }

        // 6. El Sobreviviente
        const maxBetrayed = Math.max(...stats.map(s => s.times_betrayed));
        if (maxBetrayed > 0) {
          const survivors = stats.filter(s => s.times_betrayed === maxBetrayed)
            .map(s => ({ id: s.player_id, name: s.player_name }));
          calculatedAwards.push({
            title: "El Sobreviviente",
            description: "El que más disparos recibió y sigue en pie",
            icon: <Skull className="text-orange-400" />,
            playerIds: survivors.map(s => s.id),
            playerNames: survivors.map(s => s.name)
          });
        }

        // 7. El Pacifista
        const pacifists = stats.filter(s => s.total_betray === 0)
          .map(s => ({ id: s.player_id, name: s.player_name }));
        if (pacifists.length > 0 && pacifists.length < stats.length) {
          calculatedAwards.push({
            title: "El Pacifista",
            description: "Mantuvo sus manos limpias toda la partida",
            icon: <Shield className="text-green-400" />,
            playerIds: pacifists.map(s => s.id),
            playerNames: pacifists.map(s => s.name)
          });
        }

        setAwards(calculatedAwards);

        if (calculatedAwards.length > 0 && !alreadyProcessed) {
          setIsBonusPhase(true);
          setCurrentAwardIdx(0);
        } else {
          setIsBonusPhase(false);
        }
      } else {
        setIsBonusPhase(false);
      }
      setIsLoading(false);
    };

    initGameOver();

    return () => {
      isMounted = false;
    };
  }, [roomId]);

  // Manejo secuencial de la premiación
  useEffect(() => {
    if (!isBonusPhase || awards.length === 0) return;

    if (currentAwardIdx >= 0 && currentAwardIdx < awards.length) {
      const award = awards[currentAwardIdx];

      // 1. A los 1200ms de mostrar la tarjeta: sumar los $1,000 y reproducir sonido de monedas sin latencia
      const moneyTimer = setTimeout(() => {
        soundEngine.playCash();

        setLocalPlayers(prev => {
          const updated = prev.map(p => {
            if (award.playerIds.includes(p.id)) {
              return { ...p, balance: p.balance + 1000 };
            }
            return p;
          });

          useGameStore.getState().setPlayers(updated);

          // Si soy Host, persistir inmediatamente en la base de datos
          if (isHost && roomId) {
            for (const pid of award.playerIds) {
              const pUp = updated.find(p => p.id === pid);
              if (pUp) {
                supabase.from('mafia_players').update({ balance: pUp.balance }).eq('id', pid).then(() => {});
              }
            }
          }

          return updated;
        });
      }, 1200);

      // 2. A los 4000ms: avanzar al siguiente premio
      const nextTimer = setTimeout(() => {
        setCurrentAwardIdx(prev => prev + 1);
      }, 4000);

      return () => {
        clearTimeout(moneyTimer);
        clearTimeout(nextTimer);
      };
    } else if (currentAwardIdx >= awards.length) {
      // Fin de la fase de premios: cerrar tarjeta y coronar al Capo definitivo
      setIsBonusPhase(false);

      setLocalPlayers(prev => {
        const sorted = [...prev].sort((a, b) => b.balance - a.balance);
        const topId = sorted[0]?.id;
        const finalPlayers = prev.map(p => ({
          ...p,
          is_capo: p.id === topId
        }));

        useGameStore.getState().setPlayers(finalPlayers);

        if (isHost && roomId) {
          supabase.from('mafia_players').update({ is_capo: false }).eq('room_id', roomId).then(async () => {
            if (topId) {
              await supabase.from('mafia_players').update({ is_capo: true }).eq('id', topId);
            }
            await supabase.from('mafia_rooms').update({ active_event: 'awards_processed' }).eq('id', roomId);
          });
        }

        return finalPlayers;
      });
    }
  }, [isBonusPhase, awards, currentAwardIdx, isHost, roomId]);

  const sortedPlayers = [...localPlayers].sort((a, b) => b.balance - a.balance);

  if (isLoading) return null;

  return (
    <div className="min-h-screen bg-mafia-deep flex items-center justify-center p-4 overflow-y-auto">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-xl w-full bg-black/95 p-6 sm:p-12 rounded-3xl sm:rounded-[4rem] border-4 border-poker-gold shadow-[0_0_100px_rgba(212,175,55,0.3)] text-center relative my-8"
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-poker-gold to-transparent"></div>
        
        <Trophy className="w-20 h-20 text-poker-gold mx-auto mb-6 animate-bounce" />
        
        <h1 className="text-4xl font-black text-white uppercase tracking-tighter mb-2 italic">PARTIDA FINALIZADA</h1>
        <p className="text-poker-gold font-bold tracking-[0.4em] text-xs mb-8 uppercase">La familia tiene un nuevo Capo</p>

        <AnimatePresence mode="wait">
          {isBonusPhase && currentAwardIdx >= 0 && currentAwardIdx < awards.length && (
            <motion.div 
              key={`award-${currentAwardIdx}`}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="mb-8 p-6 bg-poker-gold/10 border-2 border-poker-gold/40 rounded-3xl relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-2">
                <Star className="text-poker-gold animate-spin-slow" size={24} />
              </div>
              <div className="flex items-center justify-center gap-3 mb-2">
                {awards[currentAwardIdx].icon}
                <h3 className="text-poker-gold text-2xl font-black uppercase italic">{awards[currentAwardIdx].title}</h3>
              </div>
              <p className="text-gray-400 text-sm mb-4 italic">{awards[currentAwardIdx].description}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {awards[currentAwardIdx].playerNames.map(name => (
                  <motion.span 
                    key={name}
                    animate={{ scale: [1, 1.1, 1] }}
                    className="bg-poker-gold text-black font-black px-4 py-1 rounded-full text-sm shadow-lg"
                  >
                    {name} +$1,000
                  </motion.span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-3 mb-10">
          {sortedPlayers.map((player, idx) => (
            <motion.div 
              key={player.id}
              layout
              initial={{ x: -50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className={`flex items-center justify-between p-4 rounded-2xl border transition-all duration-500 ${idx === 0 ? 'bg-poker-gold border-poker-gold shadow-[0_0_20px_rgba(212,175,55,0.4)]' : 'bg-gray-900/50 border-white/5'}`}
            >
              <div className="flex items-center gap-4">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${idx === 0 ? 'bg-black text-poker-gold' : 'bg-gray-800 text-gray-500'}`}>
                  {idx + 1}
                </span>
                <span className={`font-bold text-sm sm:text-base flex items-center gap-2 ${idx === 0 ? 'text-black' : 'text-white'}`}>
                  {player.name}
                  {idx === 0 && <Crown size={16} className="text-black inline shrink-0" />}
                </span>
              </div>
              <motion.span 
                key={player.balance}
                initial={{ scale: 1.3, color: "#D4AF37" }}
                animate={{ scale: 1, color: idx === 0 ? "#000" : "#fff" }}
                transition={{ duration: 0.3 }}
                className="text-lg sm:text-xl font-black"
              >
                ${player.balance.toLocaleString()}
              </motion.span>
            </motion.div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          {isHost ? (
            <button 
              onClick={async () => {
                if (!roomId) return;
                soundEngine.playClick();
                await Promise.all([
                  supabase.from('mafia_players').update({ 
                    balance: 0,
                    last_action: null,
                    is_capo: false,
                    is_incognito: false,
                    has_accountant: false
                  }).eq('room_id', roomId),
                  supabase.from('mafia_actions').delete().eq('room_id', roomId),
                  supabase.from('mafia_logs').delete().eq('room_id', roomId),
                  supabase.from('mafia_player_stats').update({
                    total_cooperate: 0,
                    total_betray: 0,
                    total_trap: 0,
                    successful_traps: 0,
                    failed_traps: 0,
                    successful_betrayals: 0,
                    event_benefits: 0,
                    total_earned: 0,
                    total_lost: 0,
                    times_betrayed: 0,
                    times_trapped: 0
                  }).eq('room_id', roomId)
                ]);

                await supabase.from('mafia_rooms').update({
                  status: 'waiting',
                  round_number: 1,
                  global_pool: 2000,
                  active_event: null,
                  active_event_label: null
                }).eq('id', roomId);
              }}
              className="w-full bg-poker-gold text-black font-black py-5 rounded-2xl hover:bg-yellow-500 transition-all flex items-center justify-center gap-3 text-lg shadow-[0_6px_0_#9a7d25] active:translate-y-1 active:shadow-none"
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
