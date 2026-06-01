// Attack definitions and hit resolution — pure hand-to-hand combat.

export const ONE_SHOT = [
  'Jab', 'Hook', 'Hook_Right', 'Cross', 'Uppercut', 'Uppercut_Combo',
  'Body_Punch', 'Body_Punch_L', 'Elbow', 'Counter',
  'Hit_Chest', 'Hit_Head', 'Hit_Heavy',
  'Death01', 'Death02', 'GetUp', 'Roll',
];

export const ATTACKS = {
  'Jab':           { damage: 10, range: 2.0, hitTime: 0.18, reaction: 'Hit_Chest', type: 'melee' },
  'Hook':          { damage: 16, range: 2.0, hitTime: 0.22, reaction: 'Hit_Heavy', type: 'melee' },
  'Hook_Right':    { damage: 16, range: 2.0, hitTime: 0.22, reaction: 'Hit_Heavy', type: 'melee' },
  'Cross':         { damage: 14, range: 2.0, hitTime: 0.20, reaction: 'Hit_Heavy', type: 'melee' },
  'Uppercut':      { damage: 18, range: 1.9, hitTime: 0.25, reaction: 'Hit_Heavy', type: 'melee' },
  'Uppercut_Combo':{ damage: 22, range: 1.9, hitTime: 0.28, reaction: 'Hit_Heavy', type: 'melee' },
  'Body_Punch':    { damage: 12, range: 1.9, hitTime: 0.20, reaction: 'Hit_Chest', type: 'melee' },
  'Body_Punch_L':  { damage: 12, range: 1.9, hitTime: 0.20, reaction: 'Hit_Chest', type: 'melee' },
  'Elbow':         { damage: 14, range: 1.8, hitTime: 0.15, reaction: 'Hit_Heavy', type: 'melee' },
  'Counter':       { damage: 20, range: 1.8, hitTime: 0.25, reaction: 'Hit_Heavy', type: 'melee' },
};

export function checkAttackHit(attacker, victim) {
  const atk = ATTACKS[attacker.currentAnimName];
  if (!atk) return null;
  if (attacker.attackHitChecked) return null;
  if (attacker.attackElapsed < atk.hitTime) return null;

  attacker.attackHitChecked = true;

  if (!attacker.model || !victim.model) return null;

  const dist = attacker.model.position.distanceTo(victim.model.position);
  if (dist > atk.range) return null;

  if (victim.currentAnimName === 'Roll') return null;

  if (victim.isBlocking) {
    const chipDamage = Math.round(atk.damage * 0.15);
    return { damage: chipDamage, reaction: 'Hit_Chest', blocked: true };
  }

  return { damage: atk.damage, reaction: atk.reaction };
}
