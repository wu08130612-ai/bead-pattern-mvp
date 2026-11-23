"""自测：单格编辑、29×29 分板、手机视口、人像优化。Chrome + Firefox。

用法：/tmp/pwenv/bin/python docs/verify/improvements/tools/verify_improvements.py
"""
import json, pathlib, subprocess, traceback
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = ROOT / 'docs' / 'verify' / 'improvements'
FX = ROOT / 'docs' / 'fixtures'
URL = (ROOT / 'index.html').as_uri()
PORTRAIT = FX / 'portrait_renoir_romaine_lacaux.jpg'
CAT = FX / 'cat_transparent_test.png'
CHROME = '/usr/bin/google-chrome'

res = {'url': URL, 'checks': [], 'console': {}, 'external': {}}

def check(name, cond, detail=None):
    res['checks'].append({'name': name, 'ok': bool(cond), 'detail': detail})
    print(('OK ' if cond else 'FAIL'), name, detail if detail is not None else '')
    if not cond:
        raise SystemExit(1)

def shot(pg, name, **kw):
    pg.screenshot(path=str(OUT / name), **kw)

def attach(pg, bucket):
    errors, net = [], []
    pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.on('request', lambda r: net.append(r.url))
    bucket['errors'] = errors
    bucket['net'] = net
    return errors, net

def external_after(net, start):
    bad = []
    for u in net[start:]:
        if u.startswith(('file:', 'data:', 'blob:', 'about:')):
            continue
        bad.append(u)
    return bad

def click_cell(pg, x, y):
    pg.evaluate("""([x, y]) => {
      const m = window.__bead.viewMetrics;
      const box = document.querySelector('.canvas-box');
      const canvas = document.querySelector('#pattern');
      const sx = canvas.clientWidth / canvas.width;
      const sy = canvas.clientHeight / canvas.height;
      const cx = (m.margin + x * m.cell + m.cell / 2) * sx;
      const cy = (m.margin + y * m.cell + m.cell / 2) * sy;
      box.scrollLeft = Math.max(0, cx - box.clientWidth / 2);
      box.scrollTop = Math.max(0, cy - box.clientHeight / 2);
      const r = canvas.getBoundingClientRect();
      const top = r.top + cy;
      if (top < 80 || top > window.innerHeight - 120) {
        window.scrollBy(0, top - window.innerHeight / 3);
      }
    }""", [x, y])
    pos = pg.evaluate("""([x, y]) => {
      const m = window.__bead.viewMetrics;
      return { x: m.margin + x * m.cell + m.cell / 2, y: m.margin + y * m.cell + m.cell / 2 };
    }""", [x, y])
    pg.locator('#pattern').click(position={'x': pos['x'], 'y': pos['y']}, force=True)

def cell_info(pg):
    return pg.evaluate("""() => {
      const p = __bead.pattern, s = __bead.selected;
      const v = s ? p.cells[s.y * p.W + s.x] : -2;
      const it = v >= 0 ? p.legend[v] : null;
      const sum = p.legend.reduce((a, it) => a + it.count, 0);
      const pct = p.legend.reduce((a, it) => a + it.pct, 0);
      return {
        sel: s, code: it ? it.code : (v === -1 ? '' : null),
        beads: p.beadCount, empty: p.emptyCount, colors: p.legend.length,
        sum, pct, wh: p.W * p.H,
        legend: p.legend.map(it => ({code: it.code, hex: it.hex, count: it.count, pct: it.pct, no: it.no})),
      };
    }""")

