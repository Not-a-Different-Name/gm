import {
  BLOCK_DEFINITIONS,
  BlockId,
  FixedWorldBoundary,
  Inventory,
  createWorldMetadata,
  waterSurfaceHeight
} from '@gm/core';
import {
  BlockParticles,
  Clouds,
  DropItems,
  PlayerController,
  Sky,
  VoxelWorldView,
  WaterFlowController,
  updateWaterMaterial
} from '@gm/renderer';
import {
  SaveFormatError,
  WorldStorage,
  classifySaveError,
  createStoredWorld,
  parseWorldFile,
  serializeWorld
} from '@gm/storage';
import type { StoredWorld } from '@gm/storage';
import * as THREE from 'three';

import { showDialog } from './dialog.js';
import { Hotbar } from './hotbar.js';
import { applyTextureBackground } from './menu-texture.js';
import { BlockSounds } from './sound.js';
import { showToast } from './toast.js';
import './style.css';

const searchParameters = new URLSearchParams(window.location.search);
const defaultSeed = searchParameters.get('seed')?.trim() || 'gm-0';
const activeSaveId = searchParameters.get('save')?.trim() || defaultSeed;
// 当前存档名:重命名/删除 active 存档后同步主界面显示,故用 let。
let activeSaveName = searchParameters.get('saveName')?.trim() || '默认存档';
const fixedWorld = searchParameters.get('world') === 'fixed';
const metadata = createWorldMetadata(defaultSeed, '0.1.0');
const app = document.querySelector<HTMLElement>('#app');
// 区块加载半径：2 → 5×5 区块（80×80 方块）。fixed 模式被边界裁剪回 3×3。
const CHUNK_RADIUS = 2;
// HUD 展示的区块规模：fixed 模式边界固定 3×3，无限模式随半径计算。
const hudChunkCount = fixedWorld ? 3 : CHUNK_RADIUS * 2 + 1;

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
    <p>区块：<strong>${hudChunkCount} × ${hudChunkCount}</strong> · ${fixedWorld ? '固定地图' : '无限地图预览'} · 昼夜天空已启用</p>
    <p>视角：<strong id="camera-mode">第一人称</strong> · 飞行：<strong id="flight-state">关闭</strong></p>
    <p>当前方块：<strong id="selected-block">草方块</strong></p>
    <p class="hint">点击画面锁定鼠标 · 左键破坏拾取 · 右键放置（消耗 1 个）· 1-6/滚轮选方块（水 ∞）· WASD 移动 · 空格跳跃 · F 飞行 · V 切换视角</p>
  </aside>
  <section id="main-menu" class="menu-layer">
    <div class="menu-panel">
      <p class="eyebrow">GM · 单机世界</p>
      <h1>可扩展的方块世界</h1>
      <label class="save-name-label" for="seed-input">种子（决定地形生成）</label>
      <input id="seed-input" maxlength="64" value="${metadata.seed}" />
      <p>当前存档：<strong id="active-save-name">${activeSaveName}</strong></p>
      <button id="start-game" type="button">进入世界</button>
      <label class="save-name-label" for="new-save-name">新存档名称</label>
      <input id="new-save-name" maxlength="32" placeholder="例如：山地建造" />
      <button id="create-save" class="secondary-button" type="button">创建新存档</button>
      <button id="manage-saves" class="secondary-button" type="button">管理存档</button>
      <p class="menu-note">进入后点击画面锁定鼠标，按 Esc 暂停。</p>
    </div>
  </section>
  <section id="saves-menu" class="menu-layer is-hidden" aria-hidden="true">
    <div class="menu-panel">
      <p class="eyebrow">GM · 存档管理</p>
      <h1>存档列表</h1>
      <button id="back-to-main" type="button">返回主界面</button>
      <button id="import-save" class="secondary-button" type="button">导入存档</button>
      <input id="import-file" type="file" accept=".json,application/json" hidden />
      <div id="saves-list" class="save-list" aria-label="当前种子的存档列表"></div>
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
const savesMenu = document.querySelector<HTMLElement>('#saves-menu');
const startGame = document.querySelector<HTMLButtonElement>('#start-game');
const resumeGame = document.querySelector<HTMLButtonElement>('#resume-game');
const returnMainMenu = document.querySelector<HTMLButtonElement>('#return-main-menu');
const saveWorld = document.querySelector<HTMLButtonElement>('#save-world');
const createSave = document.querySelector<HTMLButtonElement>('#create-save');
const manageSaves = document.querySelector<HTMLButtonElement>('#manage-saves');
const backToMain = document.querySelector<HTMLButtonElement>('#back-to-main');
const importSave = document.querySelector<HTMLButtonElement>('#import-save');
const importFile = document.querySelector<HTMLInputElement>('#import-file');
const newSaveName = document.querySelector<HTMLInputElement>('#new-save-name');
const seedInput = document.querySelector<HTMLInputElement>('#seed-input');
const savesList = document.querySelector<HTMLElement>('#saves-list');
const activeSaveNameLabel = document.querySelector<HTMLElement>('#active-save-name');
if (
  mainMenu === null ||
  pauseMenu === null ||
  savesMenu === null ||
  startGame === null ||
  resumeGame === null ||
  returnMainMenu === null ||
  saveWorld === null ||
  createSave === null ||
  manageSaves === null ||
  backToMain === null ||
  importSave === null ||
  importFile === null ||
  newSaveName === null ||
  seedInput === null ||
  savesList === null ||
  activeSaveNameLabel === null
) {
  throw new Error('找不到游戏菜单');
}
const gameCanvas = canvas;
const gameMainMenu = mainMenu;
const gamePauseMenu = pauseMenu;
const gameSavesMenu = savesMenu;
const savesListElement = savesList;
const seedInputElement = seedInput;
const activeSaveNameLabelElement = activeSaveNameLabel;
const startGameButton = startGame;

