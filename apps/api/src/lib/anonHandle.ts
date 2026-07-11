import { randomInt } from 'node:crypto';

/**
 * Reddit-style pseudonymous handle generation for accountable anonymity on the
 * Campus Wall (PUBLIC_WALL.md §7). A handle is an adjective + animal + number,
 * e.g. "SilentFox73". Handles are permanent and unique per user; the numeric
 * range widens with the retry `attempt` to reduce collisions under contention.
 */

const ADJECTIVES = [
  'Silent',
  'Cosmic',
  'Brave',
  'Lunar',
  'Swift',
  'Hidden',
  'Golden',
  'Frosty',
  'Amber',
  'Velvet',
  'Crimson',
  'Electric',
  'Mellow',
  'Radiant',
  'Shadow',
  'Solar',
  'Wandering',
  'Zephyr',
  'Noble',
  'Quiet',
] as const;

const ANIMALS = [
  'Fox',
  'Otter',
  'Falcon',
  'Wolf',
  'Raven',
  'Panda',
  'Lynx',
  'Heron',
  'Bison',
  'Koala',
  'Badger',
  'Marten',
  'Osprey',
  'Puffin',
  'Gecko',
  'Ferret',
  'Ibis',
  'Jaguar',
  'Sparrow',
  'Turtle',
] as const;

/** Inclusive random integer in [min, max] using crypto for uniformity. */
function randBetween(min: number, max: number): number {
  return randomInt(min, max + 1);
}

/** Pick a uniformly random element from a non-empty tuple of strings. */
function pick(words: readonly string[]): string {
  const index = randomInt(0, words.length);
  return words[index] ?? words[0] ?? '';
}

/**
 * Generates a candidate handle. The number of digits grows with `attempt` so
 * later retries draw from a larger space:
 * - attempt 0–1 → 2 digits (10–99)
 * - attempt 2–3 → 3 digits (100–999)
 * - attempt 4+  → 4 digits (1000–9999)
 */
export function generateAnonHandle(attempt: number): string {
  const adj = pick(ADJECTIVES);
  const animal = pick(ANIMALS);
  let num: number;
  if (attempt <= 1) {
    num = randBetween(10, 99);
  } else if (attempt <= 3) {
    num = randBetween(100, 999);
  } else {
    num = randBetween(1000, 9999);
  }
  return `${adj}${animal}${num}`;
}
