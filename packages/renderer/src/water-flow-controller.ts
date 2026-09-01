import {
  BlockId,
  WATER_NONE,
  computeWaterLevel,
  getChunkKey,
  isWaterFlowable,
  toChunkCoordinate,
  toLocalCoordinate,
  waterOutflow,
  type WaterCellState
} from '@gm/core';

// 水流调度器依赖的世界接口。运行时水位场由世界视图持有（不进存档），
// 调度器通过这些方法读写，避免自身再维护一份重复的水位数据。
export interface WaterFlowWorld {
  getBlock(x: number, y: number, z: number): BlockId;
  // 运行时写入/移除一格水（trackChange=false，不进存档），不触发即时网格重建。
  // isWater=true 时记录其水位 level（0..MAX）；false 时清除该格水位记录。
  setRuntimeWater(x: number, y: number, z: number, isWater: boolean, level: number): void;
  // 该格是否为"调度器管理的流动/下落水"（已登记水位）。用于区分永久水源。
  isRuntimeWater(x: number, y: number, z: number): boolean;
  // 该格水位：管理水返回其 level；水源返回 0；无水返回 WATER_NONE。
  getWaterLevel(x: number, y: number, z: number): number;
  // 仅重建某区块的水面网格（不动实心地形网格），供批处理刷新调用。
  refreshWater(chunkX: number, chunkZ: number): void;
}

// 每次流体模拟推进的间隔（秒）：让水肉眼可见地逐格向外爬 / 逐格退去。
const STEP_INTERVAL = 0.2;

// 单个 tick 最多评估的格子数（护栏）：极端情况下也不会卡死一帧。
const MAX_CELLS_PER_TICK = 4096;

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

// 四个水平邻居方向（确定性顺序）。
const HORIZONTAL: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

/**
 * 运行时有限水调度器：把 `@gm/core` 的确定性水位规则逐 tick 应用到世界。
 *
 * 模型（全部只活在运行时、不写存档）：
 * - **水位场**：与区块方块并行的一份 `level` 记录（0=满级，1..MAX 越远越薄）。
 *   生成的海洋与玩家放置的水都是"水源"（恒满、不干涸、不登记进水位场）；
 *   由本调度器算出的流动水才登记 level，并用不进存档的方式写入世界。
 * - **水源判定**：某格是水方块且未被登记为流动水，即为水源。
 * - **元胞推进**：每 tick 只重算"活跃格"——上方有水→满级；否则取最矮供水邻居 +1；
 *   无供给或超过上限则干涸。撤源后失去供给的水被逐 tick 顶高直至干涸 → 边缘退水。
 *
 * 卡顿防治：只把受影响的格子标为活跃，写入用不触发重建的通道，
 * 每 tick 结束再按"脏区块"批量重建**水网格**（不碰实心地形网格）；
 * 活跃集合为空时完全静默、零开销。
 */
export class WaterFlowController {
  private readonly world: WaterFlowWorld;
  // 本轮待重新评估的格子集合（活跃前沿）。
  private active = new Set<string>();
  // 本 tick 内因写入而需要刷新的区块键集合。
  private readonly dirtyChunks = new Set<string>();
  private timer = 0;

  public constructor(world: WaterFlowWorld) {
    this.world = world;
  }

  /**
   * 通知某格及其邻域需要重新评估（破坏/放置方块后调用）。
   * 例如挖开海底会让相邻海水向缺口流动，破坏水源会触发退水。
   */
  public markDirty(x: number, y: number, z: number): void {
    this.activate(x, y, z);
    this.activateNeighbors(x, y, z);
    this.timer = STEP_INTERVAL;
  }

  /** 玩家在 (x,y,z) 放下一个水源，触发向四周蔓延。 */
  public addSource(x: number, y: number, z: number): void {
    // 放置的水是水源（不登记水位），只需唤醒邻域开始蔓延。
    this.markDirty(x, y, z);
  }

  /** 每帧调用：按间隔推进水流模拟。 */
  public update(deltaSeconds: number): void {
    if (this.active.size === 0) {
      return;
    }
    this.timer += deltaSeconds;
    if (this.timer < STEP_INTERVAL) {
      return;
    }
    this.timer = 0;
    this.step();
  }

  private activate(x: number, y: number, z: number): void {
    if (y < 0 || y >= 256) {
      return;
    }
    this.active.add(cellKey(x, y, z));
  }

  private activateNeighbors(x: number, y: number, z: number): void {
    this.activate(x + 1, y, z);
    this.activate(x - 1, y, z);
    this.activate(x, y, z + 1);
    this.activate(x, y, z - 1);
    this.activate(x, y + 1, z);
    this.activate(x, y - 1, z);
  }

