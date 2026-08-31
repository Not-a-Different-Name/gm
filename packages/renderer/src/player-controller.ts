import { BlockId, isSolidBlock } from '@gm/core';
import * as THREE from 'three';

import type { BlockLookup } from './chunk-mesh.js';

const PLAYER_HALF_WIDTH = 0.3;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const WALK_SPEED = 5.2;
const FLY_SPEED = 10;
const JUMP_SPEED = 8.6;
const GRAVITY = 24;

export type CameraMode = 'first-person' | 'third-person';

export interface PlayerControllerOptions {
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly world: BlockLookup;
  readonly spawnPosition: THREE.Vector3;
  readonly onCameraModeChange?: (mode: CameraMode) => void;
  readonly onFlightChange?: (enabled: boolean) => void;
}

export class PlayerController {
  public readonly position: THREE.Vector3;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly world: BlockLookup;
  private readonly pressedKeys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly onCameraModeChange: ((mode: CameraMode) => void) | undefined;
  private readonly onFlightChange: ((enabled: boolean) => void) | undefined;
  private pitch = 0;
  private yaw = 0;
  private grounded = false;
  private flightEnabled = false;
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
    const movement = this.getMovementDirection();
    const speed = this.flightEnabled ? FLY_SPEED : WALK_SPEED;

    this.moveHorizontally(movement.multiplyScalar(speed * delta));

    if (this.flightEnabled) {
      this.velocity.y = 0;
      if (this.pressedKeys.has('Space')) {
        this.position.y += FLY_SPEED * delta;
      }
      if (this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')) {
        this.position.y -= FLY_SPEED * delta;
      }
    } else {
      this.velocity.y -= GRAVITY * delta;
      this.moveVertically(this.velocity.y * delta);
    }

    this.updateCamera();
  }

  public get mode(): CameraMode {
    return this.cameraMode;
  }

  public get isFlying(): boolean {
    return this.flightEnabled;
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
    if (event.code === 'Space' && this.grounded && !this.flightEnabled) {
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