// 菜单贴图蒙版:主界面铺石头、存档界面铺泥土(暗色蒙层保证文字可读)。
const mainMenuPanel = mainMenu.querySelector<HTMLElement>('.menu-panel');
const savesMenuPanel = savesMenu.querySelector<HTMLElement>('.menu-panel');
if (mainMenuPanel === null || savesMenuPanel === null) {
  throw new Error('找不到菜单面板');
}
applyTextureBackground(mainMenuPanel, 'stone');
applyTextureBackground(savesMenuPanel, 'dirt');

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
  setMenuVisibility(gameSavesMenu, false);
  clock.getDelta();
  // 用户手势内创建/唤醒音频上下文（浏览器自动播放策略要求）。
  sounds.unlock();
  void gameCanvas.requestPointerLock();
}

function pauseGame(): void {
  if (!gameStarted) {
    return;
  }
  paused = true;
  // 暂停时中断长按破坏：否则 Esc 暂停后 breakingHeld 残留，恢复后仍持续破坏。
  breakingHeld = false;
  resetBreaking();
  sounds.stopBreaking();
  selection.visible = false;
  setMenuVisibility(gamePauseMenu, true);
}

startGame.addEventListener('click', () => {
  void enterWorldFromMainMenu();
});
resumeGame.addEventListener('click', startOrResumeGame);
returnMainMenu.addEventListener('click', () => {
  void leaveToMainMenu();
});
document.addEventListener('pointerlockchange', () => {
  if (gameStarted && document.pointerLockElement !== gameCanvas) {
    pauseGame();
  }
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
const fog = new THREE.Fog(0x9fd8f4, 130, 300);
scene.fog = fog;

// 昼夜天空：渐变穹顶、方块日月、星点与随时间变化的光照。
const sky = new Sky();
scene.add(sky.object3d);
const horizonColor = new THREE.Color();

// 像素云层：两层云挂在天空视觉组内（跟随相机、水下自动隐藏），云形由种子确定性生成。
const clouds = new Clouds({ seed: defaultSeed });
sky.visuals.add(clouds.object3d);

// 水下视觉：相机没入水面后，雾与清屏色过渡为深蓝（与地平线色混合，昼夜自然变暗）；
// 雾的近端留 6 格清晰区、32 格外才全雾，深水也能看清水底。
// 天空穹顶/日月/星辰/云层都关闭了雾效，必须隐藏以防穿透水面（sky.visuals，不含灯光）。
const underwaterFogColor = new THREE.Color(0x17436b);
const UNDERWATER_FOG_NEAR = 6;
const UNDERWATER_FOG_FAR = 32;
const UNDERWATER_BLEND_RATE = 4;
let underwaterAmount = 0;
const underwaterColor = new THREE.Color();

// 按相机所在格判定是否没入水面（雾是相机空间效果，与玩家身体物理分开判定，
// 第一/第三人称都跟随实际观察位置），并把 0..1 的入水量平滑趋近目标避免闪烁。
function updateUnderwaterEffect(deltaSeconds: number): void {
  const cellX = Math.floor(camera.position.x);
  const cellY = Math.floor(camera.position.y);
  const cellZ = Math.floor(camera.position.z);
  // 上方格也是水时相机必然没入水面（水面在更上层），不能再用"本格水面高"比较：
  // 水格顶部与下一格之间的空隙会让判定误以为已出水，垂直移动时雾反复切换。
  const submerged =
    world.getBlock(cellX, cellY, cellZ) === BlockId.Water &&
    (world.getBlock(cellX, cellY + 1, cellZ) === BlockId.Water ||
      camera.position.y < waterSurfaceHeight(cellY, world.getWaterLevel(cellX, cellY, cellZ)));
  const target = submerged ? 1 : 0;
  underwaterAmount +=
    (target - underwaterAmount) * Math.min(1, deltaSeconds * UNDERWATER_BLEND_RATE);

  underwaterColor.copy(horizonColor).lerp(underwaterFogColor, underwaterAmount);
  fog.near = THREE.MathUtils.lerp(130, UNDERWATER_FOG_NEAR, underwaterAmount);
  fog.far = THREE.MathUtils.lerp(300, UNDERWATER_FOG_FAR, underwaterAmount);
  fog.color.copy(underwaterColor);
  renderer.setClearColor(underwaterColor);
  // 只隐藏天空的视觉元素；灯光留在 object3d 根部，水下世界保持光照。
  sky.visuals.visible = underwaterAmount < 0.5;
}

const world = new VoxelWorldView({
  seed: defaultSeed,
  radius: CHUNK_RADIUS,
  boundary: fixedWorld ? new FixedWorldBoundary({ x: -1, z: -1 }, { x: 1, z: 1 }) : undefined
});
scene.add(world.object3d);

// 水流蔓延调度器：放水后逐帧向四周扩散，蔓延水不写入存档。
const waterFlow = new WaterFlowController(world);

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
  const restoredWaterSources = world.applyChunkDeltas(savedWorld.chunks);
  // 读档后唤醒水源重新蔓延：蔓延水不存档，池形由存档里的水源重新爬出。
  for (const source of restoredWaterSources) {
    waterFlow.markDirty(source.x, source.y, source.z);
  }
  player.setPosition(
    new THREE.Vector3(savedWorld.player.x, savedWorld.player.y, savedWorld.player.z)
  );
  // 恢复物品栏（旧存档没有 inventory 字段时得到空物品栏），并刷新热键栏数量。
  inventory = Inventory.fromEntries(savedWorld.player.inventory);
  hotbar.refreshCounts(inventory);
}

// showSuccessToast:手动保存成功后提示"已保存";自动保存成功保持静默。
// 失败(配额耗尽/其他错误)无论哪种保存路径都弹出错误提示。
async function saveCurrentWorld(showSuccessToast = false): Promise<void> {
  try {
    const deltas = world.getModifiedChunks();
    await storage.saveWorld(
      createStoredWorld(
        activeSaveId,
        activeSaveName,
        metadata,
        player.position,
        inventory.toEntries(),
        deltas
      )
    );
    // 保存成功后按快照清除已入库的修改记录，存档体积不再随编辑量累积增长。
    world.clearChanges(deltas);
    if (showSuccessToast) {
      showToast('已保存当前世界');
    }
  } catch (error) {
    if (classifySaveError(error) === 'quota') {
      showToast('存储空间不足，保存失败：请清理浏览器存储', 'error');
    } else {
      const message = error instanceof Error ? error.message : '未知错误';
      showToast(`保存失败：${message}`, 'error');
    }
  }
  await populateSaveList();
}

function scheduleSave(): void {
  // 只有游戏中才排队自动保存:返回菜单后残留的防抖定时器不再触发写入。
  if (!gameStarted) {
    return;
  }
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void saveCurrentWorld();
  }, 600);
}

