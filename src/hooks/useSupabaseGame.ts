import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import { botEngine } from '../lib/botEngine';

export const sendRoundResolving = async (roomId: string) => {
  if (!roomId) return;
  await supabase.channel(`room:${roomId}`).send({
    type: 'broadcast',
    event: 'round_resolving',
    payload: { timestamp: Date.now() }
  });
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
        }, 6000);
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

    // Polling ligero de respaldo (cada 2.5s) para mantener sincronía en móviles o microcortes de socket
    const pollInterval = setInterval(() => {
      fetchState();
    }, 2500);

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
            }, 6000);
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mafia_actions' }, () => {
        // Solo notificamos sonido de click-clack, la resolución la maneja centralizadamente GameBoard.tsx
      })
      .on('broadcast', { event: 'action_lock_in' }, () => {
        new Audio('/click-clack.mp3').play().catch(() => {});
        window.dispatchEvent(new CustomEvent('screenshake'));
      })
      .on('broadcast', { event: 'round_resolved' }, (payload) => {
        window.dispatchEvent(new CustomEvent('round_resolved', { detail: payload.payload }));
      })
      .on('broadcast', { event: 'round_resolving' }, () => {
        window.dispatchEvent(new CustomEvent('round_resolving'));
      })
      .subscribe((subStatus) => {
        console.log(`Estado de suscripción para sala ${roomId}:`, subStatus);
      }, 30000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [roomId, playerId]);

  // 2. Lógica de HOST para Bots
  useEffect(() => {
    if (!isHost || !roomId || status !== 'playing') return;
    
    // Simular bots (con delay para realismo)
    const botTimer = setTimeout(() => {
      botEngine.simulateBotActions(roomId, roundNumber, players);
    }, 2000);

    return () => clearTimeout(botTimer);
  }, [status, roundNumber, isHost, roomId]);

  return { sendRoundResolving: () => sendRoundResolving(roomId || '') };
}
