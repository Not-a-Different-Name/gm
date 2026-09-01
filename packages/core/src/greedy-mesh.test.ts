import { describe, expect, it } from 'vitest';

import { BlockId } from './block.js';
import {
  generateGreedyMesh,
  getRectVariant,
  TEXTURE_VARIANT_COUNT,
  type GreedyRect
} from './greedy-mesh.js';

interface PlacedBlock {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly id: BlockId;
}

// 用放置列表构造一个确定性世界查询回调；未放置的坐标一律返回 Air，
// 并可选记录每一次查询坐标（供边界回调断言）。
function makeWorld(
  blocks: readonly PlacedBlock[],
  onQuery?: (x: number, y: number, z: number) => void
): (x: number, y: number, z: number) => BlockId {
  const map = new Map<string, BlockId>();
  for (const block of blocks) {
    map.set(`${block.x},${block.y},${block.z}`, block.id);
  }
  return (x, y, z) => {
    onQuery?.(x, y, z);
    return map.get(`${x},${y},${z}`) ?? BlockId.Air;
  };
}

const SIZE: [number, number, number] = [16, 16, 16];

function rectsFor(
  directionIndex: number,
  blocks: readonly PlacedBlock[],
  onQuery?: (x: number, y: number, z: number) => void,
  size: readonly [number, number, number] = SIZE
): GreedyRect[] {
  return generateGreedyMesh({
    size,
    directionIndex,
    getBlock: makeWorld(blocks, onQuery)
  });
}

// 方向下标对照：0=+X、1=-X、2=+Y、3=-Y、4=+Z、5=-Z。
const TOP = 2;
const PLUS_X = 0;

describe('generateGreedyMesh 基本形状', () => {
  it('全空气区域每个方向都不产出矩形', () => {
    for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
      expect(rectsFor(directionIndex, [])).toEqual([]);
    }
  });

  it('悬空单方块：六个方向各一个 1×1 矩形', () => {
    const blocks = [{ x: 8, y: 8, z: 8, id: BlockId.Grass }];
    for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
      const rects = rectsFor(directionIndex, blocks);
      expect(rects).toHaveLength(1);
      expect(rects[0]).toMatchObject({ width: 1, height: 1, blockId: BlockId.Grass });
    }
  });

  it('2×2×1 平台：顶面与底面各合并为一个 2×2 矩形，四个侧面各 2×1', () => {
    const blocks = [
      { x: 0, y: 0, z: 0, id: BlockId.Grass },
      { x: 1, y: 0, z: 0, id: BlockId.Grass },
      { x: 0, y: 0, z: 1, id: BlockId.Grass },
      { x: 1, y: 0, z: 1, id: BlockId.Grass }
    ];
    const top = rectsFor(TOP, blocks);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ width: 2, height: 2, layer: 0 });
    const bottom = rectsFor(3, blocks);
    expect(bottom).toHaveLength(1);
    expect(bottom[0]).toMatchObject({ width: 2, height: 2, layer: 0 });
    // +X 方向的面在 x=1 层（x=0 格被邻格遮挡），沿 z 宽 2、沿 y 高 1。
    const plusX = rectsFor(PLUS_X, blocks);
    expect(plusX).toHaveLength(1);
    expect(plusX[0]).toMatchObject({ layer: 1, width: 2, height: 1 });
    for (const directionIndex of [1, 4, 5]) {
      const rects = rectsFor(directionIndex, blocks);
      expect(rects).toHaveLength(1);
      expect(rects[0]).toMatchObject({ width: 2, height: 1 });
    }
  });

  it('相邻不同方块不合并：草与泥土顶面各一个矩形', () => {
    const blocks = [
      { x: 0, y: 0, z: 0, id: BlockId.Grass },
      { x: 1, y: 0, z: 0, id: BlockId.Dirt }
    ];
    const top = rectsFor(TOP, blocks);
    expect(top).toHaveLength(2);
    expect(top.map((rect) => rect.blockId).sort()).toEqual([BlockId.Grass, BlockId.Dirt]);
  });

  it('带孔洞平面：矩形面积和等于可见面数，扫描顺序固定', () => {
    // 2×2 缺一角。
    const blocks = [
      { x: 0, y: 0, z: 0, id: BlockId.Grass },
      { x: 1, y: 0, z: 0, id: BlockId.Grass },
      { x: 0, y: 0, z: 1, id: BlockId.Grass }
    ];
    const top = rectsFor(TOP, blocks);
    const area = top.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    expect(area).toBe(3);
    // 固定扫描顺序：先扫出 (0,0) 起的 2×1，再扫出 (0,1) 起的 1×1。
    expect(top).toEqual(rectsFor(TOP, blocks).map((rect) => ({ ...rect })));
    expect(top.map((rect) => [rect.u0, rect.v0, rect.width, rect.height])).toEqual([
      [0, 0, 2, 1],
      [0, 1, 1, 1]
    ]);
  });
});