// 启动即恢复存档,并记住 promise:"进入世界"点击时 await 它,避免恢复未完成就开玩
// 或读档失败后进入空白世界。恢复错误在点击处统一弹窗,这里挂空 catch 防止
// 浏览器报未处理拒绝(点击处理器 await 的仍是原 promise,能正常拿到拒绝)。
const restorePromise = restoreWorld();
restorePromise.catch(() => undefined);

// 主界面"进入世界":等待存档恢复完成再进入;恢复期间按钮禁用显示"正在恢复…"。
async function enterWorldFromMainMenu(): Promise<void> {
  startGameButton.disabled = true;
  startGameButton.textContent = '正在恢复…';
  try {
    await restorePromise;
  } catch (error) {
    await handleRestoreError(error);
    return;
  } finally {
    startGameButton.disabled = false;
    startGameButton.textContent = '进入世界';
  }
  startOrResumeGame();
}

// 读档失败分类处理:版本过新仅提示;损坏提供"删除并进入新世界"选项;其余报错。
async function handleRestoreError(error: unknown): Promise<void> {
  if (!(error instanceof SaveFormatError)) {
    showToast('读档失败，请稍后重试', 'error');
    return;
  }
  if (error.reason === 'too-new') {
    await showDialog({
      title: '存档版本过新',
      message: '这个存档来自更新版本的游戏，请升级游戏后再进入。',
      confirmText: '知道了'
    });
    return;
  }
  const answer = await showDialog({
    title: '存档已损坏',
    message: `${error.message}。可以删除该存档并进入新世界。`,
    confirmText: '删除并进入新世界',
    danger: true
  });
  if (answer === null) {
    return;
  }
  await storage.deleteWorld(activeSaveId);
  activeSaveName = '默认存档';
  syncActiveSaveName();
  showToast('已删除损坏存档');
  startOrResumeGame();
}

