/**
 * fdlibm permission notice (https://netlib.org/fdlibm/):
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 *
 * scalbn follows musl; its MIT attribution is pending owner confirmation.
 *
 * Deterministic math: drop-in replacements for the `Math` functions that
 * ECMAScript leaves "implementation-approximated" (sin, cos, atan, atan2, exp,
 * log, pow, hypot). Engines are free to return different last bits for those,
 * and V8 really does differ between x64 and arm64, which made the chaotic
 * simulation (and the Daily Run) play out differently per CPU. Everything the
 * simulation computes must go through this module or plain arithmetic.
 *
 * Guarantees
 * - Bit-identical results on every engine and CPU: the code uses only
 *   exactly-specified operations (IEEE-754 + - * /, Math.sqrt/abs/floor,
 *   comparisons, int32 bit operations, typed-array bit reinterpretation with
 *   the byte order detected at load, and BigInt for huge sin/cos arguments).
 *   Every constant is a shortest round-trip literal (at most 17 significant
 *   digits), which the language requires to parse exactly. JS never fuses a
 *   multiply-add, so the evaluation order written here is the one executed.
 * - Accuracy: fdlibm algorithms (Sun's freely distributable libm, which V8
 *   itself ports). Worst errors measured against a 60-digit decimal reference
 *   (20k random inputs per range, game ranges and the full double range):
 *   sin 0.75, cos 0.70, atan 0.51, atan2 1.01, exp 0.70, log 0.54, pow 0.69,
 *   hypot 0.94 ulp, on par with or better than V8's own Math.* (and, hypot
 *   aside, bit-identical to V8 on x64 for over 95% of inputs). sin/cos reduce
 *   with a three-part pi/2 (Cody-Waite)
 *   for |x| < 1647099 and with an exact BigInt Payne-Hanek reduction above,
 *   so they are accurate for every finite x. exp covers the whole double
 *   range, subnormal results included. tests/dmath.test.ts keeps every
 *   function within 2 ulp of Math.* and pins the exact output bits.
 * - Special values (NaN, +-0, +-Infinity) follow Math.*, including the
 *   JS-specific pow rules (pow(1, Infinity) and pow(x, NaN) are NaN).
 * - Speed (V8, x64): sin/cos/atan2/exp within ~1.5x of the native calls,
 *   hypot ~4x faster than V8's variadic Math.hypot, pow/log ~2-3x slower but
 *   off the hot path. The huge-argument sin/cos path is slow but never
 *   reached at game scale. Overall the sim got slightly faster per tick.
 */

// ── bit access ────────────────────────────────────────────────────────────

const F = new Float64Array(1);
const W = new Int32Array(F.buffer);
/** Index of the high (sign/exponent) word in W; little-endian on every real target, but checked. */
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;

function hiWord(x: number): number {
  F[0] = x;
  return W[HI]!;
}
/** x with its low 32 bits cleared (the fdlibm SET_LOW_WORD(x, 0) idiom). */
function clearLow(x: number): number {
  F[0] = x;
  W[LO] = 0;
  return F[0]!;
}
/** x with its high word replaced (SET_HIGH_WORD). */
function setHigh(x: number, hi: number): number {
  F[0] = x;
  W[HI] = hi;
  return F[0]!;
}
function fromWords(hi: number, lo: number): number {
  W[HI] = hi;
  W[LO] = lo;
  return F[0]!;
}
/** 2^k for -1022 <= k <= 1023, exact. */
function pow2(k: number): number {
  return fromWords((0x3ff + k) << 20, 0);
}

const TWO_1023 = 8.98846567431158e307;
const TWO_M969 = 2.004168360008973e-292; // 2^-1022 * 2^53
const TWO_M1000 = 9.332636185032189e-302;
const TWO_M27 = 7.450580596923828e-9;
const TWO_M28 = 3.725290298461914e-9;
const TWO53 = 9007199254740992;
const TWO54 = 18014398509481984;

