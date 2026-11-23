"""验收脚本：Playwright + 本机 Google Chrome，以 file:// 打开 index.html 跑完整流程。
用法：/workspace/pwenv/bin/python docs/verify/tools/verify.py
"""
import json, time, pathlib, subprocess
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
V = ROOT / 'docs' / 'verify'
FX = ROOT / 'docs' / 'fixtures'
URL = (ROOT / 'index.html').as_uri()
res = {'url': URL, 'steps': []}
def log(k, v): res['steps'].append({k: v}); print(k, v)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True)
    ctx = b.new_context(viewport={'width': 1440, 'height': 1300}, accept_downloads=True, device_scale_factor=1)
    pg = ctx.new_page()
    errors, netreq = [], []
    pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.on('request', lambda r: netreq.append(r.url) if not r.url.startswith(('file:', 'data:', 'blob:')) else None)
    pg.goto(URL)
    pg.screenshot(path=str(V / '01_empty.png'), full_page=True)

    # 上传 + 50×50 + 24 色（默认），计时
    t0 = time.perf_counter()
    pg.set_input_files('#file', str(FX / 'portrait_renoir_romaine_lacaux.jpg'))
    pg.wait_for_selector('#result:not([hidden])')
    pg.wait_for_function('window.__bead.pattern && window.__bead.pattern.W === 50')
    wall = (time.perf_counter() - t0) * 1000
    info = pg.evaluate('({ms: window.__bead.lastMs, W: __bead.pattern.W, H: __bead.pattern.H, colors: __bead.pattern.legend.length, beads: __bead.pattern.beadCount})')
    log('50x50_24色_出图', {'页面内生成+绘制ms': round(info['ms'], 1), '含上传解码的总耗时ms': round(wall, 1), **info})
    pg.screenshot(path=str(V / '02_uploaded.png'), full_page=False)
    pg.locator('.canvas-box canvas').screenshot(path=str(V / '03_pattern_full_labels.png'))
    pg.locator('#legend').screenshot(path=str(V / '04_legend.png'))
    # 放大看编号
    pg.fill('#zoom', '40'); pg.dispatch_event('#zoom', 'input')
    pg.locator('.canvas-box').screenshot(path=str(V / '03b_pattern_zoom40.png'))
    pg.fill('#zoom', '20'); pg.dispatch_event('#zoom', 'input')
    # 只看颜色
    pg.click('#viewMode button[data-view=color]')
    pg.locator('.canvas-box canvas').screenshot(path=str(V / '03c_pattern_color_only.png'))
    pg.click('#viewMode button[data-view=label]')

    # 导出 PNG
    with pg.expect_download() as dl:
        pg.click('#btnPng')
    d = dl.value
    out = V / 'export_50x50_mard_24.png'
    d.save_as(str(out))
    log('导出PNG', {'文件': str(out), '建议文件名': d.suggested_filename, '尺寸': pg.evaluate('window.__lastPng')})

    # 打印 / PDF
    lay = pg.evaluate('window.__preparePrint()')
    pdf = V / 'print_50x50_mard_24.pdf'
    pg.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
    log('打印PDF_50x50', {'布局': lay, '文件': str(pdf)})

    # 其他组合：耗时
    def run(size, colors, palette='mard', fit='cover', fixture='portrait_renoir_romaine_lacaux.jpg', extra=None):
        pg.select_option('#palette', palette)
        pg.select_option('#maxColors', str(colors))
        pg.check(f'input[name=fit][value={fit}]')
        if size in ('29x29', '50x50'):
            pg.click(f'#sizePreset button[data-size="{size}"]')
        else:
            pg.click('#sizePreset button[data-size=custom]')
            w, h = size.split('x'); pg.fill('#gw', w); pg.fill('#gh', h)
            pg.dispatch_event('#gw', 'change'); pg.dispatch_event('#gh', 'change')
        if extra: extra()
        pg.set_input_files('#file', str(FX / fixture))
        W, H = map(int, size.split('x'))
        pg.wait_for_timeout(400)
        pg.wait_for_function(f'__bead.pattern && __bead.pattern.W === {W} && __bead.pattern.H === {H}')
        r = pg.evaluate('({ms: __bead.lastMs, colors: __bead.pattern.legend.length, beads: __bead.pattern.beadCount, empty: __bead.pattern.emptyCount})')
        return r
    log('29x29_Perler_16色', run('29x29', 16, 'perler'))
    pg.locator('.canvas-box canvas').screenshot(path=str(V / '05_29x29_perler16.png'))
    log('50x50_Mard_不限色', run('50x50', 0))
    log('100x100_Mard_32色', run('100x100', 32))
    lay = pg.evaluate('window.__preparePrint()')
    pg.pdf(path=str(V / 'print_100x100_mard_32.pdf'), prefer_css_page_size=True, print_background=True)
    log('打印PDF_100x100', {'布局': lay})
    log('200x200_Mard_48色', run('200x200', 48))
    # 透明背景测试图：完整入画 + 透明留空
    log('透明PNG_40x40_contain_8色', run('40x40', 8, 'mard', 'contain', 'cat_transparent_test.png'))
    pg.locator('.canvas-box canvas').screenshot(path=str(V / '06_transparent_cat_empty.png'))

    res['console_errors_warnings'] = errors
    res['external_requests'] = netreq
    print('console:', errors); print('external requests:', netreq)
    b.close()

json.dump(res, open(V / 'verify_result.json', 'w'), ensure_ascii=False, indent=1)
for f in ['print_50x50_mard_24', 'print_100x100_mard_32']:
    subprocess.run(['pdftoppm', '-png', '-r', '110', str(V / f'{f}.pdf'), str(V / f)], check=True)
    print(f, subprocess.run(['pdfinfo', str(V / f'{f}.pdf')], capture_output=True, text=True).stdout.split('Pages:')[1].split('\n')[0].strip(), 'pages')