// 返回主界面:先取消防抖定时器并立即落盘最后 600ms 内的编辑,再切换界面。
async function leaveToMainMenu(): Promise<void> {
  gameStarted = false;
  paused = true;
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  await saveCurrentWorld();
  setMenuVisibility(gamePauseMenu, false);
  setMenuVisibility(gameMainMenu, true);
  void populateSaveList();
}

function currentSeed(): string {
  return seedInputElement.value.trim() || defaultSeed;
}

// 主界面"当前存档"文本与游戏内 HUD 同源:重命名/删除 active 存档后即时同步。
function syncActiveSaveName(): void {
  activeSaveNameLabelElement.textContent = activeSaveName;
}

// 跳转进入某存档:与创建存档同一套 URL 参数约定,整页刷新加载。
function enterSave(id: string, name: string): void {
  const next = new URLSearchParams({
    seed: currentSeed(),
    save: id,
    saveName: name
  });
  window.location.search = next.toString();
}

// 存档列表:每行仅两个按钮——[进入]进世界、[管理]展开详情,行内附摘要。
async function populateSaveList(): Promise<void> {
  const saves = await storage.listWorlds(currentSeed());
  savesListElement.replaceChildren();
  if (saves.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'menu-note';
    empty.textContent = '这个种子还没有存档：创建新存档，或导入 JSON 文件。';
    savesListElement.append(empty);
    return;
  }
  for (const save of saves) {
    const row = document.createElement('div');
    row.className = 'save-row';
    const info = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'save-row-name';
    name.textContent = save.name ?? '旧存档';
    const meta = document.createElement('span');
    meta.className = 'save-row-meta';
    meta.textContent =
      `修改 ${save.chunks.length} 区块 · 玩家 ` +
      `(${Math.floor(save.player.x)}, ${Math.floor(save.player.y)}, ${Math.floor(save.player.z)}) · ` +
      new Date(save.updatedAt).toLocaleString();
    info.append(name, meta);
    const buttons = document.createElement('div');
    buttons.className = 'save-row-buttons';
    const enterButton = document.createElement('button');
    enterButton.type = 'button';
    enterButton.textContent = '进入';
    enterButton.addEventListener('click', () => enterSave(save.id, save.name ?? '旧存档'));
    const manageButton = document.createElement('button');
    manageButton.type = 'button';
    manageButton.className = 'secondary-button';
    manageButton.textContent = '管理';
    manageButton.addEventListener('click', () => renderSaveDetail(save));
    buttons.append(enterButton, manageButton);
    row.append(info, buttons);
    savesListElement.append(row);
  }
}

