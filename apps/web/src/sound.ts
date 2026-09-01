// 程序化破坏/放置音效：不依赖任何音频资产，全部用 Web Audio 合成。
// AudioContext 必须在用户手势调用栈内创建（浏览器自动播放策略），
// 入口 unlock() 由开始游戏按钮点击与画布按下两个手势点触发。

const MASTER_GAIN = 0.3;

interface HardnessBand {
  /** 长按轻击的带通中心频率。 */
  readonly frequency: number;
  /** 长按轻击的单次衰减时长。 */
  readonly duration: number;
  /** 长按轻击的间隔。 */
  readonly tickInterval: number;
  /** 破坏瞬间噪声的低通截止起点：越硬越低越闷沉。 */
  readonly burstCutoff: number;
  /** 破坏瞬间爆发的衰减时长：越硬越绵长。 */
  readonly burstDuration: number;
  /** 破坏瞬间低频"砰"的正弦起点：越硬起点越低越沉。 */
  readonly thumpStart: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// 硬度 → 音色连续映射。所有频率压在中低区（轻击 ≤1600Hz、爆发 ≤300Hz），避免尖锐刺耳；
// 破坏瞬间的明暗（低通截止）、时长与低沉度都随硬度变化，叶子细碎短促、石头低沉绵长。
// 基岩 Infinity 全部钳制到最沉一档。
function hardnessBand(hardness: number): HardnessBand {
  return {
    frequency: clamp(1600 - hardness * 700, 550, 1600),
    duration: clamp(0.05 + hardness * 0.05, 0.06, 0.15),
    tickInterval: Math.round(clamp(110 + hardness * 40, 110, 200)),
    burstCutoff: clamp(3000 - hardness * 1400, 900, 3000),
    burstDuration: clamp(0.22 + hardness * 0.12, 0.24, 0.5),
    thumpStart: clamp(300 - hardness * 140, 90, 300)
  };
}

export class BlockSounds {
  private context: AudioContext | undefined;
  private masterGain: GainNode | undefined;
  private noiseBuffer: AudioBuffer | undefined;
  private breakingTimer: number | undefined;

  /** 用户手势内创建/唤醒音频上下文；重复调用安全，策略拒绝静默忽略。 */
  public unlock(): void {
    if (this.context === undefined) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = MASTER_GAIN;
      this.masterGain.connect(this.context.destination);
    }
    void this.context.resume().catch(() => undefined);
  }

  /** 开始长按破坏的连续轻击；重复调用会先停掉上一轮。 */
  public startBreaking(hardness: number): void {
    this.stopBreaking();
    const band = hardnessBand(hardness);
    const tick = (): void => {
      this.playTick(band);
      this.breakingTimer = window.setTimeout(tick, band.tickInterval);
    };
    tick();
  }

  /** 停止连续轻击；幂等，是唯一的停止出口。 */
  public stopBreaking(): void {
    if (this.breakingTimer !== undefined) {
      window.clearTimeout(this.breakingTimer);
      this.breakingTimer = undefined;
    }
  }

  /** 方块破坏瞬间的碎裂爆发：低通噪声（明暗随硬度）+ 低频"砰"（低沉度随硬度）。 */
  public playBreak(hardness: number): void {
    if (this.context === undefined) {
      return;
    }
    const context = this.context;
    const band = hardnessBand(hardness);
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer === undefined) {
      return;
    }
    const now = context.currentTime;

    // 碎裂噪声：低通截止随硬度降低（越硬越闷），衰减中也持续下滑，模拟碎块落地散开。
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(band.burstCutoff, now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(band.burstCutoff * 0.4, 200),
      now + band.burstDuration
    );
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + band.burstDuration);
    noise.connect(filter).connect(noiseGain).connect(this.masterGain!);
    noise.start();
    noise.stop(now + band.burstDuration + 0.02);

    // 低频"砰"：正弦从方块各自的起点下滑到 55Hz，硬方块起点更低、更沉更长。
    const thump = context.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(band.thumpStart, now);
    thump.frequency.exponentialRampToValueAtTime(55, now + band.burstDuration * 0.8);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.5, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + band.burstDuration);
    thump.connect(thumpGain).connect(this.masterGain!);
    thump.start();
    thump.stop(now + band.burstDuration + 0.02);
  }

  /** 放置方块的短促闷响。 */
  public playPlace(): void {
    if (this.context === undefined) {
      return;
    }
    const context = this.context;
    const now = context.currentTime;

    const noise = context.createBufferSource();
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer === undefined) {
      return;
    }
    noise.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    noise.connect(filter).connect(gain).connect(this.masterGain!);
    noise.start();
    noise.stop(now + 0.1);
  }

  /** 页面切后台/暂停时停掉所有持续音。 */
  public silence(): void {
    this.stopBreaking();
  }

  private playTick(band: HardnessBand): void {
    if (this.context === undefined) {
      return;
    }
    const context = this.context;
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer === undefined) {
      return;
    }
    const now = context.currentTime;

    // 噪声经窄带通（Q=3）滤波定音色。
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = band.frequency;
    filter.Q.value = 3;
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.14, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + band.duration);
    noise.connect(filter).connect(noiseGain).connect(this.masterGain!);
    noise.start();
    noise.stop(now + band.duration + 0.01);

    // 叠加同频三角波基音增强音高感：三角波谐波柔和，不似正弦高音尖锐。
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(band.frequency, now);
    const oscillatorGain = context.createGain();
    oscillatorGain.gain.setValueAtTime(0.06, now);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.001, now + band.duration * 1.1);
    oscillator.connect(oscillatorGain).connect(this.masterGain!);
    oscillator.start();
    oscillator.stop(now + band.duration * 1.1 + 0.01);
  }

  /** 0.5 秒白噪声缓冲，全类复用同一份。 */
  private getNoiseBuffer(): AudioBuffer | undefined {
    if (this.context === undefined) {
      return undefined;
    }
    if (this.noiseBuffer === undefined) {
      const length = Math.floor(this.context.sampleRate * 0.5);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }
}
