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

    // 1. Verificación de seguridad: ¿Ya se resolvió esta ronda?
    const { count } = await supabase
      .from('mafia_logs')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', roomId)
      .eq('round_number', roundNumber);

    if (count && count > 0) {
      console.log(`Ronda ${roundNumber} ya tiene logs. Asegurando que la habitación avance...`);
      // Si ya hay logs, significa que la lógica ya corrió. 
      // Forzamos el avance de la habitación por si se quedó trabada.
      await supabase.from('mafia_rooms').update({ 
        round_number: roundNumber + 1,
        status: 'playing' 
      }).eq('id', roomId).eq('round_number', roundNumber);
      return;
    }

    const { data: allActions } = await supabase
      .from('mafia_actions')
      .select('*')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber);

    const safeActions = allActions || [];

    // Eliminar acciones duplicadas por jugador (por si un bot o jugador inserta 2 veces por error de red)
    const uniqueActionsMap = new Map();
    safeActions.forEach(a => {
      if (!uniqueActionsMap.has(a.player_id)) {
        uniqueActionsMap.set(a.player_id, a);
      }
    });

    // Auto-completar acciones faltantes con 'cooperate' para que el juego NUNCA se trabe
    const missingActions: any[] = [];
    players.forEach(p => {
      if (!uniqueActionsMap.has(p.id)) {
        const fallbackAction = {
          room_id: roomId,
          round_number: roundNumber,
          player_id: p.id,
          target_id: p.id,
          action_type: 'cooperate'
        };
        uniqueActionsMap.set(p.id, fallbackAction);
        missingActions.push(fallbackAction);
      }
    });

    // Si hubo jugadores que no jugaron (se acabó el tiempo), guardamos su 'cooperate' por defecto en BD
    if (missingActions.length > 0) {
      await supabase.from('mafia_actions').insert(missingActions);
    }

    const filteredActions = Array.from(uniqueActionsMap.values());

    const { data: room } = await supabase.from('mafia_rooms').select('*').eq('id', roomId).single();
    if (!room) return;

    // 2. Leer y preparar el EVENTO ACTIVO (generado al inicio de la ronda)
    const activeEventId = (room.active_event || 'none') as EventId;

    // 3. Estructura de grupos (Barajado dinámico por ronda para rotar oponentes)
    // 3. Estructura de grupos (Fisher-Yates determinístico con semilla para rotar oponentes)
    const seedString = roomId + roundNumber.toString();
    const shuffledPlayers = [...players];
    
    // Función para generar un número pseudo-aleatorio basado en el seed
    let h = 0;
    for (let i = 0; i < seedString.length; i++) {
      h = Math.imul(31, h) + seedString.charCodeAt(i) | 0;
    }
    
    const seededRandom = () => {
      h = Math.imul(h ^ h >>> 16, 0x85ebca6b) | 0;
      h = Math.imul(h ^ h >>> 13, 0xc2b2ae35) | 0;
      h = (h ^ h >>> 16) >>> 0;
      return h / 0xffffffff;
    };

    for (let i = shuffledPlayers.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
    }

    const groups: any[][] = [];
    if (room.game_mode !== 'circle') {
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
      successful_traps: number; failed_traps: number;
      successful_betrayals: number; event_benefits: number;
      name: string;
      last_action?: string;
    }> = {};

    players.forEach(p => {
      playerUpdates[p.id] = { balance: Number(p.balance), is_incognito: false, has_accountant: false };
      statDeltas[p.id] = { 
        cooperate: 0, betray: 0, trap: 0, earned: 0, lost: 0, betrayed: 0, trapped: 0, 
        successful_traps: 0, failed_traps: 0, successful_betrayals: 0, event_benefits: 0,
        name: p.name 
      };
    });

    const logs: { room_id: string; round_number: number; message: string; type: string }[] = [];
    const successfulBetrayers: any[] = [];

    if (room.game_mode === 'circle') {
      const n = shuffledPlayers.length;
      shuffledPlayers.forEach((p, i) => {
        const action = uniqueActionsMap.get(p.id);
        if (!action) return;
        const leftIdx = (i - 1 + n) % n;
        const rightIdx = (i + 1) % n;
        const leftAction = uniqueActionsMap.get(shuffledPlayers[leftIdx].id);
        const rightAction = uniqueActionsMap.get(shuffledPlayers[rightIdx].id);
        
        statDeltas[p.id].last_action = action.action_type;
        playerUpdates[p.id].last_action = action.action_type;

        if (action.action_type === 'cooperate') {
          statDeltas[p.id].cooperate++;
          let betrayalCount = 0;
          let betrayedBy: string[] = [];
          if (leftAction?.action_type === 'betray') { betrayalCount++; betrayedBy.push(shuffledPlayers[leftIdx].name); }
          if (rightAction?.action_type === 'betray') { betrayalCount++; betrayedBy.push(shuffledPlayers[rightIdx].name); }
          
          if (betrayalCount === 0) {
            const reward = activeEventId === 'double_cooperate' ? 2000 : 1000;
            playerUpdates[p.id].balance += reward;
            statDeltas[p.id].earned += reward;
            newGlobalPool += 250;
            logs.push({ room_id: roomId, round_number: roundNumber, message: `🤝 ${p.name} cooperó con éxito y ganó $${reward}`, type: 'success' });
          } else {
            const loss = 1000 * betrayalCount;
            playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - loss);
            statDeltas[p.id].lost += loss;
            statDeltas[p.id].betrayed += betrayalCount;
            logs.push({ room_id: roomId, round_number: roundNumber, message: `🗡️ ${p.name} fue traicionado por ${betrayedBy.join(' y ')}. Perdió $${loss}`, type: 'danger' });
          }
        } else if (action.action_type === 'betray') {
          statDeltas[p.id].betray++;
          let loot = 0;
          let victims: string[] = [];
          let traps: string[] = [];
          let shootouts: string[] = [];

          // Procesar vecino Izquierdo
          if (leftAction?.action_type === 'cooperate') {
            loot += 1000; victims.push(shuffledPlayers[leftIdx].name);
            statDeltas[p.id].successful_betrayals++;
          } else if (leftAction?.action_type === 'betray') {
            playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - 500);
            statDeltas[p.id].lost += 500; shootouts.push(shuffledPlayers[leftIdx].name);
          } else if (leftAction?.action_type === 'trap') {
            playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - 1000);
            statDeltas[p.id].lost += 1000; statDeltas[p.id].trapped++; traps.push(shuffledPlayers[leftIdx].name);
          }

          // Procesar vecino Derecho
          if (rightAction?.action_type === 'cooperate') {
            loot += 1000; victims.push(shuffledPlayers[rightIdx].name);
            statDeltas[p.id].successful_betrayals++;
          } else if (rightAction?.action_type === 'betray') {
            playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - 500);
            statDeltas[p.id].lost += 500; shootouts.push(shuffledPlayers[rightIdx].name);
          } else if (rightAction?.action_type === 'trap') {
            playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - 1000);
            statDeltas[p.id].lost += 1000; statDeltas[p.id].trapped++; traps.push(shuffledPlayers[rightIdx].name);
          }

          playerUpdates[p.id].balance += loot;
          statDeltas[p.id].earned += loot;

          if (loot > 0) logs.push({ room_id: roomId, round_number: roundNumber, message: `🗡️ ${p.name} robó $${loot} a ${victims.join(' y ')}`, type: 'danger' });
          if (shootouts.length > 0) logs.push({ room_id: roomId, round_number: roundNumber, message: `🔥 ${p.name} tuvo un tiroteo con ${shootouts.join(' y ')}`, type: 'danger' });
          if (traps.length > 0) logs.push({ room_id: roomId, round_number: roundNumber, message: `🪤 ${p.name} cayó en la trampa de ${traps.join(' y ')}`, type: 'warning' });
        } else if (action.action_type === 'trap') {
          statDeltas[p.id].trap++;
          let caughtCount = 0;
          let caughtNames: string[] = [];
          if (leftAction?.action_type === 'betray') { caughtCount++; caughtNames.push(shuffledPlayers[leftIdx].name); }
          if (rightAction?.action_type === 'betray') { caughtCount++; caughtNames.push(shuffledPlayers[rightIdx].name); }
          
          if (caughtCount > 0) {
            const reward = caughtCount * 1000;
            playerUpdates[p.id].balance += reward;
            statDeltas[p.id].earned += reward;
            statDeltas[p.id].successful_traps += caughtCount;
            logs.push({ room_id: roomId, round_number: roundNumber, message: `🛡️ ${p.name} atrapó a ${caughtNames.join(' y ')} y ganó $${reward}`, type: 'success' });
          } else {
            playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - 500);
            statDeltas[p.id].lost += 500;
            statDeltas[p.id].failed_traps++;
            logs.push({ room_id: roomId, round_number: roundNumber, message: `🪤 La trampa de ${p.name} falló`, type: 'info' });
          }
        }
      });
    } else {
      // 5. RESOLUCIÓN CLÁSICA POR GRUPOS
      groups.forEach((group, groupIdx) => {
        const groupPlayerIds = group.map(p => p.id);
        const groupActions = filteredActions.filter(a => groupPlayerIds.includes(a.player_id));
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

            if (groupBetrayers.length > 0) {
              statDeltas[t.player_id].successful_traps++;
              if (activeEventId === 'trap_refund') statDeltas[t.player_id].event_benefits++;
            } else {
              statDeltas[t.player_id].failed_traps++;
            }

            playerUpdates[t.player_id].balance += stolenFromGroup;
            statDeltas[t.player_id].earned += stolenFromGroup;
            statDeltas[t.player_id].trapped += groupBetrayers.length;
          });
        }

        // Traidores que superan el grupo → van al pozo
        groupBetrayers.forEach(b => {
          if (groupTrappers.length === 0) {
            successfulBetrayers.push(b);
            statDeltas[b.player_id].successful_betrayals++;
          }
        });

        // Recompensar cooperación (con evento double_cooperate)
        const cooperateReward = activeEventId === 'double_cooperate' ? 2000 : 1000;
        if (groupBetrayers.length === 0) {
          groupCooperators.forEach(c => {
            playerUpdates[c.player_id].balance += cooperateReward;
            newGlobalPool += 250;
            statDeltas[c.player_id].earned += cooperateReward;
            if (activeEventId === 'double_cooperate') statDeltas[c.player_id].event_benefits++;
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
          const sharePerBetrayer = Math.floor(newGlobalPool / successfulBetrayers.length);
          successfulBetrayers.forEach(bId => {
            playerUpdates[bId].balance += sharePerBetrayer;
            statDeltas[bId].earned += sharePerBetrayer;
          });
          logs.push({ room_id: roomId, round_number: roundNumber, message: `⚖️ TREGUA ARMADA: Los traidores se repartieron el pozo global`, type: 'warning' });
          newGlobalPool = 1000;
        } else {
          const burned = Math.floor(newGlobalPool * 0.5);
          newGlobalPool -= burned;
          logs.push({ room_id: roomId, round_number: roundNumber, message: `¡FUEGO CRUZADO! Se quemaron $${burned} del pozo global`, type: 'danger' });
        }
      } else if (successfulBetrayers.length === 1) {
        const winnerId = successfulBetrayers[0];
        const winner = players.find(p => p.id === winnerId);
        if (winner) {
          playerUpdates[winnerId].balance += newGlobalPool;
          statDeltas[winnerId].earned += newGlobalPool;
          logs.push({ room_id: roomId, round_number: roundNumber, message: `¡TRAICIÓN GLOBAL! ${winner.name} burló a su grupo y vació el pozo de $${newGlobalPool}`, type: 'danger' });
          newGlobalPool = 1000;
        }
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
    // 9. Actualizar estadísticas (OPCIONAL - Protegido contra errores 401/406)
    try {
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
            successful_traps: (existing.successful_traps || 0) + delta.successful_traps,
            failed_traps: (existing.failed_traps || 0) + delta.failed_traps,
            successful_betrayals: (existing.successful_betrayals || 0) + delta.successful_betrayals,
            event_benefits: (existing.event_benefits || 0) + delta.event_benefits,
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
            successful_traps: delta.successful_traps,
            failed_traps: delta.failed_traps,
            successful_betrayals: delta.successful_betrayals,
            event_benefits: delta.event_benefits,
          });
        }
      }
      
      // Log de éxito para diagnóstico
      logs.push({
        room_id: roomId, round_number: roundNumber,
        message: `📊 Estadísticas de ${Object.keys(statDeltas).length} jugadores actualizadas.`,
        type: 'info'
      });
    } catch (e) {
      console.warn("Error en estadísticas:", e);
      logs.push({
        room_id: roomId, round_number: roundNumber,
        message: `⚠️ Fallo crítico al guardar estadísticas: ${e instanceof Error ? e.message : 'Error desconocido'}`,
        type: 'danger'
      });
    }

    // 10. Elegir nuevo evento para la siguiente ronda
    const nextEvent = pickRandomEvent();

    // 11. Actualizar Capo (OPCIONAL)
    try {
      const sortedPlayers = Object.entries(playerUpdates).sort((a, b) => b[1].balance - a[1].balance);
      const topPlayerId = sortedPlayers[0]?.[0];
      await supabase.from('mafia_players').update({ is_capo: false }).eq('room_id', roomId);
      if (topPlayerId) {
        await supabase.from('mafia_players').update({ is_capo: true }).eq('id', topPlayerId);
      }
    } catch (e) {
       console.warn("Error al actualizar Capo:", e);
    }

    // 12. PERSISTENCIA CRÍTICA: Logs y Habitación
    if (logs.length > 0) {
      await supabase.from('mafia_logs').insert(logs);
    }

    const isGameOver = (roundNumber + 1) > (room.max_rounds || 10);
    const nextStatus = isGameOver ? 'finished' : 'playing';

    // Calcular mapa de acciones para la revelación de fichas
    const actionsMap = Object.fromEntries(
      Object.entries(playerUpdates)
        .filter(([, u]) => u.last_action)
        .map(([pid, u]) => [pid, u.last_action])
    );
    // Determinar si hubo al menos una traición para disparar el sonido
    const hasBetrayal = filteredActions.some(a => a.action_type === 'betray');

    // ACTUALIZACIÓN FINAL DE LA HABITACIÓN (sin columnas extras)
    await supabase.from('mafia_rooms').update({
      global_pool: newGlobalPool,
      round_number: roundNumber + 1,
      status: nextStatus,
      active_event: nextEvent.id !== 'none' ? nextEvent.id : null,
      active_event_label: nextEvent.id !== 'none' ? nextEvent.label : null,
    }).eq('id', roomId);

    // BROADCAST: Enviamos el payload de resolución por el canal existente
    // El host ya está suscrito a este canal, por lo que el send() funcionará directamente.
    const broadcastChannel = supabase.channel(`room:${roomId}`);
    await broadcastChannel.send({
      type: 'broadcast',
      event: 'round_resolved',
      payload: {
        round: roundNumber,
        actions: actionsMap,
        hasBetrayal,
      },
    });
  },
};