// 存档详情:替代列表区显示完整信息,五个功能各一按钮,避免单屏按钮堆叠。
function renderSaveDetail(save: StoredWorld): void {
  savesListElement.replaceChildren();
  const detail = document.createElement('dl');
  detail.className = 'save-detail';
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['名称', save.name ?? '旧存档'],
    ['种子', save.metadata.seed],
    ['修改区块', String(save.chunks.length)],
    [
      '玩家位置',
      `(${save.player.x.toFixed(1)}, ${save.player.y.toFixed(1)}, ${save.player.z.toFixed(1)})`
    ],
    ['最后保存', new Date(save.updatedAt).toLocaleString()]
  ];
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    detail.append(term, description);
  }
  savesListElement.append(detail);

  const addActionButton = (text: string, className: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.addEventListener('click', onClick);
    savesListElement.append(button);
  };

  addActionButton('进入世界', '', () => enterSave(save.id, save.name ?? '旧存档'));
  addActionButton('重命名存档', 'secondary-button', () => {
    void renameSave(save);
  });
  addActionButton('导出存档', 'secondary-button', () => {
    void exportSave(save);
  });
  addActionButton('删除存档', 'danger-button', () => {
    void deleteSave(save);
  });
  addActionButton('返回列表', 'secondary-button', () => {
    void populateSaveList();
  });
}

async function renameSave(save: StoredWorld): Promise<void> {
  const name = await showDialog({
    title: '重命名存档',
    input: { label: '新名称', maxLength: 32, value: save.name ?? '' },
    confirmText: '重命名'
  });
  if (name === null) {
    return;
  }
  await storage.renameWorld(save.id, name);
  if (save.id === activeSaveId) {
    activeSaveName = name;
    syncActiveSaveName();
  }
  showToast('已重命名存档');
  const updated = await storage.loadWorld(save.id);
  if (updated !== undefined) {
    renderSaveDetail(updated);
  }
}

async function deleteSave(save: StoredWorld): Promise<void> {
  const answer = await showDialog({
    title: '删除存档？',
    message: `「${save.name ?? '旧存档'}」将被永久删除，无法恢复。`,
    confirmText: '删除',
    danger: true
  });
  if (answer === null) {
    return;
  }
  await storage.deleteWorld(save.id);
  if (save.id === activeSaveId) {
    activeSaveName = '默认存档';
    syncActiveSaveName();
    showToast('已删除当前存档：再进入世界将创建新世界');
  } else {
    showToast('已删除存档');
  }
  await populateSaveList();
}

