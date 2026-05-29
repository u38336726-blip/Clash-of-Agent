// Attack definitions and hit resolution — pure hand-to-hand combat.

export const ONE_SHOT = [
  'Jump_Start', 'Roll', 'Death01',
  'Jab', 'Hook', 'Kick_Front', 'Kick_Round', 'Tackle', 'Elbow',
  'Hit_Chest', 'Hit_Head',
];

// range = max distance for a hit
// hitTime = seconds into the animation before the hit lands
// type: 'melee' | 'ranged'
export const ATTACKS = {
  'Jab':        { damage: 8,  range: 1.9, hitTime: 0.2,  reaction: 'Hit_Chest', type: 'melee' },
  'Hook':       { damage: 14, range: 1.9, hitTime: 0.3,  reaction: 'Hit_Head',  type: 'melee' },
  'Kick_Front': { damage: 12, range: 2.2, hitTime: 0.35, reaction: 'Hit_Chest', type: 'melee' },
  'Kick_Round': { damage: 16, range: 2.2, hitTime: 0.4,  reaction: 'Hit_Head',  type: 'melee' },
  'Tackle':     { damage: 18, range: 1.8, hitTime: 0.45, reaction: 'Hit_Chest', type: 'melee' },
  'Elbow':      { damage: 10, range: 1.6, hitTime: 0.22, reaction: 'Hit_Head',  type: 'melee' },
  'Jump_Start': { damage: 10, range: 2.2, hitTime: 0.3,  reaction: 'Hit_Chest', type: 'melee' },
  'Roll':       { damage: 5,  range: 1.8, hitTime: 0.45, reaction: 'Hit_Chest', type: 'melee' },
};

/**
 * Check if an attacker's current animation lands a hit on the victim.
 *
 * Returns { damage, reaction } if hit, or null if miss / not applicable.
 * Pure check — caller handles side-effects (damage, flash, combo, etc).
 */
export function checkAttackHit(attacker, victim) {
  const atk = ATTACKS[attacker.currentAnimName];
  if (!atk) return null;
  if (attacker.attackHitChecked) return null;

  // Wait for the hit-frame (uses game-time so it scales with sim speed)
  if (attacker.attackElapsed < atk.hitTime) return null;

  // Mark checked so we only resolve once per attack
  attacker.attackHitChecked = true;

  // Distance check
  if (!attacker.model || !victim.model) return null;
  const dist = attacker.model.position.distanceTo(victim.model.position);
  if (dist > atk.range) return null;

  // Rolling = full dodge
  if (victim.currentAnimName === 'Roll' || victim.currentAnimName === 'Roll_RM') return null;

  // Crouching dodges head-level attacks
  if (victim.currentAnimName === 'Crouch_Idle_Loop' && atk.reaction === 'Hit_Head') return null;

  // --- Blocking ---
  // Blocks absorb most damage. Melee: 80% reduced. Ranged: 60% reduced.
  // Returns a special "blocked" result so the UI can show feedback.
  if (victim.isBlocking) {
    const reduction = atk.type === 'melee' ? 0.8 : 0.6;
    const chipDamage = Math.round(atk.damage * (1 - reduction));
    return { damage: chipDamage, reaction: 'Hit_Chest', blocked: true };
  }

  // --- Moving-target dodge ---
  if (victim.isMoving) {
    const speed = victim.velocity ? victim.velocity.length() : 0;

    if (atk.type === 'ranged') {
      const dodgeChance = Math.min(0.85, speed * 0.2);
      if (Math.random() < dodgeChance) return { dodged: true };
    } else {
      const dodgeChance = Math.min(0.35, speed * 0.08);
      if (Math.random() < dodgeChance) return { dodged: true };
    }
  }

  return { damage: atk.damage, reaction: atk.reaction };
}
