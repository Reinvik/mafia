import { supabase } from './supabase';

export const roundEngine = {
  async resolveRound(roomId: string, roundNumber: number) {
    const { data: players } = await supabase.from('mafia_players').select('*').eq('room_id', roomId);
    const { data: existingActions } = await supabase
      .from('mafia_actions')
      .select('*')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber);

    if (!players) return;

    const existingPlayerIds = new Set(existingActions?.map(a => a.player_id) || []);
    const missingPlayers = players.filter(p => !existingPlayerIds.has(p.id));

    if (missingPlayers.length > 0) {
      const defaultActions = missingPlayers.map(p => ({
        room_id: roomId,
        round_number: roundNumber,
        player_id: p.id,
        target_id: players.find(other => other.id !== p.id)?.id || p.id,
        action_type: 'cooperate'
      }));
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

    let newGlobalPool = Number(room.global_pool);
    const playerUpdates: Record<string, any> = {};
    const logs: { room_id: string, round_number: number, message: string, type: string }[] = [];

    players.forEach(p => playerUpdates[p.id] = { 
      balance: Number(p.balance),
      is_incognito: false, 
      has_accountant: false 
    });

    const betrayers = allActions.filter(a => a.action_type === 'betray');
    const globalBetrayalFailed = betrayers.length >= 2;

    if (globalBetrayalFailed) {
      newGlobalPool = Math.floor(newGlobalPool * 0.5);
      logs.push({ room_id: roomId, round_number: roundNumber, message: "¡FUEGO CRUZADO! Varias traiciones colisionaron. Se quema el 50% del pozo.", type: 'danger' });
    }

    const processedPairs = new Set<string>();

    for (const action of allActions) {
      const actorId = action.player_id;
      const targetId = action.target_id;
      const type = action.action_type;
      const actor = players.find(p => p.id === actorId);
      const target = players.find(p => p.id === targetId);
      if (!actor || !target) continue;

      const pairKey = [actorId, targetId].sort().join('-');
      if (processedPairs.has(pairKey)) continue;

      const targetAction = allActions.find(a => a.player_id === targetId && a.target_id === actorId);
      const targetGenericAction = allActions.find(a => a.player_id === targetId);
      const targetType = targetAction?.action_type || 'none'; 
      const targetGlobalType = targetGenericAction?.action_type || 'cooperate';

      if (type === 'trap' && targetGlobalType === 'betray') {
        playerUpdates[actorId].balance += 1500;
        playerUpdates[targetId].balance = Math.max(0, playerUpdates[targetId].balance - 1000);
        logs.push({ room_id: roomId, round_number: roundNumber, message: `¡TRAMPA MAESTRA! ${actor.name} emboscó la traición de ${target.name}. ${target.name} pierde $1,000.`, type: 'warning' });
      }
      else if (type === 'betray' && targetGlobalType === 'trap') {
        if (targetType === 'trap') {
           playerUpdates[targetId].balance += 1500;
           playerUpdates[actorId].balance = Math.max(0, playerUpdates[actorId].balance - 1000);
           logs.push({ room_id: roomId, round_number: roundNumber, message: `¡TRAMPA! ${target.name} detectó la traición de ${actor.name}. ${actor.name} pierde $1,000.`, type: 'warning' });
        } else if (!globalBetrayalFailed) {
           playerUpdates[actorId].balance += newGlobalPool;
           logs.push({ room_id: roomId, round_number: roundNumber, message: `¡TRAICIÓN! ${actor.name} le robó todo a ${target.name} ($${newGlobalPool.toLocaleString()}).`, type: 'danger' });
           newGlobalPool = 2000;
        }
      }
      else if (type === 'cooperate' && targetType === 'cooperate') {
        playerUpdates[actorId].balance += 1000;
        playerUpdates[targetId].balance += 1000;
        newGlobalPool += 500;
        logs.push({ room_id: roomId, round_number: roundNumber, message: `${actor.name} y ${target.name} cooperaron. +$1,000 cada uno.`, type: 'success' });
      }
      else if (type === 'cooperate' && targetType === 'betray') {
        if (!globalBetrayalFailed) {
          playerUpdates[targetId].balance += newGlobalPool;
          logs.push({ room_id: roomId, round_number: roundNumber, message: `¡TRAICIÓN! ${target.name} traicionó la confianza de ${actor.name} y se llevó el pozo.`, type: 'danger' });
          newGlobalPool = 2000;
        }
      }
      else if (type === 'betray' && targetType === 'cooperate') {
        if (!globalBetrayalFailed) {
          playerUpdates[actorId].balance += newGlobalPool;
          logs.push({ room_id: roomId, round_number: roundNumber, message: `¡TRAICIÓN! ${actor.name} traicionó la confianza de ${target.name} y se llevó el pozo.`, type: 'danger' });
          newGlobalPool = 2000;
        }
      }

      processedPairs.add(pairKey);
    }

    for (const [pid, updates] of Object.entries(playerUpdates)) {
      await supabase.from('mafia_players').update(updates).eq('id', pid);
    }

    const sortedPlayers = Object.entries(playerUpdates).sort((a,b) => b[1].balance - a[1].balance);
    const topPlayerId = sortedPlayers[0]?.[0];
    await supabase.from('mafia_players').update({ is_capo: false }).eq('room_id', roomId);
    if (topPlayerId) {
      await supabase.from('mafia_players').update({ is_capo: true }).eq('id', topPlayerId);
    }

    if (logs.length > 0) {
      await supabase.from('mafia_logs').insert(logs);
    }

    // VERIFICAR SI LA PARTIDA TERMINÓ
    const isGameOver = (roundNumber + 1) > (room.max_rounds || 10);
    const nextStatus = isGameOver ? 'finished' : 'playing';

    await supabase.from('mafia_rooms').update({ 
      global_pool: newGlobalPool, 
      round_number: roundNumber + 1,
      status: nextStatus 
    }).eq('id', roomId);

    await supabase.channel(`room:${roomId}`).send({
      type: 'broadcast',
      event: 'round_resolved',
      payload: { round: roundNumber, globalPool: newGlobalPool, status: nextStatus }
    });
  }
};
