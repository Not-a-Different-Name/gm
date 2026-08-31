import { describe, expect, it } from 'vitest';

import {
  getChunkKey,
  getChunkPosition,
  getLocalBlockPosition,
  toChunkCoordinate,
  toLocalCoordinate
} from './chunk-coordinate.js';

describe('区块坐标', () => {
  it('正确处理负数世界坐标', () => {
    expect(toChunkCoordinate(-1)).toBe(-1);
    expect(toChunkCoordinate(-16)).toBe(-1);
    expect(toChunkCoordinate(-17)).toBe(-2);
    expect(toLocalCoordinate(-1)).toBe(15);
    expect(toLocalCoordinate(-16)).toBe(0);
  });

  it('从方块位置计算区块和局部位置', () => {
    const position = { x: -1, y: 120, z: 16 };

    expect(getChunkPosition(position)).toEqual({ x: -1, z: 1 });
    expect(getLocalBlockPosition(position)).toEqual({ x: 15, y: 120, z: 0 });
    expect(getChunkKey({ x: -1, z: 1 })).toBe('-1,1');
  });
});
