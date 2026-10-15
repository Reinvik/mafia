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
  { id: 'none', label: '', description: '' },
] as const;

export type EventId = typeof RANDOM_EVENTS[number]['id'];

function pickRandomEvent() {
  return RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
}

// Candado en memoria para impedir doble resolución simultánea de la misma ronda
const activeResolutions = new Set<string>();

// ──────────────────────────────────────────
// MOTOR DE RONDAS
// ──────────────────────────────────────────
export const roundEngine = {
  async resolveRound(roomId: string, roundNumber: number) {
    const lockKey = `${roomId}:${roundNumber}`;
    if (activeResolutions.has(lockKey)) {
      return;
    }
    activeResolutions.add(lockKey);

    try {
      botEngine.clearBotTimers();

      // 0. Obtener sala, jugadores y acciones actuales en paralelo
      const [roomRes, playersRes, actionsRes, logsCountRes] = await Promise.all([
        supabase.from('mafia_rooms').select('*').eq('id', roomId).single(),
        supabase.from('mafia_players').select('*').eq('room_id', roomId),
        supabase.from('mafia_actions').select('*').eq('room_id', roomId).eq('round_number', roundNumber),
        supabase.from('mafia_logs').select('*', { count: 'exact', head: true }).eq('room_id', roomId).eq('round_number', roundNumber),
      ]);

      const room = roomRes.data;
      const players = playersRes.data;
      if (!room || !players || players.length === 0) return;

      // Si la sala ya avanzó de ronda o terminó, abortar inmediatamente
      if (room.round_number !== roundNumber || room.status === 'finished') {
        return;
      }

      // 1. Verificación de idempotencia: ¿Ya se resolvió esta ronda?
      if (logsCountRes.count && logsCountRes.count > 0) {
        const isGameOver = (roundNumber + 1) > (room.max_rounds || 10);
        await supabase.from('mafia_rooms').update({
          round_number: roundNumber + 1,
          status: isGameOver ? 'finished' : 'playing',
        }).eq('id', roomId).eq('round_number', roundNumber);
        return;
      }

      const existingActions = actionsRes.data || [];

      // 2. Eliminar acciones duplicadas por jugador y completar faltantes (bots o jugadores inactivos)
      const uniqueActionsMap = new Map<string, any>();
      existingActions.forEach(a => {
        if (!uniqueActionsMap.has(a.player_id)) {
          uniqueActionsMap.set(a.player_id, a);
        }
      });

      const missingActions: any[] = [];
      players.forEach(p => {
        if (!uniqueActionsMap.has(p.id)) {
          const isBot = p.name.includes('(Bot)');
          const decision = isBot ? botEngine.getDecision(p, players) : null;
          const fallbackAction = {
            room_id: roomId,
            round_number: roundNumber,
            player_id: p.id,
            target_id: decision?.target_id || players.find(other => other.id !== p.id)?.id || p.id,
            action_type: decision?.action_type || 'cooperate',
          };
          uniqueActionsMap.set(p.id, fallbackAction);
          missingActions.push(fallbackAction);
        }
      });

      if (missingActions.length > 0) {
        await supabase.from('mafia_actions').insert(missingActions);
      }

      const filteredActions = Array.from(uniqueActionsMap.values());

      // 3. Leer el EVENTO ACTIVO de la ronda
      const activeEventId = (room.active_event || 'none') as EventId;

      // 4. Estructura de grupos (Fisher-Yates determinístico con semilla por sala + ronda)
      const seedString = roomId + roundNumber.toString();
      let seed = 0;
      for (let i = 0; i < seedString.length; i++) {
        seed += seedString.charCodeAt(i);
      }

      const seededRandom = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
      };

      const shuffledPlayers = [...players].sort((a, b) => a.id.localeCompare(b.id));
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

      // 5. Estado inicial de pozo y deltas
      let newGlobalPool = Number(room.global_pool);

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
        playerUpdates[p.id] = {
          balance: Number(p.balance),
          is_incognito: false,
          has_accountant: false,
          is_capo: false,
        };
        statDeltas[p.id] = {
          cooperate: 0, betray: 0, trap: 0, earned: 0, lost: 0, betrayed: 0, trapped: 0,
          successful_traps: 0, failed_traps: 0, successful_betrayals: 0, event_benefits: 0,
          name: p.name,
        };
      });

      const logs: { room_id: string; round_number: number; message: string; type: string }[] = [];
      const successfulBetrayers: string[] = [];

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
            const betrayedBy: string[] = [];
            if (leftAction?.action_type === 'betray') { betrayalCount++; betrayedBy.push(shuffledPlayers[leftIdx].name); }
            if (rightAction?.action_type === 'betray') { betrayalCount++; betrayedBy.push(shuffledPlayers[rightIdx].name); }

            if (betrayalCount === 0) {
              const reward = activeEventId === 'double_cooperate' ? 2000 : 1000;
              playerUpdates[p.id].balance += reward;
              statDeltas[p.id].earned += reward;
              if (activeEventId === 'double_cooperate') statDeltas[p.id].event_benefits++;
              newGlobalPool += 250;
              logs.push({ room_id: roomId, round_number: roundNumber, message: `🤝 ${p.name} cooperó con éxito y ganó $${reward.toLocaleString()}`, type: 'success' });
            } else {
              statDeltas[p.id].betrayed += betrayalCount;
              logs.push({ room_id: roomId, round_number: roundNumber, message: `🗡️ ${p.name} intentó cooperar pero fue saboteado por ${betrayedBy.join(' y ')}. Su ganancia fue anulada ($0)`, type: 'danger' });
            }
          } else if (action.action_type === 'betray') {
            statDeltas[p.id].betray++;
            const victims: string[] = [];
            const traps: string[] = [];
            const shootouts: string[] = [];
            const trapPenalty = activeEventId === 'trap_refund' ? 2000 : 1000;

            // Procesar vecino Izquierdo
            if (leftAction?.action_type === 'cooperate') {
              victims.push(shuffledPlayers[leftIdx].name);
              statDeltas[p.id].successful_betrayals++;
            } else if (leftAction?.action_type === 'betray') {
              playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - 500);
              statDeltas[p.id].lost += 500;
              shootouts.push(shuffledPlayers[leftIdx].name);
            } else if (leftAction?.action_type === 'trap') {
              playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - trapPenalty);
              statDeltas[p.id].lost += trapPenalty;
              statDeltas[p.id].trapped++;
              traps.push(shuffledPlayers[leftIdx].name);
            }

            // Procesar vecino Derecho
            if (rightAction?.action_type === 'cooperate') {
              victims.push(shuffledPlayers[rightIdx].name);
              statDeltas[p.id].successful_betrayals++;
            } else if (rightAction?.action_type === 'betray') {
              playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - 500);
              statDeltas[p.id].lost += 500;
              shootouts.push(shuffledPlayers[rightIdx].name);
            } else if (rightAction?.action_type === 'trap') {
              playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - trapPenalty);
              statDeltas[p.id].lost += trapPenalty;
              statDeltas[p.id].trapped++;
              traps.push(shuffledPlayers[rightIdx].name);
            }

            if (traps.length === 0) {
              successfulBetrayers.push(p.id);
            }

            if (victims.length > 0) logs.push({ room_id: roomId, round_number: roundNumber, message: `🗡️ ${p.name} saboteó la cooperación de ${victims.join(' y ')} y busca el pozo global`, type: 'danger' });
            if (shootouts.length > 0) logs.push({ room_id: roomId, round_number: roundNumber, message: `🔥 ${p.name} tuvo un tiroteo con ${shootouts.join(' y ')} (-$${(shootouts.length * 500).toLocaleString()})`, type: 'danger' });
            if (traps.length > 0) logs.push({ room_id: roomId, round_number: roundNumber, message: `🪤 ${p.name} cayó en la trampa de ${traps.join(' y ')}`, type: 'warning' });
          } else if (action.action_type === 'trap') {
            statDeltas[p.id].trap++;
            let caughtCount = 0;
            const caughtNames: string[] = [];
            if (leftAction?.action_type === 'betray') { caughtCount++; caughtNames.push(shuffledPlayers[leftIdx].name); }
            if (rightAction?.action_type === 'betray') { caughtCount++; caughtNames.push(shuffledPlayers[rightIdx].name); }

            if (caughtCount > 0) {
              const rewardPerCatch = activeEventId === 'trap_refund' ? 2000 : 1000;
              const reward = caughtCount * rewardPerCatch;
              playerUpdates[p.id].balance += reward;
              statDeltas[p.id].earned += reward;
              statDeltas[p.id].successful_traps += caughtCount;
              if (activeEventId === 'trap_refund') statDeltas[p.id].event_benefits++;
              logs.push({ room_id: roomId, round_number: roundNumber, message: `🛡️ ${p.name} atrapó a ${caughtNames.join(' y ')} y ganó $${reward.toLocaleString()}`, type: 'success' });
            } else {
              playerUpdates[p.id].balance = Math.max(0, playerUpdates[p.id].balance - 500);
              statDeltas[p.id].lost += 500;
              statDeltas[p.id].failed_traps++;
              logs.push({ room_id: roomId, round_number: roundNumber, message: `🪤 La trampa de ${p.name} no atrapó a nadie (-$500)`, type: 'info' });
            }
          }
        });
      } else {
        // RESOLUCIÓN CLÁSICA POR GRUPOS
        groups.forEach((group, groupIdx) => {
          const groupPlayerIds = group.map(p => p.id);
          const groupActions = filteredActions.filter(a => groupPlayerIds.includes(a.player_id));
          const groupBetrayers = groupActions.filter(a => a.action_type === 'betray');
          const groupTrappers = groupActions.filter(a => a.action_type === 'trap');
          const groupCooperators = groupActions.filter(a => a.action_type === 'cooperate');

          groupActions.forEach(a => {
            if (statDeltas[a.player_id]) {
              if (a.action_type === 'cooperate') statDeltas[a.player_id].cooperate++;
              if (a.action_type === 'betray') statDeltas[a.player_id].betray++;
              if (a.action_type === 'trap') statDeltas[a.player_id].trap++;
              playerUpdates[a.player_id].last_action = a.action_type;
            }
          });

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

          groupBetrayers.forEach(b => {
            if (groupTrappers.length === 0) {
              successfulBetrayers.push(b.player_id);
              statDeltas[b.player_id].successful_betrayals++;
            }
          });

          const cooperateReward = activeEventId === 'double_cooperate' ? 2000 : 1000;
          if (groupBetrayers.length === 0) {
            groupCooperators.forEach(c => {
              playerUpdates[c.player_id].balance += cooperateReward;
              newGlobalPool += 250;
              statDeltas[c.player_id].earned += cooperateReward;
              if (activeEventId === 'double_cooperate') statDeltas[c.player_id].event_benefits++;
            });
            if (groupCooperators.length > 0) {
              const extra = activeEventId === 'double_cooperate' ? ' (¡EVENTO ACTIVO: DOBLE!)' : '';
              logs.push({
                room_id: roomId, round_number: roundNumber,
                message: `[Célula ${groupIdx + 1}] Cooperación exitosa. +$${cooperateReward.toLocaleString()} por miembro.${extra}`,
                type: 'success',
              });
            }
          }
        });
      }

      // 6. RESOLUCIÓN GLOBAL DEL POZO
      if (successfulBetrayers.length >= 2) {
        if (activeEventId === 'peace_betray') {
          const sharePerBetrayer = Math.floor(newGlobalPool / successfulBetrayers.length);
          successfulBetrayers.forEach(bId => {
            playerUpdates[bId].balance += sharePerBetrayer;
            statDeltas[bId].earned += sharePerBetrayer;
          });
          logs.push({ room_id: roomId, round_number: roundNumber, message: `⚖️ TREGUA ARMADA: Los traidores se repartieron el pozo global ($${sharePerBetrayer.toLocaleString()} c/u)`, type: 'warning' });
          newGlobalPool = 1000;
        } else {
          const burned = Math.floor(newGlobalPool * 0.5);
          newGlobalPool -= burned;
          logs.push({ room_id: roomId, round_number: roundNumber, message: `¡FUEGO CRUZADO! Múltiples traidores chocaron en la bóveda y se quemaron $${burned.toLocaleString()} del pozo`, type: 'danger' });
        }
      } else if (successfulBetrayers.length === 1) {
        const winnerId = successfulBetrayers[0];
        const winner = players.find(p => p.id === winnerId);
        if (winner) {
          playerUpdates[winnerId].balance += newGlobalPool;
          statDeltas[winnerId].earned += newGlobalPool;
          logs.push({ room_id: roomId, round_number: roundNumber, message: `¡GOLPE MAESTRO! ${winner.name} fue el único traidor exitoso y vació el pozo de $${newGlobalPool.toLocaleString()}`, type: 'danger' });
          newGlobalPool = 1000;
        }
      }

      // 7. Restaurar pozo mínimo
      if (newGlobalPool < 1000) {
        newGlobalPool = 1000;
      }

      // 8. Determinar nuevo Capo directamente antes de escribir en BD
      const sortedPlayers = Object.entries(playerUpdates).sort((a, b) => b[1].balance - a[1].balance);
      const topPlayerId = sortedPlayers[0]?.[0];
      if (topPlayerId && sortedPlayers[0][1].balance > 0) {
        playerUpdates[topPlayerId].is_capo = true;
      }

      // 9. Actualizar todos los jugadores en PARALELO (alta velocidad)
      await Promise.all(
        Object.entries(playerUpdates).map(([pid, updates]) =>
          supabase.from('mafia_players').update(updates).eq('id', pid)
        )
      );

      // 10. Actualizar estadísticas en PARALELO (1 sola lectura previa)
      try {
        const { data: existingStats } = await supabase
          .from('mafia_player_stats')
          .select('*')
          .eq('room_id', roomId);

        const existingMap = new Map((existingStats || []).map(s => [s.player_id, s]));

        await Promise.all(
          Object.entries(statDeltas).map(([pid, delta]) => {
            const existing = existingMap.get(pid);
            if (existing) {
              return supabase.from('mafia_player_stats').update({
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
              return supabase.from('mafia_player_stats').insert({
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
          })
        );
      } catch (e) {
        console.warn("Error actualizando estadísticas:", e);
      }

      // 11. Elegir evento para la siguiente ronda y guardar logs + avance de sala
      const nextEvent = pickRandomEvent();
      const isGameOver = (roundNumber + 1) > (room.max_rounds || 10);
      const nextStatus = isGameOver ? 'finished' : 'playing';

      if (logs.length > 0) {
        await supabase.from('mafia_logs').insert(logs);
      }

      await supabase.from('mafia_rooms').update({
        global_pool: newGlobalPool,
        round_number: roundNumber + 1,
        status: nextStatus,
        active_event: nextEvent.id !== 'none' ? nextEvent.id : null,
        active_event_label: nextEvent.id !== 'none' ? nextEvent.label : null,
      }).eq('id', roomId).eq('round_number', roundNumber);

    } finally {
      activeResolutions.delete(lockKey);
    }
  },
};