describe('generateGreedyMesh 遮挡与产面语义', () => {
  it('邻居为空气/水/树叶时产面，实体不透明邻居剔除', () => {
    // 顶面邻居是水：草方块仍产面。
    expect(
      rectsFor(TOP, [
        { x: 0, y: 0, z: 0, id: BlockId.Grass },
        { x: 0, y: 1, z: 0, id: BlockId.Water }
      ]).some((rect) => rect.blockId === BlockId.Grass)
    ).toBe(true);
    // 顶面邻居是树叶（透明）：草方块仍产面。
    expect(
      rectsFor(TOP, [
        { x: 0, y: 0, z: 0, id: BlockId.Grass },
        { x: 0, y: 1, z: 0, id: BlockId.Leaves }
      ]).some((rect) => rect.blockId === BlockId.Grass)
    ).toBe(true);
    // 顶面邻居是石头（不透明）：草方块顶面被剔除（石头自身的顶面照常产出，不影响断言）。
    expect(
      rectsFor(TOP, [
        { x: 0, y: 0, z: 0, id: BlockId.Grass },
        { x: 0, y: 1, z: 0, id: BlockId.Stone }
      ]).some((rect) => rect.blockId === BlockId.Grass)
    ).toBe(false);
  });

  it('水格自身不产出实心面', () => {
    // 水面之上是空气，但水属于水面网格，实心贪心不产面。
    expect(rectsFor(TOP, [{ x: 0, y: 0, z: 0, id: BlockId.Water }])).toEqual([]);
  });

  it('树叶与树叶相邻仍各自产面且可合并为大矩形', () => {
    const blocks = [
      { x: 0, y: 0, z: 0, id: BlockId.Leaves },
      { x: 1, y: 0, z: 0, id: BlockId.Leaves }
    ];
    // 树叶透明：彼此相邻也保留 +X/-X 面（现行为）。
    expect(rectsFor(PLUS_X, blocks)).toHaveLength(2);
    // 顶面同方块合并为一个 2×1 矩形（mask=blockId 语义回归）。
    const top = rectsFor(TOP, blocks);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ width: 2, height: 1, blockId: BlockId.Leaves });
  });

  it('边界邻格经回调查询：x=15 的 +X 面会查询 x=16', () => {
    const queries: Array<[number, number, number]> = [];
    const rects = rectsFor(PLUS_X, [{ x: 15, y: 0, z: 0, id: BlockId.Grass }], (x, y, z) =>
      queries.push([x, y, z])
    );
    // 回调对越界坐标返回 Air → 产面。
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ layer: 15 });
    expect(queries).toContainEqual([16, 0, 0]);
  });
});

describe('generateGreedyMesh 确定性与纹理', () => {
  it('同一模拟地形两次构建结果逐项相等', () => {
    const size: [number, number, number] = [16, 64, 16];
    const blocks: PlacedBlock[] = [];
    for (let y = 0; y < 64; y += 1) {
      for (let z = 0; z < 16; z += 1) {
        for (let x = 0; x < 16; x += 1) {
          if ((x + y + z) % 3 !== 0) {
            blocks.push({ x, y, z, id: y < 32 ? BlockId.Stone : BlockId.Grass });
          }
        }
      }
    }
    const first: GreedyRect[][] = [];
    const second: GreedyRect[][] = [];
    for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
      first.push(rectsFor(directionIndex, blocks, undefined, size));
      second.push(rectsFor(directionIndex, blocks, undefined, size));
    }
    expect(second).toEqual(first);
  });

  it('顶面使用方块顶面纹理、侧面使用侧面纹理', () => {
    const blocks = [{ x: 0, y: 0, z: 0, id: BlockId.Grass }];
    expect(rectsFor(TOP, blocks)[0]?.textureId).toBe('grass-top');
    expect(rectsFor(3, blocks)[0]?.textureId).toBe('dirt');
    expect(rectsFor(PLUS_X, blocks)[0]?.textureId).toBe('grass-side');
  });
});

describe('getRectVariant', () => {
  it('同参数必同输出，且落在变体数量范围内', () => {
    for (const [originX, originY, originZ, width, height, directionIndex] of [
      [0, 0, 0, 1, 1, 0],
      [7, 64, 3, 16, 16, 2],
      [15, 255, 15, 2, 5, 5]
    ] as const) {
      const variant = getRectVariant(originX, originY, originZ, width, height, directionIndex);
      expect(variant).toBe(
        getRectVariant(originX, originY, originZ, width, height, directionIndex)
      );
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(TEXTURE_VARIANT_COUNT);
    }
  });
});
