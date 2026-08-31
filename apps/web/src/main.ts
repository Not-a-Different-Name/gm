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
`;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (canvas === null) {
  throw new Error('找不到游戏画布');
}

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
  player.update(deltaSeconds);
  world.update(player.position.x, player.position.z);
  particles.update(deltaSeconds);
  updateSelection();
  renderer.render(scene, camera);
  window.requestAnimationFrame(render);
}

window.addEventListener('resize', () => {
  resize();
});

resize();
render();