  // 采集某格作为"供水者"时的状态，供 waterOutflow 计算其对水平邻居的供水级。
  private sampleCell(x: number, y: number, z: number): WaterCellState {
    if (this.world.getBlock(x, y, z) !== BlockId.Water) {
      return { level: WATER_NONE, isSource: false, belowFlowable: false, aboveIsWater: false };
    }
    const isSource = !this.world.isRuntimeWater(x, y, z);
    return {
      level: isSource ? 0 : this.world.getWaterLevel(x, y, z),
      isSource,
      belowFlowable: isWaterFlowable(this.world.getBlock(x, y - 1, z)),
      aboveIsWater: this.world.getBlock(x, y + 1, z) === BlockId.Water
    };
  }

  private step(): void {
    const current = this.active;
    this.active = new Set<string>();
    let processed = 0;

    for (const key of current) {
      if (processed >= MAX_CELLS_PER_TICK) {
        // 超护栏则把剩余的顺延到下一 tick，避免单帧过载。
        this.active.add(key);
        continue;
      }
      processed += 1;
      this.evaluate(key);
    }

    for (const chunkKey of this.dirtyChunks) {
      const [chunkX, chunkZ] = chunkKey.split(',').map(Number) as [number, number];
      this.world.refreshWater(chunkX, chunkZ);
    }
    this.dirtyChunks.clear();
  }

  private markChunkDirty(x: number, z: number): void {
    const chunkX = toChunkCoordinate(x);
    const chunkZ = toChunkCoordinate(z);
    this.dirtyChunks.add(getChunkKey({ x: chunkX, z: chunkZ }));
    // 位于区块边界的写入会影响相邻区块的水面剔除，一并刷新。
    const localX = toLocalCoordinate(x);
    const localZ = toLocalCoordinate(z);
    if (localX === 0) this.dirtyChunks.add(getChunkKey({ x: chunkX - 1, z: chunkZ }));
    if (localX === 15) this.dirtyChunks.add(getChunkKey({ x: chunkX + 1, z: chunkZ }));
    if (localZ === 0) this.dirtyChunks.add(getChunkKey({ x: chunkX, z: chunkZ - 1 }));
    if (localZ === 15) this.dirtyChunks.add(getChunkKey({ x: chunkX, z: chunkZ + 1 }));
  }

  // 重算单个格子并在需要时写入世界。
  private evaluate(key: string): void {
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    const block = this.world.getBlock(x, y, z);

    // 水源格：本身不改，只把供给推送到下方或四周（唤醒它们下一 tick 重算）。
    if (block === BlockId.Water && !this.world.isRuntimeWater(x, y, z)) {
      this.spreadFrom(x, y, z);
      return;
    }

    // 实体方块：不再处理（其上若曾有流动水，方块写入时已被覆盖）。
    if (block !== BlockId.Air && block !== BlockId.Water) {
      return;
    }

    // 空气或本调度器管理的流动水：按元胞规则重算应有水位。
    const aboveIsWater = this.world.getBlock(x, y + 1, z) === BlockId.Water;
    const horizontalOutflows = HORIZONTAL.map(([dx, dz]) =>
      waterOutflow(this.sampleCell(x + dx, y, z + dz))
    );
    const nextLevel = computeWaterLevel({ aboveIsWater, horizontalOutflows });
    this.applyLevel(x, y, z, block, nextLevel);
  }

  // 把水源的供给推送到下方或四个水平邻居。
  private spreadFrom(x: number, y: number, z: number): void {
    if (isWaterFlowable(this.world.getBlock(x, y - 1, z))) {
      this.activate(x, y - 1, z);
      return;
    }
    for (const [dx, dz] of HORIZONTAL) {
      if (isWaterFlowable(this.world.getBlock(x + dx, y, z + dz))) {
        this.activate(x + dx, y, z + dz);
      }
    }
  }

  // 依据计算出的水位写入/清除本格的流动水，并在状态变化时唤醒下游邻居。
  private applyLevel(
    x: number,
    y: number,
    z: number,
    currentBlock: BlockId,
    nextLevel: number
  ): void {
    const isManaged = currentBlock === BlockId.Water && this.world.isRuntimeWater(x, y, z);
    const previousLevel = isManaged ? this.world.getWaterLevel(x, y, z) : WATER_NONE;

    if (nextLevel === WATER_NONE) {
      // 应当干涸：仅撤走"由本调度器放置的流动水"，绝不动水源或地形。
      if (isManaged) {
        this.world.setRuntimeWater(x, y, z, false, WATER_NONE);
        this.markChunkDirty(x, z);
        this.activateNeighbors(x, y, z);
      }
      return;
    }

    // 应当有水：只在空气或本调度器管理的流动水上写入，绝不覆盖水源/地形。
    const canManage = currentBlock === BlockId.Air || isManaged;
    if (!canManage) {
      return;
    }
    if (isManaged && previousLevel === nextLevel) {
      return;
    }
    this.world.setRuntimeWater(x, y, z, true, nextLevel);
    this.markChunkDirty(x, z);
    // 水位变化会影响下游，唤醒下方与四邻在下一 tick 继续推进。
    this.activate(x, y - 1, z);
    for (const [dx, dz] of HORIZONTAL) {
      this.activate(x + dx, y, z + dz);
    }
  }
}
