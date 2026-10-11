export interface Positioned {
  x: number;
  y: number;
}

/**
 * Uniform spatial grid rebuilt every tick with a counting sort into typed
 * arrays. It covers a fixed window centred on a point (the player); anything
 * outside is clamped into the border cells, which keeps queries correct
 * (callers always check real distances) at the cost of some extra checks.
 */
export class SpatialGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  private originX = 0;
  private originY = 0;
  private cellStart: Int32Array;
  private cellCount: Int32Array;
  private items: Int32Array;
  private cellOf: Int32Array;

  constructor(cellSize: number, halfExtent: number) {
    this.cellSize = cellSize;
    this.cols = Math.ceil((halfExtent * 2) / cellSize);
    this.rows = this.cols;
    const cells = this.cols * this.rows;
    this.cellStart = new Int32Array(cells + 1);
    this.cellCount = new Int32Array(cells);
    this.items = new Int32Array(256);
    this.cellOf = new Int32Array(256);
  }

  private cellX(x: number): number {
    const c = Math.floor((x - this.originX) / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private cellY(y: number): number {
    const c = Math.floor((y - this.originY) / this.cellSize);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  build(list: readonly Positioned[], centerX: number, centerY: number): void {
    const n = list.length;
    if (this.items.length < n) {
      let cap = this.items.length;
      while (cap < n) cap *= 2;
      this.items = new Int32Array(cap);
      this.cellOf = new Int32Array(cap);
    }
    this.originX = centerX - (this.cols * this.cellSize) / 2;
    this.originY = centerY - (this.rows * this.cellSize) / 2;

    const counts = this.cellCount;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const e = list[i]!;
      const c = this.cellY(e.y) * this.cols + this.cellX(e.x);
      this.cellOf[i] = c;
      counts[c]!++;
    }
    const start = this.cellStart;
    let acc = 0;
    for (let c = 0; c < counts.length; c++) {
      start[c] = acc;
      acc += counts[c]!;
    }
    start[counts.length] = acc;
    // Reuse counts as write cursors.
    for (let c = 0; c < counts.length; c++) counts[c] = start[c]!;
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i]!;
      this.items[counts[c]!++] = i;
    }
  }

  /**
   * Writes indices of items whose cell overlaps the circle into `out` and
   * returns how many were written. Callers must check exact distances.
   */
  query(x: number, y: number, r: number, out: number[]): number {
    const x0 = this.cellX(x - r);
    const x1 = this.cellX(x + r);
    const y0 = this.cellY(y - r);
    const y1 = this.cellY(y + r);
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const c = row + cx;
        const end = this.cellStart[c + 1]!;
        for (let k = this.cellStart[c]!; k < end; k++) out[n++] = this.items[k]!;
      }
    }
    return n;
  }
}
