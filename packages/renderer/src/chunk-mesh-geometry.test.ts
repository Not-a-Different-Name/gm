import { BlockId, type GreedyRect } from '@gm/core';
import { describe, expect, it } from 'vitest';

import { buildChunkMeshGeometry, type RectRegion } from './chunk-mesh-geometry.js';

// 方向下标对照：0=+X、1=-X、2=+Y、3=-Y、4=+Z、5=-Z。
const SHADES = [0.82, 0.7, 1, 0.55, 0.88, 0.64] as const;

function makeRect(overrides: Partial<GreedyRect>): GreedyRect {
  return {
    directionIndex: 2,
    u0: 0,
    v0: 0,
    layer: 0,
    width: 1,
    height: 1,
    blockId: BlockId.Grass,
    textureId: 'grass-top',
    variant: 0,
    ...overrides
  };
}

// 取二进制精确值，避免浮点减法（如 0.3-0.1）产生尾巴。
const FIXED_REGION: RectRegion = { u0: 0.25, v0: 0.25, u1: 0.5, v1: 0.75 };

// 每个方向一个 2×3 矩形（u0=1、v0=1、layer=2）的期望四角位置。
// 由旧逐面 FACES 顶点逐角推导：面角落在哪个角格随方向而变，此表即回归依据。
const EXPECTED_CORNERS: readonly (readonly (readonly [number, number, number])[])[] = [
  // +X：面在 x+1（layer=2 → x=3），y ∈ [1,4]、z ∈ [1,3]。
  [
    [3, 1, 1],
    [3, 4, 1],
    [3, 4, 3],
    [3, 1, 3]
  ],
  // -X：面在 x=2，y ∈ [1,4]、z ∈ [1,3]。
  [
    [2, 1, 3],
    [2, 4, 3],
    [2, 4, 1],
    [2, 1, 1]
  ],
  // +Y：面在 y+1（layer=2 → y=3），x ∈ [1,3]、z ∈ [1,4]。
  [
    [1, 3, 4],
    [3, 3, 4],
    [3, 3, 1],
    [1, 3, 1]
  ],
  // -Y：面在 y=2，x ∈ [1,3]、z ∈ [1,4]。
  [
    [1, 2, 1],
    [3, 2, 1],
    [3, 2, 4],
    [1, 2, 4]
  ],
  // +Z：面在 z+1（layer=2 → z=3），x ∈ [1,3]、y ∈ [1,4]。
  [
    [3, 1, 3],
    [3, 4, 3],
    [1, 4, 3],
    [1, 1, 3]
  ],
  // -Z：面在 z=2，x ∈ [1,3]、y ∈ [1,4]。
  [
    [1, 1, 2],
    [1, 4, 2],
    [3, 4, 2],
    [3, 1, 2]
  ]
];

describe('buildChunkMeshGeometry 顶点与朝向', () => {
  it('六个方向的矩形四角位置与旧逐面 FACES 顶点一致', () => {
    for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
      const rect = makeRect({ directionIndex, u0: 1, v0: 1, layer: 2, width: 2, height: 3 });
      const data = buildChunkMeshGeometry([rect], () => FIXED_REGION);
      expect(data.positions).toHaveLength(18);
      // 三角形顺序 0-1-2 / 0-2-3。
      const expected = EXPECTED_CORNERS[directionIndex]!;
      const flat = [0, 1, 2, 0, 2, 3].flatMap((corner) => expected[corner]!);
      expect(data.positions).toEqual(flat);
    }
  });

  it('矩形尺寸累加正确：每矩形 6 顶点、每顶点 3 个坐标', () => {
    const data = buildChunkMeshGeometry(
      [makeRect({ width: 2, height: 2 }), makeRect({ directionIndex: 0, width: 4, height: 1 })],
      () => FIXED_REGION
    );
    expect(data.positions).toHaveLength(36);
    expect(data.uvs).toHaveLength(24);
    expect(data.regions).toHaveLength(48);
  });

  it('顶点色等于方向明暗常数', () => {
    for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
      const data = buildChunkMeshGeometry(
        [makeRect({ directionIndex, width: 2, height: 2 })],
        () => FIXED_REGION
      );
      expect(data.colors).toEqual(new Array(18).fill(SHADES[directionIndex]));
    }
  });
});

