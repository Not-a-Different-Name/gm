import { BlockId, isSolidBlock, waterOverlapHeight } from '@gm/core';
import * as THREE from 'three';

import type { WaterLevelLookup } from './chunk-mesh.js';

const PLAYER_HALF_WIDTH = 0.3;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const WALK_SPEED = 5.2;
const FLY_SPEED = 10;
const JUMP_SPEED = 8.6;
const GRAVITY = 24;

// 身体与单个水格的重叠高度达到该值才算"在水中"（触发游泳）。
// level 3 的浅水仅约 0.305 深，蹚过浅水不应切换成游泳。
const WATER_SWIM_OVERLAP = 0.45;
// 水中水平移动的速度系数：约为行走速度的一半。
const WATER_SPEED_FACTOR = 0.55;
// 水中按住跳跃键上浮的目标速度（方块/秒）。
const SWIM_UP_SPEED = 4.5;
// 水中不操作时缓慢下沉的目标速度（方块/秒）。
const SWIM_SINK_SPEED = -1.8;
// 水中竖直速度向目标速度指数逼近的速率（/秒）：出入水与按键切换都平滑无跳变。
const SWIM_RESPONSE = 8;
// 入水瞬间竖直速度的保留比例：高处落水被水面制动，不会一路砸到底。
const WATER_ENTRY_DAMP = 0.35;
// 游出水面瞬间按住跳跃键的补跳初速度（约 0.75 倍陆地跳跃），用于跃出水面。
const SURFACE_HOP_SPEED = 6.5;

export type CameraMode = 'first-person' | 'third-person';

export interface PlayerControllerOptions {
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly world: WaterLevelLookup;
  readonly spawnPosition: THREE.Vector3;
  readonly onCameraModeChange?: (mode: CameraMode) => void;
  readonly onFlightChange?: (enabled: boolean) => void;
}

export class PlayerController {
  public readonly position: THREE.Vector3;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly world: WaterLevelLookup;
  private readonly pressedKeys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly onCameraModeChange: ((mode: CameraMode) => void) | undefined;
  private readonly onFlightChange: ((enabled: boolean) => void) | undefined;
  private pitch = 0;
  private yaw = 0;
  private grounded = false;
  private flightEnabled = false;
  // 身体是否在水中（驱动物理）；wasInWater 用于检测"本帧刚出水"的一次性事件。
  private isInWater = false;
  private wasInWater = false;
  private cameraMode: CameraMode = 'first-person';

