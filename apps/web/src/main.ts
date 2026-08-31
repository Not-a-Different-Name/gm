import { BLOCK_DEFINITIONS, BlockId, FixedWorldBoundary, createWorldMetadata } from '@gm/core';
import { BlockParticles, PlayerController, VoxelWorldView } from '@gm/renderer';
import { WorldStorage, createStoredWorld } from '@gm/storage';
import * as THREE from 'three';

import './style.css';

const searchParameters = new URLSearchParams(window.location.search);
const defaultSeed = searchParameters.get('seed')?.trim() || 'gm-0';
const activeSaveId = searchParameters.get('save')?.trim() || defaultSeed;
const activeSaveName = searchParameters.get('saveName')?.trim() || '默认存档';
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
    <p>存档：<strong>${activeSaveName}</strong></p>
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
      <p>当前存档：${activeSaveName}</p>
      <button id="start-game" type="button">进入世界</button>
      <label class="save-name-label" for="new-save-name">新存档名称</label>
      <input id="new-save-name" maxlength="32" placeholder="例如：山地建造" />
      <button id="create-save" class="secondary-button" type="button">创建新存档</button>
      <div id="save-list" class="save-list" aria-label="当前种子的存档列表"></div>
      <p class="menu-note">进入后点击画面锁定鼠标，按 Esc 暂停。</p>
    </div>
  </section>
  <section id="pause-menu" class="menu-layer is-hidden" aria-hidden="true">
    <div class="menu-panel">
      <p class="eyebrow">游戏已暂停</p>
      <h1>暂停菜单</h1>
      <button id="resume-game" type="button">继续游戏</button>
      <button id="save-world" class="secondary-button" type="button">保存当前地图</button>
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
const saveWorld = document.querySelector<HTMLButtonElement>('#save-world');
const createSave = document.querySelector<HTMLButtonElement>('#create-save');
const newSaveName = document.querySelector<HTMLInputElement>('#new-save-name');
const saveList = document.querySelector<HTMLElement>('#save-list');
if (
  mainMenu === null ||
  pauseMenu === null ||
  startGame === null ||
  resumeGame === null ||
  returnMainMenu === null ||
  saveWorld === null ||
  createSave === null ||
  newSaveName === null ||
  saveList === null
) {
  throw new Error('找不到游戏菜单');
}
const gameCanvas = canvas;
const gameMainMenu = mainMenu;
const gamePauseMenu = pauseMenu;
const saveListElement = saveList;

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
  void populateSaveList();
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

const storage = new WorldStorage();
let saveTimer: number | undefined;

async function restoreWorld(): Promise<void> {
  const savedWorld = await storage.loadWorld(activeSaveId);
  if (savedWorld === undefined) {
    return;
  }
  world.applyChunkDeltas(savedWorld.chunks);
  player.setPosition(
    new THREE.Vector3(savedWorld.player.x, savedWorld.player.y, savedWorld.player.z)
  );
}

async function saveCurrentWorld(): Promise<void> {
  await storage.saveWorld(
    createStoredWorld(
      activeSaveId,
      activeSaveName,
      metadata,
      player.position,
      world.getModifiedChunks()
    )
  );
  await populateSaveList();
}

function scheduleSave(): void {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void saveCurrentWorld();
  }, 600);
}

void restoreWorld();

async function populateSaveList(): Promise<void> {
  const saves = await storage.listWorlds(defaultSeed);
  saveListElement.replaceChildren();
  for (const save of saves) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'save-entry';
    button.textContent = `${save.name ?? '旧存档'} · ${new Date(save.updatedAt).toLocaleString()}`;
    button.addEventListener('click', () => {
      const next = new URLSearchParams({
        seed: defaultSeed,
        save: save.id,
        saveName: save.name ?? '旧存档'
      });
      window.location.search = next.toString();
    });
    saveListElement.append(button);
  }
}

createSave.addEventListener('click', () => {
  const name = newSaveName.value.trim();
  if (name.length === 0) {
    newSaveName.focus();
    return;
  }
  const next = new URLSearchParams({
    seed: defaultSeed,
    save: crypto.randomUUID(),
    saveName: name
  });
  window.location.search = next.toString();
});
saveWorld.addEventListener('click', () => {
  void saveCurrentWorld();
});
void populateSaveList();

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

function isMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.menu-panel') !== null;
}

document.addEventListener(
  'contextmenu',
  (event) => {
    if (!isMenuTarget(event.target)) {
      event.preventDefault();
    }
  },
  { capture: true }
);
document.addEventListener(
  'auxclick',
  (event) => {
    if (!isMenuTarget(event.target)) {
      event.preventDefault();
    }
  },
  { capture: true }
);
canvas.addEventListener('dragstart', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  if (event.button !== 0) {
    event.preventDefault();
  }
});
canvas.addEventListener('pointermove', (event) => {
  if (event.buttons !== 0) {
    event.preventDefault();
  }
});
canvas.addEventListener('pointerup', (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
});
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
      scheduleSave();
    }
  }
  if (event.button === 2) {
    if (world.setBlock(blockPosition.x, blockPosition.y, blockPosition.z, selectedBlock)) {
      scheduleSave();
    }
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
