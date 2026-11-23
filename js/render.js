/**
 * render.js —— 把图纸画到 canvas 上（屏幕显示、PNG 导出、打印分页共用）
 *
 * drawPattern 可以只画网格的一块区域（x0,y0,w,h），行列号始终用整张图纸的绝对编号（从 1 开始），
 * 所以打印分页后每页的坐标都能和总图对得上。
 */
(function (global) {
  'use strict';
  const { textColorFor } = global.BeadColor;

  const BOARD = 29;

  /** 屏幕图纸的页边（行列号）。打印若传入 margin，就用传入值。 */
  function patternMargin(cell, explicit) {
    if (explicit != null) return explicit;
    return Math.max(18, Math.round(cell * 1.2));
  }

  /** 把整张图纸切成 size×size 的拼豆板（默认 29）。边缘不足一块的也算一块。 */
  function pegboards(W, H, size) {
    size = size || BOARD;
    const cols = Math.ceil(W / size);
    const rows = Math.ceil(H / size);
    const boards = [];
    let index = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * size, y0 = r * size;
        const w = Math.min(size, W - x0);
        const h = Math.min(size, H - y0);
        boards.push({
          index: index++,
          row: r + 1,
          col: c + 1,
          x0, y0, w, h,
          colFrom: x0 + 1,
          colTo: x0 + w,
          rowFrom: y0 + 1,
          rowTo: y0 + h,
          partial: w !== size || h !== size,
        });
      }
    }
    return { size, cols, rows, count: boards.length, boards };
  }

  function boardLines(W, H, size) {
    const info = pegboards(W, H, size);
    const partial = info.boards.filter(b => b.partial).length;
    const head = `${info.rows} 行 × ${info.cols} 列，共 ${info.count} 块 ${info.size}×${info.size} 拼豆板` +
      (partial ? `，其中 ${partial} 块是边缘余量（不足 ${info.size} 格）` : '，全部是整板');
    const lines = info.boards.map(b =>
      `板 ${b.index}：第 ${b.row} 行第 ${b.col} 列，列 ${b.colFrom}–${b.colTo}，行 ${b.rowFrom}–${b.rowTo}，${b.w}×${b.h}` +
      (b.partial ? '，边缘余量' : '，整板'));
    return { info, head, lines };
  }

  /** 根据格子大小选一个能塞进格子的字号 */
  function fitFont(ctx, text, cell, weight) {
    let size = Math.floor(cell * 0.52);
    ctx.font = `${weight} ${size}px "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
    const w = ctx.measureText(text).width;
    const maxW = cell * 0.9;
    if (w > maxW) size = Math.max(5, Math.floor(size * maxW / w));
    return size;
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param pattern buildPattern 的结果
   * @param o {cell, x0, y0, w, h, label:'code'|'no'|'none', highlight:number(-1=无), margin(px),
   *          boardSize:number(0=不标板), selected:{x,y}|null}
   */
  function drawPattern(canvas, pattern, o) {
    const { W, legend, cells } = pattern;
    const cell = o.cell;
    const x0 = o.x0 || 0, y0 = o.y0 || 0;
    const w = o.w || pattern.W, h = o.h || pattern.H;
    const m = patternMargin(cell, o.margin);
    canvas.width = Math.round(w * cell + m * 2);
    canvas.height = Math.round(h * cell + m * 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const textColors = legend.map(l => textColorFor(l.hex));
    const hl = o.highlight != null ? o.highlight : -1;

    // 1) 格子底色
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = cells[(y0 + y) * W + (x0 + x)];
      const px = m + x * cell, py = m + y * cell;
      if (v < 0) {
        ctx.fillStyle = '#fff'; ctx.fillRect(px, py, cell, cell);
        ctx.fillStyle = '#c8c8c8';
        ctx.beginPath(); ctx.arc(px + cell / 2, py + cell / 2, Math.max(1, cell * 0.06), 0, Math.PI * 2); ctx.fill();
        continue;
      }
      ctx.fillStyle = legend[v].hex;
      ctx.fillRect(px, py, cell, cell);
      if (hl >= 0 && v !== hl) { ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.fillRect(px, py, cell, cell); }
    }

    // 2) 格内标注（色号或序号），深底白字、浅底黑字
    if (o.label !== 'none' && cell >= 9) {
      const sample = o.label === 'no' ? String(legend.length) : legend.reduce((a, l) => l.code.length > a.length ? l.code : a, '');
      const size = fitFont(ctx, sample, cell, 'bold');
      ctx.font = `bold ${size}px "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = cells[(y0 + y) * W + (x0 + x)];
        if (v < 0) continue;
        if (hl >= 0 && v !== hl) continue;
        const t = o.label === 'no' ? String(legend[v].no) : legend[v].code;
        ctx.fillStyle = (hl >= 0) ? textColors[v] : textColors[v];
        ctx.fillText(t, m + x * cell + cell / 2, m + y * cell + cell / 2 + size * 0.04);
      }
    }

    // 3) 网格线：细线每格，中线每 5 格，粗线每 10 格（按绝对坐标）
    const line = (x1, y1, x2, y2, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const thin = Math.max(0.5, cell / 28), mid = Math.max(1, cell / 14), thick = Math.max(1.8, cell / 8);
    for (let pass = 0; pass < 3; pass++) {
      for (let x = 0; x <= w; x++) {
        const ax = x0 + x;
        const kind = ax % 10 === 0 || x === 0 || x === w ? 2 : ax % 5 === 0 ? 1 : 0;
        if (kind !== pass) continue;
        const px = Math.round(m + x * cell) + 0.5;
        line(px, m, px, m + h * cell, ['#9a9a9a', '#444', '#000'][kind], [thin, mid, thick][kind]);
      }
      for (let y = 0; y <= h; y++) {
        const ay = y0 + y;
        const kind = ay % 10 === 0 || y === 0 || y === h ? 2 : ay % 5 === 0 ? 1 : 0;
        if (kind !== pass) continue;
        const py = Math.round(m + y * cell) + 0.5;
        line(m, py, m + w * cell, py, ['#9a9a9a', '#444', '#000'][kind], [thin, mid, thick][kind]);
      }
    }

    // 3b) 29×29 拼豆板分界：橙色虚线，板号标在每块左上角
    if (o.boardSize) {
      const B = o.boardSize;
      const cut = Math.max(2.2, cell / 6);
      ctx.save();
      ctx.strokeStyle = '#d9480f';
      ctx.lineWidth = cut;
      ctx.setLineDash([Math.max(4, cell * 0.35), Math.max(3, cell * 0.22)]);
      for (let x = 1; x < w; x++) {
        if ((x0 + x) % B !== 0) continue;
        const px = Math.round(m + x * cell) + 0.5;
        ctx.beginPath(); ctx.moveTo(px, m); ctx.lineTo(px, m + h * cell); ctx.stroke();
      }
      for (let y = 1; y < h; y++) {
        if ((y0 + y) % B !== 0) continue;
        const py = Math.round(m + y * cell) + 0.5;
        ctx.beginPath(); ctx.moveTo(m, py); ctx.lineTo(m + w * cell, py); ctx.stroke();
      }
      ctx.restore();

      const info = pegboards(pattern.W, pattern.H, B);
      const fontPx = Math.max(9, Math.min(13, Math.floor(cell * 0.42)));
      ctx.font = `bold ${fontPx}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.setLineDash([]);
      info.boards.forEach(b => {
        const vx0 = Math.max(b.x0, x0), vy0 = Math.max(b.y0, y0);
        const vx1 = Math.min(b.x0 + b.w, x0 + w), vy1 = Math.min(b.y0 + b.h, y0 + h);
        if (vx0 >= vx1 || vy0 >= vy1) return;
        const label = String(b.index);
        const pad = Math.max(1, Math.round(cell * 0.06));
        const tw = ctx.measureText(label).width;
        const bw = tw + pad * 2, bh = fontPx + pad;
        if (bw > cell - 1 || bh > cell * 0.75) return;
        const bx = m + (vx0 - x0) * cell + pad;
        const by = m + (vy0 - y0) * cell + pad;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = '#d9480f';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
        ctx.fillStyle = '#d9480f';
        ctx.fillText(label, bx + pad, by + Math.max(0, pad * 0.3));
      });
    }

    // 4) 四边行列号（格子够大时每格都标，否则每 5 格标一次）
    const every = cell >= 13 ? 1 : 5;
    const ls = Math.max(8, Math.min(m * 0.5, cell * 0.55));
    ctx.fillStyle = '#222';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let x = 0; x < w; x++) {
      const n = x0 + x + 1;
      if (every > 1 && n % every !== 0 && n !== 1) continue;
      ctx.font = `${n % 5 === 0 ? 'bold ' : ''}${ls}px Arial, sans-serif`;
      const cx = m + x * cell + cell / 2;
      ctx.fillText(String(n), cx, m / 2);
      ctx.fillText(String(n), cx, m + h * cell + m / 2);
    }
    for (let y = 0; y < h; y++) {
      const n = y0 + y + 1;
      if (every > 1 && n % every !== 0 && n !== 1) continue;
      ctx.font = `${n % 5 === 0 ? 'bold ' : ''}${ls}px Arial, sans-serif`;
      const cy = m + y * cell + cell / 2;
      ctx.fillText(String(n), m / 2, cy);
      ctx.fillText(String(n), m + w * cell + m / 2, cy);
    }

    // 5) 选中的格子：白边 + 橙色边，打印/导出不传 selected 就不会画
    if (o.selected && o.selected.x >= x0 && o.selected.y >= y0 && o.selected.x < x0 + w && o.selected.y < y0 + h) {
      const sx = m + (o.selected.x - x0) * cell;
      const sy = m + (o.selected.y - y0) * cell;
      ctx.save();
      ctx.lineJoin = 'miter';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(3, cell * 0.14);
      ctx.strokeRect(sx + ctx.lineWidth / 2, sy + ctx.lineWidth / 2, cell - ctx.lineWidth, cell - ctx.lineWidth);
      ctx.strokeStyle = '#d9480f';
      ctx.lineWidth = Math.max(1.6, cell * 0.07);
      ctx.strokeRect(sx + 1.5, sy + 1.5, cell - 3, cell - 3);
      ctx.restore();
    }
    return canvas;
  }

  /**
   * 在 canvas 上画图例（PNG 导出用）。返回所占高度。
   * entries 一行一个：色块(带标注) | 色号 | 名称 | HEX | 颗数 | 占比
   */
  function drawLegend(ctx, pattern, x, y, width, s, label) {
    const items = pattern.legend;
    const colW = 330 * s, rowH = 40 * s;
    const cols = Math.max(1, Math.floor(width / colW));
    const rows = Math.ceil(items.length / cols);
    ctx.textBaseline = 'middle';
    items.forEach((it, k) => {
      const c = Math.floor(k / rows), r = k % rows;
      const px = x + c * colW, py = y + r * rowH;
      const sw = rowH - 8 * s;
      ctx.fillStyle = it.hex; ctx.fillRect(px, py + 4 * s, sw, sw);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1 * s; ctx.strokeRect(px + 0.5, py + 4 * s + 0.5, sw, sw);
      const t = label === 'no' ? String(it.no) : it.code;
      ctx.fillStyle = textColorFor(it.hex);
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.floor(sw * (t.length > 3 ? 0.34 : 0.42))}px Arial, sans-serif`;
      ctx.fillText(t, px + sw / 2, py + 4 * s + sw / 2);
      ctx.textAlign = 'left'; ctx.fillStyle = '#111';
      ctx.font = `bold ${15 * s}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillText(`${it.no}. ${it.code}`, px + sw + 8 * s, py + 13 * s);
      ctx.font = `${12 * s}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = '#444';
      ctx.fillText(`${it.name ? it.name + ' · ' : ''}${it.hex}`, px + sw + 8 * s, py + 29 * s);
      ctx.textAlign = 'right'; ctx.fillStyle = '#111';
      ctx.font = `bold ${15 * s}px Arial, sans-serif`;
      ctx.fillText(`×${it.count}`, px + colW - 14 * s, py + 13 * s);
      ctx.font = `${12 * s}px Arial, sans-serif`; ctx.fillStyle = '#444';
      ctx.fillText(`${(it.pct * 100).toFixed(1)}%`, px + colW - 14 * s, py + 29 * s);
    });
    return rows * rowH;
  }

  global.BeadRender = { drawPattern, drawLegend, pegboards, boardLines, patternMargin, BOARD };
})(window);