  public constructor(options: PlayerControllerOptions) {
    this.camera = options.camera;
    this.canvas = options.canvas;
    this.world = options.world;
    this.position = options.spawnPosition.clone();
    this.onCameraModeChange = options.onCameraModeChange;
    this.onFlightChange = options.onFlightChange;

    this.canvas.addEventListener('click', () => {
      void this.canvas.requestPointerLock();
    });
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  public update(deltaSeconds: number): void {
    const delta = Math.min(deltaSeconds, 0.05);
    this.updateWaterState();
    const movement = this.getMovementDirection();
    const speed = this.flightEnabled
      ? FLY_SPEED
      : WALK_SPEED * (this.isInWater ? WATER_SPEED_FACTOR : 1);

    this.moveHorizontally(movement.multiplyScalar(speed * delta));

    if (this.flightEnabled) {
      this.velocity.y = 0;
      if (this.pressedKeys.has('Space')) {
        this.position.y += FLY_SPEED * delta;
      }
      if (this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')) {
        this.position.y -= FLY_SPEED * delta;
      }
    } else if (this.isInWater) {
      this.updateSwimming(delta);
    } else {
      this.velocity.y -= GRAVITY * delta;
      this.moveVertically(this.velocity.y * delta);
      // 刚游出水面且按住跳跃键：补一次出水跳，避免被重力立刻拽回水中。
      if (this.wasInWater && this.pressedKeys.has('Space') && this.velocity.y > 0) {
        this.velocity.y = Math.max(this.velocity.y, SURFACE_HOP_SPEED);
      }
    }

    this.updateCamera();
  }

  public get mode(): CameraMode {
    return this.cameraMode;
  }

  public get isFlying(): boolean {
    return this.flightEnabled;
  }

  public get inWater(): boolean {
    return this.isInWater;
  }

  public setPosition(position: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    // 读档/重生后立即同步水中状态，避免在新位置沿用旧状态。
    this.updateWaterState();
    this.updateCamera();
  }

  // 玩家碰撞盒与目标格 [x, x+1]×[y, y+1]×[z, z+1] 是否相交。
  // 供放置逻辑拒绝"把方块放进自己身体里"（严格边界：脚底所在格不算相交，脚下方格可放）。
  public intersectsBlockPosition(x: number, y: number, z: number): boolean {
    return (
      this.position.x - PLAYER_HALF_WIDTH < x + 1 &&
      this.position.x + PLAYER_HALF_WIDTH > x &&
      this.position.y < y + 1 &&
      this.position.y + PLAYER_HEIGHT > y &&
      this.position.z - PLAYER_HALF_WIDTH < z + 1 &&
      this.position.z + PLAYER_HALF_WIDTH > z
    );
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) {
      return;
    }

    const movementX = THREE.MathUtils.clamp(event.movementX, -80, 80);
    const movementY = THREE.MathUtils.clamp(event.movementY, -80, 80);
    this.yaw -= movementX * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch - movementY * 0.0024, -1.48, 1.48);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyV' && !event.repeat) {
      this.cameraMode = this.cameraMode === 'first-person' ? 'third-person' : 'first-person';
      this.onCameraModeChange?.(this.cameraMode);
      return;
    }
    if (event.code === 'KeyF' && !event.repeat) {
      this.flightEnabled = !this.flightEnabled;
      this.velocity.y = 0;
      this.onFlightChange?.(this.flightEnabled);
      return;
    }
    if (event.code === 'Space' && this.grounded && !this.flightEnabled && !this.isInWater) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.pressedKeys.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private getMovementDirection(): THREE.Vector3 {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const movement = new THREE.Vector3();

    if (this.pressedKeys.has('KeyW')) {
      movement.add(forward);
    }
    if (this.pressedKeys.has('KeyS')) {
      movement.sub(forward);
    }
    if (this.pressedKeys.has('KeyA')) {
      movement.sub(right);
    }
    if (this.pressedKeys.has('KeyD')) {
      movement.add(right);
    }

    return movement.lengthSq() > 0 ? movement.normalize() : movement;
  }

  private moveHorizontally(movement: THREE.Vector3): void {
    const originalX = this.position.x;
    this.position.x += movement.x;
    if (this.intersectsSolidBlock()) {
      this.position.x = originalX;
    }

    const originalZ = this.position.z;
    this.position.z += movement.z;
    if (this.intersectsSolidBlock()) {
      this.position.z = originalZ;
    }
  }

  private moveVertically(distance: number): void {
    const originalY = this.position.y;
    this.position.y += distance;
    if (!this.intersectsSolidBlock()) {
      this.grounded = false;
      return;
    }

    this.position.y = originalY;
    if (distance < 0) {
      this.grounded = true;
    }
    this.velocity.y = 0;
  }

  // 更新"身体是否在水中"：枚举 AABB 覆盖的所有水格，取身体与水体的最大重叠高度，
  // 超过阈值才算入水；进入瞬间按比例削减竖直速度（入水制动）。
  private updateWaterState(): void {
    const minimumX = Math.floor(this.position.x - PLAYER_HALF_WIDTH);
    const maximumX = Math.floor(this.position.x + PLAYER_HALF_WIDTH);
    const minimumY = Math.floor(this.position.y);
    const maximumY = Math.floor(this.position.y + PLAYER_HEIGHT - 0.001);
    const minimumZ = Math.floor(this.position.z - PLAYER_HALF_WIDTH);
    const maximumZ = Math.floor(this.position.z + PLAYER_HALF_WIDTH);

    let maximumOverlap = 0;
    for (let x = minimumX; x <= maximumX; x += 1) {
      for (let y = minimumY; y <= maximumY; y += 1) {
        for (let z = minimumZ; z <= maximumZ; z += 1) {
          if (this.world.getBlock(x, y, z) !== BlockId.Water) {
            continue;
          }
          maximumOverlap = Math.max(
            maximumOverlap,
            waterOverlapHeight(
              y,
              this.world.getWaterLevel(x, y, z),
              this.position.y,
              this.position.y + PLAYER_HEIGHT
            )
          );
        }
      }
    }

    this.wasInWater = this.isInWater;
    this.isInWater = maximumOverlap > WATER_SWIM_OVERLAP;
    if (this.isInWater && !this.wasInWater) {
      this.velocity.y *= WATER_ENTRY_DAMP;
    }
  }

  // 水中竖直移动：按住跳跃键上浮，否则缓慢下沉；速度向目标指数逼近保持平滑。
  private updateSwimming(delta: number): void {
    const targetSpeed = this.pressedKeys.has('Space') ? SWIM_UP_SPEED : SWIM_SINK_SPEED;
    this.velocity.y += (targetSpeed - this.velocity.y) * Math.min(1, SWIM_RESPONSE * delta);
    this.moveVertically(this.velocity.y * delta);
  }

  private intersectsSolidBlock(): boolean {
    const minimumX = Math.floor(this.position.x - PLAYER_HALF_WIDTH);
    const maximumX = Math.floor(this.position.x + PLAYER_HALF_WIDTH);
    const minimumY = Math.floor(this.position.y);
    const maximumY = Math.floor(this.position.y + PLAYER_HEIGHT - 0.001);
    const minimumZ = Math.floor(this.position.z - PLAYER_HALF_WIDTH);
    const maximumZ = Math.floor(this.position.z + PLAYER_HALF_WIDTH);

    for (let x = minimumX; x <= maximumX; x += 1) {
      for (let y = minimumY; y <= maximumY; y += 1) {
        for (let z = minimumZ; z <= maximumZ; z += 1) {
          const blockId = this.world.getBlock(x, y, z);
          if (blockId !== BlockId.Air && isSolidBlock(blockId)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private updateCamera(): void {
    const eyePosition = new THREE.Vector3(
      this.position.x,
      this.position.y + EYE_HEIGHT,
      this.position.z
    );
    if (this.cameraMode === 'first-person') {
      this.camera.position.copy(eyePosition);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      return;
    }

    const lookDirection = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')
    );
    const cameraDistance = this.getThirdPersonCameraDistance(eyePosition, lookDirection);
    this.camera.position.copy(eyePosition).addScaledVector(lookDirection, -cameraDistance);
    this.camera.lookAt(eyePosition);
  }

  private getThirdPersonCameraDistance(
    eyePosition: THREE.Vector3,
    lookDirection: THREE.Vector3
  ): number {
    const maximumDistance = 5.5;
    for (let distance = 0.25; distance <= maximumDistance; distance += 0.25) {
      const sample = eyePosition.clone().addScaledVector(lookDirection, -distance);
      const blockId = this.world.getBlock(
        Math.floor(sample.x),
        Math.floor(sample.y),
        Math.floor(sample.z)
      );
      if (blockId !== BlockId.Air && isSolidBlock(blockId)) {
        return Math.max(0.35, distance - 0.25);
      }
    }
    return maximumDistance;
  }
}
