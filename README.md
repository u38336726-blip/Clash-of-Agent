<div align="center">

# Human Movement Arena

**Browser-based 3D fighting game with real-time AI learning**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Play%20Now-brightgreen?style=for-the-badge)](https://ar9av.in/app/humanarena)
[![Paper](https://img.shields.io/badge/Research-Paper-blue?style=for-the-badge)](paper/human_movement_arena.pdf)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

Two AI agents learn to fight from scratch using tabular Q-learning in a real-time 3D environment.
No neural networks. No GPU. No ML frameworks. Just a browser.

[**Try it live**](https://ar9av.in/app/humanarena)

</div>

---

## Overview

Human Movement Arena is a 3D fighting game where AI agents discover combat strategies through reinforcement learning. Starting from random behavior, agents learn to attack, block, counter, and dodge by playing thousands of rounds against each other — all running in your browser with Three.js.

The project is also a research experiment investigating how training fidelity affects learned behavior. Our key finding: **185 rounds of real 3D training produced better fighters than 5,050 rounds of simplified simulation.**

<div align="center">
  <img src="paper/figures/fig_action_shot.png" width="700" alt="Two AI fighters in close combat" />
  <br />
  <em>AI agents engaged in close combat during training, with real-time stats dashboard</em>
</div>

## Features

| Mode | Description |
|------|-------------|
| **1 Player** | Fight a pre-trained AI with 4 difficulty levels (Easy / Medium / Hard / Expert) |
| **2 Players** | Local multiplayer — two players, one keyboard |
| **Train** | Watch AI vs AI learn in real-time with speed controls, live win-rate graphs, and training stats |

### Training System
- **Q-learning** with experience replay (350 states, 7 actions, 10KB Q-table)
- **Live dashboard** — win rates, damage curves, exploration rate, state coverage
- **Speed controls** — 1x to 20x game speed + turbo/hyper modes for fast training
- **Persistent learning** — brains auto-save to localStorage, survive page refresh
- **Export data** — download full training data (Q-tables + match logs) as JSON

### Combat System
- 4 fighter classes: **Brawler**, **Swordsman**, **Gunslinger**, **Mage**
- Melee and ranged attacks with distance-based hit detection
- Blocking (with chip damage), dodge rolling, counter-attacks
- Stun states, movement-based evasion, combo tracking
- 45 skeletal animations from Universal Animation Library

### Environment
- 3D arena with dynamic loading (morphs in piece-by-piece)
- Cinematic lighting (hemisphere, spot, rim, torch lights)
- 8-bit retro UI with Press Start 2P pixel font
- Match event logging for analysis

## Controls

| | Player 1 | Player 2 | Action |
|-|----------|----------|--------|
| | `W` `A` `S` `D` | `Up` `Down` `Left` `Right` | Move |
| | `Q` `E` `F` | `I` `O` `P` | Attack |
| | `X` | `N` | Block |
| | `R` | `,` | Roll |
| | `Space` | `/` | Jump |
| | `Shift` | `Shift` | Sprint |

## Research Findings

The project systematically compared training approaches:

| Approach | Rounds | Outcome |
|----------|--------|---------|
| Ghost simulation (1D headless) | 5,050 | Failed — damage collapsed, strategies useless in 3D |
| Calibrated ghost | 1,734 | Better but 96% timeouts, still ineffective |
| **Pure 3D training** | **185** | **Best results — stable damage, competitive vs human** |

Five reward function failure modes were documented:

1. **Idle Agent** — AI stood still 44% of the time
2. **Mutual Avoidance** — both AIs stayed apart, 99% timeouts
3. **Damage Collapse** — average damage fell from 196 to 16 per round
4. **Block Turtling** — AI held block 94% of the match
5. **HP Blindness** — training at 10% HP covered only 41/864 states

**Human evaluation** (preliminary, n=8 matches):

| Stage | Record | AI Accuracy | AI Idle When Hit |
|-------|--------|-------------|------------------|
| Pre-training | Human 5-0 | 65% | 44% |
| Post ghost training | Human 2-0 | 50% | 8% |
| Post pure 3D | **Human 2-1** | **100%** | **0%** |

Full details in the [research paper](paper/human_movement_arena.pdf).

## Architecture

```
human-movt/
  index.html              Minimal HTML shell
  css/style.css           8-bit retro UI (Press Start 2P)
  js/
    main.js               Game loop, boot sequence, training orchestration
    scene.js              Three.js scene, camera, lighting, arena loader
    player.js             Player class — animation, movement, damage, stun
    combat.js             Hit detection, dodge mechanics, block resolution
    controls.js           Keyboard input, directional movement
    classes.js            Fighter class definitions + keybind generation
    ai.js                 AI controller — brain integration, decision execution
    brain.js              Q-learning — Q-table, experience replay, persistence
    difficulty.js         Difficulty presets (Easy / Medium / Hard / Expert)
    logger.js             Match event logging (JSON export)
    headless.js           Headless 1D simulation (deprecated)
  assets/
    character.glb         Rigged 3D character (45 skeletal animations)
    arena.glb             3D arena environment
    trained_brain_p2.json Pre-trained Q-table (349 states, shipped with game)
  paper/
    human_movement_arena.pdf   Research paper
    build_paper.py             PDF generator (reportlab)
    figures/                   Data-driven charts (matplotlib)
```

## Quick Start

```bash
# Clone
git clone https://github.com/Ar9av/human-fight.git
cd human-fight

# Serve (any static server works)
python3 -m http.server 8080

# Open
open http://localhost:8080
```

No dependencies. No build step. No npm install.

## Tech Stack

- **Three.js** — 3D rendering, skeletal animation, shadow maps
- **Vanilla JavaScript** — ES modules, no frameworks
- **Q-Learning** — tabular RL with experience replay
- **GLB/glTF** — 3D model format (Universal Animation Library)
- **localStorage** — brain persistence across sessions
- **CloudFront CDN** — asset delivery for hosted version

## License

MIT

---

<div align="center">
  <strong><a href="https://ar9av.in/app/humanarena">Play Human Movement Arena</a></strong>
  <br />
  Built by <a href="https://github.com/Ar9av">Arnav Gupta</a>
</div>
