import { supabase } from './supabase';
import { botEngine } from './botEngine';

// ──────────────────────────────────────────
// CATÁLOGO DE EVENTOS ALEATORIOS
// ──────────────────────────────────────────
export const RANDOM_EVENTS = [
  {
    id: 'double_cooperate',
    label: '🤝 PACTO DE SANGRE: Cooperar vale el DOBLE esta ronda',
    description: 'Los cooperadores reciben $2,000 en vez de $1,000.',
  },
  {
    id: 'peace_betray',
    label: '⚖️ TREGUA ARMADA: Traidores se REPARTEN el pozo sin guerra',
    description: 'Si varios traidores llegan al pozo, en vez de quemarlo se lo dividen.',
  },
  {
    id: 'trap_refund',
    label: '🪤 MERCADO NEGRO: Las trampas roban el DOBLE',
    description: 'Cada trampa exitosa roba $2,000 al traidor.',
  },
  {
    id: 'jackpot',
    label: '💰 GOLPE GORDO: El pozo vale x1.5 al final',
    description: 'El pozo acumulado se multiplica x1.5 antes de repartirse.',
  },
  {
    id: 'none',
    label: '',
    description: '',
  },
  {
    id: 'none',
    label: '',
    description: '',
  },
  // Más ocurrencias de 'none' para que los eventos sean menos frecuentes
  { id: 'none', label: '', description: '' },
] as const;

export type EventId = typeof RANDOM_EVENTS[number]['id'];

function pickRandomEvent() {
  return RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
}

