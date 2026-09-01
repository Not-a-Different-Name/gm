import * as THREE from 'three';

import {
  bodyVisibilityAt,
  moonDirectionAt,
  skyPhaseAt,
  sunDirectionAt,
  type SkyPhase
} from './sky-cycle.js';

// 天球上各元素的半径：都小于相机 far(500)，且材质关闭雾效，避免被距离雾吞掉。
const DOME_RADIUS = 480;
const STAR_RADIUS = 460;
const BODY_DISTANCE = 300;
const SUN_SIZE = 40;
const MOON_SIZE = 30;
const STAR_COUNT = 1400;

// 一整天的真实时长（秒）。默认 8 分钟一轮，昼夜各约 4 分钟。
const DEFAULT_DAY_LENGTH = 480;

// 关键天色（线性空间由 Three.js 处理），用于按阶段混合。
const ZENITH_DAY = new THREE.Color(0x4a86c4);
const HORIZON_DAY = new THREE.Color(0xbfe0f2);
const ZENITH_NIGHT = new THREE.Color(0x080b1e);
const HORIZON_NIGHT = new THREE.Color(0x1a2140);
const HORIZON_SUNSET = new THREE.Color(0xffb066);
const ZENITH_SUNSET = new THREE.Color(0x5a4a86);

const SUN_LIGHT_DAY = new THREE.Color(0xfff2cf);
const MOON_LIGHT = new THREE.Color(0x8fa6d8);
const HEMI_SKY_DAY = new THREE.Color(0xcdeaff);
const HEMI_GROUND_DAY = new THREE.Color(0x5a6a3c);
const HEMI_SKY_NIGHT = new THREE.Color(0x151d38);
const HEMI_GROUND_NIGHT = new THREE.Color(0x0c1220);

const domeVertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

