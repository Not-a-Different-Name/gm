import { describe, expect, it } from 'vitest';

import { bodyVisibilityAt, moonDirectionAt, skyPhaseAt, sunDirectionAt } from './sky-cycle.js';

describe('sunDirectionAt', () => {
  it('日出时刻太阳接近地平线', () => {
    const sunrise = sunDirectionAt(0.25);
    expect(Math.abs(sunrise.y)).toBeLessThan(0.05);
  });

  it('正午太阳位于地平线以上高处', () => {
    const noon = sunDirectionAt(0.5);
    expect(noon.y).toBeGreaterThan(0.9);
  });

  it('午夜太阳位于地平线以下', () => {
    const midnight = sunDirectionAt(0);
    expect(midnight.y).toBeLessThan(-0.9);
  });

  it('返回单位向量', () => {
    const direction = sunDirectionAt(0.37);
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 6);
  });
});

describe('moonDirectionAt', () => {
  it('月亮方向与太阳相对', () => {
    const sun = sunDirectionAt(0.5);
    const moon = moonDirectionAt(0.5);
    expect(moon.x).toBeCloseTo(-sun.x, 6);
    expect(moon.y).toBeCloseTo(-sun.y, 6);
    expect(moon.z).toBeCloseTo(-sun.z, 6);
  });
});

describe('skyPhaseAt', () => {
  it('太阳高悬时为白昼', () => {
    const phase = skyPhaseAt(1);
    expect(phase.dayFactor).toBeCloseTo(1, 6);
    expect(phase.nightFactor).toBeCloseTo(0, 6);
  });

  it('太阳深埋地平线下时为夜晚', () => {
    const phase = skyPhaseAt(-1);
    expect(phase.dayFactor).toBeCloseTo(0, 6);
    expect(phase.nightFactor).toBeCloseTo(1, 6);
  });

  it('太阳贴近地平线时朝晚霞最强', () => {
    const horizon = skyPhaseAt(0);
    const high = skyPhaseAt(0.6);
    expect(horizon.sunsetFactor).toBeGreaterThan(high.sunsetFactor);
    expect(horizon.sunsetFactor).toBeCloseTo(1, 6);
  });

  it('白昼因子随太阳高度单调不减', () => {
    let previous = -1;
    for (let elevation = -1; elevation <= 1.0001; elevation += 0.1) {
      const { dayFactor } = skyPhaseAt(elevation);
      expect(dayFactor).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = dayFactor;
    }
  });
});

describe('bodyVisibilityAt', () => {
  it('地平线以下不可见，以上完全可见', () => {
    expect(bodyVisibilityAt(-0.5)).toBeCloseTo(0, 6);
    expect(bodyVisibilityAt(0.5)).toBeCloseTo(1, 6);
  });
});
