/**
 * quantize.js —— 图片 → 网格采样 → 映射到拼豆色板 → 限制颜色数 → 去杂点
 *
 * 流程：
 *   1. sampleGrid：把图片按「裁剪填满 / 完整入画」画到 (W*S)×(H*S) 的离屏画布，
 *      再对每个 S×S 小块做带透明度权重的平均，得到每格一个颜色（盒式平均本身就是轻度平滑）。
 *   2. buildPattern：
 *      a. 透明格 → 留空或白色；可选「背景留空」：从边缘泛洪去掉与背景相近的格子
 *      b. 若限制颜色数：在 Lab 空间做 k-means 聚类，簇中心吸附到最近的色板颜色，
 *         不足 K 个时用全色板映射中用量最多的颜色补齐，再迭代两次细化
 *      c. 每格映射到已选颜色中 Lab 最近的一个
 *      d. 可选去杂点：孤立单格且周围多数是另一种颜色时，替换为周围颜色
 *   50×50 网格只有 2500 格，全部计算在几十毫秒内完成。
 */
(function (global) {
  'use strict';
  const { hexToRgb, rgbToLab, dist2 } = global.BeadColor;

  /** 可复现的伪随机数（mulberry32），保证同一张图每次结果一致 */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * @param {CanvasImageSource} img 已解码的图片
   * @param {number} W 网格列数  @param {number} H 网格行数
   * @param {'cover'|'contain'} fit
   * @returns {{W,H,rgb:Float32Array,alpha:Float32Array}}
   */
  function sampleGrid(img, W, H, fit) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const S = Math.max(2, Math.min(8, Math.floor(1600 / Math.max(W, H)))); // 每格子采样 S×S 像素
    const cw = W * S, ch = H * S;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const scale = fit === 'cover' ? Math.max(cw / iw, ch / ih) : Math.min(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    const data = ctx.getImageData(0, 0, cw, ch).data;

    const n = W * H;
    const rgb = new Float32Array(n * 3);
    const alpha = new Float32Array(n);
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        let r = 0, g = 0, b = 0, aSum = 0;
        for (let y = gy * S; y < gy * S + S; y++) {
          let p = (y * cw + gx * S) * 4;
          for (let x = 0; x < S; x++, p += 4) {
            const a = data[p + 3];
            r += data[p] * a; g += data[p + 1] * a; b += data[p + 2] * a; aSum += a;
          }
        }
        const i = gy * W + gx;
        alpha[i] = aSum / (S * S * 255);
        if (aSum > 0) { rgb[i * 3] = r / aSum; rgb[i * 3 + 1] = g / aSum; rgb[i * 3 + 2] = b / aSum; }
      }
    }
    return { W, H, rgb, alpha };
  }

  /** 预计算色板的 Lab（排除夜光/珠光/透明等特殊豆） */
  function preparePalette(palette, includeSpecial) {
    return palette.colors
      .filter(c => includeSpecial || !c.special)
      .map(c => {
        const [r, g, b] = hexToRgb(c.hex);
        return Object.assign({}, c, { lab: rgbToLab(r, g, b) });
      });
  }

  function nearest(L, A, B, cands) {
    let best = -1, bd = Infinity;
    for (let k = 0; k < cands.length; k++) {
      const c = cands[k].lab;
      const d = dist2(L, A, B, c[0], c[1], c[2]);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  /** 从网格边缘泛洪：与边缘平均色相近（Lab 距离 < tol）且连通的格子视为背景 */
  function floodBackground(W, H, labs, empty, tol) {
    let sl = 0, sa = 0, sb = 0, cnt = 0;
    const border = [];
    for (let x = 0; x < W; x++) { border.push(x, (H - 1) * W + x); }
    for (let y = 1; y < H - 1; y++) { border.push(y * W, y * W + W - 1); }
    for (const i of border) if (!empty[i]) { sl += labs[i * 3]; sa += labs[i * 3 + 1]; sb += labs[i * 3 + 2]; cnt++; }
    if (!cnt) return 0;
    const ref = [sl / cnt, sa / cnt, sb / cnt];
    const t2 = tol * tol;
    const close = i => dist2(labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2], ref[0], ref[1], ref[2]) < t2;
    const seen = new Uint8Array(W * H);
    const stack = [];
    for (const i of border) if (!empty[i] && close(i)) { stack.push(i); seen[i] = 1; }
    let removed = 0;
    while (stack.length) {
      const i = stack.pop();
      empty[i] = 1; removed++;
      const x = i % W, y = (i / W) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1); if (x < W - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - W); if (y < H - 1) nb.push(i + W);
      for (const j of nb) if (!seen[j] && !empty[j] && close(j)) { seen[j] = 1; stack.push(j); }
    }
    return removed;
  }

  /** k-means（Lab），k-means++ 初始化，返回簇中心数组 */
  function kmeans(points, k, iters) {
    const n = points.length / 3;
    const rand = rng(12345);
    const centers = [];
    const d = new Float64Array(n).fill(Infinity);
    let first = Math.floor(rand() * n);
    centers.push([points[first * 3], points[first * 3 + 1], points[first * 3 + 2]]);
    while (centers.length < k) {
      const c = centers[centers.length - 1];
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const dd = dist2(points[i * 3], points[i * 3 + 1], points[i * 3 + 2], c[0], c[1], c[2]);
        if (dd < d[i]) d[i] = dd;
        sum += d[i];
      }
      if (sum === 0) break;
      let r = rand() * sum, pick = 0;
      for (let i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break; } }
      centers.push([points[pick * 3], points[pick * 3 + 1], points[pick * 3 + 2]]);
    }
    const assign = new Int32Array(n);
    for (let it = 0; it < iters; it++) {
      const acc = centers.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < centers.length; c++) {
          const cc = centers[c];
          const dd = dist2(points[i * 3], points[i * 3 + 1], points[i * 3 + 2], cc[0], cc[1], cc[2]);
          if (dd < bd) { bd = dd; best = c; }
        }
        assign[i] = best;
        const a = acc[best]; a[0] += points[i * 3]; a[1] += points[i * 3 + 1]; a[2] += points[i * 3 + 2]; a[3]++;
      }
      for (let c = 0; c < centers.length; c++) {
        const a = acc[c];
        if (a[3]) centers[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      }
    }
    return centers;
  }

  /**
   * 去杂点：
   *   - 孤立格（8 邻域内没有同色）且某个邻色占 ≥ minMajor 时，替换为该邻色；
   *   - 「靠近色优先」：某邻色占 ≥ 6 且与本格色差 ΔE < nearDE 时，也并入该邻色，
   *     用来消除相近灰色交替出现的“麻点”。
   */
  function denoise(W, H, cells, minMajor, passes, sub, nearDE) {
    const near2 = nearDE * nearDE;
    for (let p = 0; p < passes; p++) {
      const out = cells.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, me = cells[i];
        if (me < 0) continue;
        const counts = new Map();
        let same = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const v = cells[ny * W + nx];
          if (v === me) same++;
          else if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1);
        }
        let bv = -1, bc = 0;
        counts.forEach((c, v) => { if (c > bc) { bc = c; bv = v; } });
        if (bv < 0) continue;
        if (same === 0 && bc >= minMajor) { out[i] = bv; continue; }
        if (bc >= 6) {
          const a = sub[me].lab, b = sub[bv].lab;
          if (dist2(a[0], a[1], a[2], b[0], b[1], b[2]) < near2) out[i] = bv;
        }
      }
      cells.set(out);
    }
  }

  /**
   * @param sample sampleGrid 的结果
   * @param palette BEAD_PALETTES 中的一个
   * @param opts {maxColors:number|0, transparent:'empty'|'white', bgRemove:boolean, bgTol:number,
   *              denoise:'off'|'light'|'strong', includeSpecial:boolean}
   * @returns {{W,H,cells:Int16Array, colors:Array, legend:Array, emptyCount, beadCount, ms}}
   */
  function buildPattern(sample, palette, opts) {
    const t0 = performance.now();
    const { W, H, rgb, alpha } = sample;
    const n = W * H;
    const cands = preparePalette(palette, opts.includeSpecial);
    const labs = new Float32Array(n * 3);
    const empty = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      if (alpha[i] < 0.5) {
        if (opts.transparent === 'empty') { empty[i] = 1; continue; }
        r = g = b = 255;
      } else if (alpha[i] < 1) { // 半透明边缘：与白色混合
        const a = alpha[i];
        r = r * a + 255 * (1 - a); g = g * a + 255 * (1 - a); b = b * a + 255 * (1 - a);
      }
      const lab = rgbToLab(r, g, b);
      labs[i * 3] = lab[0]; labs[i * 3 + 1] = lab[1]; labs[i * 3 + 2] = lab[2];
    }
    if (opts.bgRemove) floodBackground(W, H, labs, empty, opts.bgTol || 12);

    // 有效（非留空）格子的 Lab
    const idx = [];
    for (let i = 0; i < n; i++) if (!empty[i]) idx.push(i);
    const pts = new Float32Array(idx.length * 3);
    idx.forEach((i, k) => { pts[k * 3] = labs[i * 3]; pts[k * 3 + 1] = labs[i * 3 + 1]; pts[k * 3 + 2] = labs[i * 3 + 2]; });

    // 全色板映射及用量
    const fullMap = new Int32Array(idx.length);
    const fullCount = new Int32Array(cands.length);
    for (let k = 0; k < idx.length; k++) {
      const c = nearest(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], cands);
      fullMap[k] = c; fullCount[c]++;
    }
    const usedFull = [];
    fullCount.forEach((c, i) => { if (c) usedFull.push(i); });

    let chosen; // cands 下标
    const K = opts.maxColors || 0;
    if (!K || usedFull.length <= K || !idx.length) {
      chosen = usedFull;
    } else {
      const centers = kmeans(pts, K, 10);
      let set = new Set(centers.map(c => nearest(c[0], c[1], c[2], cands)));
      const fill = () => {
        const order = usedFull.slice().sort((a, b) => fullCount[b] - fullCount[a]);
        for (const c of order) { if (set.size >= K) break; set.add(c); }
      };
      fill();
      // 细化：按当前选色分组 → 组内平均 → 再吸附到色板
      for (let it = 0; it < 2; it++) {
        const sel = Array.from(set);
        const sub = sel.map(i => cands[i]);
        const acc = sel.map(() => [0, 0, 0, 0]);
        for (let k = 0; k < idx.length; k++) {
          const j = nearest(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], sub);
          const a = acc[j]; a[0] += pts[k * 3]; a[1] += pts[k * 3 + 1]; a[2] += pts[k * 3 + 2]; a[3]++;
        }
        set = new Set();
        acc.forEach((a, j) => { if (a[3]) set.add(nearest(a[0] / a[3], a[1] / a[3], a[2] / a[3], cands)); });
        fill();
      }
      chosen = Array.from(set);
    }

    // 最终映射
    const sub = chosen.map(i => cands[i]);
    const cells = new Int16Array(n).fill(-1);
    for (let k = 0; k < idx.length; k++) {
      cells[idx[k]] = nearest(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], sub);
    }
    if (opts.denoise === 'light') denoise(W, H, cells, 5, 1, sub, 8);
    else if (opts.denoise === 'strong') denoise(W, H, cells, 4, 2, sub, 14);

    // 统计 + 图例（按颗数降序，编号 1..n）
    const counts = new Int32Array(sub.length);
    let emptyCount = 0;
    for (let i = 0; i < n; i++) { if (cells[i] < 0) emptyCount++; else counts[cells[i]]++; }
    const order = sub.map((_, j) => j).filter(j => counts[j] > 0).sort((a, b) => counts[b] - counts[a]);
    const remap = new Int16Array(sub.length).fill(-1);
    order.forEach((j, newIdx) => { remap[j] = newIdx; });
    for (let i = 0; i < n; i++) if (cells[i] >= 0) cells[i] = remap[cells[i]];
    const beadCount = n - emptyCount;
    const legend = order.map((j, k) => ({
      no: k + 1, code: sub[j].code, name: sub[j].name || '', hex: sub[j].hex,
      count: counts[j], pct: beadCount ? counts[j] / beadCount : 0,
    }));
    return { W, H, cells, legend, emptyCount, beadCount, ms: performance.now() - t0 };
  }

  global.BeadQuantize = { sampleGrid, buildPattern };
})(window);