// 文件名消毒:去掉 Windows 文件系统不允许的字符。
function sanitizeFileName(name: string | undefined): string {
  const cleaned = (name ?? '存档').trim().replace(/[\\/:*?"<>|]/g, '_');
  return cleaned.length === 0 ? '存档' : cleaned;
}

async function exportSave(save: StoredWorld): Promise<void> {
  const world = await storage.loadWorld(save.id);
  if (world === undefined) {
    showToast('存档不存在，导出失败', 'error');
    return;
  }
  const blob = new Blob([serializeWorld(world)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sanitizeFileName(save.name)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast('已导出存档文件');
}

// 导入 JSON 存档:错误按类提示;id 冲突先确认覆盖;种子不同则同步主界面种子输入。
async function handleImport(json: string): Promise<void> {
  let parsed: StoredWorld;
  try {
    parsed = parseWorldFile(json);
  } catch (error) {
    if (error instanceof SaveFormatError) {
      if (error.reason === 'invalid-json') {
        showToast('文件不是有效的 JSON 存档', 'error');
      } else if (error.reason === 'too-new') {
        showToast('存档来自更新版本的游戏，无法导入', 'error');
      } else {
        showToast('存档文件已损坏，无法导入', 'error');
      }
    } else {
      showToast('导入失败', 'error');
    }
    return;
  }
  // 已存在同 id 存档时确认覆盖(损坏记录被导入覆盖也算修复,故读失败视为不存在)。
  let existing: StoredWorld | undefined;
  try {
    existing = await storage.loadWorld(parsed.id);
  } catch {
    existing = undefined;
  }
  if (existing !== undefined) {
    const answer = await showDialog({
      title: '覆盖已有存档？',
      message: `已存在存档「${existing.name ?? '旧存档'}」，导入将覆盖它。`,
      confirmText: '覆盖导入',
      danger: true
    });
    if (answer === null) {
      return;
    }
  }
  await storage.saveWorld(parsed);
  if (parsed.metadata.seed !== currentSeed()) {
    seedInputElement.value = parsed.metadata.seed;
    showToast(`已导入，种子已同步为「${parsed.metadata.seed}」`);
  } else {
    showToast(`已导入存档「${parsed.name ?? '旧存档'}」`);
  }
  await populateSaveList();
}

createSave.addEventListener('click', () => {
  const name = newSaveName.value.trim();
  if (name.length === 0) {
    newSaveName.focus();
    return;
  }
  const next = new URLSearchParams({
    seed: currentSeed(),
    save: crypto.randomUUID(),
    saveName: name
  });
  window.location.search = next.toString();
});
saveWorld.addEventListener('click', () => {
  void saveCurrentWorld(true);
});
manageSaves.addEventListener('click', () => {
  setMenuVisibility(gameMainMenu, false);
  setMenuVisibility(gameSavesMenu, true);
  void populateSaveList();
});
backToMain.addEventListener('click', () => {
  setMenuVisibility(gameSavesMenu, false);
  setMenuVisibility(gameMainMenu, true);
});
importSave.addEventListener('click', () => {
  importFile.click();
});
importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  importFile.value = '';
  if (file === undefined) {
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    if (typeof reader.result === 'string') {
      void handleImport(reader.result);
    }
  });
  reader.addEventListener('error', () => {
    showToast('读取文件失败', 'error');
  });
  reader.readAsText(file);
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
  BlockId.Wood,
  BlockId.Water
] as const;
let selectedBlock = BlockId.Grass;

// 物品栏：掉落+拾取+消耗（水不计入、恒可放置）。let 以便读档时整体替换。
let inventory = new Inventory();

// 程序化破坏/放置音效：AudioContext 由开始按钮与画布点击两个手势点解锁。
const sounds = new BlockSounds();

// 底部热键栏：点击/数字键/滚轮选中；onSelect 同步当前放置方块与 HUD 标签。
const hotbar = new Hotbar(selectableBlocks, inventory, (index) => {
  const nextBlock = selectableBlocks[index];
  if (nextBlock === undefined) {
    return;
  }
  selectedBlock = nextBlock;
  selectedBlockLabel.textContent = BLOCK_DEFINITIONS[selectedBlock].name.replace('gm:', '');
});
app.append(hotbar.element);

// 方块掉落物：破坏时弹出、走近自动拾取入物品栏；只存在于运行时，不存档。
const drops = new DropItems(world, (blockId) => {
  inventory.add(blockId);
  hotbar.refreshCounts(inventory);
});
scene.add(drops.object3d);

const particles = new BlockParticles();
scene.add(particles.object3d);

const selection = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x171717 })
);
selection.visible = false;
scene.add(selection);

// 破坏进度反馈：随长按逐渐升温发亮的半透明覆盖盒。
const breakOverlay = new THREE.Mesh(
  new THREE.BoxGeometry(1.03, 1.03, 1.03),
  new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0,
    depthWrite: false
  })
);
breakOverlay.visible = false;
scene.add(breakOverlay);

// 准星射线最远遍历的格数：覆盖视距内的已渲染区块（半径 CHUNK_RADIUS 的最远角
// ≈ (2×半径+1)×16×1.2，半径 2 时 = 96 格）。
const TARGET_REACH = (CHUNK_RADIUS * 2 + 1) * 16 * 1.2;

// 复用临时向量，避免每帧分配。
const targetDirection = new THREE.Vector3();

// 所有方块统一的较短破坏耗时（秒）：长按此时长后方块被破坏。
const BREAK_TIME = 0.45;

interface BreakProgress {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  elapsed: number;
  chipTimer: number;
}

let breakingHeld = false;
let breakProgress: BreakProgress | undefined;

function resetBreaking(): void {
  breakProgress = undefined;
  breakOverlay.visible = false;
  breakOverlay.material.opacity = 0;
}

interface TargetBlock {
  readonly position: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly blockId: BlockId;
}

