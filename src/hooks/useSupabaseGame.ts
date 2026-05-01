import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import { botEngine } from '../lib/botEngine';

export function useSupabaseGame() {
  const { roomId, playerId, status, setRoomInfo, setPlayers, players, isHost, setIsHost, roundNumber, setCurrentPlayer, resetGame } = useGameStore();

  // 1. Verificación de sesión y suscripciones
  useEffect(() => {
    if (!roomId || !playerId) return;

    const fetchState = async () => {
      // Verificar si la sala existe
      const { data: room, error: roomErr } = await supabase.from('mafia_rooms').select('*').eq('id', roomId).single();
      if (roomErr || !room) {
        console.error("Sala no encontrada, reseteando...");
        resetGame();
        return;
      }
      
      setRoomInfo({ 
        id: room.id, 
        status: room.status as any, 
        globalPool: room.global_pool, 
        roundNumber: room.round_number,
        max_rounds: room.max_rounds 
      });

      // Verificar si el jugador existe
      const { data: plist, error: pErr } = await supabase.from('mafia_players').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
      if (pErr || !plist) return;
      
      const me = plist.find(p => p.id === playerId);
      if (!me) {
        console.error("Jugador no encontrado en esta sala, reseteando...");
        resetGame();
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

    // Limpiar canales previos
    supabase.getChannels().forEach(ch => {
      if (ch.topic === `realtime:room:${roomId}`) supabase.removeChannel(ch);
    });

    const channel = supabase.channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mafia_rooms' }, (payload) => {
        const newRoom = payload.new as any;
        if (newRoom.id === roomId) {
          const updateState = () => {
            setRoomInfo({ 
              id: newRoom.id, 
              status: newRoom.status, 
              globalPool: newRoom.global_pool, 
              roundNumber: newRoom.round_number,
              max_rounds: newRoom.max_rounds 
            });
          };

          if (newRoom.status === 'finished') {
            setTimeout(updateState, 4000);
          } else {
            updateState();
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mafia_players' }, (payload) => {
        const player = (payload.new || payload.old) as any;
        if (player.room_id === roomId) {
          supabase.from('mafia_players').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).then(({data}) => {
            if (data) {
              setPlayers(data as any[]);
              if (data[0]?.id === playerId) setIsHost(true);
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
        // El broadcast trae actions (mapa playerId->accion) y hasBetrayal
        window.dispatchEvent(new CustomEvent('round_resolved', { detail: payload.payload }));
      })
      .on('broadcast', { event: 'round_resolving' }, () => {
        window.dispatchEvent(new CustomEvent('round_resolving'));
      })
      .subscribe((status) => {
        console.log(`Estado de suscripción para sala ${roomId}:`, status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, playerId, isHost, roundNumber, players.length]);

  // 2. Lógica de HOST para Bots
  useEffect(() => {
    if (!isHost || !roomId || status !== 'playing') return;
    
    // Simular bots (con delay para realismo)
    setTimeout(() => {
      botEngine.simulateBotActions(roomId, roundNumber, players);
    }, 2000);
  }, [status, roundNumber, isHost, roomId]);

  const sendActionLockIn = async () => {
    if(!roomId) return;
    await supabase.channel(`room:${roomId}`).send({
      type: 'broadcast',
      event: 'action_lock_in',
      payload: { timestamp: Date.now() }
    });
  };

  const sendRoundResolving = async () => {
    if(!roomId) return;
    await supabase.channel(`room:${roomId}`).send({
      type: 'broadcast',
      event: 'round_resolving',
      payload: { timestamp: Date.now() }
    });
  };

  return { sendActionLockIn, sendRoundResolving };
}