// 天空穹顶：按视线仰角在地平线色与天顶色之间过渡，并叠加朝向太阳的暖色光晕。
const domeFragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vDirection;
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform float uSunGlow;

  void main() {
    vec3 direction = normalize(vDirection);
    float elevation = clamp(direction.y, -1.0, 1.0);
    // 地平线附近压缩过渡，天顶更纯净。
    float gradient = pow(clamp(elevation * 0.5 + 0.5, 0.0, 1.0), 0.8);
    vec3 color = mix(uHorizonColor, uZenithColor, gradient);

    // 面向太阳的光晕：随视线与太阳方向的夹角衰减。
    float sunAmount = max(dot(direction, normalize(uSunDirection)), 0.0);
    float halo = pow(sunAmount, 6.0) * 0.6 + pow(sunAmount, 64.0) * 0.6;
    color += uSunColor * halo * uSunGlow;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// 生成日月的像素贴图，延续游戏的手绘方块像素风。
// 填满整张方形画布（四角不透明），呈现方块状的日月，而非圆盘。
function createBodyTexture(kind: 'sun' | 'moon'): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('无法创建日月贴图画布');
  }
  context.clearRect(0, 0, size, size);

  const center = (size - 1) / 2;
  const radius = size / 2 - 1;
  const core = kind === 'sun' ? new THREE.Color(0xfff4c2) : new THREE.Color(0xe6ecff);
  const edge = kind === 'sun' ? new THREE.Color(0xffb43c) : new THREE.Color(0x9fb0d8);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 用切比雪夫距离取同心方环，使明暗过渡为方形而非圆形，四角填满。
      const t = Math.min(Math.max(Math.abs(x - center), Math.abs(y - center)) / radius, 1);
      const shade = core.clone().lerp(edge, t * t);
      // 轻微像素抖动，避免方块过于均匀。
      const jitter = (((x * 7 + y * 13) % 5) - 2) * 0.012;
      shade.offsetHSL(0, 0, jitter);
      context.fillStyle = `#${shade.getHexString()}`;
      context.fillRect(x, y, 1, 1);
    }
  }

  if (kind === 'moon') {
    // 几处更深的环形山，打破月面的规整。
    const craters: readonly [number, number, number][] = [
      [12, 11, 2],
      [20, 18, 3],
      [15, 22, 1]
    ];
    for (const [cx, cy, cr] of craters) {
      for (let y = cy - cr; y <= cy + cr; y += 1) {
        for (let x = cx - cr; x <= cx + cr; x += 1) {
          if (Math.hypot(x - cx, y - cy) <= cr) {
            const shade = edge.clone().offsetHSL(0, 0, -0.08);
            context.fillStyle = `#${shade.getHexString()}`;
            context.fillRect(x, y, 1, 1);
          }
        }
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 在天球上均匀撒点，返回 THREE.Points；夜晚淡入并带轻微闪烁。
function createStars(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const positions = new Float32Array(STAR_COUNT * 3);
  const phases = new Float32Array(STAR_COUNT);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    // 在整个天球上均匀撒点（漫天星辰），仅剔除极低处以免陷进地平线以下。
    const theta = Math.random() * Math.PI * 2;
    // cosθ ∈ [-0.15, 1]：覆盖天顶到接近地平线的四周，只留很窄的地平线下裙边。
    const cosPhi = Math.random() * 1.15 - 0.15;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    positions[index * 3] = STAR_RADIUS * sinPhi * Math.cos(theta);
    positions[index * 3 + 1] = STAR_RADIUS * cosPhi;
    positions[index * 3 + 2] = STAR_RADIUS * sinPhi * Math.sin(theta);
    phases[index] = Math.random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xf4f6ff,
    size: 2.6,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = -1;
  points.frustumCulled = false;
  return points;
}

export interface SkyOptions {
  /** 一整天的真实时长（秒）。 */
  readonly dayLength?: number;
  /** 初始时刻 [0,1)，默认 0.3（清晨）。 */
  readonly startTime?: number;
}

/**
 * 天空系统：渐变穹顶、方块日月、星点与昼夜光照。
 * 所有天球元素每帧重定位到相机所在处，形成无限远的天空。
 * 不修改世界生成，纯渲染层扩展。
 */
export class Sky {
  public readonly object3d = new THREE.Group();
  // 纯视觉元素（穹顶/日月/星辰）：水下会整组隐藏防穿透水面。
  // 与灯光分开存放——灯光不能跟着隐藏，否则水下世界失去全部光照、一片漆黑。
  public readonly visuals = new THREE.Group();

  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly sunMaterial: THREE.SpriteMaterial;
  private readonly moonMaterial: THREE.SpriteMaterial;
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, 0);
  private readonly moonLight = new THREE.DirectionalLight(0xffffff, 0);
  private readonly hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0);
  private readonly dayLength: number;
  private timeOfDay: number;
  private elapsed = 0;
  private currentPhase: SkyPhase = { dayFactor: 1, nightFactor: 0, sunsetFactor: 0 };

  public constructor(options: SkyOptions = {}) {
    this.dayLength = options.dayLength ?? DEFAULT_DAY_LENGTH;
    this.timeOfDay = options.startTime ?? 0.3;

    const domeMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenithColor: { value: ZENITH_DAY.clone() },
        uHorizonColor: { value: HORIZON_DAY.clone() },
        uSunColor: { value: new THREE.Color(0xffd9a0) },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunGlow: { value: 1 }
      },
      vertexShader: domeVertexShader,
      fragmentShader: domeFragmentShader
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 16), domeMaterial);
    this.dome.renderOrder = -2;
    this.dome.frustumCulled = false;

    this.sunMaterial = new THREE.SpriteMaterial({
      map: createBodyTexture('sun'),
      transparent: true,
      depthWrite: false,
      fog: false
    });
    this.sun = new THREE.Sprite(this.sunMaterial);
    this.sun.scale.setScalar(SUN_SIZE);
    this.sun.renderOrder = -1;

    this.moonMaterial = new THREE.SpriteMaterial({
      map: createBodyTexture('moon'),
      transparent: true,
      depthWrite: false,
      fog: false
    });
    this.moon = new THREE.Sprite(this.moonMaterial);
    this.moon.scale.setScalar(MOON_SIZE);
    this.moon.renderOrder = -1;

    this.stars = createStars();

    this.visuals.add(this.dome, this.sun, this.moon, this.stars);
    this.object3d.add(this.visuals, this.sunLight, this.moonLight, this.hemiLight);

    this.applyTime();
  }

  /** 当前时刻 [0,1)：0=午夜，0.5=正午。 */
  public get time(): number {
    return this.timeOfDay;
  }

  /** 当前天色阶段，可供水下滤镜、HUD 等复用。 */
  public get phase(): SkyPhase {
    return this.currentPhase;
  }

  /** 直接设置时刻，用于调试或存档恢复。 */
  public setTime(timeOfDay: number): void {
    this.timeOfDay = ((timeOfDay % 1) + 1) % 1;
    this.applyTime();
  }

  /** 每帧推进昼夜并把天球重定位到相机处。 */
  public update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    this.elapsed += deltaSeconds;
    this.timeOfDay = (this.timeOfDay + deltaSeconds / this.dayLength) % 1;
    this.object3d.position.copy(cameraPosition);
    this.applyTime();
  }

  private applyTime(): void {
    const sunDir = sunDirectionAt(this.timeOfDay);
    const moonDir = moonDirectionAt(this.timeOfDay);
    const phase = skyPhaseAt(sunDir.y);
    this.currentPhase = phase;

    // 日月定位（相对天球中心，即相机）。
    this.sun.position.set(
      sunDir.x * BODY_DISTANCE,
      sunDir.y * BODY_DISTANCE,
      sunDir.z * BODY_DISTANCE
    );
    this.moon.position.set(
      moonDir.x * BODY_DISTANCE,
      moonDir.y * BODY_DISTANCE,
      moonDir.z * BODY_DISTANCE
    );
    const sunVisible = bodyVisibilityAt(sunDir.y);
    const moonVisible = bodyVisibilityAt(moonDir.y);
    this.sunMaterial.opacity = sunVisible;
    this.moonMaterial.opacity = moonVisible * 0.95;

    // 星星：夜晚淡入，并用整体时间做极轻微的呼吸式闪烁。
    const twinkle = 0.85 + Math.sin(this.elapsed * 1.6) * 0.15;
    this.stars.material.opacity = phase.nightFactor * twinkle;

    // 穹顶颜色：先在昼/夜之间混合，再叠加朝晚霞的暖色。
    const zenith = ZENITH_NIGHT.clone().lerp(ZENITH_DAY, phase.dayFactor);
    const horizon = HORIZON_NIGHT.clone().lerp(HORIZON_DAY, phase.dayFactor);
    zenith.lerp(ZENITH_SUNSET, phase.sunsetFactor * 0.5);
    horizon.lerp(HORIZON_SUNSET, phase.sunsetFactor * 0.7);
    const uniforms = this.dome.material.uniforms;
    (uniforms.uZenithColor!.value as THREE.Color).copy(zenith);
    (uniforms.uHorizonColor!.value as THREE.Color).copy(horizon);
    (uniforms.uSunDirection!.value as THREE.Vector3).set(sunDir.x, sunDir.y, sunDir.z);
    uniforms.uSunGlow!.value = sunVisible;

    // 光照：太阳主光随白昼增强，月光在夜晚提供冷色补光。
    this.sunLight.position.set(sunDir.x, sunDir.y, sunDir.z);
    this.sunLight.intensity = phase.dayFactor * 2.4;
    this.sunLight.color.copy(SUN_LIGHT_DAY).lerp(HORIZON_SUNSET, phase.sunsetFactor * 0.5);

    this.moonLight.position.set(moonDir.x, moonDir.y, moonDir.z);
    this.moonLight.intensity = phase.nightFactor * 0.5;
    this.moonLight.color.copy(MOON_LIGHT);

    this.hemiLight.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_DAY, phase.dayFactor);
    this.hemiLight.groundColor.copy(HEMI_GROUND_NIGHT).lerp(HEMI_GROUND_DAY, phase.dayFactor);
    this.hemiLight.intensity = 0.5 + phase.dayFactor * 1.7;
  }

  /** 当前地平线颜色，供场景雾与清屏色同步，使远处与天空融为一体。 */
  public getHorizonColor(target: THREE.Color): THREE.Color {
    return target.copy(this.dome.material.uniforms.uHorizonColor!.value as THREE.Color);
  }
}