// 体素 DDA 遍历：沿相机视线逐格推进，返回第一个实体方块所在格与命中面法线。
// 水与空气同属性：不阻挡射线（穿透后命中水后的实体方块），保证放置/破坏都对准实体方块。
// 替代每帧对全部区块网格做三角形射线检测（后者随网格复杂度持续消耗 CPU，是卡顿主因之一）。
// 只访问已渲染区块，避免 getBlock 顺带生成未加载区块。
function getTargetBlock(): TargetBlock | undefined {
  const direction = camera.getWorldDirection(targetDirection);
  const origin = camera.position;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = direction.x > 0 ? 1 : -1;
  const stepY = direction.y > 0 ? 1 : -1;
  const stepZ = direction.z > 0 ? 1 : -1;
  const deltaX = direction.x === 0 ? Infinity : Math.abs(1 / direction.x);
  const deltaY = direction.y === 0 ? Infinity : Math.abs(1 / direction.y);
  const deltaZ = direction.z === 0 ? Infinity : Math.abs(1 / direction.z);
  let maxX = direction.x === 0 ? Infinity : (stepX > 0 ? x + 1 - origin.x : origin.x - x) * deltaX;
  let maxY = direction.y === 0 ? Infinity : (stepY > 0 ? y + 1 - origin.y : origin.y - y) * deltaY;
  let maxZ = direction.z === 0 ? Infinity : (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * deltaZ;

  let chunkX = x >> 4;
  let chunkZ = z >> 4;
  let inLoadedArea = world.hasRenderedChunk(chunkX, chunkZ);

  for (let index = 0; index < TARGET_REACH; index += 1) {
    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;
    let t: number;
    if (maxX <= maxY && maxX <= maxZ) {
      t = maxX;
      maxX += deltaX;
      x += stepX;
      normalX = -stepX;
    } else if (maxY <= maxZ) {
      t = maxY;
      maxY += deltaY;
      y += stepY;
      normalY = -stepY;
    } else {
      t = maxZ;
      maxZ += deltaZ;
      z += stepZ;
      normalZ = -stepZ;
    }

    if (y < 0 || y >= 256) {
      return undefined;
    }
    if (x >> 4 !== chunkX || z >> 4 !== chunkZ) {
      chunkX = x >> 4;
      chunkZ = z >> 4;
      inLoadedArea = world.hasRenderedChunk(chunkX, chunkZ);
    }
    if (!inLoadedArea) {
      return undefined;
    }
    const blockId = world.getBlock(x, y, z);
    if (blockId === BlockId.Air || blockId === BlockId.Water) {
      continue;
    }
    return {
      position: new THREE.Vector3(
        origin.x + direction.x * t,
        origin.y + direction.y * t,
        origin.z + direction.z * t
      ),
      normal: new THREE.Vector3(normalX, normalY, normalZ),
      blockId
    };
  }
  return undefined;
}

function toBlockPosition(target: TargetBlock, direction: number): THREE.Vector3 {
  // 射线穿透水后命中的一定是实体方块：目标格取命中面朝向玩家一侧的邻格。
  // 放置时若该邻格是水格，会被实体方块直接替换（水是低级方块、可被填充）。
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

// 长按破坏：每帧对准心方块累计耗时，达到 BREAK_TIME 时破坏。
// 中途松开或改瞄别的方块会重置进度。
function updateBreaking(deltaSeconds: number): void {
  if (!breakingHeld) {
    return;
  }
  const target = getTargetBlock();
  if (target === undefined) {
    resetBreaking();
    sounds.stopBreaking();
    return;
  }
  const position = toBlockPosition(target, -1);
  const block = world.getBlock(position.x, position.y, position.z);
  if (block === BlockId.Air) {
    resetBreaking();
    sounds.stopBreaking();
    return;
  }

  // 换目标则重新计时，并按新方块的硬度重启破坏轻击音。
  if (
    breakProgress === undefined ||
    breakProgress.x !== position.x ||
    breakProgress.y !== position.y ||
    breakProgress.z !== position.z
  ) {
    breakProgress = { x: position.x, y: position.y, z: position.z, elapsed: 0, chipTimer: 0 };
    sounds.startBreaking(BLOCK_DEFINITIONS[block].hardness);
  }

  breakProgress.elapsed += deltaSeconds;
  const ratio = Math.min(breakProgress.elapsed / BREAK_TIME, 1);

  // 覆盖盒随进度升温发亮。
  breakOverlay.position.copy(position).addScalar(0.5);
  breakOverlay.visible = true;
  breakOverlay.material.opacity = 0.15 + ratio * 0.45;

  // 破坏过程中持续迸出少量碎屑。
  breakProgress.chipTimer -= deltaSeconds;
  if (breakProgress.chipTimer <= 0) {
    breakProgress.chipTimer = 0.08;
    particles.spawn(position.clone().addScalar(0.5), BLOCK_DEFINITIONS[block].color, 2);
  }

  if (ratio >= 1) {
    if (world.setBlock(position.x, position.y, position.z, BlockId.Air)) {
      sounds.stopBreaking();
      sounds.playBreak(BLOCK_DEFINITIONS[block].hardness);
      // 掉落物+入包：破坏的方块弹出掉落物，走近自动拾取计入物品栏。
      drops.spawn(position.clone().addScalar(0.5), block);
      inventory.add(block);
      hotbar.refreshCounts(inventory);
      particles.spawn(position.clone().addScalar(0.5), BLOCK_DEFINITIONS[block].color);
      // 破坏后通知水系统重新评估：挖开海底/岸边会让相邻水向缺口流动，破坏水源会退水。
      waterFlow.markDirty(position.x, position.y, position.z);
      scheduleSave();
    }
    resetBreaking();
  }
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
  // 第二个音频解锁点：点击画布本身也是用户手势。
  sounds.unlock();
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
  // 左键：进入长按破坏状态，真正的破坏在渲染循环中按耗时推进。
  if (event.button === 0) {
    breakingHeld = true;
    return;
  }
  // 右键：即时放置。
  if (event.button === 2) {
    const target = getTargetBlock();
    if (target === undefined) {
      return;
    }
    const blockPosition = toBlockPosition(target, 1);
    // 拒绝把方块放进自己的碰撞盒里（水中向下放置/贴墙放置时容易命中身体所在格）。
    if (player.intersectsBlockPosition(blockPosition.x, blockPosition.y, blockPosition.z)) {
      return;
    }
    // 物品栏门控：持有数量为 0 不能放置（水恒可放，不消耗）。
    if (!inventory.canPlace(selectedBlock)) {
      return;
    }
    if (world.setBlock(blockPosition.x, blockPosition.y, blockPosition.z, selectedBlock)) {
      inventory.tryConsume(selectedBlock);
      hotbar.refreshCounts(inventory);
      sounds.playPlace();
      // 放置的水源本身写入存档；由它向四周蔓延出的水仅存在于运行时（不存档）。
      if (selectedBlock === BlockId.Water) {
        waterFlow.addSource(blockPosition.x, blockPosition.y, blockPosition.z);
      } else {
        // 放置实体方块可能挡住/改变水路，通知水系统重新评估邻域。
        waterFlow.markDirty(blockPosition.x, blockPosition.y, blockPosition.z);
      }
      scheduleSave();
    }
  }
});
canvas.addEventListener('mouseup', (event) => {
  if (event.button === 0) {
    breakingHeld = false;
    resetBreaking();
    sounds.stopBreaking();
  }
});

document.addEventListener('keydown', (event) => {
  const index = Number(event.key) - 1;
  if (selectableBlocks[index] !== undefined) {
    hotbar.select(index);
  }
});

// 滚轮循环切换热键栏（指针锁定且未暂停时），与数字键/点击共用 hotbar.select。
window.addEventListener('wheel', (event) => {
  if (document.pointerLockElement !== canvas || paused) {
    return;
  }
  const direction = event.deltaY > 0 ? 1 : -1;
  hotbar.select((hotbar.selected + direction + selectableBlocks.length) % selectableBlocks.length);
});

// 切后台标签页时停掉持续音。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    sounds.silence();
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
    drops.update(deltaSeconds, player.position);
    waterFlow.update(deltaSeconds);
    updateSelection();
    updateBreaking(deltaSeconds);
  }
  // 天空持续推进（即使暂停也缓慢流动），并让雾与清屏色跟随地平线，使远景与天空融合。
  const sceneDelta = paused ? deltaSeconds * 0.15 : deltaSeconds;
  sky.update(sceneDelta, camera.position);
  sky.getHorizonColor(horizonColor);
  // 云层跟随相机并持续西向漂移（暂停时也缓慢流动，与天空一致）。
  clouds.update(clock.elapsedTime, camera.position);
  // 常规时雾与清屏色跟随天空地平线色；没入水面后过渡为深蓝近雾（见 updateUnderwaterEffect）。
  updateUnderwaterEffect(sceneDelta);
  // 水面波纹随时间滚动，暂停时也缓慢流动。
  updateWaterMaterial(clock.elapsedTime);
  renderer.render(scene, camera);
  window.requestAnimationFrame(render);
}

window.addEventListener('resize', () => {
  resize();
});

resize();
render();
