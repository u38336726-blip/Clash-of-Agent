// Attack definitions and hit resolution — pure hand-to-hand combat.

export const ONE_SHOT = [
  'Jab', 'Hook', 'Hook_Right', 'Cross', 'Uppercut', 'Uppercut_Combo',
  'Body_Punch', 'Body_Punch_L', 'Elbow', 'Counter',
  'Hit_Chest', 'Hit_Head', 'Hit_Heavy',
  'Death01', 'Death02', 'GetUp', 'Roll',
];

export const ATTACKS = {
  'Jab':           { damage: 10, range: 1.9,  idealDist: 1.56, hitTime: 0.18, hitWindow: 0.12, contactRadius: 0.7,  forwardDot: 0.08, reaction: 'Hit_Chest', type: 'melee' },
  'Hook':          { damage: 16, range: 1.82, idealDist: 1.48, hitTime: 0.22, hitWindow: 0.14, contactRadius: 0.62, forwardDot: 0.02, reaction: 'Hit_Heavy', type: 'melee' },
  'Hook_Right':    { damage: 16, range: 1.82, idealDist: 1.48, hitTime: 0.22, hitWindow: 0.14, contactRadius: 0.62, forwardDot: 0.02, reaction: 'Hit_Heavy', type: 'melee' },
  'Cross':         { damage: 14, range: 1.88, idealDist: 1.54, hitTime: 0.20, hitWindow: 0.12, contactRadius: 0.68, forwardDot: 0.12, reaction: 'Hit_Heavy', type: 'melee' },
  'Uppercut':      { damage: 18, range: 1.76, idealDist: 1.44, hitTime: 0.25, hitWindow: 0.14, contactRadius: 0.58, forwardDot: 0.04, reaction: 'Hit_Heavy', type: 'melee' },
  'Uppercut_Combo':{ damage: 22, range: 1.78, idealDist: 1.45, hitTime: 0.28, hitWindow: 0.16, contactRadius: 0.6,  forwardDot: 0.04, reaction: 'Hit_Heavy', type: 'melee' },
  'Body_Punch':    { damage: 12, range: 1.76, idealDist: 1.44, hitTime: 0.20, hitWindow: 0.12, contactRadius: 0.58, forwardDot: 0.04, reaction: 'Hit_Chest', type: 'melee' },
  'Body_Punch_L':  { damage: 12, range: 1.76, idealDist: 1.44, hitTime: 0.20, hitWindow: 0.12, contactRadius: 0.58, forwardDot: 0.04, reaction: 'Hit_Chest', type: 'melee' },
  'Elbow':         { damage: 14, range: 1.64, idealDist: 1.36, hitTime: 0.15, hitWindow: 0.1,  contactRadius: 0.48, forwardDot: -0.04, reaction: 'Hit_Heavy', type: 'melee' },
  'Counter':       { damage: 20, range: 1.82, idealDist: 1.5,  hitTime: 0.25, hitWindow: 0.14, contactRadius: 0.62, forwardDot: 0.04, reaction: 'Hit_Heavy', type: 'melee' },
};

function isAttackActive(attacker, atk) {
  if (attacker.attackElapsed < atk.hitTime) return false;
  if (attacker.attackElapsed > atk.hitTime + (atk.hitWindow ?? 0.14)) {
    attacker.attackHitChecked = true;
    return false;
  }
  return true;
}

function isFacingVictim(attacker, victim, minDot) {
  const toVictimX = victim.model.position.x - attacker.model.position.x;
  const toVictimZ = victim.model.position.z - attacker.model.position.z;
  const planarLen = Math.hypot(toVictimX, toVictimZ);
  if (planarLen < 0.001) return true;

  const forwardX = Math.sin(attacker.model.rotation.y);
  const forwardZ = Math.cos(attacker.model.rotation.y);
  const dot = (toVictimX / planarLen) * forwardX + (toVictimZ / planarLen) * forwardZ;
  return dot >= minDot;
}

function hasVisibleContact(attacker, victim, atk, centerDist) {
  const handPos = attacker.getAttackHandPos?.();
  const bodyPos = victim.getBodyPos?.();
  if (!handPos || !bodyPos) {
    return centerDist <= atk.range * 0.92;
  }
  return handPos.distanceTo(bodyPos) <= atk.contactRadius;
}

export function checkAttackHit(attacker, victim) {
  const atk = ATTACKS[attacker.currentAnimName];
  if (!atk) return null;
  if (attacker.attackHitChecked) return null;
  if (!isAttackActive(attacker, atk)) return null;

  if (!attacker.model || !victim.model) return null;

  const centerDist = attacker.model.position.distanceTo(victim.model.position);
  if (centerDist > atk.range) return null;

  if (victim.currentAnimName === 'Roll') return null;
  if (!isFacingVictim(attacker, victim, atk.forwardDot ?? 0)) return null;
  if (!hasVisibleContact(attacker, victim, atk, centerDist)) return null;

  attacker.attackHitChecked = true;

  if (victim.isBlocking) {
    const chipDamage = Math.round(atk.damage * 0.15);
    return { damage: chipDamage, reaction: 'Hit_Chest', blocked: true };
  }

  return { damage: atk.damage, reaction: atk.reaction };
}
