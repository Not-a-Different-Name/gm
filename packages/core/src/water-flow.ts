import { BlockId } from './block.js';

// 流动水的最大级数：0 = 满级（水源或落点），1..MAX 越远越薄，
// 超过 MAX 即干涸。设为 3，使平地水源最多向外蔓延 3 格（明显小于经典沙盒的 7）。
export const MAX_WATER_LEVEL = 3;

// 表示"该位置没有水"（空气或实体）的哨兵水位值。
export const WATER_NONE = 255;

// 一个格子对其"水平邻居"提供的供水级所需的状态。
// 全部为纯数据，由调用方（运行时调度器）从世界与水位场中采集后传入。
export interface WaterCellState {
  // 本格当前水位：0..MAX_WATER_LEVEL，或 WATER_NONE 表示无水。
  readonly level: number;
  // 本格是否为永久水源（生成的海洋、玩家放置的水）。水源恒满且不会干涸。
  readonly isSource: boolean;
  // 正下方是否可被水流入（为空气）。能向下流时不向水平摊开。
  readonly belowFlowable: boolean;
  // 正上方是否有水（含流动/下落水）。落点水会以满级向四周摊开。
  readonly aboveIsWater: boolean;
}

// 计算某个非源、可容纳水的位置在下一刻应有的水位所需的邻域信息。
export interface WaterNeighborhood {
  // 正上方是否有水：为真则本格被上方喂养，直接取满级 0。
  readonly aboveIsWater: boolean;
  // 四个水平邻居各自"对本格提供的供水级"；WATER_NONE 表示该邻居不供水。
  readonly horizontalOutflows: readonly number[];
}

/**
 * 判断某个方块能否被水流入：仅空气可流入。
 * 实体方块阻挡水流，已有水不算"可流入的空位"（已被占据）。
 */
export function isWaterFlowable(blockId: BlockId): boolean {
  return blockId === BlockId.Air;
}

/**
 * 计算某个水格对其"水平邻居"提供的供水级（纯函数，确定性）。
 *
 * - 无水且非源 → 不供水（WATER_NONE）。
 * - 正下方可流入 → 水优先下落，不向水平摊开（WATER_NONE）。
 * - 是水源，或落点水（正上方有水且已落地）→ 满级供水 0（邻居将变为 1）。
 * - 否则为水平流动水 → 以自身水位供水（邻居将变为 level + 1）。
 */
export function waterOutflow(state: WaterCellState): number {
  if (state.level === WATER_NONE && !state.isSource) {
    return WATER_NONE;
  }
  if (state.belowFlowable) {
    return WATER_NONE;
  }
  if (state.isSource || state.aboveIsWater) {
    return 0;
  }
  return state.level;
}

/**
 * 计算某个非源、可容纳水的位置在下一刻应有的水位（纯函数，确定性）。
 *
 * - 正上方有水 → 满级 0（被上方喂养的下落/落点水）。
 * - 否则取所有供水水平邻居中最小的 `供水级 + 1`。
 * - 无任何供给，或最小值已超过 MAX_WATER_LEVEL → 干涸（WATER_NONE）。
 *
 * 撤源后：失去供给的水格每步会被邻居"顶"到更高级，最终超过上限而干涸，
 * 从而实现水从边缘向内逐步退去的效果。
 */
export function computeWaterLevel(neighborhood: WaterNeighborhood): number {
  if (neighborhood.aboveIsWater) {
    return 0;
  }
  let best = WATER_NONE;
  for (const outflow of neighborhood.horizontalOutflows) {
    if (outflow === WATER_NONE) {
      continue;
    }
    const fed = outflow + 1;
    if (fed < best) {
      best = fed;
    }
  }
  if (best === WATER_NONE || best > MAX_WATER_LEVEL) {
    return WATER_NONE;
  }
  return best;
}
