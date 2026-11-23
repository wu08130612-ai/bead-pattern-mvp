/**
 * export.js —— 导出 PNG（整张图纸 + 图例）与打印/另存为 PDF（A4 自动分页）
 * 全部在浏览器本地完成：PNG 用 canvas.toBlob，PDF 用浏览器自带的 window.print()。
 */
(function (global) {
  'use strict';
  const { drawPattern, drawLegend, boardLines } = global.BeadRender;
  const { textColorFor } = global.BeadColor;

  function metaLine(p, meta) {
    return `${p.W}×${p.H} 格 · ${meta.paletteLabel} · ${p.legend.length} 色 · 共 ${p.beadCount} 颗` +
      (p.emptyCount ? `（留空 ${p.emptyCount} 格）` : '');
  }

  /** 导出高清 PNG：标题 + 图纸 + 图例 + 页脚 */
  function exportPNG(p, meta) {
    const cell = Math.max(16, Math.min(40, Math.floor(4800 / Math.max(p.W, p.H))));
    const boardSize = meta.boardSize || 0;
    const patCv = drawPattern(document.createElement('canvas'), p, { cell, label: meta.label, boardSize });
    const s = Math.max(1, patCv.width / 1400);          // 文字随画布放大
    const pad = 40 * s;
    const width = Math.max(patCv.width + pad * 2, 1400 * s);
    const legendCols = Math.max(1, Math.floor((width - pad * 2) / (330 * s)));
    const legendH = Math.ceil(p.legend.length / legendCols) * 40 * s;
    const boardNote = boardSize ? boardLines(p.W, p.H, boardSize).head : '';
    const headerH = (boardNote ? 114 : 90) * s, footerH = 110 * s;
    const out = document.createElement('canvas');
    out.width = Math.round(width);
    out.height = Math.round(headerH + patCv.height + 50 * s + legendH + footerH);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${30 * s}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText(meta.title || '拼豆图纸', pad, 34 * s);
    ctx.font = `${18 * s}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#444';
    ctx.fillText(metaLine(p, meta), pad, 68 * s);
    if (boardNote) ctx.fillText('拼豆板：' + boardNote, pad, 96 * s);
    ctx.drawImage(patCv, (out.width - patCv.width) / 2, headerH);
    let y = headerH + patCv.height + 20 * s;
    ctx.fillStyle = '#111'; ctx.font = `bold ${20 * s}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText('图例 / 用料清单', pad, y + 12 * s);
    y += 30 * s;
    drawLegend(ctx, p, pad, y, out.width - pad * 2, s, meta.label);
    ctx.textAlign = 'left'; ctx.fillStyle = '#666'; ctx.font = `${13 * s}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
    // 出处较长时按「；」拆成多行
    const lines = ('色值来源：' + meta.paletteSource).split('；').map((t, i, a) => t + (i < a.length - 1 ? '；' : ''));
    lines.push('HEX 为第三方公开的屏幕参考色，实物以色卡为准 · 图片仅在本机处理，不上传');
    lines.forEach((t, i) => ctx.fillText(t, pad, out.height - footerH + 34 * s + i * 22 * s));
    return new Promise(resolve => out.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `拼豆图纸_${p.W}x${p.H}_${p.legend.length}色.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      resolve({ width: out.width, height: out.height, size: b.size });
    }, 'image/png'));
  }

  // ---------- 打印 / PDF ----------
  const A4 = { portrait: [210, 297], landscape: [297, 210] };
  const MARGIN = 8, HEADER = 12, CHIP_W = 31, CHIP_H = 6, LABEL_CELLS = 2.4;
  const PX_PER_MM = 300 / 25.4; // 300 dpi

  function layoutFor(p, orient, cellMm, headerMm) {
    const [pw, ph] = A4[orient];
    const cw = pw - MARGIN * 2, ch = ph - MARGIN * 2;
    const chipCols = Math.floor(cw / CHIP_W);
    const legendH = Math.ceil(p.legend.length / chipCols) * CHIP_H + 6;
    const header = headerMm || HEADER;
    const areaH = ch - header - legendH - 4;
    const cols = Math.max(1, Math.floor(cw / cellMm - LABEL_CELLS));
    const rows = Math.max(1, Math.floor(areaH / cellMm - LABEL_CELLS));
    const tx = Math.ceil(p.W / cols), ty = Math.ceil(p.H / rows);
    return { orient, cellMm, cols, rows, tx, ty, pages: tx * ty };
  }

  /** 每块 29×29 板单独一页。格子取在一页里放得下最大板的最大毫米数。 */
  function chooseBoardLayout(p, orientOpt, cellOpt) {
    const described = boardLines(p.W, p.H, 29);
    const info = described.info;
    const maxW = info.boards.reduce((m, b) => Math.max(m, b.w), 1);
    const maxH = info.boards.reduce((m, b) => Math.max(m, b.h), 1);
    const probe = { W: maxW, H: maxH, legend: p.legend };
    const orients = orientOpt === 'auto' ? ['portrait', 'landscape'] : [orientOpt];
    const cells = cellOpt === 'auto' ? [7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5] : [+cellOpt];
    let best = null;
    for (const o of orients) {
      for (const c of cells) {
        const lay = layoutFor(probe, o, c, 18);
        if (lay.cols >= maxW && lay.rows >= maxH) {
          const cand = Object.assign({}, lay, {
            pageMode: 'board', boardSize: 29, pages: info.count,
            boardCols: info.cols, boardRows: info.rows, cellMm: c,
          });
          if (!best || cand.cellMm > best.cellMm) best = cand;
          break;
        }
      }
    }
    return best;
  }

  /** 自动：优先单页且格子 ≥ 3.5mm，否则用指定/默认 5mm 分页；方向取页数少、格子大的 */
  function chooseLayout(p, orientOpt, cellOpt, pageMode) {
    if (pageMode === 'board') {
      const board = chooseBoardLayout(p, orientOpt, cellOpt);
      if (board) return board;
    }
    const orients = orientOpt === 'auto' ? ['portrait', 'landscape'] : [orientOpt];
    let best = null;
    for (const o of orients) {
      let lay;
      if (cellOpt === 'auto') {
        for (let c = 6; c >= 3.5; c -= 0.1) {
          const l = layoutFor(p, o, +c.toFixed(1));
          if (l.pages === 1) { lay = l; break; }
        }
        if (!lay) lay = layoutFor(p, o, 5);
      } else lay = layoutFor(p, o, +cellOpt);
      if (!best || lay.pages < best.pages || (lay.pages === best.pages && lay.cellMm > best.cellMm)) best = lay;
    }
    if (pageMode === 'board' && best) best.boardFallback = true;
    return best;
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function chipLegend(p, label) {
    const box = el('div', 'pl-chips');
    p.legend.forEach(it => {
      const t = label === 'no' ? it.no : it.code;
      box.appendChild(el('div', 'pl-chip',
        `<span class="sw" style="background:${it.hex};color:${textColorFor(it.hex)}">${esc(t)}</span>` +
        `<b>${it.no}.${esc(it.code)}</b> ×${it.count}`));
    });
    return box;
  }

  /** 生成打印页面到 #print-root，返回布局信息；调用方再 window.print() */
  function buildPrint(p, meta, orientOpt, cellOpt, pageMode) {
    const lay = chooseLayout(p, orientOpt, cellOpt, pageMode);
    const boardSize = lay.pageMode === 'board' ? 29 : (meta.boardSize || 0);
    const described = boardSize ? boardLines(p.W, p.H, boardSize) : null;
    const root = document.getElementById('print-root');
    root.innerHTML = '';
    let style = document.getElementById('page-style');
    if (!style) { style = document.createElement('style'); style.id = 'page-style'; document.head.appendChild(style); }
    style.textContent = `@page { size: A4 ${lay.orient}; margin: ${MARGIN}mm; }`;
    root.dataset.orient = lay.orient;
    let pageNo = 0;
    const cellPx = Math.round(lay.cellMm * PX_PER_MM);
    const marginPx = Math.round(cellPx * LABEL_CELLS / 2);

    const slices = [];
    if (lay.pageMode === 'board' && described) {
      described.info.boards.forEach(b => slices.push({
        x0: b.x0, y0: b.y0, w: b.w, h: b.h,
        extra: `板 ${b.index}（第${b.row}行第${b.col}列${b.partial ? '，边缘余量' : '，整板'}） · ${b.w}×${b.h}`,
      }));
    } else {
      for (let ty = 0; ty < lay.ty; ty++) for (let tx = 0; tx < lay.tx; tx++) {
        const x0 = tx * lay.cols, y0 = ty * lay.rows;
        const w = Math.min(lay.cols, p.W - x0), h = Math.min(lay.rows, p.H - y0);
        let extra = '';
        if (described) {
          const hit = described.info.boards.filter(b => b.x0 < x0 + w && x0 < b.x0 + b.w && b.y0 < y0 + h && y0 < b.y0 + b.h);
          extra = '板 ' + hit.map(b => b.index).join('、');
        }
        slices.push({ x0, y0, w, h, extra });
      }
    }

    slices.forEach(s => {
      pageNo++;
      const cv = drawPattern(document.createElement('canvas'), p, {
        cell: cellPx, x0: s.x0, y0: s.y0, w: s.w, h: s.h,
        label: meta.label, margin: marginPx, boardSize,
      });
      const page = el('section', 'print-page');
      const head = el('div', 'pl-head' + (s.extra && s.extra.length > 28 ? ' wrap' : ''));
      head.innerHTML =
        `<span><b>${esc(meta.title || '拼豆图纸')}</b> · ${esc(metaLine(p, meta))}</span>` +
        `<span>第 ${pageNo}/<i class="pl-total"></i> 页 · 列 ${s.x0 + 1}–${s.x0 + s.w} · 行 ${s.y0 + 1}–${s.y0 + s.h}` +
        (s.extra ? ` · ${esc(s.extra)}` : '') + `</span>`;
      page.appendChild(head);
      const img = new Image();
      img.src = cv.toDataURL('image/png');
      img.style.width = (cv.width / PX_PER_MM) + 'mm';
      img.style.height = (cv.height / PX_PER_MM) + 'mm';
      img.className = 'pl-img';
      page.appendChild(img);
      page.appendChild(chipLegend(p, meta.label));
      root.appendChild(page);
    });

    // 末尾：完整用料清单（多列表格；颜色很多时自动续页）
    const perCol = lay.orient === 'portrait' ? 40 : 26;
    const nCols = lay.orient === 'portrait' ? 2 : 3;
    const perPage = perCol * nCols;
    const listPages = Math.max(1, Math.ceil(p.legend.length / perPage));
    const total = lay.pages + listPages;
    root.querySelectorAll('.pl-total').forEach(e => { e.textContent = total; });
    for (let lp = 0; lp < listPages; lp++) {
      pageNo++;
      const page = el('section', 'print-page');
      page.appendChild(el('div', 'pl-head', `<span><b>用料清单</b> · ${esc(metaLine(p, meta))}</span><span>第 ${pageNo}/${total} 页</span>`));
      const wrap = el('div', 'pl-cols');
      const items = p.legend.slice(lp * perPage, (lp + 1) * perPage);
      for (let c = 0; c < nCols; c++) {
        const part = items.slice(c * perCol, (c + 1) * perCol);
        if (!part.length) break;
        const rows = part.map(it => `<tr><td><span class="sw" style="background:${it.hex};color:${textColorFor(it.hex)}">${esc(meta.label === 'no' ? it.no : it.code)}</span></td>` +
          `<td>${it.no}</td><td><b>${esc(it.code)}</b></td><td>${esc(it.name)}</td><td>${it.hex}</td><td><b>${it.count}</b></td><td>${(it.pct * 100).toFixed(1)}%</td></tr>`).join('');
        wrap.appendChild(el('table', 'pl-table',
          `<thead><tr><th>色块</th><th>序</th><th>色号</th><th>名称</th><th>HEX</th><th>颗数</th><th>占比</th></tr></thead><tbody>${rows}</tbody>`));
      }
      page.appendChild(wrap);
      if (lp === listPages - 1) {
        page.appendChild(el('p', 'pl-sum', `合计 ${p.legend.length} 色，共 <b>${p.beadCount}</b> 颗` + (p.emptyCount ? `；留空 ${p.emptyCount} 格（图中带小圆点的格子不拼）` : '') + '。建议每色多备 5%–10% 损耗。'));
        let foot = `色值来源：${esc(meta.paletteSource)}<br>HEX 为第三方公开的屏幕参考色，实物以色卡为准 · 图片仅在本机处理，不上传 · 打印时请选择「实际大小 / 100%」`;
        if (described) {
          const detail = described.lines.length > 12
            ? `${esc(described.head)}。块数较多，分界用橙色虚线标在图纸上，板号标在每块左上角。`
            : `${esc(described.head)}。<br>${described.lines.map(esc).join('<br>')}`;
          foot += `<br>29×29 拼豆板：${detail}`;
        }
        page.appendChild(el('p', 'pl-foot', foot));
      }
      root.appendChild(page);
    }
    return lay;
  }

  function waitImages(root) {
    return Promise.all(Array.from(root.querySelectorAll('img')).map(i => i.decode ? i.decode().catch(() => {}) : null));
  }

  global.BeadExport = { exportPNG, buildPrint, chooseLayout, waitImages };
})(window);
