/**
 * Difficulty presets — affects AI behavior and stun mechanics.
 *
 * Easy:   Long stuns, slow AI, rarely blocks
 * Medium: Normal stuns, normal AI
 * Hard:   Short stuns, fast AI, blocks often, counter-attacks
 * Expert: No stun lock, instant reactions, reads your patterns
 */

export const DIFFICULTIES = {
  easy: {
    name: 'Easy',
    color: '#40cc40',
    description: 'Slow AI, long stuns, easy combos',
    stunDuration: 0.6,         // how long you/AI stay stunned after a hit
    aiDecisionSpeed: 0.15,     // seconds between AI decisions
    aiAttackCooldown: 0.35,    // minimum time between AI attacks
    aiBlockChance: 0.05,       // extra chance AI blocks when you attack
    aiEpsilon: 0.15,           // randomness in AI decisions
    aiDamageMultiplier: 0.7,   // AI deals less damage
    playerDamageMultiplier: 1.0,
  },
  medium: {
    name: 'Medium',
    color: '#ffcc40',
    description: 'Balanced fight, fair stuns',
    stunDuration: 0.35,
    aiDecisionSpeed: 0.1,
    aiAttackCooldown: 0.25,
    aiBlockChance: 0.1,
    aiEpsilon: 0.05,
    aiDamageMultiplier: 1.0,
    playerDamageMultiplier: 1.0,
  },
  hard: {
    name: 'Hard',
    color: '#ff8040',
    description: 'Fast AI, short stuns, blocks often',
    stunDuration: 0.15,
    aiDecisionSpeed: 0.07,
    aiAttackCooldown: 0.18,
    aiBlockChance: 0.25,
    aiEpsilon: 0.03,
    aiDamageMultiplier: 1.2,
    playerDamageMultiplier: 1.0,
  },
  expert: {
    name: 'Expert',
    color: '#ff3030',
    description: 'No stun lock, instant reactions, full damage',
    stunDuration: 0.05,        // basically no stun — can act almost immediately
    aiDecisionSpeed: 0.05,
    aiAttackCooldown: 0.12,
    aiBlockChance: 0.4,
    aiEpsilon: 0.01,           // almost pure learned strategy
    aiDamageMultiplier: 1.4,
    playerDamageMultiplier: 1.0,
  },
};

// Active difficulty (set from UI)
export let activeDifficulty = DIFFICULTIES.medium;

export function setDifficulty(key) {
  activeDifficulty = DIFFICULTIES[key] || DIFFICULTIES.medium;
  return activeDifficulty;
}
