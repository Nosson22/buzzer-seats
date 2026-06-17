"use client";
import { useEffect, useState } from "react";
import { formatCountdown, secondsUntilGameStarts, secondsUntilWindowOpens } from "@/lib/utils";
import { isInBuyingWindow, windowOpensAt } from "@/lib/game-windows";

interface CountdownProps {
  gameTime: string | Date;
  onWindowOpen?: () => void;
  onGameStart?: () => void;
}

export function Countdown({ gameTime, onWindowOpen, onGameStart }: CountdownProps) {
  const gt = new Date(gameTime);
  const [secs, setSecs] = useState(0);
  const [inWindow, setInWindow] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const gameStarted = now >= gt;
      const inWin = isInBuyingWindow(gt);

      setStarted(gameStarted);
      setInWindow(inWin);

      if (gameStarted) {
        setSecs(0);
        onGameStart?.();
      } else if (inWin) {
        setSecs(secondsUntilGameStarts(gt));
        onWindowOpen?.();
      } else {
        setSecs(secondsUntilWindowOpens(gt));
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gt]);

  if (started) {
    return (
      <div className="text-center">
        <p className="text-red-400 font-bold text-lg">Game has started — listings closed</p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className="text-sm text-gray-400 mb-1">
        {inWindow ? "Buying window closes in" : "Buying window opens in"}
      </p>
      <div
        className={`text-4xl font-mono font-black tabular-nums ${
          inWindow ? "text-green-400" : "text-yellow-400"
        }`}
      >
        {formatCountdown(secs)}
      </div>
      {!inWindow && (
        <p className="text-xs text-gray-500 mt-1">Listings go live 1 hour before game time</p>
      )}
    </div>
  );
}
