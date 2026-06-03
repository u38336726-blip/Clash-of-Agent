import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const arenaRadius = 6;

// Scene
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a18);
scene.fog = new THREE.Fog(0x0a0a18, 35, 80);

// Camera
export const camera = new THREE.PerspectiveCamera(
  62, window.innerWidth / window.innerHeight, 0.1, 200
);
camera.position.set(0, 1.8, 5.5);

// Renderer
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);

// Orbit controls
export const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.target.set(0, 1.2, 0);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.06;
orbitControls.maxPolarAngle = Math.PI / 2;
orbitControls.minDistance = 2.5;
orbitControls.maxDistance = 12;

// Clock
export const clock = new THREE.Clock();

// --- Lights — cinematic arena setup ---

// Ambient: minimal fill — shadows need to be dark for drama
scene.add(new THREE.AmbientLight(0x202030, 0.2));

// Hemisphere: sky=warm, ground=cool — natural outdoor arena feel
const hemiLight = new THREE.HemisphereLight(0xffeebb, 0x303060, 0.4);
scene.add(hemiLight);

// Main sun: warm directional from above-right, casts shadows
const sunLight = new THREE.DirectionalLight(0xfff0dd, 3.0);
sunLight.position.set(8, 15, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 60;
sunLight.shadow.camera.left = -10;
sunLight.shadow.camera.right = 10;
sunLight.shadow.camera.top = 10;
sunLight.shadow.camera.bottom = -10;
sunLight.shadow.bias = -0.0003;
sunLight.shadow.radius = 3;
scene.add(sunLight);

// Back rim light: strong cool blue — gives fighters a defined silhouette edge
const rimLight = new THREE.DirectionalLight(0x5577ff, 2.8);
rimLight.position.set(-5, 6, -8);
scene.add(rimLight);

// Front fill: warm subtle light so faces aren't dark
const frontFill = new THREE.DirectionalLight(0xffddbb, 0.5);
frontFill.position.set(0, 3, 8);
scene.add(frontFill);

// Arena torch lights: warm point lights on the sides for atmosphere
const torchL = new THREE.PointLight(0xff8040, 1.5, 25, 1.5);
torchL.position.set(-8, 4, 0);
scene.add(torchL);

const torchR = new THREE.PointLight(0xff8040, 1.5, 25, 1.5);
torchR.position.set(8, 4, 0);
scene.add(torchR);

// Center spotlight: dramatic top-down on the fighters
const spotLight = new THREE.SpotLight(0xffffff, 2.0, 20, Math.PI / 6, 0.5, 1);
spotLight.position.set(0, 12, 0);
spotLight.target.position.set(0, 0, 0);
spotLight.castShadow = true;
spotLight.shadow.mapSize.set(2048, 2048);
scene.add(spotLight);
scene.add(spotLight.target);

// --- Load Arena GLB (hidden until reveal) ---
let arenaModel = null;
let arenaReady = false;
let arenaTargetY = 0;     // final resting Y position
let arenaAnimation = null; // active transition state

const arenaLoader = new GLTFLoader();
console.log('Loading arena from assets/arena.glb...');
arenaLoader.load('assets/arena.glb', (gltf) => {
  console.log('Arena GLB loaded successfully');
  const arena = gltf.scene;

  arena.traverse(child => {
    if (child.isMesh) {
      child.receiveShadow = true;
      child.castShadow = true;
      // Store original materials for fade-in
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          m.transparent = true;
          m.opacity = 0;
        });
      }
    }
  });

  // Scale
  const box = new THREE.Box3().setFromObject(arena);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z);
  const targetSize = 30;
  const scale = targetSize / maxDim;
  arena.scale.setScalar(scale);

  // Position: centered, floor at y=0
  const scaledBox = new THREE.Box3().setFromObject(arena);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  arena.position.set(
    arena.position.x - scaledCenter.x,
    arena.position.y - scaledBox.min.y,
    arena.position.z - scaledCenter.z
  );

  // Store final position — arena stays in place, meshes start invisible
  arenaTargetY = arena.position.y;

  scene.add(arena);
  arenaModel = arena;
  arenaReady = true;
  console.log(`Arena ready (hidden). Scale=${scale.toFixed(3)}`);
}, undefined, (err) => {
  console.warn('Arena load failed, using fallback ground:', err);
  addFallbackGround();
});

// Fallback if arena fails to load
// Default ground + grid — visible when arena is off
const defaultGround = new THREE.Mesh(
  new THREE.CircleGeometry(15, 64),
  new THREE.MeshStandardMaterial({ color: 0x252540, roughness: 0.8, metalness: 0.2 })
);
defaultGround.rotation.x = -Math.PI / 2;
defaultGround.receiveShadow = true;
scene.add(defaultGround);

const defaultRing = new THREE.Mesh(
  new THREE.RingGeometry(arenaRadius - 0.05, arenaRadius + 0.05, 64),
  new THREE.MeshBasicMaterial({ color: 0x4a4a7a, side: THREE.DoubleSide })
);
defaultRing.rotation.x = -Math.PI / 2;
defaultRing.position.y = 0.02;
scene.add(defaultRing);