// ──────────────────────────────────────────
// MOTOR DE RONDAS
// ──────────────────────────────────────────
export const roundEngine = {
  async resolveRound(roomId: string, roundNumber: number) {
    const { data: players } = await supabase.from('mafia_players').select('*').eq('room_id', roomId);
    if (!players) return;

    const { data: existingActions } = await supabase
      .from('mafia_actions')
      .select('*')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber);

    // 1. Completar acciones faltantes (bots/inactivos)
    const existingPlayerIds = new Set(existingActions?.map(a => a.player_id) || []);
    const missingPlayers = players.filter(p => !existingPlayerIds.has(p.id));

    if (missingPlayers.length > 0) {
      const defaultActions = missingPlayers.map(p => {
        const isBot = p.name.includes('(Bot)');
        if (isBot) {
          const decision = botEngine.getDecision(p, players);
          return {
            room_id: roomId,
            round_number: roundNumber,
            player_id: p.id,
            target_id: decision?.target_id || players.find(other => other.id !== p.id)?.id || p.id,
            action_type: decision?.action_type || 'cooperate',
          };
        }
        return {
          room_id: roomId,
          round_number: roundNumber,
          player_id: p.id,
          target_id: players.find(other => other.id !== p.id)?.id || p.id,
          action_type: 'cooperate',
        };
      });
      await supabase.from('mafia_actions').insert(defaultActions);
    }

    const { data: allActions } = await supabase
      .from('mafia_actions')
      .select('*')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber);

    if (!allActions || allActions.length === 0) return;

    const { data: room } = await supabase.from('mafia_rooms').select('*').eq('id', roomId).single();
    if (!room) return;

    // 2. Leer y preparar el EVENTO ACTIVO (generado al inicio de la ronda)
    const activeEventId = (room.active_event || 'none') as EventId;

    // 3. Estructura de grupos (Barajado dinámico por ronda para rotar oponentes)
    const shuffledPlayers = [...players].sort((a, b) => {
      // Usar un hash más agresivo combinando ID y roundNumber
      const strA = a.id + roundNumber.toString();
      const strB = b.id + roundNumber.toString();
      let hashA = 0;
      let hashB = 0;
      for (let i = 0; i < strA.length; i++) hashA = ((hashA << 5) - hashA) + strA.charCodeAt(i);
      for (let i = 0; i < strB.length; i++) hashB = ((hashB << 5) - hashB) + strB.charCodeAt(i);
      return hashA - hashB;
    });

    const groups: any[][] = [];
    const n = shuffledPlayers.length;
    if (n <= 3) {
      groups.push(shuffledPlayers);
    } else {
      const numGroups = Math.ceil(n / 3);
      for (let i = 0; i < numGroups; i++) groups.push([]);
      shuffledPlayers.forEach((p, i) => {
        groups[i % numGroups].push(p);
      });
    }

    // 4. Estado inicial
    let newGlobalPool = Number(room.global_pool);

    // Aplicar JACKPOT antes de calcular (multiplicar pozo)
    if (activeEventId === 'jackpot') {
      newGlobalPool = Math.floor(newGlobalPool * 1.5);
    }

    const playerUpdates: Record<string, any> = {};
    const statDeltas: Record<string, {
      cooperate: number; betray: number; trap: number;
      earned: number; lost: number; betrayed: number; trapped: number;
      name: string;
    }> = {};

    players.forEach(p => {
      playerUpdates[p.id] = { balance: Number(p.balance), is_incognito: false, has_accountant: false };
      statDeltas[p.id] = { cooperate: 0, betray: 0, trap: 0, earned: 0, lost: 0, betrayed: 0, trapped: 0, name: p.name };
    });

    const logs: { room_id: string; round_number: number; message: string; type: string }[] = [];

    // 5. RESOLUCIÓN POR GRUPOS
    const successfulBetrayers: any[] = [];

    groups.forEach((group, groupIdx) => {
      const groupPlayerIds = group.map(p => p.id);
      const groupActions = allActions.filter(a => groupPlayerIds.includes(a.player_id));
      const groupBetrayers = groupActions.filter(a => a.action_type === 'betray');
      const groupTrappers = groupActions.filter(a => a.action_type === 'trap');
      const groupCooperators = groupActions.filter(a => a.action_type === 'cooperate');

      // Contabilizar acciones para stats
      groupActions.forEach(a => {
        if (statDeltas[a.player_id]) {
          if (a.action_type === 'cooperate') statDeltas[a.player_id].cooperate++;
          if (a.action_type === 'betray') statDeltas[a.player_id].betray++;
          if (a.action_type === 'trap') statDeltas[a.player_id].trap++;
          playerUpdates[a.player_id].last_action = a.action_type;
        }
      });

      // Fase local: Trampas
      const trapStealAmount = activeEventId === 'trap_refund' ? 2000 : 1000;

      if (groupTrappers.length > 0) {
        groupTrappers.forEach(t => {
          const trapper = group.find(p => p.id === t.player_id);
          let stolenFromGroup = 0;

          groupBetrayers.forEach(b => {
            const betrayer = group.find(p => p.id === b.player_id);
            if (betrayer && trapper) {
              const stealAmount = Math.floor(trapStealAmount / groupTrappers.length);
              playerUpdates[b.player_id].balance = Math.max(0, playerUpdates[b.player_id].balance - stealAmount);
              stolenFromGroup += stealAmount;
              statDeltas[b.player_id].lost += stealAmount;
              statDeltas[b.player_id].betrayed++;

              const poolSteal = Math.floor(Math.min(newGlobalPool, 1000) / groupTrappers.length);
              newGlobalPool -= poolSteal;
              stolenFromGroup += poolSteal;

              logs.push({
                room_id: roomId, round_number: roundNumber,
                message: `[Célula ${groupIdx + 1}] ¡EMBOSCADA! ${trapper.name} atrapó a ${betrayer.name}. +$${stolenFromGroup.toLocaleString()}`,
                type: 'warning',
              });
            }
          });

          playerUpdates[t.player_id].balance += stolenFromGroup;
          statDeltas[t.player_id].earned += stolenFromGroup;
          statDeltas[t.player_id].trapped += groupBetrayers.length;
        });
      }

      // Traidores que superan el grupo → van al pozo
      groupBetrayers.forEach(b => {
        if (groupTrappers.length === 0) {
          successfulBetrayers.push(b);
        }
      });

      // Recompensar cooperación (con evento double_cooperate)
      const cooperateReward = activeEventId === 'double_cooperate' ? 2000 : 1000;
      if (groupBetrayers.length === 0) {
        groupCooperators.forEach(c => {
          playerUpdates[c.player_id].balance += cooperateReward;
          newGlobalPool += 250;
          statDeltas[c.player_id].earned += cooperateReward;
        });
        if (groupCooperators.length > 1) {
          const extra = activeEventId === 'double_cooperate' ? ' (¡EVENTO ACTIVO: DOBLE!)' : '';
          logs.push({
            room_id: roomId, round_number: roundNumber,
            message: `[Célula ${groupIdx + 1}] Cooperación total. +$${cooperateReward.toLocaleString()} para todos.${extra}`,
            type: 'success',
          });
        }
      }
    });

    // 6. RESOLUCIÓN GLOBAL (traiciones exitosas)
    if (successfulBetrayers.length >= 2) {
      if (activeEventId === 'peace_betray') {
        // EVENTO: Los traidores se reparten el pozo en paz
        const sharePerBetrayer = Math.floor(newGlobalPool / successfulBetrayers.length);
        successfulBetrayers.forEach(b => {
          playerUpdates[b.player_id].balance += sharePerBetrayer;
          statDeltas[b.player_id].earned += sharePerBetrayer;
        });
        logs.push({
          room_id: roomId, round_number: roundNumber,
          message: `⚖️ TREGUA ARMADA: ${successfulBetrayers.length} traidores se repartieron el pozo de $${newGlobalPool.toLocaleString()} sin guerra. $${sharePerBetrayer.toLocaleString()} c/u.`,
          type: 'warning',
        });
        newGlobalPool = 1000; // Pozo vaciado con semilla
      } else {
        // Fuego cruzado normal → se quema el 50%
        const burned = Math.floor(newGlobalPool * 0.5);
        newGlobalPool = newGlobalPool - burned;
        logs.push({
          room_id: roomId, round_number: roundNumber,
          message: `¡FUEGO CRUZADO! Varios traidores escaparon. Se quemaron $${burned.toLocaleString()} del pozo.`,
          type: 'danger',
        });
      }
    } else if (successfulBetrayers.length === 1) {
      const winnerId = successfulBetrayers[0].player_id;
      const winner = players.find(p => p.id === winnerId);
      if (winner) {
        playerUpdates[winnerId].balance += newGlobalPool;
        statDeltas[winnerId].earned += newGlobalPool;
        logs.push({
          room_id: roomId, round_number: roundNumber,
          message: `¡TRAICIÓN GLOBAL! ${winner.name} burló a su grupo y vació el pozo de $${newGlobalPool.toLocaleString()}.`,
          type: 'danger',
        });
        newGlobalPool = 1000; // POZO A SEMILLA
      }
    }

    // 7. Restaurar pozo mínimo si quedó bajo el umbral
    if (newGlobalPool < 1000) {
      newGlobalPool = 1000; 
    }

    // 8. Actualizar balances en DB
    for (const [pid, updates] of Object.entries(playerUpdates)) {
      await supabase.from('mafia_players').update(updates).eq('id', pid);
    }

    // 9. Actualizar estadísticas acumuladas
    for (const [pid, delta] of Object.entries(statDeltas)) {
      const { data: existing } = await supabase.from('mafia_player_stats')
        .select('*').eq('room_id', roomId).eq('player_id', pid).single();

      if (existing) {
        await supabase.from('mafia_player_stats').update({
          total_cooperate: existing.total_cooperate + delta.cooperate,
          total_betray: existing.total_betray + delta.betray,
          total_trap: existing.total_trap + delta.trap,
          total_earned: existing.total_earned + delta.earned,
          total_lost: existing.total_lost + delta.lost,
          times_betrayed: existing.times_betrayed + delta.betrayed,
          times_trapped: existing.times_trapped + delta.trapped,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        await supabase.from('mafia_player_stats').insert({
          room_id: roomId,
          player_id: pid,
          player_name: delta.name,
          total_cooperate: delta.cooperate,
          total_betray: delta.betray,
          total_trap: delta.trap,
          total_earned: delta.earned,
          total_lost: delta.lost,
          times_betrayed: delta.betrayed,
          times_trapped: delta.trapped,
        });
      }
    }

    // 10. Elegir nuevo evento para la siguiente ronda
    const nextEvent = pickRandomEvent();

    // 11. Actualizar Capo
    const sortedPlayers = Object.entries(playerUpdates).sort((a, b) => b[1].balance - a[1].balance);
    const topPlayerId = sortedPlayers[0]?.[0];
    await supabase.from('mafia_players').update({ is_capo: false }).eq('room_id', roomId);
    if (topPlayerId) {
      await supabase.from('mafia_players').update({ is_capo: true }).eq('id', topPlayerId);
    }

    if (logs.length > 0) {
      await supabase.from('mafia_logs').insert(logs);
    }

    const isGameOver = (roundNumber + 1) > (room.max_rounds || 10);
    const nextStatus = isGameOver ? 'finished' : 'playing';

    await supabase.from('mafia_rooms').update({
      global_pool: newGlobalPool,
      round_number: roundNumber + 1,
      status: nextStatus,
      active_event: nextEvent.id !== 'none' ? nextEvent.id : null,
      active_event_label: nextEvent.id !== 'none' ? nextEvent.label : null,
    }).eq('id', roomId);

    await supabase.channel(`room:${roomId}`).send({
      type: 'broadcast',
      event: 'round_resolved',
      payload: {
        round: roundNumber,
        globalPool: newGlobalPool,
        status: nextStatus,
        activeEvent: nextEvent.id !== 'none' ? nextEvent : null,
      },
    });
  },
};
