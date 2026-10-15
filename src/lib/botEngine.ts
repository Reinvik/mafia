import { supabase } from './supabase';
import { useGameStore } from '../store/gameStore';

const BOT_NAMES = [
  "Don Corleone", "Al Capone", "Lucky Luciano", "Tony Montana", 
  "El Padrino", "Frank Costello", "Bugsy Siegel", "John Gotti",
  "The Ghost", "Nightshade", "Vinnie the Chin"
];

const activeTimers: ReturnType<typeof setTimeout>[] = [];
let acceleratedRoundKey = '';

export const botEngine = {
  clearBotTimers() {
    while (activeTimers.length > 0) {
      const t = activeTimers.pop();
      if (t) clearTimeout(t);
    }
  },

  async addBot(roomId: string) {
    const { data: currentPlayers } = await supabase
      .from('mafia_players')
      .select('name')
      .eq('room_id', roomId);

    const usedNames = new Set((currentPlayers || []).map(p => p.name));
    const availableNames = BOT_NAMES.filter(n => !usedNames.has(`${n} (Bot)`));
    const pool = availableNames.length > 0 ? availableNames : BOT_NAMES;
    const randomName = pool[Math.floor(Math.random() * pool.length)] + " (Bot)";

    const { data, error } = await supabase
      .from('mafia_players')
      .insert([{
        room_id: roomId,
        name: randomName,
        balance: 0,
        is_capo: false
      }])
      .select()
      .single();
    
    return { data, error };
  },

  getDecision(bot: any, players: any[]) {
    const availableTargets = players.filter(p => p.id !== bot.id);
    if (availableTargets.length === 0) return null;
    const target = availableTargets[Math.floor(Math.random() * availableTargets.length)];
    
    const rand = Math.random();
    let actionType = 'cooperate';
    if (rand > 0.6) actionType = 'betray'; // 30% traición (0.6 - 0.9)
    if (rand > 0.9) actionType = 'trap';   // 10% trampa (0.9 - 1.0)

    return { target_id: target.id, action_type: actionType };
  },

  async executeBotVote(roomId: string, roundNumber: number, bot: any, allPlayers: any[]) {
    // Verificar que seguimos en la misma ronda antes de insertar
    const storeState = useGameStore.getState();
    if (storeState.roomId !== roomId || storeState.roundNumber !== roundNumber || storeState.status !== 'playing') {
      return;
    }

    const { data: existing } = await supabase
      .from('mafia_actions')
      .select('id')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber)
      .eq('player_id', bot.id)
      .maybeSingle();

    if (existing) return;

    const decision = this.getDecision(bot, allPlayers);
    if (!decision) return;

    await supabase.from('mafia_actions').insert([{
      room_id: roomId,
      round_number: roundNumber,
      player_id: bot.id,
      target_id: decision.target_id,
      action_type: decision.action_type
    }]);
  },

  async simulateBotActions(roomId: string, roundNumber: number, players: any[], baseDelayMs = 1500) {
    this.clearBotTimers();

    let currentPlayers = players;
    if (!currentPlayers || currentPlayers.length === 0) {
      const { data } = await supabase.from('mafia_players').select('*').eq('room_id', roomId);
      currentPlayers = data || [];
    }

    const bots = currentPlayers.filter(p => p.name.includes("(Bot)"));
    if (bots.length === 0) return;

    bots.forEach((bot, idx) => {
      // Escalonar votos de los bots de forma natural después de la fase de revelación
      const delay = baseDelayMs + (idx * 650) + Math.floor(Math.random() * 1800);
      
      const timer = setTimeout(() => {
        this.executeBotVote(roomId, roundNumber, bot, currentPlayers);
      }, delay);

      activeTimers.push(timer);
    });
  },

  // Cuando todos los jugadores humanos ya eligieron, acelerar los bots restantes para no hacer esperar
  async accelerateBots(roomId: string, roundNumber: number, players: any[]) {
    const key = `${roomId}:${roundNumber}`;
    if (acceleratedRoundKey === key) return;
    acceleratedRoundKey = key;

    this.clearBotTimers();

    const bots = players.filter(p => p.name.includes("(Bot)"));
    if (bots.length === 0) return;

    bots.forEach((bot, idx) => {
      const timer = setTimeout(() => {
        this.executeBotVote(roomId, roundNumber, bot, players);
      }, 250 + idx * 250);
      activeTimers.push(timer);
    });
  }
};
