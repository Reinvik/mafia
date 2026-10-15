import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import { botEngine } from '../lib/botEngine';
import { soundEngine } from '../lib/soundEngine';

export const sendRoundResolving = async (roomId: string, roundNumber?: number) => {
  if (!roomId) return;
  const existingChannel = supabase.getChannels().find(ch => ch.topic === `realtime:room:${roomId}`);
  const targetChannel = existingChannel || supabase.channel(`room:${roomId}`);
  try {
    await targetChannel.send({
      type: 'broadcast',
      event: 'round_resolving',
      payload: { round: roundNumber, timestamp: Date.now() }
    });
  } catch {
    // Fallback silencioso: la transición de ronda se sincroniza por base de datos
  }
};

export function useSupabaseGame() {
  const { roomId, playerId, status, setRoomInfo, setPlayers, players, isHost, setIsHost, roundNumber, setCurrentPlayer, resetGame } = useGameStore();

  // 1. Verificación de sesión y suscripciones
  useEffect(() => {
    if (!roomId || !playerId) return;

    let isMounted = true;

    const fetchState = async () => {
      // Verificar si la sala existe
      const { data: room, error: roomErr } = await supabase.from('mafia_rooms').select('*').eq('id', roomId).single();
      if (!isMounted) return;
      if (roomErr || !room) {
        console.error("Sala no encontrada, reseteando...");
        resetGame();
        return;
      }
      
      const currentStoreStatus = useGameStore.getState().status;
      if (room.status === 'finished' && currentStoreStatus !== 'finished') {
        setRoomInfo({ 
          id: room.id, 
          status: currentStoreStatus, 
          globalPool: room.global_pool, 
          roundNumber: room.round_number,
          max_rounds: room.max_rounds,
          game_mode: room.game_mode
        });
        setTimeout(() => {
          if (isMounted) {
            setRoomInfo({
              id: room.id,
              status: 'finished',
              globalPool: room.global_pool,
              roundNumber: room.round_number,
              max_rounds: room.max_rounds,
              game_mode: room.game_mode
            });
          }
        }, 5000);
      } else {
        setRoomInfo({ 
          id: room.id, 
          status: room.status as any, 
          globalPool: room.global_pool, 
          roundNumber: room.round_number,
          max_rounds: room.max_rounds,
          game_mode: room.game_mode
        });
      }

      // Verificar si el jugador existe
      const { data: plist, error: pErr } = await supabase.from('mafia_players').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
      if (!isMounted || pErr || !plist) return;
      
      const me = plist.find(p => p.id === playerId);
      if (!me) {
        console.error("Jugador no encontrado en esta sala, reseteando...");
        resetGame();
        return;
      }

      // Si la partida ya finalizó ('finished'), no sobreescribir los balances durante la premiación
      if (currentStoreStatus === 'finished' && room.status === 'finished') {
        if (plist[0].id === playerId) setIsHost(true);
        return;
      }
      
      setPlayers(plist as any[]);
      setCurrentPlayer(me as any);

      // Determinar si soy Host (el primero en unirse es el host)
      if (plist[0].id === playerId) {
        setIsHost(true);
      }
    };

    fetchState();

    const handleForceSync = () => {
      fetchState();
    };
    window.addEventListener('force_game_sync', handleForceSync);

    // Polling ligero de respaldo (cada 2s) para mantener sincronía en móviles o microcortes de socket
    const pollInterval = setInterval(() => {
      fetchState();
    }, 2000);

    // Limpiar canales previos para esta sala
    supabase.getChannels().forEach(ch => {
      if (ch.topic === `realtime:room:${roomId}`) supabase.removeChannel(ch);
    });

    const channel = supabase.channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mafia_rooms' }, (payload) => {
        const newRoom = payload.new as any;
        if (newRoom && newRoom.id === roomId) {
          if (newRoom.status === 'finished' && useGameStore.getState().status !== 'finished') {
            setRoomInfo({ 
              id: newRoom.id,
              status: useGameStore.getState().status,
              globalPool: newRoom.global_pool, 
              roundNumber: newRoom.round_number,
              max_rounds: newRoom.max_rounds,
              game_mode: newRoom.game_mode 
            });
            setTimeout(() => {
              if (isMounted) {
                setRoomInfo({
                  id: newRoom.id,
                  status: 'finished',
                  globalPool: newRoom.global_pool,
                  roundNumber: newRoom.round_number,
                  max_rounds: newRoom.max_rounds,
                  game_mode: newRoom.game_mode
                });
              }
            }, 5000);
          } else {
            setRoomInfo({ 
              id: newRoom.id, 
              status: newRoom.status, 
              globalPool: newRoom.global_pool, 
              roundNumber: newRoom.round_number,
              max_rounds: newRoom.max_rounds,
              game_mode: newRoom.game_mode
            });
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mafia_players' }, (payload) => {
        const player = (payload.new || payload.old) as any;
        if (player && player.room_id === roomId) {
          if (useGameStore.getState().status === 'finished') return;
          supabase.from('mafia_players').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).then(({data}) => {
            if (data && isMounted) {
              setPlayers(data as any[]);
              
              const stillInRoom = data.some(p => p.id === playerId);
              if (!stillInRoom) {
                console.log("Has sido expulsado de la sala.");
                resetGame();
                return;
              }

              if (data[0]?.id === playerId) setIsHost(true);

              const me = data.find(p => p.id === playerId);
              if (me) setCurrentPlayer(me as any);
            }
          });
        }
      })
      .on('broadcast', { event: 'action_lock_in' }, () => {
        soundEngine.playLockIn();
        window.dispatchEvent(new CustomEvent('screenshake'));
      })
      .on('broadcast', { event: 'round_resolved' }, (payload) => {
        window.dispatchEvent(new CustomEvent('round_resolved', { detail: payload.payload }));
      })
      .on('broadcast', { event: 'round_resolving' }, (payload) => {
        window.dispatchEvent(new CustomEvent('round_resolving', { detail: payload.payload }));
      })
      .subscribe((subStatus) => {
        console.log(`Estado de suscripción para sala ${roomId}:`, subStatus);
      }, 30000);

    return () => {
      isMounted = false;
      window.removeEventListener('force_game_sync', handleForceSync);
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [roomId, playerId]);

  // 2. Lógica de HOST para Bots
  useEffect(() => {
    if (!isHost || !roomId || status !== 'playing') return;
    
    // En la ronda 1 los bots votan rápido (1.2s+); en rondas > 1 esperan a que termine la revelación de 3.5s
    const baseDelay = roundNumber > 1 ? 3800 : 1200;
    botEngine.simulateBotActions(roomId, roundNumber, players, baseDelay);

    return () => {
      botEngine.clearBotTimers();
    };
  }, [status, roundNumber, isHost, roomId, players.length]);

  return { sendRoundResolving: (r?: number) => sendRoundResolving(roomId || '', r) };
}
