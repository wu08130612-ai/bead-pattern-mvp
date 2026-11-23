/**
 * color.js —— 颜色工具：HEX/RGB 转换、sRGB → CIE Lab、色差、文字反色
 * 所有匹配都在 Lab 空间做（比 RGB 欧氏距离更接近人眼感受）。
 */
(function (global) {
  'use strict';

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  // sRGB 0-255 → 线性
  const LIN = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function fLab(t) {
    return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  }

  /** RGB(0-255，可为小数) → [L, a, b]，D65 白点 */
  function rgbToLab(r, g, b) {
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const fx = fLab(x), fy = fLab(y), fz = fLab(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function lin(v) {
    // 允许小数（盒式平均后的颜色），整数走查表
    if (Number.isInteger(v)) return LIN[v];
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /** Lab 距离平方（CIE76）。亮度权重略降，减少人像暗部被拉成纯黑。 */
  function dist2(l1, a1, b1, l2, a2, b2) {
    const dl = (l1 - l2) * 0.9, da = a1 - a2, db = b1 - b2;
    return dl * dl + da * da + db * db;
  }

  /** 深底配白字、浅底配黑字（用 Lab 的 L 判断） */
  function textColorFor(hex) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToLab(r, g, b)[0] < 58 ? '#FFFFFF' : '#000000';
  }

  global.BeadColor = { hexToRgb, rgbToLab, dist2, textColorFor };
})(window);
