import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(new Date(date));
}

const WINDOW_MS = 60 * 60 * 1000;

export function secondsUntilWindowOpens(gameTime: Date): number {
  const opensAt = new Date(gameTime.getTime() - WINDOW_MS);
  return Math.max(0, Math.floor((opensAt.getTime() - Date.now()) / 1000));
}

export function secondsUntilGameStarts(gameTime: Date): number {
  return Math.max(0, Math.floor((new Date(gameTime).getTime() - Date.now()) / 1000));
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}