/** x * 2^n with a single rounding (musl scalbn). */
function scalbn(x: number, n: number): number {
  if (n > 1023) {
    x *= TWO_1023;
    n -= 1023;
    if (n > 1023) {
      x *= TWO_1023;
      n -= 1023;
      if (n > 1023) n = 1023;
    }
  } else if (n < -1022) {
    // Keep the final step below -53 so the subnormal result is rounded once.
    x *= TWO_M969;
    n += 969;
    if (n < -1022) {
      x *= TWO_M969;
      n += 969;
      if (n < -1022) n = -1022;
    }
  }
  return x * pow2(n);
}

// ── constants ─────────────────────────────────────────────────────────────

const PI = 3.141592653589793;
const PIO2 = 1.5707963267948966;
const PIO4 = 0.7853981633974483;
const PI_LO = 1.2246467991473532e-16;

// sin/cos kernels on [-pi/4, pi/4]
const S1 = -0.16666666666666632;
const S2 = 0.00833333333332249;
const S3 = -0.0001984126982985795;
const S4 = 0.0000027557313707070068;
const S5 = -2.5050760253406863e-8;
const S6 = 1.58969099521155e-10;
const C1 = 0.0416666666666666;
const C2 = -0.001388888888887411;
const C3 = 0.00002480158728947673;
const C4 = -2.7557314351390663e-7;
const C5 = 2.087572321298175e-9;
const C6 = -1.1359647557788195e-11;

// pi/2 split into 33-bit pieces (Cody-Waite): n * PIO2_k is exact for |n| < 2^20.
const INVPIO2 = 0.6366197723675814;
const PIO2_1 = 1.5707963267341256;
const PIO2_1T = 6.077100506506192e-11;
const PIO2_2 = 6.077100506303966e-11;
const PIO2_2T = 2.0222662487959506e-21;
const PIO2_3 = 2.0222662487111665e-21;
const PIO2_3T = 8.4784276603689e-32;
/** 1.5 * 2^52: adding and subtracting it rounds to the nearest integer. */
const TOINT = 6755399441055744;
/** Below this the Cody-Waite reduction is exact enough (fdlibm: |n| < 2^20). */
const MEDIUM_MAX = 1647099;

// ── sin / cos ─────────────────────────────────────────────────────────────

