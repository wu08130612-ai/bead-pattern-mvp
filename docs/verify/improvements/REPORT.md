# 改进项自测（2026-11-23）

脚本：`docs/verify/improvements/tools/verify_improvements.py`  
环境：本机 headless Chrome（`/usr/bin/google-chrome`）和 Playwright Firefox。页面用 `file://` 打开仓库根目录的 `index.html`。控制台 error / warning 为空。生成图纸期间没有发往外部主机的请求（只有 `file:` / `data:` / `blob:`）。

机器可读结果：`verify_result.json`。

## 线上地址

- 仓库：https://github.com/wu08130612-ai/bead-pattern-mvp
- 预期 Pages：https://wu08130612-ai.github.io/bead-pattern-mvp/
- 2026-11-23 实测该 URL **HTTP 404**（约 0.06 秒返回 GitHub 的 404 页）。`GET /repos/wu08130612-ai/bead-pattern-mvp/pages` 也是 404，站点还没创建。
- 因此「打开线上页、上传雷诺阿、生成 50×50、确认生成时没有外网请求」**没有在线上做**。本地 `file://` 做了同样三件事，通过。

Pages 没能打开的原因：创建站点需要 `administration:write` 和 `pages:write`。Actions 的 `GITHUB_TOKEN` 没有 `administration`。工作流运行：

- https://github.com/wu08130612-ai/bead-pattern-mvp/actions/runs/45137327589 失败（站点不存在，`configure-pages` 默认不创建）
- https://github.com/wu08130612-ai/bead-pattern-mvp/actions/runs/45137987994 失败（`enablement: true` 去创建站点，返回 `Resource not accessible by integration`）

分支源（Settings 里选 Deploy from branch `main` / `/`）同样需要这项权限，这个环境设不了。工作流已改回不带 `enablement`。仓库所有者需要自己在 **Settings → Pages** 里选一次 **GitHub Actions**（或 Deploy from a branch：`main` / root）。选好之后，再跑 `.github/workflows/pages.yml` 就会把根目录发出去。成功发布要多久，这次没测到。

## 1. 单格编辑

雷诺阿图，默认 50×50、MARD、24 色。点第 7 行第 5 列（0 起算 4,6），原色号 M15（736 颗）。

- 无效色号被拒绝，格子不变。
- 改成色板里的 A1：A1 为 1 颗、占比 0.04%，M15 变为 735，合计仍是 2500，占比之和为 1。
- 点图例把该格改回 M15。清空后留空 1、需拼 2499。再填回后合计恢复。
- 方向键移动选区，Delete 留空，Esc、点图纸空白、再点同一格都能取消选择。
- 透明猫头（40×40，完整入画）的留空格可以填上再清掉。清掉之后等 300ms，格子仍是留空，没有被防抖重算盖掉。

截图：

- `04_cell_editor.png` 编辑条
- `04b_cell_selected_canvas.png` 选中格
- `05_cell_changed_legend.png` 改色后的图例（A1 × 1，M15 × 735，合计 2500）
- `06_cell_cleared.png` 设为留空
- `03_before_color.png` 改色前的格子
- `12_cat_empty.png` 透明图留空格

## 2. 29×29 拼豆板

- 50×50：2 行 × 2 列，共 4 块，其中 3 块是边缘余量。`07_boards_50_panel.png`、`07_boards_50_pattern.png`（橙色虚线，左上角板号）。
- 29×29：1 块整板。`08_boards_29_full.png`。
- 30×40：板 2 只有 1 列宽，板 3 高 11，板 4 是 1×11。`09_boards_partial_panel.png`、`09_boards_partial_pattern.png`。
- 打印选「按拼豆板」：50×50 得到 4 张图纸页（竖向、每格 6 mm）加用料清单。页眉写明「板 1（第 1 行第 1 列，整板）」和列 1–29、行 1–29。`print_50x50_by_board.pdf`，`10_print_board-1.png`，`10_print_board-2.png`。

## 3. 手机视口和 Firefox

Chrome 视口，不是真机，也不是 Safari。

- 390×844、deviceScaleFactor 2：页面没有横向溢出；「人像优化」按钮高 44px；图案比可视区域宽，可以在图纸框里平移；「总览」把 50 列收到 6px/格（画布 336px，框 340px）。`13_mobile_layout.png`，`13_mobile_upload.png`，`14_mobile_zoom_fit.png`。
- 点第 4 行第 4 列后，编辑条固定在屏幕底部（上沿约 y=438，高约 388），图案仍露在上面，选中格有框。`14_mobile_editor.png`。
- 360×700 同样没有横向溢出。`15_mobile_360.png`。
- 桌面 Firefox：上传生成没有外网请求；能选中格子并改色号；套用人像优化。控制台干净。`16_firefox_portrait.png`。

## 4. 人像优化

同一张雷诺阿，50×50，MARD。

| | 颜色数 | 需拼 | 留空 |
| --- | --- | --- | --- |
| 默认（24 色、轻度去杂点、不去背景） | 24 | 2500 | 0 |
| 人像优化（16 色、较强去杂点、边缘泛洪容差 16） | 16 | 1441 | 1059 |

脸部区域（第 13–28 行、第 19–34 列，共 256 格）只空了 4 格。对照图：`11_before_portrait.png`、`11_after_portrait.png`、`11_before_after.png`、`11_preset_note.png`。

## 已验证

- 本地打开、上传夹具人像、生成 50×50，生成过程无外网请求（Chrome 与 Firefox）。
- 单格改色、留空、图例/色块/键盘、颗数和占比即时更新，编辑不会被随后的一次重算冲掉。
- 29×29 板号、边缘余量、按板分页的页眉。
- Chrome 390 和 360 宽的布局、总览、平移、底部编辑条；桌面 Firefox 的选格、改色、人像优化。
- 上述浏览器控制台无 error / warning。

## 未验证

- **Safari**（这个环境没有）。
- **真机**（没有手机；上面是 Chrome 的手机视口）。
- **系统打印对话框**（没有点「打印」。分页检查的是页面写进 `#print-root` 的 DOM，以及由它导出的 PDF 前两页）。
- **线上 Pages**：地址仍是 404，所以没有在 https://wu08130612-ai.github.io/bead-pattern-mvp/ 上重复「打开、上传、生成、无外网请求」。
