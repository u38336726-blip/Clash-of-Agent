// Fighter class definitions — pure hand-to-hand combat (Taken 3 style).

export const CLASS_DEFS = {
  boxer: {
    name: 'Boxer',
    description: 'Lightning-fast punches. High combo potential.',
    color: '#ff4422',
    attacks: [
      { anim: 'Jab',  label: 'Jab'   },
      { anim: 'Hook', label: 'Hook'  },
      { anim: 'Elbow', label: 'Elbow' },
    ],
    stats: { maxHealth: 110, walkSpeed: 2.6, sprintSpeed: 4.2 },
  },
  mma: {
    name: 'MMA',
    description: 'Kicks and takedowns. Versatile range.',
    color: '#22aaff',
    attacks: [
      { anim: 'Kick_Front', label: 'Front Kick'  },
      { anim: 'Tackle',     label: 'Takedown'    },
      { anim: 'Jab',        label: 'Jab'         },
    ],
    stats: { maxHealth: 100, walkSpeed: 2.4, sprintSpeed: 4.0 },
  },
  street: {
    name: 'Street',
    description: 'Raw power. Hard-hitting brawler style.',
    color: '#ffaa00',
    attacks: [
      { anim: 'Hook',       label: 'Haymaker'    },
      { anim: 'Kick_Round', label: 'Roundhouse'  },
      { anim: 'Jab',        label: 'Jab'         },
    ],
    stats: { maxHealth: 120, walkSpeed: 2.3, sprintSpeed: 3.8 },
  },
  agent: {
    name: 'Agent',
    description: 'Tactical close-quarters. Fast and lethal.',
    color: '#88ff44',
    attacks: [
      { anim: 'Tackle',     label: 'Takedown'    },
      { anim: 'Elbow',      label: 'Elbow Strike' },
      { anim: 'Hook',       label: 'Hook'        },
    ],
    stats: { maxHealth: 90, walkSpeed: 3.0, sprintSpeed: 4.8 },
  },
};

// P1 combat keys: Q, E, F   |   P2 combat keys: I, O, P
const P1_COMBAT_KEYS = ['Q', 'E', 'F'];
const P2_COMBAT_KEYS = ['I', 'O', 'P'];

// Block anim name — used by player.js and combat.js
export const BLOCK_ANIM = 'Block_Loop';

const P1_SHARED = [
  { key: 'Space', anim: 'Jump_Start',       label: 'Jump',   category: 'move' },
  { key: 'X',     anim: BLOCK_ANIM,         label: 'Block',  category: 'move' },
  { key: 'C',     anim: 'Crouch_Idle_Loop', label: 'Crouch', category: 'move' },
  { key: 'R',     anim: 'Roll',             label: 'Roll',   category: 'move' },
];

const P2_SHARED = [
  { key: '/',     anim: 'Jump_Start',       label: 'Jump',   category: 'move' },
  { key: 'N',     anim: BLOCK_ANIM,         label: 'Block',  category: 'move' },
  { key: '.',     anim: 'Crouch_Idle_Loop', label: 'Crouch', category: 'move' },
  { key: ',',     anim: 'Roll',             label: 'Roll',   category: 'move' },
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
