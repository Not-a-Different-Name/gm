import { BLOCK_DEFINITIONS, BlockId, FixedWorldBoundary, createWorldMetadata } from '@gm/core';
import { BlockParticles, PlayerController, VoxelWorldView } from '@gm/renderer';
import * as THREE from 'three';

import './style.css';

const searchParameters = new URLSearchParams(window.location.search);
const defaultSeed = searchParameters.get('seed')?.trim() || 'gm-0';
const fixedWorld = searchParameters.get('world') === 'fixed';
const metadata = createWorldMetadata(defaultSeed, '0.1.0');
const app = document.querySelector<HTMLElement>('#app');

if (app === null) {
  throw new Error('找不到游戏根节点');
}

app.innerHTML = `
  <canvas id="game-canvas" aria-label="GM 方块世界预览"></canvas>
  <aside class="hud">
    <p class="eyebrow">GM · 地形预览</p>
    <h1>可扩展的方块世界</h1>
    <p>种子：<strong>${metadata.seed}</strong></p>
    <p>区块：<strong>3 × 3</strong> · ${fixedWorld ? '固定地图' : '无限地图预览'} · 海平面水体已启用</p>
    <p>视角：<strong id="camera-mode">第一人称</strong> · 飞行：<strong id="flight-state">关闭</strong></p>
    <p>当前方块：<strong id="selected-block">草方块</strong></p>
    <p class="hint">点击画面锁定鼠标 · 左键破坏 · 右键放置 · 1-5 选方块 · WASD 移动 · 空格跳跃 · F 飞行 · V 切换视角</p>
  </aside>
  <section id="main-menu" class="menu-layer">
    <div class="menu-panel">
      <p class="eyebrow">GM · 单机世界</p>
      <h1>可扩展的方块世界</h1>
      <p>种子：${metadata.seed}</p>
      <button id="start-game" type="button">进入世界</button>
      <p class="menu-note">进入后点击画面锁定鼠标，按 Esc 暂停。</p>
    </div>
  </section>
  <section id="pause-menu" class="menu-layer is-hidden" aria-hidden="true">
    <div class="menu-panel">
      <p class="eyebrow">游戏已暂停</p>
      <h1>暂停菜单</h1>
      <button id="resume-game" type="button">继续游戏</button>
      <button id="return-main-menu" class="secondary-button" type="button">返回主界面</button>
      <p class="menu-note">按 Esc 也可暂停；选择继续后点击画面恢复控制。</p>
    </div>
  </section>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (canvas === null) {
  throw new Error('找不到游戏画布');
}

const mainMenu = document.querySelector<HTMLElement>('#main-menu');
const pauseMenu = document.querySelector<HTMLElement>('#pause-menu');
const startGame = document.querySelector<HTMLButtonElement>('#start-game');
const resumeGame = document.querySelector<HTMLButtonElement>('#resume-game');
const returnMainMenu = document.querySelector<HTMLButtonElement>('#return-main-menu');
if (
  mainMenu === null ||
  pauseMenu === null ||
  startGame === null ||
  resumeGame === null ||
  returnMainMenu === null
) {
  throw new Error('找不到游戏菜单');
}
const gameCanvas = canvas;
const gameMainMenu = mainMenu;
const gamePauseMenu = pauseMenu;

let gameStarted = false;
let paused = true;

function setMenuVisibility(menu: HTMLElement, visible: boolean): void {
  menu.classList.toggle('is-hidden', !visible);
  menu.setAttribute('aria-hidden', String(!visible));
}

function startOrResumeGame(): void {
  gameStarted = true;
  paused = false;
  setMenuVisibility(gameMainMenu, false);
  setMenuVisibility(gamePauseMenu, false);
  clock.getDelta();
  void gameCanvas.requestPointerLock();
}

function pauseGame(): void {
  if (!gameStarted) {
    return;
  }
  paused = true;
  selection.visible = false;
  setMenuVisibility(gamePauseMenu, true);
}

startGame.addEventListener('click', startOrResumeGame);
resumeGame.addEventListener('click', startOrResumeGame);
returnMainMenu.addEventListener('click', () => {
  gameStarted = false;
  paused = true;
  setMenuVisibility(gamePauseMenu, false);
  setMenuVisibility(gameMainMenu, true);
});
document.addEventListener('pointerlockchange', () => {
  if (gameStarted && document.pointerLockElement !== gameCanvas) {
    pauseGame();
  }
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x9fd8f4);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd8f4, 110, 260);
scene.add(new THREE.HemisphereLight(0xccecff, 0x4b5a36, 2.2));

const sun = new THREE.DirectionalLight(0xfff5d1, 2.5);
sun.position.set(80, 150, 45);
scene.add(sun);

const world = new VoxelWorldView({
  seed: defaultSeed,
  radius: 1,
  boundary: fixedWorld ? new FixedWorldBoundary({ x: -1, z: -1 }, { x: 1, z: 1 }) : undefined
});
scene.add(world.object3d);

const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 500);
const cameraMode = document.querySelector<HTMLElement>('#camera-mode');
const flightState = document.querySelector<HTMLElement>('#flight-state');
if (cameraMode === null || flightState === null) {
  throw new Error('找不到游戏状态栏');
}

const player = new PlayerController({
  camera,
  canvas,
  world,
  spawnPosition: new THREE.Vector3(0.5, world.getSpawnHeight(), 0.5),
  onCameraModeChange: (mode) => {
    cameraMode.textContent = mode === 'first-person' ? '第一人称' : '第三人称';
  },
  onFlightChange: (enabled) => {
    flightState.textContent = enabled ? '开启' : '关闭';
  }
});

const selectedBlockLabel = document.querySelector<HTMLElement>('#selected-block');
if (selectedBlockLabel === null) {
  throw new Error('找不到方块选择状态栏');
}

const selectableBlocks = [
  BlockId.Grass,
  BlockId.Dirt,
  BlockId.Stone,
  BlockId.Sand,
  BlockId.Wood
] as const;
let selectedBlock = BlockId.Grass;
const particles = new BlockParticles();
scene.add(particles.object3d);

const selection = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x171717 })
);
selection.visible = false;
scene.add(selection);
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2();

interface TargetBlock {
  readonly position: THREE.Vector3;
  readonly normal: THREE.Vector3;
}

function getTargetBlock(): TargetBlock | undefined {
  raycaster.setFromCamera(screenCenter, camera);
  const intersection = raycaster.intersectObject(world.object3d, true)[0];
  const face = intersection?.face;
  if (intersection === undefined || face === null || face === undefined) {
    return undefined;
  }
  return { position: intersection.point, normal: face.normal.clone() };
}

function toBlockPosition(target: TargetBlock, direction: number): THREE.Vector3 {
  return target.position
    .clone()
    .addScaledVector(target.normal, direction * 0.01)
    .floor();
}

function updateSelection(): void {
  const target = getTargetBlock();
  if (target === undefined) {
    selection.visible = false;
    return;
  }
  const position = toBlockPosition(target, -1);
  selection.position.copy(position).addScalar(0.5);
  selection.visible = true;
}

canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('auxclick', (event) => event.preventDefault());
canvas.addEventListener('dragstart', (event) => event.preventDefault());
canvas.addEventListener('mousedown', (event) => event.preventDefault());
canvas.addEventListener('mousedown', (event) => {
  if (document.pointerLockElement !== canvas) {
    return;
  }
  const target = getTargetBlock();
  if (target === undefined) {
    return;
  }
  const blockPosition = toBlockPosition(target, event.button === 0 ? -1 : 1);
  if (event.button === 0) {
    const destroyedBlock = world.getBlock(blockPosition.x, blockPosition.y, blockPosition.z);
    if (
      destroyedBlock !== BlockId.Air &&
      world.setBlock(blockPosition.x, blockPosition.y, blockPosition.z, BlockId.Air)
    ) {
      particles.spawn(blockPosition.addScalar(0.5), BLOCK_DEFINITIONS[destroyedBlock].color);
    }
  }
  if (event.button === 2) {
    world.setBlock(blockPosition.x, blockPosition.y, blockPosition.z, selectedBlock);
  }
});

document.addEventListener('keydown', (event) => {
  const index = Number(event.key) - 1;
  const nextBlock = selectableBlocks[index];
  if (nextBlock !== undefined) {
    selectedBlock = nextBlock;
    selectedBlockLabel.textContent = BLOCK_DEFINITIONS[selectedBlock].name.replace('gm:', '');
  }
});

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const clock = new THREE.Clock();

function render(): void {
  const deltaSeconds = clock.getDelta();
  if (!paused) {
    player.update(deltaSeconds);
    world.update(player.position.x, player.position.z);
    particles.update(deltaSeconds);
    updateSelection();
  }
  renderer.render(scene, camera);
  window.requestAnimationFrame(render);
}

window.addEventListener('resize', () => {
  resize();
});

resize();
render();
