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

  async simulateBotActions(roomId: string, roundNumber: number, players: any[]) {
    // Filtrar quiénes son bots
    const bots = players.filter(p => p.name.includes("(Bot)"));
    if (bots.length === 0) return;

    console.log(`Simulando acciones para ${bots.length} bots en la ronda ${roundNumber}`);

    for (const bot of bots) {
      // Delay aleatorio para que no sea instantáneo (2s a 15s)
      const delay = Math.floor(Math.random() * 13000) + 2000;
      
      setTimeout(async () => {
        // Verificar si el bot ya actuó en esta ronda (defensa contra duplicados)
        const { data: existing } = await supabase
          .from('mafia_actions')
          .select('id')
          .eq('room_id', roomId)
          .eq('round_number', roundNumber)
          .eq('player_id', bot.id)
          .maybeSingle();

        if (existing) return;

        // Elegir objetivo aleatorio (humano o bot, pero no él mismo)
        const availableTargets = players.filter(p => p.id !== bot.id);
        if (availableTargets.length === 0) return;
        const target = availableTargets[Math.floor(Math.random() * availableTargets.length)];
        
        // Lógica de decisión
        const rand = Math.random();
        let actionType = 'cooperate';
        if (rand > 0.6) actionType = 'betray'; // 40% traición
        if (rand > 0.9) actionType = 'trap';    // 10% trampa

        console.log(`Bot ${bot.name} decide: ${actionType} contra ${target.name}`);

        const { error } = await supabase.from('mafia_actions').insert([{
          room_id: roomId,
          round_number: roundNumber,
          player_id: bot.id,
          target_id: target.id,
          action_type: actionType
        }]);

        if (error) {
          console.error(`Error en acción de bot ${bot.name}:`, error);
        } else {
          // Broadcast de confirmación para sonido/efecto
          await supabase.channel(`room:${roomId}`).send({
            type: 'broadcast',
            event: 'action_lock_in',
            payload: { player_id: bot.id }
          });
        }
      }, delay);
    }
  }
};
