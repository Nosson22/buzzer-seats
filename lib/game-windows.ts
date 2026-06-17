// Business logic: listings go live 1 hour before game, close when game starts

export const WINDOW_MINUTES = 60;

export function isInBuyingWindow(gameTime: Date): boolean {
  const now = new Date();
  const windowOpen = new Date(gameTime.getTime() - WINDOW_MINUTES * 60 * 1000);
  return now >= windowOpen && now < gameTime;
}

export function windowOpensAt(gameTime: Date): Date {
  return new Date(gameTime.getTime() - WINDOW_MINUTES * 60 * 1000);
}

export function secondsUntilWindowOpens(gameTime: Date): number {
  const opensAt = windowOpensAt(gameTime);
  return Math.max(0, Math.floor((opensAt.getTime() - Date.now()) / 1000));
}

export function secondsUntilGameStarts(gameTime: Date): number {
  return Math.max(0, Math.floor((gameTime.getTime() - Date.now()) / 1000));
}

export function gameHasStarted(gameTime: Date): boolean {
  return new Date() >= gameTime;
}