def set_zoom(pg, z):
    pg.evaluate("""(z) => {
      const el = document.querySelector('#zoom');
      el.value = String(z);
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }""", z)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True)
        ctx = browser.new_context(viewport={'width': 1440, 'height': 1300}, device_scale_factor=1, accept_downloads=True)
        pg = ctx.new_page()
        errors, net = attach(pg, {})
        pg.goto(URL)
        pg.wait_for_selector('#drop')
        shot(pg, '01_desktop_empty.png')
        check('empty state', pg.locator('#empty').is_visible())
        start = len(net)
        pg.set_input_files('#file', str(PORTRAIT))
        pg.wait_for_function('window.__bead.pattern && __bead.pattern.W === 50 && __bead.pattern.H === 50')
        check('no external requests while generating', external_after(net, start) == [], external_after(net, start))
        base = cell_info(pg)
        check('default 50x50 24 colors', base['colors'] == 24 and base['beads'] == 2500 and base['empty'] == 0, base['colors'])
        shot(pg, '02_desktop_default_50.png')
        pg.click('#viewMode button[data-view=color]')
        pg.locator('#pattern').screenshot(path=str(OUT / '03_before_color.png'))
        pg.click('#viewMode button[data-view=label]')

        # --- single cell editor ---
        set_zoom(pg, 28)
        click_cell(pg, 4, 6)
        sel = cell_info(pg)
        check('cell selected', sel['sel'] == {'x': 4, 'y': 6}, sel['sel'])
        check('editor visible', pg.locator('#editor').is_visible())
        old_code = sel['code']
        check('selected cell has a code', bool(old_code), old_code)
        pg.locator('#editor').screenshot(path=str(OUT / '04_cell_editor.png'))
        pg.locator('.canvas-box').screenshot(path=str(OUT / '04b_cell_selected_canvas.png'))

        fresh = pg.evaluate("""(old) => {
          const used = new Set(__bead.pattern.legend.map(it => it.code));
          const c = window.BEAD_PALETTES.mard.colors.find(c => !c.special && c.code !== old && !used.has(c.code));
          return {code: c.code, hex: c.hex, name: c.name};
        }""", old_code)
        pg.fill('#editorCode', 'no-such-color')
        pg.click('#editorApply')
        check('invalid code rejected', pg.locator('#editorErr').is_visible())
        check('invalid code did not change cell', cell_info(pg)['code'] == old_code)

        pg.fill('#editorCode', fresh['code'])
        pg.click('#editorApply')
        edited = cell_info(pg)
        row = next(it for it in edited['legend'] if it['code'] == fresh['code'])
        old_row = next((it for it in edited['legend'] if it['code'] == old_code), None)
        old_before = next(it['count'] for it in sel['legend'] if it['code'] == old_code)
        check('cell code changed', edited['code'] == fresh['code'] and edited['sel'] == {'x': 4, 'y': 6})
        check('new color hex is the palette hex', row['hex'].lower() == fresh['hex'].lower(), row)
        check('new color count is 1', row['count'] == 1)
        check('old color count decreased', (old_row['count'] if old_row else 0) == old_before - 1, {'before': old_before, 'after': None if not old_row else old_row['count']})
        check('bead total unchanged', edited['beads'] == sel['beads'] == edited['sum'])
        check('percent sums to 1', abs(edited['pct'] - 1) < 1e-9, edited['pct'])
        check('row percent matches count', abs(row['pct'] - 1 / edited['beads']) < 1e-9)
        pg.locator('#legend').screenshot(path=str(OUT / '05_cell_changed_legend.png'))

        # legend swatch applies
        sw = edited['legend'][0]
        if sw['code'] == fresh['code']:
            sw = edited['legend'][1]
        pg.locator('#legend tbody tr').nth(sw['no'] - 1).click()
        via = cell_info(pg)
        check('legend click sets the cell', via['code'] == sw['code'], via['code'])

        # clear
        pg.click('#editorClear')
        cleared = cell_info(pg)
        check('cell cleared', cleared['code'] == '' and cleared['empty'] == 1 and cleared['beads'] == 2499)
        check('counts still balance', cleared['beads'] + cleared['empty'] == cleared['wh'] == cleared['sum'] + cleared['empty'])
        pg.locator('#editor').screenshot(path=str(OUT / '06_cell_cleared.png'))

        # set the empty cell again from the used-color swatches
        pg.locator('#editorSwatches button').first.click()
        filled = cell_info(pg)
        check('empty cell can be filled', filled['code'] != '' and filled['empty'] == 0 and filled['beads'] == 2500)

        # keyboard move + delete + esc
        pg.keyboard.press('ArrowRight')
        moved = cell_info(pg)
        check('arrow moves selection', moved['sel'] == {'x': 5, 'y': 6}, moved['sel'])
        pg.keyboard.press('Delete')
        deleted = cell_info(pg)
        check('delete clears cell', deleted['code'] == '' and deleted['empty'] == 1)
        pg.keyboard.press('Escape')
        check('escape deselects', pg.evaluate('window.__bead.selected') is None)
        check('editor hidden after escape', pg.locator('#editor').is_hidden())

        # click again, then click margin to deselect
        click_cell(pg, 5, 6)
        check('reselected', cell_info(pg)['sel'] == {'x': 5, 'y': 6})
        pg.locator('#pattern').click(position={'x': 4, 'y': 4}, force=True)
        check('margin click deselects', pg.evaluate('window.__bead.selected') is None)
        # same-cell toggle
        click_cell(pg, 8, 8)
        click_cell(pg, 8, 8)
        check('second click on same cell deselects', pg.evaluate('window.__bead.selected') is None)

        # restore a clean pattern for board shots: regen by toggling denoise back and forth
        pg.select_option('#denoise', 'light')
        pg.wait_for_function('window.__bead.pattern && __bead.pattern.emptyCount === 0 && __bead.pattern.legend.length === 24')
        set_zoom(pg, 18)
        pg.locator('#boardPanel').screenshot(path=str(OUT / '07_boards_50_panel.png'))
        pg.locator('#pattern').screenshot(path=str(OUT / '07_boards_50_pattern.png'))
        boards = pg.evaluate("""() => {
          const d = BeadRender.boardLines(50, 50, 29);
          return {head: d.head, n: d.info.count, partial: d.info.boards.filter(b => b.partial).length, lines: d.lines};
        }""")
        check('50x50 is 4 boards with 3 partial', boards['n'] == 4 and boards['partial'] == 3, boards['head'])
        check('panel lists boards', '边缘余量' in pg.locator('#boardPanel').inner_text() and '板 4' in pg.locator('#boardPanel').inner_text())

        # print by board
        pg.select_option('#printPage', 'board')
        lay = pg.evaluate('window.__preparePrint()')
        check('board print is 4 pattern pages', lay.get('pageMode') == 'board' and lay.get('pages') == 4, lay)
        heads = pg.locator('#print-root .pl-head').all_inner_texts()
        check('print header names each board', any('板 1' in h for h in heads) and any('边缘余量' in h for h in heads), heads[0] if heads else None)
        pdf = OUT / 'print_50x50_by_board.pdf'
        pg.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
        subprocess.run(['pdftoppm', '-png', '-r', '80', '-f', '1', '-l', '2', str(pdf), str(OUT / '10_print_board')], check=True)

        # 29x29 single full board
        pg.select_option('#printPage', 'auto')
        pg.click('#sizePreset button[data-size="29x29"]')
        pg.wait_for_function('__bead.pattern && __bead.pattern.W === 29 && __bead.pattern.H === 29')
        b29 = pg.evaluate("""() => {
          const d = BeadRender.boardLines(__bead.pattern.W, __bead.pattern.H, 29);
          return {head: d.head, partial: d.info.boards.filter(b => b.partial).length, n: d.info.count};
        }""")
        check('29x29 is one full board', b29['n'] == 1 and b29['partial'] == 0, b29)
        pg.locator('#boardPanel').screenshot(path=str(OUT / '08_boards_29_full.png'))

        # partial edge: 30 x 40
        pg.click('#sizePreset button[data-size="custom"]')
        pg.fill('#gw', '30'); pg.fill('#gh', '40')
        pg.dispatch_event('#gw', 'change')
        pg.wait_for_function('__bead.pattern && __bead.pattern.W === 30 && __bead.pattern.H === 40')
        part = pg.evaluate("""() => BeadRender.boardLines(30, 40, 29).info.boards.map(b => ({i:b.index,r:b.row,c:b.col,w:b.w,h:b.h,partial:b.partial}))""")
        check('30x40 has leftover boards', len(part) == 4 and part[0]['w'] == 29 and part[1]['w'] == 1 and any(b['partial'] for b in part), part)
        pg.locator('#boardPanel').screenshot(path=str(OUT / '09_boards_partial_panel.png'))
        set_zoom(pg, 16)
        pg.locator('#pattern').screenshot(path=str(OUT / '09_boards_partial_pattern.png'))

        # --- portrait preset vs default ---
        pg.click('#sizePreset button[data-size="50x50"]')
        pg.select_option('#maxColors', '24')
        pg.select_option('#denoise', 'light')
        pg.uncheck('#bgRemove')
        pg.wait_for_function('__bead.pattern && __bead.pattern.W === 50 && __bead.pattern.legend.length === 24 && __bead.pattern.emptyCount === 0')
        pg.click('#viewMode button[data-view=color]')
        set_zoom(pg, 12)
        pg.locator('#pattern').screenshot(path=str(OUT / '11_before_portrait.png'))
        before = cell_info(pg)
        pg.click('#btnPortrait')
        pg.wait_for_function('__bead.pattern && __bead.pattern.legend.length <= 16 && __bead.pattern.emptyCount > 0')
        after = cell_info(pg)
        opts = pg.evaluate("""() => ({
          max: document.querySelector('#maxColors').value,
          denoise: document.querySelector('#denoise').value,
          bg: document.querySelector('#bgRemove').checked,
          tol: document.querySelector('#bgTol').value,
          note: document.querySelector('#presetNote').textContent,
        })""")
        check('portrait preset settings', opts['max'] == '16' and opts['denoise'] == 'strong' and opts['bg'] is True and opts['tol'] == '16', opts)
        check('portrait uses fewer colors and removes background', after['colors'] <= 16 and after['colors'] < before['colors'] and after['empty'] > 200, {'before': before['colors'], 'after': after['colors'], 'empty': after['empty']})
        # face block should mostly survive
        face_empty = pg.evaluate("""() => {
          const p = __bead.pattern; let e = 0, n = 0;
          for (let y = 12; y < 28; y++) for (let x = 18; x < 34; x++) { n++; if (p.cells[y * p.W + x] < 0) e++; }
          return {e, n};
        }""")
        check('portrait keeps the face', face_empty['e'] < 30, face_empty)
        pg.locator('#pattern').screenshot(path=str(OUT / '11_after_portrait.png'))
        pg.locator('#presetNote').screenshot(path=str(OUT / '11_preset_note.png'))
        res['portrait'] = {'before': {'colors': before['colors'], 'beads': before['beads'], 'empty': before['empty']},
                           'after': {'colors': after['colors'], 'beads': after['beads'], 'empty': after['empty']},
                           'face_empty': face_empty, 'opts': opts}

        # transparent cat: set and clear an empty cell
        pg.click('#sizePreset button[data-size="custom"]')
        pg.fill('#gw', '40'); pg.fill('#gh', '40')
        pg.dispatch_event('#gw', 'change')
        pg.check('input[name=fit][value=contain]')
        pg.select_option('#transparent', 'empty')
        pg.uncheck('#bgRemove')
        pg.select_option('#maxColors', '8')
        pg.set_input_files('#file', str(CAT))
        pg.wait_for_function('__bead.pattern && __bead.pattern.W === 40 && __bead.pattern.emptyCount > 0')
        empty_at = pg.evaluate("""() => {
          const p = __bead.pattern;
          for (let i = 0; i < p.cells.length; i++) if (p.cells[i] < 0) return {x: i % p.W, y: (i / p.W) | 0, empty: p.emptyCount};
          return null;
        }""")
        set_zoom(pg, 18)
        click_cell(pg, empty_at['x'], empty_at['y'])
        check('selected an empty cell', cell_info(pg)['code'] == '', empty_at)
        # 页面滚得很深时，吸顶编辑条在 Playwright 的可见性判断里会抖；DOM click 走的是同一条点击处理。
        pg.evaluate("document.querySelector('#editorSwatches button').click()")
        filled_cat = cell_info(pg)
        check('empty cell of cat can be set', filled_cat['empty'] == empty_at['empty'] - 1 and filled_cat['code'] != '')
        mark = pg.evaluate("""() => {
          __bead.pattern._mark = 7;
          const before = {sel: __bead.selected, empty: __bead.pattern.emptyCount};
          document.querySelector('#editorClear').click();
          return {before, afterSel: __bead.selected, empty: __bead.pattern.emptyCount, mark: __bead.pattern._mark, cell0: __bead.pattern.cells[0]};
        }""")
        cleared_cat = cell_info(pg)
        check('that cell can be cleared again', mark['mark'] == 7 and mark['cell0'] < 0 and cleared_cat['empty'] == empty_at['empty'], mark)
        pg.wait_for_timeout(300)
        held = pg.evaluate('__bead.pattern._mark === 7 && __bead.pattern.cells[0] < 0')
        check('cell edit is not regenerated away', held)
        pg.keyboard.press('Escape')
        pg.locator('.canvas-box').screenshot(path=str(OUT / '12_cat_empty.png'))

        res['console']['chrome_desktop'] = list(errors)
        check('chrome desktop console clean', errors == [], errors)
        ctx.close()

        # --- mobile viewport (Chrome, not a real phone) ---
        mctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mpg = mctx.new_page()
        merr, mnet = attach(mpg, {})
        mpg.goto(URL)
        mpg.set_input_files('#file', str(PORTRAIT))
        mpg.wait_for_function('__bead.pattern && __bead.pattern.W === 50')
        overflow = mpg.evaluate("""() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          btn: document.querySelector('#btnPortrait').getBoundingClientRect().height,
        })""")
        check('mobile page does not scroll sideways', overflow['scrollW'] <= overflow['clientW'] + 1, overflow)
        check('mobile button is at least 44px', overflow['btn'] >= 44, overflow)
        shot(mpg, '13_mobile_layout.png', full_page=True)
        mpg.locator('#drop').screenshot(path=str(OUT / '13_mobile_upload.png'))
        set_zoom(mpg, 20)
        wide = mpg.evaluate("""() => {
          const box = document.querySelector('.canvas-box');
          const canvas = document.querySelector('#pattern');
          return {box: box.clientWidth, canvas: canvas.width, scroll: box.scrollWidth > box.clientWidth + 2};
        }""")
        check('mobile pattern pans inside the canvas box', wide['scroll'] and wide['canvas'] > wide['box'], wide)
        mpg.click('#zoomFit')
        fitted = mpg.evaluate("""() => {
          const box = document.querySelector('.canvas-box');
          const canvas = document.querySelector('#pattern');
          return {box: box.clientWidth, canvas: canvas.clientWidth, zoom: +document.querySelector('#zoom').value};
        }""")
        check('overview fits the pattern width', fitted['canvas'] <= fitted['box'] + 2, fitted)
        mpg.locator('.canvas-box').screenshot(path=str(OUT / '14_mobile_zoom_fit.png'))
        mpg.click('#zoomRead')
        click_cell(mpg, 3, 3)
        check('mobile editor open', mpg.locator('#editor').is_visible())
        editor_box = mpg.locator('#editor').bounding_box()
        check('mobile editor sits at the bottom', editor_box and editor_box['y'] > 200 and editor_box['y'] + editor_box['height'] > 700, editor_box)
        mpg.screenshot(path=str(OUT / '14_mobile_editor.png'))
        # pinch-less zoom buttons
        z0 = int(mpg.locator('#zoom').input_value())
        mpg.click('#zoomIn')
        check('zoom in works', int(mpg.locator('#zoom').input_value()) == min(44, z0 + 4))
        res['console']['chrome_mobile'] = list(merr)
        check('chrome mobile console clean', merr == [], merr)
        mctx.close()

        # a second narrow viewport, landscape-ish phone width already done; try 360 and a short height
        sctx = browser.new_context(viewport={'width': 360, 'height': 700}, device_scale_factor=1, is_mobile=True, has_touch=True)
        spg = sctx.new_page()
        serr, _ = attach(spg, {})
        spg.goto(URL)
        spg.set_input_files('#file', str(PORTRAIT))
        spg.wait_for_function('__bead.pattern && __bead.pattern.W === 50')
        ov = spg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')
        check('360px width does not overflow', ov)
        spg.screenshot(path=str(OUT / '15_mobile_360.png'), full_page=False)
        res['console']['chrome_360'] = list(serr)
        check('360px console clean', serr == [], serr)
        sctx.close()
        browser.close()

        # --- Firefox (desktop). Not Safari, not a real phone. ---
        fb = p.firefox.launch(headless=True)
        fctx = fb.new_context(viewport={'width': 1280, 'height': 900})
        fpg = fctx.new_page()
        ferr, fnet = attach(fpg, {})
        fpg.goto(URL)
        fstart = len(fnet)
        fpg.set_input_files('#file', str(PORTRAIT))
        fpg.wait_for_function('window.__bead.pattern && __bead.pattern.W === 50')
        check('firefox generate has no external requests', external_after(fnet, fstart) == [], external_after(fnet, fstart))
        set_zoom(fpg, 22)
        click_cell(fpg, 2, 2)
        check('firefox can select a cell', fpg.evaluate('window.__bead.selected && __bead.selected.x === 2'))
        code = fpg.evaluate("""() => {
          const p = __bead.pattern, s = __bead.selected;
          const v = p.cells[s.y * p.W + s.x];
          return v < 0 ? '' : p.legend[v].code;
        }""")
        other = fpg.evaluate("""(cur) => window.BEAD_PALETTES.mard.colors.find(c => !c.special && c.code !== cur).code""", code)
        fpg.fill('#editorCode', other)
        fpg.click('#editorApply')
        check('firefox can recolor a cell', fpg.evaluate("""(code) => {
          const p = __bead.pattern, s = __bead.selected;
          const v = p.cells[s.y * p.W + s.x];
          return p.legend[v].code === code;
        }""", other))
        fpg.click('#btnPortrait')
        fpg.wait_for_function("__bead.pattern && __bead.pattern.emptyCount > 0 && document.querySelector('#maxColors').value === '16'")
        fpg.screenshot(path=str(OUT / '16_firefox_portrait.png'))
        res['console']['firefox'] = list(ferr)
        check('firefox console clean', ferr == [], ferr)
        fb.close()

    # side-by-side before/after
    a = Image.open(OUT / '11_before_portrait.png').convert('RGB')
    b = Image.open(OUT / '11_after_portrait.png').convert('RGB')
    h = max(a.height, b.height)
    canvas = Image.new('RGB', (a.width + b.width + 24, h + 36), 'white')
    canvas.paste(a, (0, 36))
    canvas.paste(b, (a.width + 24, 36))
    draw = ImageDraw.Draw(canvas)
    draw.text((8, 8), '默认 24 色 · 轻度去杂点', fill=(0, 0, 0))
    draw.text((a.width + 32, 8), '人像优化 16 色 · 较强去杂点 · 去背景', fill=(180, 50, 0))
    canvas.save(OUT / '11_before_after.png')

    (OUT / 'verify_result.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print('WROTE', OUT / 'verify_result.json')

if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        (OUT / 'verify_result.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
        raise
    except Exception:
        traceback.print_exc()
        (OUT / 'verify_result.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
        raise