/** sin(x + y) for |x| <= pi/4, y the tail of x (iy = 0 when y is exactly 0). */
function kSin(x: number, y: number, iy: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** cos(x + y) for |x| <= pi/4. */
function kCos(x: number, y: number): number {
  const z = x * x;
  let w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  w = 1 - hz;
  return w + (((1 - w) - hz) + (z * r - x * y));
}

/** Reduced argument of the last remPio2Huge call: x - n*pi/2 = Y0 + Y1. */
let Y0 = 0;
let Y1 = 0;

/** floor(2/pi * 2^1600): fdlibm's ipio2 table (tests/dmath.test.ts exercises every exponent). */
const TWO_OVER_PI = BigInt(
  '0xa2f9836e4e441529fc2757d1f534ddc0db6295993c439041fe5163abdebbc561b7246e3a424dd2e006492eea09d1921cfe1deb1cb129a73ee8' +
    '8235f52ebb4484e99c7026b45f7e413991d639835339f49c845f8bbdf9283b1ff897ffde05980fef2f118b5a0a6d1f6d367ecf27cb09b74f463f' +
    '669e5fea2d7527bac7ebe5f17b3d0739f78a5292ea6bfb5fb11f8d5d0856033046fc7b6babf0cfbc209af4361da9e391615ee61b086599855f14' +
    'a068408dffd8804d73273106061556ca73a8c960e27bc08c6b47c4',
);
/** floor(pi/2 * 2^200). */
const PIO2_200 = BigInt('0x1921fb54442d18469898cc51701b839a252049c1114cf98e804');
const TWO_M196 = 9.956824444577827e-60;

/**
 * Exact (Payne-Hanek) reduction for huge |x| with BigInt fixed point.
 * Slow, but never reached at game scale; it keeps sin/cos correct for every
 * finite input instead of silently losing all precision.
 */
function remPio2Huge(x: number): number {
  const neg = x < 0;
  F[0] = neg ? -x : x;
  const hi = W[HI]!;
  const e = ((hi >>> 20) & 0x7ff) - 1075; // |x| = m * 2^e
  const m = (BigInt((hi & 0xfffff) | 0x100000) << 32n) | BigInt(W[LO]! >>> 0);
  const prod = m * TWO_OVER_PI; // |x| * 2/pi = prod * 2^-s
  const s = BigInt(1600 - e);
  const q = (prod + (1n << (s - 1n))) >> s;
  const g = (prod - (q << s)) >> (s - 192n); // fractional part * 2^192
  const R = g * PIO2_200; // remainder * 2^392
  const rh = Number(R);
  const rl = Number(R - BigInt(rh));
  const n = Number(q & 3n);
  Y0 = rh * TWO_M196 * TWO_M196;
  Y1 = rl * TWO_M196 * TWO_M196;
  if (neg) {
    Y0 = -Y0;
    Y1 = -Y1;
    return -n;
  }
  return n;
}

const TWO_M16 = 0.0000152587890625;
const TWO_M49 = 1.7763568394002505e-15;

/** sin (q = 0) or cos (q = 1): quadrant n of x - n*pi/2 shifted by q. */
function trig(x: number, q: number): number {
  const ax = Math.abs(x);
  let y0: number;
  let y1: number;
  let n: number;
  if (ax <= PIO4) {
    if (ax < TWO_M27) return q === 0 ? x : 1; // keeps the sign of -0
    return q === 0 ? kSin(x, 0, 0) : kCos(x, 0);
  } else if (ax < MEDIUM_MAX) {
    // Cody-Waite: n*PIO2_1 is exact, so r carries no rounding error.
    const fn = (x * INVPIO2 + TOINT) - TOINT;
    let r = x - fn * PIO2_1;
    let w = fn * PIO2_1T;
    y0 = r - w;
    // Lost more than 16 bits to cancellation: use 33 more bits of pi/2.
    if (Math.abs(y0) < ax * TWO_M16) {
      let t = r;
      w = fn * PIO2_2;
      r = t - w;
      w = fn * PIO2_2T - ((t - r) - w);
      y0 = r - w;
      if (Math.abs(y0) < ax * TWO_M49) {
        t = r;
        w = fn * PIO2_3;
        r = t - w;
        w = fn * PIO2_3T - ((t - r) - w);
        y0 = r - w;
      }
    }
    y1 = (r - y0) - w;
    n = fn | 0;
  } else if (ax < Infinity) {
    n = remPio2Huge(x);
    y0 = Y0;
    y1 = Y1;
  } else {
    return x - x; // NaN, +-Infinity
  }
  switch ((n + q) & 3) {
    case 0:
      return kSin(y0, y1, 1);
    case 1:
      return kCos(y0, y1);
    case 2:
      return -kSin(y0, y1, 1);
    default:
      return -kCos(y0, y1);
  }
}

export function sin(x: number): number {
  return trig(x, 0);
}

export function cos(x: number): number {
  return trig(x, 1);
}

// ── atan / atan2 ──────────────────────────────────────────────────────────

const ATANHI = [0.4636476090008061, 0.7853981633974483, 0.982793723247329, 1.5707963267948966];
const ATANLO = [2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17, 6.123233995736766e-17];
const AT0 = 0.3333333333333293;
const AT1 = -0.19999999999876483;
const AT2 = 0.14285714272503466;
const AT3 = -0.11111110405462356;
const AT4 = 0.09090887133436507;
const AT5 = -0.0769187620504483;
const AT6 = 0.06661073137387531;
const AT7 = -0.058335701337905735;
const AT8 = 0.049768779946159324;
const AT9 = -0.036531572744216916;
const AT10 = 0.016285820115365782;
const TWO66 = 73786976294838210000;

export function atan(x: number): number {
  const neg = x < 0;
  let t = neg ? -x : x;
  if (!(t < TWO66)) {
    if (x !== x) return x;
    return neg ? -PIO2 : PIO2; // atanhi[3] + atanlo[3] rounds to pi/2
  }
  let id: number;
  if (t < 0.4375) {
    if (t < TWO_M27) return x; // also keeps the sign of -0
    id = -1;
    t = x;
  } else if (t < 1.1875) {
    if (t < 0.6875) {
      id = 0;
      t = (2 * t - 1) / (2 + t);
    } else {
      id = 1;
      t = (t - 1) / (t + 1);
    }
  } else if (t < 2.4375) {
    id = 2;
    t = (t - 1.5) / (1 + 1.5 * t);
  } else {
    id = 3;
    t = -1 / t;
  }
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return t - t * (s1 + s2);
  const r = ATANHI[id]! - ((t * (s1 + s2) - ATANLO[id]!) - t);
  return neg ? -r : r;
}

const TWO60 = 1152921504606847000;
const TWO_M60 = 8.673617379884035e-19;
const PI3O4 = 2.356194490192345;

/** atan2(y, x) with Math.atan2's quadrant, signed-zero and infinity rules. */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 1) return atan(y);
  const yneg = y < 0 || (y === 0 && 1 / y < 0);
  const xneg = x < 0 || (x === 0 && 1 / x < 0);
  if (y === 0) return xneg ? (yneg ? -PI : PI) : y;
  if (x === 0) return yneg ? -PIO2 : PIO2;
  const ax = xneg ? -x : x;
  const ay = yneg ? -y : y;
  if (ax === Infinity) {
    if (ay === Infinity) return xneg ? (yneg ? -PI3O4 : PI3O4) : yneg ? -PIO4 : PIO4;
    return xneg ? (yneg ? -PI : PI) : yneg ? -0 : 0;
  }
  if (ay === Infinity) return yneg ? -PIO2 : PIO2;
  const q = ay / ax;
  let z: number;
  if (q > TWO60) {
    // |y/x| > 2^60: the angle is pi/2 to working precision, whatever the sign of x.
    z = PIO2 + 0.5 * PI_LO;
    return yneg ? -z : z;
  }
  if (xneg && q < TWO_M60) z = 0;
  else z = atan(q);
  if (!xneg) return yneg ? -z : z;
  return yneg ? (z - PI_LO) - PI : PI - (z - PI_LO);
}