const defaultGrid = new THREE.GridHelper(30, 30, 0x3a3a5c, 0x2a2a4c);
defaultGrid.position.y = 0.01;
scene.add(defaultGrid);

function setDefaultGroundVisible(v) {
  defaultGround.visible = v;
  defaultRing.visible = v;
  defaultGrid.visible = v;
}

function addFallbackGround() {
  // already added above
}

// --- Arena morph transition ---
// Meshes fade in one by one, scattered across the arena, like it's materializing.

let arenaMeshes = [];      // all meshes in the arena, sorted randomly
let arenaVisible = false;
let morphAnim = null;       // { startTime, duration, direction: 'in'|'out' }

/**
 * Toggle arena visibility with a morph transition.
 * Pieces fade in/out staggered — some appear early, some late.
 */
export function toggleArena(duration = 3.0) {
  if (!arenaReady || !arenaModel) return;

  const direction = arenaVisible ? 'out' : 'in';
  arenaVisible = !arenaVisible;

  // Hide grid when arena fades in, show when fades out
  if (direction === 'in') setDefaultGroundVisible(false);

  arenaModel.position.y = arenaTargetY;

  morphAnim = {
    startTime: performance.now(),
    duration: duration * 1000,
    direction,
  };

  // On first reveal, collect and shuffle meshes for staggered effect
  if (arenaMeshes.length === 0) {
    arenaModel.traverse(child => {
      if (child.isMesh) {
        arenaMeshes.push(child);
      }
    });
    // Shuffle so pieces appear in random order
    for (let i = arenaMeshes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arenaMeshes[i], arenaMeshes[j]] = [arenaMeshes[j], arenaMeshes[i]];
    }
  }
}

/** Call every frame */
export function updateArenaTransition() {
  if (!morphAnim || !arenaModel) return;

  const elapsed = performance.now() - morphAnim.startTime;
  const totalT = Math.min(1, elapsed / morphAnim.duration);
  const fadingIn = morphAnim.direction === 'in';

  const n = arenaMeshes.length;
  if (n === 0) return;

  // Each mesh gets its own staggered window
  // Mesh i starts fading at t = i/n * 0.6 and finishes by t = i/n * 0.6 + 0.4
  for (let i = 0; i < n; i++) {
    const mesh = arenaMeshes[i];
    const staggerStart = (i / n) * 0.6;
    const staggerEnd = staggerStart + 0.4;
    let meshT = (totalT - staggerStart) / (staggerEnd - staggerStart);
    meshT = Math.max(0, Math.min(1, meshT));

    // Ease
    meshT = meshT * meshT * (3 - 2 * meshT); // smoothstep

    const opacity = fadingIn ? meshT : 1 - meshT;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
      m.transparent = true;
      m.opacity = opacity;
      m.needsUpdate = true;
    });
  }

  // Done
  if (totalT >= 1) {
    // Clean up: set final state
    arenaMeshes.forEach(mesh => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => {
        if (fadingIn) {
          m.transparent = false;
          m.opacity = 1;
        } else {
          m.transparent = true;
          m.opacity = 0;
        }
      });
    });
    // Show grid again when arena fades out
    if (!fadingIn) setDefaultGroundVisible(true);
    morphAnim = null;
  }
}

export function isArenaVisible() { return arenaVisible; }
export function getFloorY() { return arenaVisible ? 1.09 : 0; }
export function isArenaReady() { return arenaReady; }

// --- Arena floor markings (centre circle + cross) ---
const markMat = new THREE.MeshBasicMaterial({ color: 0x8a6a3a, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.06, 64), markMat);
innerRing.rotation.x = -Math.PI / 2;
innerRing.position.y = 0.021;
scene.add(innerRing);
const outerRing = new THREE.Mesh(new THREE.RingGeometry(2.9, 3.06, 64), markMat.clone());
outerRing.rotation.x = -Math.PI / 2;
outerRing.position.y = 0.021;
scene.add(outerRing);
const crossH = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 0.05), markMat.clone());
crossH.rotation.x = -Math.PI / 2;
crossH.position.y = 0.021;
scene.add(crossH);
const crossV = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 6.2), markMat.clone());
crossV.rotation.x = -Math.PI / 2;
crossV.position.y = 0.021;
scene.add(crossV);

// --- Dynamic camera: follows fighter midpoint, zooms with separation ---
export function updateCameraForFight(p1pos, p2pos) {
  if (!p1pos || !p2pos) return;
  const midX = (p1pos.x + p2pos.x) * 0.5;
  const midZ = (p1pos.z + p2pos.z) * 0.5;
  const separation = p1pos.distanceTo(p2pos);
  // Cap zoom-out at 7.0 so both fighters always stay in frame
  const targetZ = Math.max(4.5, Math.min(7.0, separation * 1.3 + 3.2));

  // Pull orbit target toward fight midpoint (faster lerp so camera doesn't lag)
  orbitControls.target.x += (midX - orbitControls.target.x) * 0.07;
  orbitControls.target.z += (midZ * 0.15 - orbitControls.target.z) * 0.07;
  // Dynamic zoom
  camera.position.z += (targetZ - camera.position.z) * 0.05;
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
