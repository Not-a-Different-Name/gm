import type { GreedyRect } from '@gm/core';

// 纯数组的贪心矩形 → 网格属性转换：不依赖 three/DOM，node 环境可单测。

/** 图集 region：与渲染层 TextureRegion 结构兼容，本模块不引入 three 依赖。 */
export interface RectRegion {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface ChunkMeshGeometryData {
  readonly positions: number[];
  /** 顶点色：只含方向明暗（shade），图集纹理自带方块底色。 */
  readonly colors: number[];
  /** 块内平铺坐标：矩形四角为 (0,0)/(0,h)/(w,h)/(w,0)，着色器取 fract 映射回图集。 */
  readonly uvs: number[];
  /** 每顶点的图集 region（u0, v0, Δu, Δv），供着色器把平铺坐标加回图集。 */
  readonly regions: number[];
}

// 各方向的面布局（+X、-X、+Y、-Y、+Z、-Z，与旧逐面 FACES 表同序同构）：
// - axes：角格坐标 (u, v, layer) 分别填入 x/y/z 的哪一维；
// - corners：四角相对角格原点的单位偏移（即 FACES 顶点）；
// - cornerCells：四角的角格取 u0/v0 还是远端 u0+w-1/v0+h-1。
//   面角落在哪个角格随方向而变（例如 -X 的 v0 角在 u 远端），不能统一假设；
//   此表保证矩形几何与旧的逐格 UV 朝向完全一致（草侧面的草檐仍在顶侧）。
interface FaceLayout {
  /** x/y/z 三轴分别取角格坐标 (u, v, layer) 的哪一维。 */
  readonly axes: readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
  readonly corners: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number]
  ];
  readonly cornerCells: readonly [
    readonly [0 | 1, 0 | 1],
    readonly [0 | 1, 0 | 1],
    readonly [0 | 1, 0 | 1],
    readonly [0 | 1, 0 | 1]
  ];
  readonly shade: number;
}

const FACE_LAYOUTS: readonly FaceLayout[] = [
  // +X
  {
    axes: [2, 1, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1]
    ],
    cornerCells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0]
    ],
    shade: 0.82
  },
  // -X
  {
    axes: [2, 1, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0]
    ],
    cornerCells: [
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0]
    ],
    shade: 0.7
  },
  // +Y
  {
    axes: [0, 2, 1],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ],
    cornerCells: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0]
    ],
    shade: 1
  },
  // -Y
  {
    axes: [0, 2, 1],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ],
    cornerCells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ],
    shade: 0.55
  },
  // +Z
  {
    axes: [0, 1, 2],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1]
    ],
    cornerCells: [
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0]
    ],
    shade: 0.88
  },
  // -Z
  {
    axes: [0, 1, 2],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0]
    ],
    cornerCells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0]
    ],
    shade: 0.64
  }
];

// 四角在两个三角形（0-1-2 / 0-2-3）中的顺序与平铺 uv 系数（0 或 w/h）。
const TRIANGLE_CORNERS = [0, 1, 2, 0, 2, 3] as const;
const CORNER_UV_U = [0, 0, 1, 1] as const;
const CORNER_UV_V = [0, 1, 1, 0] as const;

// 把贪心矩形列表转成非索引网格属性数组：每矩形 6 顶点（两个三角形）。
// 矩形之间绝不共享顶点——computeVertexNormals 按三角形给法线，垂直相交面的
// 法线不会被平均模糊（矩形内部两个三角形共面，法线天然一致）。
export function buildChunkMeshGeometry(
  rects: readonly GreedyRect[],
  resolveRegion: (textureId: string, variant: number) => RectRegion
): ChunkMeshGeometryData {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const regions: number[] = [];
  const cells: [number, number, number] = [0, 0, 0];

  for (const rect of rects) {
    const layout = FACE_LAYOUTS[rect.directionIndex];
    if (layout === undefined) {
      // 防御：core 的方向表恒为 6 项，正常不会走到这里。
      continue;
    }
    const region = resolveRegion(rect.textureId, rect.variant);
    const regionWidth = region.u1 - region.u0;
    const regionHeight = region.v1 - region.v0;

    for (const cornerIndex of TRIANGLE_CORNERS) {
      // 角格坐标：锚点加上宽高方向的远端偏移（由本方向的 cornerCells 表决定）。
      const cellEnd = layout.cornerCells[cornerIndex]!;
      const u = rect.u0 + (cellEnd[0] === 1 ? rect.width - 1 : 0);
      const v = rect.v0 + (cellEnd[1] === 1 ? rect.height - 1 : 0);
      cells[0] = u;
      cells[1] = v;
      cells[2] = rect.layer;
      const corner = layout.corners[cornerIndex]!;
      positions.push(
        cells[layout.axes[0]] + corner[0],
        cells[layout.axes[1]] + corner[1],
        cells[layout.axes[2]] + corner[2]
      );
      colors.push(layout.shade, layout.shade, layout.shade);
      uvs.push(CORNER_UV_U[cornerIndex]! * rect.width, CORNER_UV_V[cornerIndex]! * rect.height);
      regions.push(region.u0, region.v0, regionWidth, regionHeight);
    }
  }

  return { positions, colors, uvs, regions };
}