// ── exp / log ─────────────────────────────────────────────────────────────

const O_THRESHOLD = 709.782712893384;
const U_THRESHOLD = -745.1332191019411;
const LN2HI = 0.6931471803691238;
const LN2LO = 1.9082149292705877e-10;
const INVLN2 = 1.4426950408889634;
const HALF_LN2 = 0.3465735912322998; // fdlibm's high-word threshold 0x3fd62e43
const THREE_HALF_LN2 = 1.0397205352783203; // 0x3ff0a2b2
const P1 = 0.16666666666666602;
const P2 = -0.0027777777777015593;
const P3 = 0.00006613756321437934;
const P4 = -0.0000016533902205465252;
const P5 = 4.1381367970572385e-8;

export function exp(x: number): number {
  if (x !== x) return x;
  if (x > O_THRESHOLD) return Infinity;
  if (x < U_THRESHOLD) return 0;
  const ax = x < 0 ? -x : x;
  let hi = 0;
  let lo = 0;
  let k = 0;
  let r: number;
  if (ax >= HALF_LN2) {
    // x = k*ln2 + r, |r| <= 0.5*ln2, with ln2 split so k*LN2HI is exact.
    if (ax < THREE_HALF_LN2) {
      if (x < 0) {
        hi = x + LN2HI;
        lo = -LN2LO;
        k = -1;
      } else {
        hi = x - LN2HI;
        lo = LN2LO;
        k = 1;
      }
    } else {
      k = (INVLN2 * x + (x < 0 ? -0.5 : 0.5)) | 0;
      hi = x - k * LN2HI;
      lo = k * LN2LO;
    }
    r = hi - lo;
  } else if (ax < TWO_M28) {
    return 1 + x;
  } else {
    r = x;
  }
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  if (k >= -1021) {
    if (k === 1024) return y * 2 * TWO_1023;
    return y * pow2(k);
  }
  return y * pow2(k + 1000) * TWO_M1000;
}

const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const LG1 = 0.6666666666666735;
const LG2 = 0.3999999999940942;
const LG3 = 0.2857142874366239;
const LG4 = 0.22222198432149784;
const LG5 = 0.1818357216161805;
const LG6 = 0.15313837699209373;
const LG7 = 0.14798198605116586;

