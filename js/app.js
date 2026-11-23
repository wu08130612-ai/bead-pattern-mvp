/**
 * app.js —— 界面逻辑：读取参数、加载图片、生成图纸、单格改色、拼豆板分块、导出
 * 图片用 FileReader/createImageBitmap 思路在本地解码（实际用 Image.decode），不发起任何网络请求。
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const { sampleGrid, buildPattern, editCell } = window.BeadQuantize;
  const { drawPattern, boardLines, patternMargin } = window.BeadRender;
  const { exportPNG, buildPrint, chooseLayout, waitImages } = window.BeadExport;
  const { textColorFor } = window.BeadColor;
  const PALETTES = window.BEAD_PALETTES;
  // 人像优化：少颜色 + 强去杂点 + 边缘泛洪去背景。容差在雷诺阿灰背景上试过后再定。
  const PORTRAIT = { maxColors: '16', denoise: 'strong', bgTol: '16' };

  const state = {
    img: null, imgName: '', objUrl: '', size: [50, 50], view: 'label', highlight: -1,
    selected: null, pattern: null, lastMs: 0, viewMetrics: null,
  };
  window.__bead = state; // 便于调试/自动化验收

  // ---------- 初始化色板下拉 ----------
  Object.values(PALETTES).forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = `${p.label}（${p.colors.length} 色）`;
    $('#palette').appendChild(o);
  });
  function updateSourceNote() {
    const p = PALETTES[$('#palette').value];
    $('#srcNote').innerHTML = '当前色板出处：' + p.source + '<br>' +
      p.urls.map(u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).join(' · ');
  }
  updateSourceNote();

  function paletteColors() {
    const includeSpecial = $('#special').checked;
    return PALETTES[$('#palette').value].colors.filter(c => includeSpecial || !c.special);
  }
  function findPaletteColor(code) {
    const q = String(code || '').trim().toLowerCase();
    if (!q) return null;
    return paletteColors().find(c => c.code.toLowerCase() === q) || null;
  }
  function fillPickers() {
    const colors = paletteColors();
    $('#paletteCodes').innerHTML = colors.map(c => `<option value="${c.code}">${c.name || ''}</option>`).join('');
    const sel = $('#editorPick');
    sel.innerHTML = '<option value="">选择色号…</option>' +
      colors.map(c => `<option value="${c.code}">${c.code} ${c.name || ''}</option>`).join('');
  }
  fillPickers();

  // ---------- 读取参数 ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function readOpts() {
    return {
      paletteId: $('#palette').value,
      maxColors: +$('#maxColors').value,
      denoise: $('#denoise').value,
      includeSpecial: $('#special').checked,
      transparent: $('#transparent').value,
      bgRemove: $('#bgRemove').checked,
      bgTol: +$('#bgTol').value,
      fit: document.querySelector('input[name=fit]:checked').value,
      label: $('#labelType').value,
    };
  }
  function isImageFile(file) {
    if (!file) return false;
    if (/^image\/(jpe?g|png|webp)$/.test(file.type)) return true;
    return /\.(jpe?g|png|webp)$/i.test(file.name || '');
  }

  // ---------- 图片加载 ----------
  async function loadFile(file) {
    if (!isImageFile(file)) {
      alert('请上传 JPG / PNG / WEBP 图片'); return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try { await img.decode(); }
    catch (err) {
      URL.revokeObjectURL(url);
      alert('这张图片无法在浏览器里解码，请换一张 JPG / PNG / WEBP');
      return;
    }
    if (state.objUrl) URL.revokeObjectURL(state.objUrl);
    state.objUrl = url;
    state.img = img; state.imgName = file.name.replace(/\.[^.]+$/, '');
    $('#srcImg').src = url;
    $('#srcWrap').hidden = false;
    $('#srcInfo').textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}`;
    generate();
  }
  $('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

  // ---------- 生成 ----------
  function generate() {
    clearTimeout(timer);
    if (!state.img) return;
    const t0 = performance.now();
    const o = readOpts();
    const [W, H] = state.size;
    const sample = sampleGrid(state.img, W, H, o.fit);
    state.pattern = buildPattern(sample, PALETTES[o.paletteId], o);
    state.highlight = -1;
    state.selected = null;
    state.lastMs = performance.now() - t0;
    render();
    state.lastMs = performance.now() - t0; // 含绘制
    $('#statMs').textContent = state.lastMs.toFixed(0);
  }
  let timer = 0;
  const regen = () => { clearTimeout(timer); timer = setTimeout(generate, 60); };

  function render() {
    const p = state.pattern;
    if (!p) return;
    $('#empty').hidden = true; $('#result').hidden = false;
    $('#btnPng').disabled = false; $('#btnPrint').disabled = false;
    const o = readOpts();
    const cell = +$('#zoom').value;
    const margin = patternMargin(cell);
    state.viewMetrics = { cell, margin };
    const showBoards = $('#showBoards').checked;
    drawPattern($('#pattern'), p, {
      cell,
      label: state.view === 'color' ? 'none' : o.label,
      highlight: state.selected ? -1 : state.highlight,
      selected: state.selected,
      boardSize: showBoards ? 29 : 0,
    });
    const pal = PALETTES[o.paletteId];
    $('#stats').innerHTML =
      `<span>尺寸 <b>${p.W}×${p.H}</b>（${p.W * p.H} 格）</span>` +
      `<span>需拼 <b id="statBeads">${p.beadCount}</b> 颗</span>` +
      (p.emptyCount ? `<span>留空 <b id="statEmpty">${p.emptyCount}</b> 格</span>` : '<span id="statEmpty" hidden></span>') +
      `<span>用色 <b id="statColors">${p.legend.length}</b> 种</span>` +
      `<span>色板 ${pal.brand}</span>` +
      `<span>生成耗时 <b id="statMs">${state.lastMs.toFixed(0)}</b> ms</span>`;
    renderLegend(p, o.label);
    renderEditor(o.label);
    document.body.classList.toggle('editing', !!state.selected);
    renderBoards(showBoards);
    const lay = chooseLayout(p, $('#printOrient').value, $('#printCell').value, $('#printPage').value);
    let info = `打印预计：A4 ${lay.orient === 'portrait' ? '竖向' : '横向'}，每格 ${lay.cellMm} mm，图纸 ${lay.pages} 页 + 用料清单 1 页`;
    if (lay.pageMode === 'board') info += '（按拼豆板分页，每板一页）';
    else if (lay.boardFallback) info += '（按板分页放不下一页，已改回自动分页；分界仍会标出）';
    else if (showBoards) info += '（橙色虚线是 29×29 板分界）';
    $('#printInfo').textContent = info;
  }

  function renderBoards(show) {
    const box = $('#boardPanel');
    const p = state.pattern;
    if (!show || !p) { box.hidden = true; box.innerHTML = ''; return; }
    const described = boardLines(p.W, p.H, 29);
    box.hidden = false;
    box.innerHTML = `<p><b>29×29 拼豆板</b>：${described.head}。橙色虚线是板与板的分界，左上角数字是板号。</p>` +
      `<ol class="boards">` + described.lines.map(t => `<li>${t}</li>`).join('') + `</ol>`;
  }

  function renderEditor(label) {
    const ed = $('#editor');
    const sel = state.selected;
    const p = state.pattern;
    const hint = $('#legendHint');
    if (!sel || !p || sel.x < 0 || sel.y < 0 || sel.x >= p.W || sel.y >= p.H) {
      if (sel) state.selected = null;
      ed.hidden = true;
      hint.textContent = '（点击某行可高亮该颜色，再点取消）';
      return;
    }
    ed.hidden = false;
    const v = p.cells[sel.y * p.W + sel.x];
    const it = v < 0 ? null : p.legend[v];
    $('#editorPos').textContent = `第 ${sel.y + 1} 行，第 ${sel.x + 1} 列`;
    $('#editorCur').innerHTML = it
      ? `当前 <b>${it.code}</b> ${it.name || ''} ${it.hex}（序号 ${it.no}，${it.count} 颗）`
      : '当前为留空（不拼）';
    $('#editorSwatches').innerHTML = p.legend.map(sw =>
      `<button type="button" data-code="${sw.code}" title="${sw.code} ${sw.name || ''}" style="background:${sw.hex};color:${textColorFor(sw.hex)}">${label === 'no' ? sw.no : sw.code}</button>`
    ).join('');
    hint.textContent = '（正在改格子：点某一行就把当前格换成这个颜色）';
  }

  function renderLegend(p, label) {
    const tb = $('#legend tbody');
    const editing = !!state.selected;
    tb.innerHTML = p.legend.map((it, k) => {
      const sel = !editing && state.highlight === k ? 'sel' : '';
      const arm = editing ? ' arm' : '';
      return `<tr data-k="${k}" class="${sel}${arm}">` +
        `<td><span class="sw" style="background:${it.hex};color:${textColorFor(it.hex)}">${label === 'no' ? it.no : it.code}</span></td>` +
        `<td>${it.no}</td><td><b>${it.code}</b></td><td>${it.name}</td><td>${it.hex}</td><td><b>${it.count}</b></td><td>${(it.pct * 100).toFixed(1)}%</td></tr>`;
    }).join('');
    $('#legend tfoot').innerHTML = `<tr><td colspan="5">合计 ${p.legend.length} 色${p.emptyCount ? `（另有留空 ${p.emptyCount} 格）` : ''}</td><td>${p.beadCount}</td><td>${p.beadCount ? '100%' : '0%'}</td></tr>`;
  }

  function setCellColor(color) {
    const sel = state.selected;
    const p = state.pattern;
    if (!sel || !p) return;
    const hlCode = state.highlight >= 0 && p.legend[state.highlight] ? p.legend[state.highlight].code : null;
    editCell(p, sel.x, sel.y, color ? { code: color.code, name: color.name || '', hex: color.hex } : null);
    state.highlight = hlCode ? p.legend.findIndex(it => it.code === hlCode) : -1;
    $('#editorErr').hidden = true;
    render();
  }
  function applyCode(code) {
    const c = findPaletteColor(code);
    const err = $('#editorErr');
    if (!c) {
      err.hidden = false;
      err.textContent = '色板里没有色号「' + String(code || '').trim() + '」。特殊豆要先勾选「包含夜光/珠光/荧光/透明等特殊豆」。';
      return;
    }
    err.hidden = true;
    setCellColor(c);
    $('#editorCode').value = '';
    $('#editorCode').blur();
  }
  function revealEditor() {
    const ed = $('#editor');
    if (ed.hidden) return;
    if (window.matchMedia('(max-width: 860px)').matches) return;
    const r = ed.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) ed.scrollIntoView({ block: 'nearest' });
  }
  function clearSelection() {
    state.selected = null;
    $('#editorErr').hidden = true;
    render();
  }
  function scrollCellIntoView() {
    const sel = state.selected;
    const m = state.viewMetrics;
    if (!sel || !m) return;
    const box = document.querySelector('.canvas-box');
    const canvas = $('#pattern');
    const scaleX = canvas.clientWidth / canvas.width;
    const scaleY = canvas.clientHeight / canvas.height;
    const cx = (m.margin + sel.x * m.cell + m.cell / 2) * scaleX;
    const cy = (m.margin + sel.y * m.cell + m.cell / 2) * scaleY;
    let cover = 0;
    const ed = $('#editor');
    if (ed && !ed.hidden && window.matchMedia('(max-width: 860px)').matches) {
      const br = box.getBoundingClientRect();
      const er = ed.getBoundingClientRect();
      cover = Math.max(0, Math.min(br.bottom, er.bottom) - Math.max(br.top, er.top));
    }
    const viewH = Math.max(40, box.clientHeight - cover);
    if (cx < box.scrollLeft + 8 || cx > box.scrollLeft + box.clientWidth - 8 ||
        cy < box.scrollTop + 8 || cy > box.scrollTop + viewH - 8) {
      box.scrollTo({ left: Math.max(0, cx - box.clientWidth / 2), top: Math.max(0, cy - viewH / 2) });
    }
  }

  $('#legend tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const k = +tr.dataset.k;
    if (state.selected) { setCellColor(state.pattern.legend[k]); return; }
    state.highlight = state.highlight === k ? -1 : k;
    render();
  });
  $('#editorSwatches').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !state.pattern) return;
    const it = state.pattern.legend.find(x => x.code === b.dataset.code);
    if (it) setCellColor(it);
  });
  $('#editorApply').addEventListener('click', () => applyCode($('#editorCode').value));
  $('#editorCode').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyCode($('#editorCode').value); }
  });
  $('#editorPick').addEventListener('change', () => {
    const v = $('#editorPick').value;
    if (!v) return;
    applyCode(v);
    $('#editorPick').value = '';
  });
  $('#editorClear').addEventListener('click', () => setCellColor(null));
  $('#editorCancel').addEventListener('click', clearSelection);

  $('#pattern').addEventListener('click', e => {
    const p = state.pattern;
    const m = state.viewMetrics;
    if (!p || !m) return;
    const rect = e.target.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (e.target.width / rect.width);
    const y = (e.clientY - rect.top) * (e.target.height / rect.height);
    const gx = Math.floor((x - m.margin) / m.cell);
    const gy = Math.floor((y - m.margin) / m.cell);
    if (gx < 0 || gy < 0 || gx >= p.W || gy >= p.H) { clearSelection(); return; }
    if (state.selected && state.selected.x === gx && state.selected.y === gy) clearSelection();
    else { state.selected = { x: gx, y: gy }; $('#editorErr').hidden = true; render(); revealEditor(); }
  });

  document.addEventListener('keydown', e => {
    if (!state.selected || !state.pattern) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === 'Escape') { clearSelection(); return; }
    if (typing) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { setCellColor(null); e.preventDefault(); return; }
    let { x, y } = state.selected;
    if (e.key === 'ArrowLeft') x--;
    else if (e.key === 'ArrowRight') x++;
    else if (e.key === 'ArrowUp') y--;
    else if (e.key === 'ArrowDown') y++;
    else return;
    e.preventDefault();
    state.selected = { x: clamp(x, 0, state.pattern.W - 1), y: clamp(y, 0, state.pattern.H - 1) };
    render();
    scrollCellIntoView();
  });

  // ---------- 控件事件 ----------
  $('#sizePreset').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('#sizePreset').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    const v = b.dataset.size;
    $('#customSize').hidden = v !== 'custom';
    if (v !== 'custom') { state.size = v.split('x').map(Number); $('#gw').value = state.size[0]; $('#gh').value = state.size[1]; }
    else readCustom();
    regen();
  });
  function readCustom() {
    const w = clamp(Math.round(+$('#gw').value || 50), 10, 200);
    const h = clamp(Math.round(+$('#gh').value || 50), 10, 200);
    $('#gw').value = w; $('#gh').value = h;
    state.size = [w, h];
  }
  ['#gw', '#gh'].forEach(s => $(s).addEventListener('change', () => { readCustom(); regen(); }));
  $('#ratioBtn').addEventListener('click', () => {
    if (!state.img) return;
    const w = clamp(+$('#gw').value || 50, 10, 200);
    $('#gh').value = clamp(Math.round(w * state.img.naturalHeight / state.img.naturalWidth), 10, 200);
    readCustom(); regen();
  });
  function clearPresetNote() { $('#presetNote').hidden = true; }
  ['#palette', '#maxColors', '#denoise', '#special', '#transparent', '#bgRemove'].forEach(s =>
    $(s).addEventListener('change', () => {
      clearPresetNote();
      if (s === '#palette' || s === '#special') { updateSourceNote(); fillPickers(); }
      regen();
    }));
  document.querySelectorAll('input[name=fit]').forEach(r => r.addEventListener('change', () => { clearPresetNote(); regen(); }));
  $('#bgRemove').addEventListener('change', () => { $('#bgTolRow').hidden = !$('#bgRemove').checked; });
  $('#bgTol').addEventListener('input', () => { $('#bgTolVal').textContent = $('#bgTol').value; clearPresetNote(); regen(); });
  $('#btnPortrait').addEventListener('click', () => {
    $('#maxColors').value = PORTRAIT.maxColors;
    $('#denoise').value = PORTRAIT.denoise;
    $('#bgRemove').checked = true;
    $('#bgTol').value = PORTRAIT.bgTol;
    $('#bgTolVal').textContent = PORTRAIT.bgTol;
    $('#bgTolRow').hidden = false;
    const note = $('#presetNote');
    note.hidden = false;
    note.textContent = `已套用「人像优化」：${PORTRAIT.maxColors} 色、较强去杂点、去除与边缘相连的背景（容差 ${PORTRAIT.bgTol}）。`;
    regen();
  });
  $('#viewMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('#viewMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    state.view = b.dataset.view; render();
  });
  $('#labelType').addEventListener('change', render);
  function setZoom(v) {
    const z = clamp(Math.round(v), 4, 44);
    $('#zoom').value = String(z);
    $('#zoomVal').textContent = z + 'px';
    render();
  }
  $('#zoom').addEventListener('input', () => { $('#zoomVal').textContent = $('#zoom').value + 'px'; render(); });
  $('#zoomOut').addEventListener('click', () => setZoom(+$('#zoom').value - 4));
  $('#zoomIn').addEventListener('click', () => setZoom(+$('#zoom').value + 4));
  $('#zoomRead').addEventListener('click', () => setZoom(20));
  $('#zoomFit').addEventListener('click', () => {
    const p = state.pattern; if (!p) return;
    const box = document.querySelector('.canvas-box');
    const avail = Math.max(80, box.clientWidth - 2);
    let chosen = 4;
    for (let c = 44; c >= 4; c--) {
      const m = patternMargin(c);
      if (p.W * c + m * 2 <= avail) { chosen = c; break; }
    }
    setZoom(chosen);
    box.scrollTo(0, 0);
  });
  (function pinchZoom() {
    const box = document.querySelector('.canvas-box');
    let pinch = null, pending = 0;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    box.addEventListener('touchstart', e => {
      if (e.touches.length === 2) pinch = { d: dist(e.touches), z: +$('#zoom').value };
    }, { passive: true });
    box.addEventListener('touchmove', e => {
      if (!pinch || e.touches.length < 2) return;
      const z = clamp(Math.round(pinch.z * dist(e.touches) / pinch.d), 4, 44);
      if (z === +$('#zoom').value) return;
      pending = z;
      if (pending) requestAnimationFrame(() => { if (pending) { setZoom(pending); pending = 0; } });
    }, { passive: true });
    box.addEventListener('touchend', () => { pinch = null; });
    box.addEventListener('touchcancel', () => { pinch = null; });
  })();
  $('#showBoards').addEventListener('change', render);
  ['#printOrient', '#printCell', '#printPage'].forEach(s => $(s).addEventListener('change', render));

  function meta() {
    const o = readOpts();
    const pal = PALETTES[o.paletteId];
    return {
      title: '拼豆图纸' + (state.imgName ? ' · ' + state.imgName : ''),
      paletteLabel: pal.brand,
      paletteSource: pal.source,
      label: o.label,
      boardSize: $('#showBoards').checked ? 29 : 0,
    };
  }
  $('#btnPng').addEventListener('click', async () => {
    const r = await exportPNG(state.pattern, meta());
    window.__lastPng = r;
  });
  window.__preparePrint = async () => {
    const lay = buildPrint(state.pattern, meta(), $('#printOrient').value, $('#printCell').value, $('#printPage').value);
    await waitImages(document.getElementById('print-root'));
    return lay;
  };
  $('#btnPrint').addEventListener('click', async () => {
    await window.__preparePrint();
    window.print();
  });
})();
