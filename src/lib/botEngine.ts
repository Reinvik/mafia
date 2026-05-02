import { supabase } from './supabase';

const BOT_NAMES = [
  "Don Corleone", "Al Capone", "Lucky Luciano", "Tony Montana", 
  "El Padrino", "Frank Costello", "Bugsy Siegel", "John Gotti",
  "The Ghost", "Nightshade", "Vinnie the Chin"
];

export const botEngine = {
  async addBot(roomId: string) {
    const randomName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + " (Bot)";
    const { data, error } = await supabase
      .from('mafia_players')
      .insert([{
        room_id: roomId,
        name: randomName,
        balance: 1000, // Iniciar con algo de dinero
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
    if (rand > 0.6) actionType = 'betray'; // 40% traición
    if (rand > 0.9) actionType = 'trap';    // 10% trampa

    return { target_id: target.id, action_type: actionType };
  },

  async simulateBotActions(roomId: string, roundNumber: number, players: any[]) {
    const bots = players.filter(p => p.name.includes("(Bot)"));
    if (bots.length === 0) return;

    for (const bot of bots) {
      // Delay aleatorio entre 1.5s y 7s (antes que el temporizador de 30s resuelva)
      const delay = Math.floor(Math.random() * 5500) + 1500;
      
      setTimeout(async () => {
        const { data: existing } = await supabase
          .from('mafia_actions')
          .select('id')
          .eq('room_id', roomId)
          .eq('round_number', roundNumber)
          .eq('player_id', bot.id)
          .maybeSingle();

        if (existing) return;

        const decision = this.getDecision(bot, players);
        if (!decision) return;

        const { error } = await supabase.from('mafia_actions').insert([{
          room_id: roomId,
          round_number: roundNumber,
          player_id: bot.id,
          target_id: decision.target_id,
          action_type: decision.action_type
        }]);
      }, delay);
    }
  }
};
