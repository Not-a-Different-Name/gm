function hashString(input: string): number {
  let hash = 2166136261;

  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export class SeededRandom {
  private state: number;

  public constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  public nextInt(minimum: number, maximumExclusive: number): number {
    if (
      !Number.isInteger(minimum) ||
      !Number.isInteger(maximumExclusive) ||
      minimum >= maximumExclusive
    ) {
      throw new RangeError('随机整数范围无效');
    }

    return Math.floor(this.next() * (maximumExclusive - minimum)) + minimum;
  }

  public fork(namespace: string): SeededRandom {
    return new SeededRandom(`${this.state}:${namespace}`);
  }
}
