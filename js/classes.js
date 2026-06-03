// Fighter class definitions — pure hand-to-hand combat (Taken 3 style).

const STANDARD_MAX_HEALTH = 100;

export const CLASS_DEFS = {
  boxer: {
    name: 'Boxer',
    description: 'Lightning-fast punches. High combo potential.',
    color: '#ff4422',
    attacks: [
      { anim: 'Jab',            label: 'Jab'       },
      { anim: 'Hook',           label: 'Hook'      },
      { anim: 'Cross',          label: 'Cross'     },
      { anim: 'Uppercut',       label: 'Uppercut'  },
      { anim: 'Body_Punch',     label: 'Body Shot' },
      { anim: 'Uppercut_Combo', label: 'Combo'     },
      { anim: 'Kick_Front',     label: 'Front Kick'},
      { anim: 'Kick_Side',      label: 'Side Kick' },
    ],
    stats: { maxHealth: STANDARD_MAX_HEALTH, walkSpeed: 2.6, sprintSpeed: 4.2 },
  },
  mma: {
    name: 'MMA',
    description: 'Close combat specialist.',
    color: '#22aaff',
    attacks: [
      { anim: 'Jab',            label: 'Jab'       },
      { anim: 'Cross',          label: 'Cross'     },
      { anim: 'Hook',           label: 'Hook'      },
      { anim: 'Elbow',          label: 'Elbow'     },
      { anim: 'Uppercut',       label: 'Uppercut'  },
      { anim: 'Body_Punch',     label: 'Body Shot' },
      { anim: 'Kick_Round',     label: 'Round Kick'},
      { anim: 'Kick_MMA',       label: 'Spin Kick' },
    ],
    stats: { maxHealth: STANDARD_MAX_HEALTH, walkSpeed: 2.4, sprintSpeed: 4.0 },
  },
  street: {
    name: 'Street',
    description: 'Raw power. Hard-hitting brawler style.',
    color: '#ffaa00',
    attacks: [
      { anim: 'Hook',           label: 'Haymaker'  },
      { anim: 'Hook_Right',     label: 'Right Hook'},
      { anim: 'Uppercut_Combo', label: 'Combo'     },
      { anim: 'Body_Punch_L',   label: 'Body Shot' },
      { anim: 'Elbow',          label: 'Elbow'     },
      { anim: 'Cross',          label: 'Cross'     },
      { anim: 'Kick_Front',     label: 'Front Kick'},
      { anim: 'Kick_Round',     label: 'Round Kick'},
    ],
    stats: { maxHealth: STANDARD_MAX_HEALTH, walkSpeed: 2.3, sprintSpeed: 3.8 },
  },
  agent: {
    name: 'Agent',
    description: 'Tactical close-quarters. Fast and lethal.',
    color: '#88ff44',
    attacks: [
      { anim: 'Elbow',          label: 'Elbow'     },
      { anim: 'Cross',          label: 'Cross'     },
      { anim: 'Jab',            label: 'Jab'       },
      { anim: 'Counter',        label: 'Counter'   },
      { anim: 'Hook',           label: 'Hook'      },
      { anim: 'Body_Punch',     label: 'Body Shot' },
      { anim: 'Kick_Side',      label: 'Side Kick' },
      { anim: 'Kick_MMA',       label: 'Spin Kick' },
    ],
    stats: { maxHealth: STANDARD_MAX_HEALTH, walkSpeed: 3.0, sprintSpeed: 4.8 },
  },
};

// P1 combat keys   |   P2 combat keys
const P1_COMBAT_KEYS = ['Q', 'E', 'F', 'Z', 'T', 'G', 'Y', 'H'];
const P2_COMBAT_KEYS = ['I', 'O', 'P', 'K', 'L', 'J', 'U', 'M'];

// Block anim name — used by player.js and combat.js
export const BLOCK_ANIM = 'Block_Loop';

const P1_SHARED = [
  { key: 'X', anim: BLOCK_ANIM, label: 'Block', category: 'move' },
  { key: 'R', anim: 'Roll',     label: 'Dodge', category: 'move' },
];

const P2_SHARED = [
  { key: 'N', anim: BLOCK_ANIM, label: 'Block', category: 'move' },
  { key: ',', anim: 'Roll',     label: 'Dodge', category: 'move' },
];

/**
 * Build the full action list for a player given their chosen class.
 * @param {string} classId  - key in CLASS_DEFS
 * @param {'p1'|'p2'} playerId
 * @returns {Array<{key:string, anim:string, label:string, category:string}>}
 */
export function getClassActions(classId, playerId) {
  const def = CLASS_DEFS[classId];
  const keys = playerId === 'p1' ? P1_COMBAT_KEYS : P2_COMBAT_KEYS;
  const shared = playerId === 'p1' ? P1_SHARED : P2_SHARED;

  const combat = def.attacks.map((atk, i) => ({
    key: keys[i],
    anim: atk.anim,
    label: atk.label,
    category: 'combat',
  }));

  return [...shared, ...combat];
}
