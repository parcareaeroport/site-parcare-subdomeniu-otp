import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalizează numărul de înmatriculare eliminând spații, puncte, cratime
 * și convertind la majuscule
 * @param input - numărul de înmatriculare introdus de utilizator
 * @returns numărul de înmatriculare normalizat (ex: "DB88SSS")
 */
export function normalizeLicensePlate(input: string): string {
  return input
    .replace(/[^A-Za-z0-9]/g, '') // Păstrează DOAR litere și cifre, elimină ORICE altceva
    .toUpperCase() // Convertește la majuscule
}
