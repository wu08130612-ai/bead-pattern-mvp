/**
 * app.js —— 界面逻辑：读取参数、加载图片、生成图纸、显示图例、触发导出
 * 图片用 FileReader/createImageBitmap 在本地解码，不发起任何网络请求。
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const { sampleGrid, buildPattern } = window.BeadQuantize;
  const { drawPattern } = window.BeadRender;
  const { exportPNG, buildPrint, chooseLayout, waitImages } = window.BeadExport;
  const { textColorFor } = window.BeadColor;
  const PALETTES = window.BEAD_PALETTES;

  const state = {
    img: null, imgName: '', size: [50, 50], view: 'label', highlight: -1,
    pattern: null, lastMs: 0,
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

  // ---------- 图片加载 ----------
  async function loadFile(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      alert('请上传 JPG / PNG / WEBP 图片'); return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    state.img = img; state.imgName = file.name.replace(/\.[^.]+$/, '');
    $('#srcImg').src = url;
    $('#srcWrap').hidden = false;
    $('#srcInfo').textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}`;
    generate();
  }
  $('#file').addEventListener('change', e => loadFile(e.target.files[0]));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('#file').click(); });

  // ---------- 生成 ----------
  function generate() {
    if (!state.img) return;
    const t0 = performance.now();
    const o = readOpts();
    const [W, H] = state.size;
    const sample = sampleGrid(state.img, W, H, o.fit);
    state.pattern = buildPattern(sample, PALETTES[o.paletteId], o);
    state.highlight = -1;
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
    drawPattern($('#pattern'), p, { cell, label: state.view === 'color' ? 'none' : o.label, highlight: state.highlight });
    const pal = PALETTES[o.paletteId];
    $('#stats').innerHTML =
      `<span>尺寸 <b>${p.W}×${p.H}</b>（${p.W * p.H} 格）</span>` +
      `<span>需拼 <b>${p.beadCount}</b> 颗</span>` +
      (p.emptyCount ? `<span>留空 <b>${p.emptyCount}</b> 格</span>` : '') +
      `<span>用色 <b>${p.legend.length}</b> 种</span>` +
      `<span>色板 ${pal.brand}</span>` +
      `<span>生成耗时 <b id="statMs">${state.lastMs.toFixed(0)}</b> ms</span>`;
    renderLegend(p, o.label);
    const lay = chooseLayout(p, $('#printOrient').value, $('#printCell').value);
    $('#printInfo').textContent = `打印预计：A4 ${lay.orient === 'portrait' ? '竖向' : '横向'}，每格 ${lay.cellMm} mm，图纸 ${lay.pages} 页 + 用料清单 1 页`;
  }

  function renderLegend(p, label) {
    const tb = $('#legend tbody');
    tb.innerHTML = p.legend.map((it, k) =>
      `<tr data-k="${k}" class="${state.highlight === k ? 'sel' : ''}">` +
      `<td><span class="sw" style="background:${it.hex};color:${textColorFor(it.hex)}">${label === 'no' ? it.no : it.code}</span></td>` +
      `<td>${it.no}</td><td><b>${it.code}</b></td><td>${it.name}</td><td>${it.hex}</td><td><b>${it.count}</b></td><td>${(it.pct * 100).toFixed(1)}%</td></tr>`
    ).join('');
    $('#legend tfoot').innerHTML = `<tr><td colspan="5">合计 ${p.legend.length} 色${p.emptyCount ? `（另有留空 ${p.emptyCount} 格）` : ''}</td><td>${p.beadCount}</td><td>100%</td></tr>`;
  }
  $('#legend tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const k = +tr.dataset.k;
    state.highlight = state.highlight === k ? -1 : k;
    render();
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
  ['#palette', '#maxColors', '#denoise', '#special', '#transparent', '#bgRemove'].forEach(s =>
    $(s).addEventListener('change', () => { if (s === '#palette') updateSourceNote(); regen(); }));
  document.querySelectorAll('input[name=fit]').forEach(r => r.addEventListener('change', regen));
  $('#bgRemove').addEventListener('change', () => { $('#bgTolRow').hidden = !$('#bgRemove').checked; });
  $('#bgTol').addEventListener('input', () => { $('#bgTolVal').textContent = $('#bgTol').value; regen(); });
  $('#viewMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('#viewMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    state.view = b.dataset.view; render();
  });
  $('#labelType').addEventListener('change', render);
  $('#zoom').addEventListener('input', () => { $('#zoomVal').textContent = $('#zoom').value + 'px'; render(); });
  ['#printOrient', '#printCell'].forEach(s => $(s).addEventListener('change', render));

  function meta() {
    const o = readOpts();
    const pal = PALETTES[o.paletteId];
    return { title: '拼豆图纸' + (state.imgName ? ' · ' + state.imgName : ''), paletteLabel: pal.brand,
      paletteSource: pal.source, label: o.label };
  }
  $('#btnPng').addEventListener('click', async () => {
    const r = await exportPNG(state.pattern, meta());
    window.__lastPng = r;
  });
  // 供打印/自动化：先排版，等图片解码完再调用打印
  window.__preparePrint = async () => {
    const lay = buildPrint(state.pattern, meta(), $('#printOrient').value, $('#printCell').value);
    await waitImages(document.getElementById('print-root'));
    return lay;
  };
  $('#btnPrint').addEventListener('click', async () => {
    await window.__preparePrint();
    window.print();
  });
})();
