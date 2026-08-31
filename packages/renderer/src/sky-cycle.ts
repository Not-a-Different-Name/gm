// 昼夜循环的纯数学：不依赖 Three.js、DOM 或时间，方便单元测试。
// 这里只描述“某个时刻太阳/月亮在天球上的方向”和“该高度对应的天色阶段”，
// 具体的颜色与网格由 sky.ts 使用这些结果驱动。

export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// 天球方向的固定侧向倾斜（弧度），让日月沿略微斜切的弧线划过，而不是正头顶直上直下。
const ARC_TILT_Z = -0.35;

const TAU = Math.PI * 2;

function normalize(x: number, y: number, z: number): Vector3Like {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// 标准 smoothstep：edge0→edge1 之间平滑过渡为 0→1。
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// timeOfDay ∈ [0,1)：0=午夜，0.25=日出，0.5=正午，0.75=日落。
// 以 0.25 为相位起点，让太阳在日出时从东边地平线升起。
function sunAngle(timeOfDay: number): number {
  return (timeOfDay - 0.25) * TAU;
}

/** 给定一天中的时刻，返回太阳在天球上的单位方向。y>0 表示在地平线以上。 */
export function sunDirectionAt(timeOfDay: number): Vector3Like {
  const angle = sunAngle(timeOfDay);
  return normalize(Math.cos(angle), Math.sin(angle), ARC_TILT_Z);
}

/** 月亮与太阳在天球上相对，返回其单位方向。 */
export function moonDirectionAt(timeOfDay: number): Vector3Like {
  const sun = sunDirectionAt(timeOfDay);
  return { x: -sun.x, y: -sun.y, z: -sun.z };
}

export interface SkyPhase {
  /** 白昼强度：太阳升高时趋近 1，夜间为 0。 */
  readonly dayFactor: number;
  /** 夜晚强度：dayFactor 的补数。 */
  readonly nightFactor: number;
  /** 朝霞/晚霞强度：太阳接近地平线时最强，用于暖色天光与光晕。 */
  readonly sunsetFactor: number;
}

/**
 * 由太阳高度（方向的 y 分量，取值 [-1,1]）推导天色阶段。
 * 纯函数，便于测试；颜色映射在渲染层完成。
 */
export function skyPhaseAt(sunElevation: number): SkyPhase {
  const dayFactor = smoothstep(-0.1, 0.22, sunElevation);
  const sunsetFactor = clamp01(1 - Math.abs(sunElevation) / 0.28);
  return { dayFactor, nightFactor: 1 - dayFactor, sunsetFactor };
}

/** 供渲染层复用的可见度淡入淡出：太阳/月亮越过地平线时平滑显隐。 */
export function bodyVisibilityAt(bodyElevation: number): number {
  return smoothstep(-0.14, 0.06, bodyElevation);
}
