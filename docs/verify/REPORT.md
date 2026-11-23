# 验收报告 · 照片转拼豆图纸 MVP

- 时间：2026-11-23（Asia/Taipei，UTC+8）
- 环境：盒子上的 Google Chrome 156.0.8078.47（headless，由 Playwright 驱动），视口 1440×1300
- 打开方式：`file:///workspace/bead-pattern-mvp/index.html`（不经过服务器，同时验证离线/文件协议可用）
- 脚本：`docs/verify/tools/verify.py`；原始输出：`verify_stdout.txt`、`verify_result.json`
- 测试图：`docs/fixtures/portrait_renoir_romaine_lacaux.jpg`（雷诺阿人像，公有领域，960×1206）、`docs/fixtures/cat_transparent_test.png`（自制透明背景猫头）

## 步骤与结果

| # | 步骤 | 结果 |
| --- | --- | --- |
| 1 | 打开页面，截空态 | ✅ `01_empty.png` |
| 2 | 上传人像，50×50、MARD、24 色（默认）、轻度去杂点，计时 | ✅ **页面内生成+绘制 59.6 ms；从 set_input_files 到出图的总耗时 123.8 ms**（远低于 10 秒）。24 色、2500 颗 |
| 3 | 截上传后页面、图纸全览（带编号）、放大 40px、只看颜色、图例 | ✅ `02_uploaded.png`、`03_pattern_full_labels.png`、`03b_pattern_zoom40.png`、`03c_pattern_color_only.png`、`04_legend.png` |
| 4 | 点「导出 PNG」，接收下载 | ✅ `export_50x50_mard_24.png`，2216×2830 px，约 1.0 MB，文件名「拼豆图纸_50x50_24色.png」。目视检查：编号、行列号、图例、出处页脚都清晰 |
| 5 | 打印/PDF：调用页面的打印排版后，用 Chrome 打印引擎输出 PDF（`page.pdf`，读取页面自己的 `@page` 尺寸） | ✅ `print_50x50_mard_24.pdf`，共 2 页（A4 竖向单页图纸，每格 3.7 mm + 用料清单 1 页）；转成的 PNG：`print_50x50_mard_24-1.png`、`-2.png` |
| 6 | 29×29 + Perler + 16 色 | ✅ 15.6 ms，16 色，`05_29x29_perler16.png` |
| 7 | 50×50 + MARD + 不限色 | ✅ 16.6 ms，实际用到 27 色 |
| 8 | 100×100 + MARD + 32 色，打印分页 | ✅ 生成 70.1 ms；PDF 共 9 页 = 图纸 8 页（A4 横向，每格 5 mm，每页 53 列×27 行，2×4 块）+ 用料清单 1 页。每页都有绝对行列号、本页范围和色号小图例。`print_100x100_mard_32.pdf`，转成的 PNG `print_100x100_mard_32-1.png … -9.png` |
| 9 | 200×200 + MARD + 48 色（压力测试） | ✅ 166.9 ms，去重后实际 42 色 |
| 10 | 透明 PNG，40×40，完整入画，8 色，透明=留空 | ✅ 8.1 ms，587 颗 + 1013 格留空（透明区域没有被塞成黑色），`06_transparent_cat_empty.png` |
| 11 | 控制台 error/warning | ✅ 0 条 |
| 12 | 外部网络请求（非 file/data/blob） | ✅ 0 个，图片没有离开本机 |

## 未验证

- 真实的 `window.print()` 打印对话框（headless 浏览器弹不出对话框；PDF 用同一个 Chrome 打印引擎 + 同样的 print CSS 生成，排版结果应该一致，但没有点过真实对话框）。
- 实物打印后照着拼的体验（没有打印机）。
- Safari / Firefox / 移动端浏览器。
- 拖拽上传（代码已实现，自动化测试只用了文件选择框）。
- 通过 http 静态服务器访问（只测了 file://；页面没有用到任何必须走 http 的功能）。
