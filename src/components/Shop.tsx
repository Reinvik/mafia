import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { supabase } from '../lib/supabase';
import { ShoppingCart, EyeOff, Search, Clock } from 'lucide-react';

export function Shop() {
  const { currentPlayer, roomId, isHost } = useGameStore();
  const [timeLeft, setTimeLeft] = useState(15);
  const [purchased, setPurchased] = useState<string[]>([]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          if (isHost && roomId) {
            // El host mueve a la siguiente ronda
            supabase.from('mafia_rooms').update({ status: 'playing' }).eq('id', roomId);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isHost, roomId]);

  const buyItem = async (id: string, cost: number, field: string) => {
    if (!currentPlayer || currentPlayer.balance < cost || purchased.includes(id)) return;

    const { error } = await supabase
      .from('mafia_players')
      .update({ 
        balance: currentPlayer.balance - cost,
        [field]: true 
      })
      .eq('id', currentPlayer.id);

    if (!error) {
      setPurchased(prev => [...prev, id]);
      new Audio('/cash-register.mp3').play().catch(() => {});
    }
  };

  return (
    <div className="min-h-screen bg-poker-dark bg-felt flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-4xl w-full bg-black/90 p-8 rounded-[3rem] border-4 border-poker-gold/30 shadow-2xl"
      >
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-4xl font-black text-poker-gold uppercase flex items-center gap-4 italic">
            <ShoppingCart className="w-10 h-10" /> LA TIENDA DE DON VITO
          </h2>
          <div className="flex items-center gap-4">
            <div className="bg-gray-800 px-6 py-2 rounded-full border border-poker-gold/50">
              <span className="text-poker-gold font-bold">TU SALDO: </span>
              <span className="text-white font-black">${currentPlayer?.balance.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 text-red-500 font-mono font-bold text-2xl">
              <Clock className="w-6 h-6" /> {timeLeft}s
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ShopItem 
            id="incognito"
            title="Identidad de Incógnito"
            desc="Oculta tu nombre en la siguiente ronda. Aparecerás como '???'."
            cost={500}
            icon={<EyeOff />}
            purchased={purchased.includes('incognito')}
            onBuy={() => buyItem('incognito', 500, 'is_incognito')}
            canAfford={(currentPlayer?.balance || 0) >= 500}
          />
          <ShopItem 
            id="accountant"
            title="Sobornar al Contador"
            desc="Revela los balances exactos de todos los demás jugadores."
            cost={500}
            icon={<Search />}
            purchased={purchased.includes('accountant')}
            onBuy={() => buyItem('accountant', 500, 'has_accountant')}
            canAfford={(currentPlayer?.balance || 0) >= 500}
          />
        </div>

        <div className="mt-8 text-center text-gray-500 italic text-sm">
          "Las mejores ventajas no se ganan, se compran."
        </div>
      </motion.div>
    </div>
  );
}

function ShopItem({ title, desc, cost, icon, purchased, onBuy, canAfford }: any) {
  return (
    <div className={`p-6 rounded-2xl border-2 transition-all ${purchased ? 'border-green-500 bg-green-500/10' : 'border-gray-700 bg-gray-800/50'}`}>
      <div className="flex justify-between items-start mb-4">
        <div className="w-12 h-12 rounded-xl bg-gray-900 flex items-center justify-center text-poker-gold">
          {React.cloneElement(icon, { size: 24 })}
        </div>
        <div className="text-right">
          <p className="text-2xl font-black text-white">${cost}</p>
        </div>
      </div>
      <h3 className="text-xl font-bold text-poker-gold mb-2 uppercase tracking-wide">{title}</h3>
      <p className="text-gray-400 text-sm mb-6 leading-relaxed">{desc}</p>
      <button 
        onClick={onBuy}
        disabled={purchased || !canAfford}
        className={`w-full py-3 rounded-xl font-black transition-all ${
          purchased 
            ? 'bg-green-600 text-white cursor-default' 
            : canAfford 
              ? 'bg-poker-gold text-black hover:bg-yellow-500 active:scale-95 shadow-[0_4px_0_#9a7d25]' 
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        }`}
      >
        {purchased ? 'ADQUIRIDO' : canAfford ? 'COMPRAR' : 'FONDOS INSUFICIENTES'}
      </button>
    </div>
  );
}
