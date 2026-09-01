import { describe, expect, it } from 'vitest';

import { BlockId } from './block.js';
import {
  MAX_WATER_LEVEL,
  WATER_NONE,
  computeWaterLevel,
  isWaterFlowable,
  waterFallsThrough,
  waterOutflow,
  waterOverlapHeight,
  waterSurfaceHeight,
  type WaterCellState,
  type WaterNeighborhood
} from './water-flow.js';

const baseCell: WaterCellState = {
  level: WATER_NONE,
  isSource: false,
  belowFlowable: false,
  aboveIsWater: false
};

describe('isWaterFlowable', () => {
  it('仅空气可被水流入', () => {
    expect(isWaterFlowable(BlockId.Air)).toBe(true);
    expect(isWaterFlowable(BlockId.Stone)).toBe(false);
    expect(isWaterFlowable(BlockId.Water)).toBe(false);
  });
});

describe('waterFallsThrough', () => {
  it('空气与水都会让水流继续下落，只有实体方块让水落地', () => {
    expect(waterFallsThrough(BlockId.Air)).toBe(true);
    expect(waterFallsThrough(BlockId.Water)).toBe(true);
    expect(waterFallsThrough(BlockId.Stone)).toBe(false);
  });
});

describe('waterSurfaceHeight', () => {
  it('按水位分级下沉，无水位信息按水源处理', () => {
    expect(waterSurfaceHeight(10, 0)).toBe(10.875);
    expect(waterSurfaceHeight(10, 1)).toBeCloseTo(10.685, 12);
    expect(waterSurfaceHeight(10, 3)).toBeCloseTo(10.305, 12);
    expect(waterSurfaceHeight(10, WATER_NONE)).toBe(10.875);
  });

  it('超出最大级的 level 被钳制', () => {
    expect(waterSurfaceHeight(10, 99)).toBeCloseTo(10.305, 12);
  });
});

describe('waterOverlapHeight', () => {
  it('身体区间与水体区间的重叠高度', () => {
    // 满水格 y=10（水面 10.875）与身体 [10, 11.8] 重叠 0.875。
    expect(waterOverlapHeight(10, 0, 10, 11.8)).toBe(0.875);
    // level 3 浅水（水面约 10.305）重叠 0.305。
    expect(waterOverlapHeight(10, 3, 10, 11.8)).toBeCloseTo(0.305, 12);
  });

  it('完全在水面以上则无重叠', () => {
    expect(waterOverlapHeight(10, 0, 11.5, 13.3)).toBe(0);
  });

  it('确定性：相同输入产生相同输出', () => {
    expect(waterOverlapHeight(10, 2, 10.1, 11.9)).toBe(waterOverlapHeight(10, 2, 10.1, 11.9));
  });
});

describe('waterOutflow', () => {
  it('无水且非源不供水', () => {
    expect(waterOutflow(baseCell)).toBe(WATER_NONE);
  });

  it('水源满级供水 0（邻居将变为 1）', () => {
    expect(waterOutflow({ ...baseCell, isSource: true })).toBe(0);
  });

  it('正下方可流入时优先下落，不向水平供水', () => {
    expect(waterOutflow({ ...baseCell, isSource: true, belowFlowable: true })).toBe(WATER_NONE);
  });

  it('落点水（上方有水且已落地）以满级向四周摊开', () => {
    expect(waterOutflow({ ...baseCell, level: 2, aboveIsWater: true })).toBe(0);
  });

  it('回归：下落水柱不向水平供水（下方是水仍算未落地）', () => {
    // 下方是水：本格属于下落水柱（下方在同一 tick 已被先填满），
    // 即便上方有水也不得横向摊开，否则瀑布会一路向四周蔓延。
    expect(waterOutflow({ ...baseCell, level: 0, aboveIsWater: true, belowFlowable: true })).toBe(
      WATER_NONE
    );
  });

  it('水平流动水按自身水位供水', () => {
    expect(waterOutflow({ ...baseCell, level: 1 })).toBe(1);
    expect(waterOutflow({ ...baseCell, level: 2 })).toBe(2);
  });
});

function neighborhood(
  aboveIsWater: boolean,
  horizontalOutflows: readonly number[]
): WaterNeighborhood {
  return { aboveIsWater, horizontalOutflows };
}

describe('computeWaterLevel', () => {
  it('上方有水则被喂养为满级 0', () => {
    expect(computeWaterLevel(neighborhood(true, []))).toBe(0);
  });

  it('取最矮供水邻居 + 1', () => {
    // 邻居供水级 0 与 2，最小取 0 → 本格 1。
    expect(computeWaterLevel(neighborhood(false, [0, 2, WATER_NONE, WATER_NONE]))).toBe(1);
    // 邻居供水级 1 与 2，最小取 1 → 本格 2。
    expect(computeWaterLevel(neighborhood(false, [1, 2]))).toBe(2);
  });

  it('无任何供给则干涸', () => {
    expect(computeWaterLevel(neighborhood(false, [WATER_NONE, WATER_NONE]))).toBe(WATER_NONE);
    expect(computeWaterLevel(neighborhood(false, []))).toBe(WATER_NONE);
  });

  it('超过最大级则干涸（3 格封顶）', () => {
    // 供水级 MAX 的邻居会把本格顶到 MAX+1 → 超限干涸。
    expect(computeWaterLevel(neighborhood(false, [MAX_WATER_LEVEL]))).toBe(WATER_NONE);
    // 供水级 MAX-1 的邻居 → 本格恰为 MAX，仍成立。
    expect(computeWaterLevel(neighborhood(false, [MAX_WATER_LEVEL - 1]))).toBe(MAX_WATER_LEVEL);
  });

  it('相同输入产生相同输出（确定性）', () => {
    const build = (): WaterNeighborhood => neighborhood(false, [0, 2, WATER_NONE, 1]);
    expect(computeWaterLevel(build())).toBe(computeWaterLevel(build()));
  });
});