/** Natural logarithm. */
export function log(x: number): number {
  F[0] = x;
  let hx = W[HI]!;
  const lx = W[LO]!;
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022: zero, negative or subnormal
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = setHigh(x, hx | (i ^ 0x3ff00000)); // normalize x or x/2 into [sqrt(2)/2, sqrt(2))
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    // -2^-20 <= f < 2^-20
    if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
    const R = f * f * (0.5 - 0.3333333333333333 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - ((R - k * LN2_LO) - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  if (((hx - 0x6147a) | (0x6b851 - hx)) > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return k * LN2_HI - ((s * (f - R) - k * LN2_LO) - f);
}

// ── pow ───────────────────────────────────────────────────────────────────

const DP_H1 = 0.5849624872207642; // log2(1.5) high
const DP_L1 = 1.350039202129749e-8; // log2(1.5) low
const L1 = 0.5999999999999946;
const L2 = 0.4285714285785502;
const L3 = 0.33333332981837743;
const L4 = 0.272728123808534;
const L5 = 0.23066074577556175;
const L6 = 0.20697501780033842;
const LG2_ = 0.6931471805599453;
const LG2_H = 0.6931471824645996;
const LG2_L = -1.904654299957768e-9;
const OVT = 8.008566259537294e-17; // -(1024 - log2(ovfl + 0.5ulp))
const CP = 0.9617966939259756; // 2/(3 ln2)
const CP_H = 0.9617967009544373;
const CP_L = -7.028461650952758e-9;
const IVLN2 = 1.4426950408889634;
const IVLN2_H = 1.4426950216293335;
const IVLN2_L = 1.9259629911266175e-8;

/**
 * x^y (fdlibm e_pow: log2(x) in extra precision, then 2^(y*log2 x)), with
 * Math.pow's special cases. Use it instead of both Math.pow and `**`.
 */
export function pow(x: number, y: number): number {
  if (y !== y) return NaN;
  if (y === 0) return 1;
  if (x !== x) return NaN;
  const ay = Math.abs(y);
  const ax0 = Math.abs(x);
  if (ay === Infinity) {
    if (ax0 === 1) return NaN; // JS: (+-1)^(+-Infinity) is NaN, unlike C
    if (ax0 > 1) return y > 0 ? Infinity : 0;
    return y < 0 ? Infinity : 0;
  }
  if (y === 1) return x;
  if (y === -1) return 1 / x;
  if (y === 2) return x * x;
  if (y === 0.5 && x > 0) return Math.sqrt(x); // not -0: pow(-0, 0.5) is +0

  F[0] = x;
  const hx = W[HI]!;
  let ix = hx & 0x7fffffff;
  const lx = W[LO]!;
  const hy = hiWord(y);
  const iy = hy & 0x7fffffff;

  // yisint: 0 = y not an integer, 1 = odd integer, 2 = even integer (only needed for x < 0)
  let yisint = 0;
  if (hx < 0) {
    if (ay >= TWO53) yisint = 2;
    else if (Math.floor(y) === y) yisint = y % 2 === 0 ? 2 : 1;
  }

  // x is +-0, +-Infinity or +-1
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax0;
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (ix === 0x3ff00000 && yisint === 0) return NaN; // (-1)^non-int
      if (yisint === 1) z = -z;
    }
    return z;
  }

  if (hx < 0 && yisint === 0) return NaN; // (x<0)^(non-int)
  const sgn = hx < 0 && yisint === 1 ? -1 : 1;

  let t1: number;
  let t2: number;
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      // |y| > 2^64: must over/underflow
      if (ix <= 0x3fefffff) return hy < 0 ? Infinity : 0;
      if (ix >= 0x3ff00000) return hy > 0 ? Infinity : 0;
    }
    if (ix < 0x3fefffff) return hy < 0 ? sgn * Infinity : sgn * 0;
    if (ix > 0x3ff00000) return hy > 0 ? sgn * Infinity : sgn * 0;
    // |1 - x| <= 2^-20: log(x) by x - x^2/2 + x^3/3 - x^4/4
    const t = ax0 - 1;
    const w = (t * t) * (0.5 - t * (0.3333333333333333 - t * 0.25));
    const u = IVLN2_H * t;
    const v = t * IVLN2_L - w * IVLN2;
    t1 = clearLow(u + v);
    t2 = v - (t1 - u);
  } else {
    let ax = ax0;
    let n = 0;
    if (ix < 0x00100000) {
      // subnormal x
      ax *= TWO53;
      n -= 53;
      ix = hiWord(ax);
    }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    ix = j | 0x3ff00000;
    let k: number;
    if (j <= 0x3988e) k = 0; // |x| < sqrt(3/2)
    else if (j < 0xbb67a) k = 1; // |x| < sqrt(3)
    else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    ax = setHigh(ax, ix);
    const bp = k === 0 ? 1 : 1.5;
    const dpH = k === 0 ? 0 : DP_H1;
    const dpL = k === 0 ? 0 : DP_L1;

    // ss = s_h + s_l = (x - bp) / (x + bp)
    let u = ax - bp;
    let v = 1 / (ax + bp);
    const ss = u * v;
    const sH = clearLow(ss);
    let tH = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let tL = ax - (tH - bp);
    const sL = v * ((u - sH * tH) - sH * tL);
    // log(ax)
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += sL * (sH + ss);
    s2 = sH * sH;
    tH = clearLow(3 + s2 + r);
    tL = r - ((tH - 3) - s2);
    u = sH * tH;
    v = sL * tH + tL * ss;
    // 2/(3 log2) * (ss + ...)
    const pH = clearLow(u + v);
    const pL = v - (pH - u);
    const zH = CP_H * pH;
    const zL = CP_L * pH + pL * CP + dpL;
    // log2(ax) = (ss + ...) * 2/(3 log2) = n + dp_h + z_h + z_l
    const t = n;
    t1 = clearLow(((zH + zL) + dpH) + t);
    t2 = zL - (((t1 - t) - dpH) - zH);
  }

  // (y1 + y2) * (t1 + t2) with y1 = y truncated to 32 bits
  const y1 = clearLow(y);
  const pL = (y - y1) * t1 + y * t2;
  let pH = y1 * t1;
  let z = pL + pH;
  F[0] = z;
  const j = W[HI]!;
  const i = W[LO]!;
  if (j >= 0x40900000) {
    // z >= 1024
    if (j !== 0x40900000 || i !== 0) return sgn * Infinity;
    if (pL + OVT > z - pH) return sgn * Infinity;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= -1075
    if (j >>> 0 !== 0xc090cc00 || i !== 0) return sgn * 0;
    if (pL <= z - pH) return sgn * 0;
  }

  // 2^(pH + pL)
  const ij = j & 0x7fffffff;
  let k = (ij >> 20) - 0x3ff;
  let n = 0;
  if (ij > 0x3fe00000) {
    // |z| > 0.5: n = nearest int to z
    n = (j + (0x00100000 >> (k + 1))) | 0;
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    pH -= t;
  }
  let t = clearLow(pL + pH);
  const u = t * LG2_H;
  const v = (pL - (t - pH)) * LG2_ + t * LG2_L;
  z = u + v;
  const w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const r = (z * t1) / (t1 - 2) - (w + z * w);
  z = 1 - (r - z);
  const jz = (hiWord(z) + (n << 20)) | 0;
  if (jz >> 20 <= 0) z = scalbn(z, n); // subnormal result
  else z = setHigh(z, jz);
  return sgn * z;
}

// ── hypot ─────────────────────────────────────────────────────────────────

const TWO600 = 4.149515568880993e180;
const TWO_M600 = 2.409919865102884e-181;
const TWO500 = 3.273390607896142e150;

function hypotSlow(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  if (a === Infinity || b === Infinity) return Infinity;
  if (a !== a || b !== b) return NaN;
  if (a < b) {
    const t = a;
    a = b;
    b = t;
  }
  if (a === 0) return 0;
  if (a > TWO500) {
    a *= TWO_M600;
    b *= TWO_M600;
    return Math.sqrt(a * a + b * b) * TWO600;
  }
  // Only tiny inputs get here (a*a + b*b < 2^-969): scale up to keep the bits.
  a *= TWO600;
  b *= TWO600;
  return Math.sqrt(a * a + b * b) * TWO_M600;
}

/**
 * sqrt(a^2 + b^2) without spurious overflow or underflow (Math.hypot for two
 * arguments, including Infinity beating NaN). Error below 1.5 ulp.
 */
export function hypot(a: number, b: number): number {
  const s = a * a + b * b;
  if (s < Infinity && s >= TWO_M969) return Math.sqrt(s);
  return hypotSlow(a, b);
}