describe('buildChunkMeshGeometry 平铺 uv 与 region', () => {
  it('2×2 矩形的 uv 为块内坐标 (0..2)，region 为传入四值', () => {
    const data = buildChunkMeshGeometry([makeRect({ width: 2, height: 2 })], () => FIXED_REGION);
    // +Y 角格表 [0,1]/[1,1]/[1,0]/[0,0]：四角 uv (0,2)/(2,2)/(2,0)/(0,0)，
    // 两个三角形 0-1-2 / 0-2-3。
    expect(data.uvs).toEqual([0, 2, 2, 2, 2, 0, 0, 2, 2, 0, 0, 0]);
    for (let vertex = 0; vertex < 6; vertex += 1) {
      expect(data.regions.slice(vertex * 4, vertex * 4 + 4)).toEqual([0.25, 0.25, 0.25, 0.5]);
    }
  });

  it('六个方向的平铺 uv 与角格表一致（u 随宽度、v 随高度，不随方向错位）', () => {
    // 2×3 矩形四角的期望 uv = 角格表 (cellU×2, cellV×3)，按三角形顺序 0-1-2 / 0-2-3 展开。
    // 此表防回归：uv 系数曾与角格表脱钩，导致部分方向的合并矩形 uv 轴与面内轴错位、
    // 贴图按合并尺寸整面拉伸（单块 1×1 矩形恰好掩盖该缺陷）。
    const EXPECTED_UVS: readonly (readonly number[])[] = [
      [0, 0, 0, 3, 2, 3, 0, 0, 2, 3, 2, 0], // +X：角格 [0,0]/[0,1]/[1,1]/[1,0]
      [2, 0, 2, 3, 0, 3, 2, 0, 0, 3, 0, 0], // -X：角格 [1,0]/[1,1]/[0,1]/[0,0]
      [0, 3, 2, 3, 2, 0, 0, 3, 2, 0, 0, 0], // +Y：角格 [0,1]/[1,1]/[1,0]/[0,0]
      [0, 0, 2, 0, 2, 3, 0, 0, 2, 3, 0, 3], // -Y：角格 [0,0]/[1,0]/[1,1]/[0,1]
      [2, 0, 2, 3, 0, 3, 2, 0, 0, 3, 0, 0], // +Z：角格 [1,0]/[1,1]/[0,1]/[0,0]
      [0, 0, 0, 3, 2, 3, 0, 0, 2, 3, 2, 0] // -Z：角格 [0,0]/[0,1]/[1,1]/[1,0]
    ];
    for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
      const data = buildChunkMeshGeometry(
        [makeRect({ directionIndex, u0: 1, v0: 1, layer: 2, width: 2, height: 3 })],
        () => FIXED_REGION
      );
      expect(data.uvs).toEqual(EXPECTED_UVS[directionIndex]);
    }
  });

  it('不同矩形可用不同 region', () => {
    const data = buildChunkMeshGeometry(
      [
        makeRect({ width: 1, height: 1 }),
        makeRect({ width: 1, height: 1, u0: 1, textureId: 'stone' })
      ],
      (textureId) =>
        textureId === 'grass-top' ? FIXED_REGION : { u0: 0.5, v0: 0, u1: 0.75, v1: 1 }
    );
    // 两个矩形的 region 互不相同。
    expect(data.regions.slice(0, 4)).toEqual([0.25, 0.25, 0.25, 0.5]);
    expect(data.regions.slice(24, 28)).toEqual([0.5, 0, 0.25, 1]);
  });
});
