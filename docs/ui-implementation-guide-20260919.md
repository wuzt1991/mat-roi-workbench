# 地垫工作台 UI 确定版：施工与验收步骤

按本指南接手时，先运行冻结基准，再迁移视觉层，最后逐项验收。目标只有 **默认侧光剧场、日间 02C 月白、两个主题共同使用微星粒子拖尾**。详细颜色、尺寸、算法和动效时序见 [确定版规格](ui-approved-spec-20260919.md)，不需要重新选风格或重新访问参考站设计一遍。

本指南对应 `ui-approved-20260919-v1`。冻结目录是交接基准，不是正式产品的源码入口。2026-09-19 的本轮工作只整理文档与基准包，尚未将外观接入 `public/index.html`。

## 1. 先校验交接基准

所有命令在 `roi-workbench` 项目根目录运行。需要 Python 3；语法检查另需 Node.js，项目声明 Node.js ≥24。

1. 阅读 [规格第 1、3、4、10、11、14 节](ui-approved-spec-20260919.md)，确认最终方案、依赖顺序、主题状态、动效和正式集成边界。
2. 检查当前工作区修改，保留其他会话的业务工作。不要整体还原 `public/`，不要更新冻结文件以消除差异。
3. 校验随文源码、资源和截图完整性：

```bash
python3 docs/ui-approved-20260919/verify.py
```

正常输出包含 `36 frozen source/assets files`、`16 evidence files` 和本地 HTML/CSS 依赖通过。失败时按输出定位缺失或变动文件，先恢复交接包完整性，再施工。

如需检查当前 `public/` 是否偏离交接基准，运行：

```bash
python3 docs/ui-approved-20260919/verify.py --compare-live
```

这条命令只读；返回 1 表示存在差异，不代表当前业务改动应被撤销。阅读差异后决定适配方式，保留原冻结包与其 SHA-256。

## 2. 启动独立参考页

从项目根目录启动只监听本机的静态服务：

```bash
python3 -m http.server 4193 --bind 127.0.0.1 --directory docs/ui-approved-20260919/reference/public
```

服务保持在该终端运行；结束时 Ctrl-C。端口被占用时选另一个空闲端口，并同步修改下面地址。不同端口是不同存储源，可将参考页与当前 `4192` 预览隔离。

| 入口 | 用途 |
|---|---|
| [带工具栏参考页](http://127.0.0.1:4193/ui-refinement-preview.html) | 开关总动效；主题按钮在内部工作台右上角 |
| [直接工作台参考页](http://127.0.0.1:4193/ui-refinement-frame.html) | 核对实际产品区域；拍摄截图使用这个入口 |

先在两模式下实际移动鼠标、观察光影、打开店铺菜单与新增店铺弹窗。静态图片无法验证真实流动或拖尾消散。对照图见 [证据目录清单](ui-approved-20260919/evidence/manifest.json)，规格第 13 节有逐图链接。

参考数据由 `ReviewModel.seed()` 初始化，草稿键为 `mat-workbench-ui-study-20260918`。`ui-refinement-sandbox.js` 只隔离业务草稿，主题和总动效键仍按同源共享。用新端口或独立浏览器资料运行；不要执行 `localStorage.clear()`，不要清空用户正式草稿来凑出示例数据。

只需原样复现独立预览时，将整个 `reference/public/` 放在静态服务下并保持相对路径即可。不需要安装 React、OGL、Three.js 或 GSAP。

## 3. 核对正式宿主接口

正式集成前，阅读当前 `public/index.html` 及业务渲染脚本，确认真实目标入口。冻结预览使用 `review-20260918.js`，正式入口当前使用 `app.js` 和 `persistence.js` 等，两者不能互相覆盖。主界面相似也不代表事件和选择器完全相同。

记录下表映射后再写适配。优先沿用现有 DOM；只补视觉需要的语义 class 或精确选择器，不改业务层次与控件占位。

| 视觉模块依赖 | 正式宿主需核对的接口 |
|---|---|
| 根状态 | `document.documentElement.dataset`、`meta[name="color-scheme"]` |
| 主题按钮 | `.topbar-right`、`#app`、唯一 `#ui-mode-toggle` |
| 外层面板 | `.plan-overview .main-column`、`.parameter-rail`、`.plan-detail-card`、`.wide-content` |
| 指标 / 表格 | `.metric-grid`、`.metric`、`.table-scroll`；包括固定首尾列、奇偶行与编辑态 |
| 菜单 / 弹窗 | `.sidebar-picker-menu`、`data-placement="above"`、`#dialog`、遮罩及页脚 |
| 主动导航 | `data-action="nav"` / `tab` / `library-tab`，动画目标 `#main-content` |
| 展开设置 | `data-action="sku-options"`、点击前 `aria-expanded="false"`、目标 `#sku-options:not([hidden])` |
| 粒子避让 | `input,textarea,select,[contenteditable="true"],dialog,[role="dialog"]`；宿主新增编辑控件需映射 |
| 根节点重绘 | 当前观察 `#app` 直接子节点；宿主使用深层局部重绘时，应在对应渲染结束处补调用 |

主题按钮更新函数目前是模块内部函数；如需显式渲染钩子，只做最小适配并记录差异，不假设存在未导出的 API。每次业务重绘后按钮仍须只有一个。

宿主中 `update.css`、其他后加载样式、内联样式、`:nth-child()` 和 `!important` 都可能覆盖主题。先查 computed style，不盲目提高整个样式表的优先级。正式页有更新提示及其他预览未展示的控件，需补齐两主题状态并单独记录验收。

## 4. 迁移视觉文件与加载顺序

迁移冻结清单中 `role: visual` 的八个文件，另保留 `public/licenses/react-bits-side-rays.txt`：

| 文件 | 集成要求 |
|---|---|
| `ui-appearance.js` | head 同步执行，早于首屏样式和内容，避免闪白 |
| `ui-refinement.css` | 通用精修覆盖层 |
| `ui-material-studies.css` | 通用层之后加载，保留最终覆盖顺序 |
| `ui-side-rays.js` | 原样复用 GLSL、uniform 和 WebGL 封装 |
| `ui-material-studies.js` | Side Rays 后加载，管理背景启停 |
| `ui-cursor-trails.css` | 材质层之后加载 |
| `ui-cursor-trails.js` | 一页初始化一次，不在每次业务 render 时重新加载 |
| `ui-refinement-motion.js` | 业务脚本之后加载，保留捕获阶段识别意图、下一帧播放的顺序 |

已有同名文件时先比较，不直接覆盖其他会话的新改动。通过 [冻结清单](ui-approved-20260919/reference/manifest.json) 的哈希定位原始版本，适配代码放在产品目录，冻结包保持不动。

以下是插入顺序示意，宿主自己的样式与脚本仍按原顺序保留：

```html
<!-- head：保留并更新现有 meta，不重复创建 -->
<meta name="color-scheme" content="dark">
<script src="ui-appearance.js"></script>

<!-- 宿主已有 CSS 之后 -->
<link rel="stylesheet" href="ui-refinement.css">
<link rel="stylesheet" href="ui-material-studies.css">
<link rel="stylesheet" href="ui-cursor-trails.css">

<!-- 宿主已有业务 defer 脚本之后，保持以下相对顺序 -->
<script src="ui-side-rays.js" defer></script>
<script src="ui-material-studies.js" defer></script>
<script src="ui-cursor-trails.js" defer></script>
<script src="ui-refinement-motion.js" defer></script>
```

完整预览以 [冻结 HTML](ui-approved-20260919/reference/public/ui-refinement-frame.html) 为准。正式宿主没有 `review-20260918.css` 时，逐条核对它提供的有效布局与视觉条件，仅补充适用规则；不能为对齐预览而整体替换正式布局或引入复核原型的业务专用 CSS。

不要把预览 iframe、外层工具栏、sandbox、ReviewModel、示例数据、“修改复核原型”文案和旧拖尾选择器带入产品。当前批准的产品入口是右上角模式按钮；总动效控制已有 API，当前可见开关在预览工具栏。正式软件若有外观设置入口，可连接 `UiAppearance.setMotion()`；若没有，不自行增加工具栏改变布局，将该入口位置列为后续产品决定。主题切换能独立迁移。

## 5. 接通状态并核对最终参数

以 `UiAppearance` 为唯一状态来源。无偏好时 `rays + motion=true`；只有已存 `day` 恢复月白，只有动效键为字符串 `false` 时关闭。保持现有两个存储键，不读取旧拖尾选择键，不根据系统深浅色或机器快慢自行改主题。

按钮显示目标：“日间模式”或“侧光模式”。切换不刷新、不跳页、不丢输入，不触发业务重算。两主题的 `data-ui-cursor-trail` 都是 `spark`；`data-ui-pearl-motion="none"` 只关旧面板跟随。

| 类别 | 必须保留的检查点；完整值见规格 |
|---|---|
| 侧光 | speed 2.5、intensity 3.2、spread 2、falloff .85；右上光源；`#EAB308` / `#96C8FF` |
| 月白 | `pearl + moon`；base `#eef0f3`；accent `#58667b`；不恢复粉紫、冰青或雾绿方案 |
| 圆角 | 外层侧光 16px / 月白 18px；指标侧光 12px / 月白 14px |
| 粒子 | 272px 局部画布、64 点、6px 采样、108px 路径范围、420ms 消散、指针中心 7px 留空 |
| 微动效 | 按下 110ms、箭头 160ms、菜单 180ms、弹窗 220ms、导航/展开 180ms；指定 easing |
| 材质 | 正常侧光面板 blur 20px；月白主体无 blur；菜单/弹窗及遮罩规则分别保留 |
| 性能 | RAF 跟设备刷新率；背景 DPR 上限 2、粒子原生 DPR；不加默认限帧或自动降档 |
| 结构 | 保留业务区域、字号、间距、控件尺寸；不恢复蓝色导航左条、大面积面板鼠标反光 |

不以“颜色接近”为理由重写 shader，不把粒子改为 DOM 列表，不用大型光晕替代局部拖尾，也不把状态动画加到每次数据 render 上。

## 6. 验收静态外观、真实动效与业务交互

### 6.1 复拍静态基准

1. 在独立测试源使用内置示例数据，确认数值与规格第 13 节一致。
2. 打开带工具栏参考页，关闭总动效。选择主题后打开直接 frame 并重新加载，使侧光 `elapsed=0`，不能截取任意暂停时刻。
3. 视口设为 1440×1000 CSS px、缩放 100%，待字体加载完成，滚动到顶部。保持相同浏览器、DPR、字体与焦点/hover 状态。
4. 分别拍摄主界面、店铺菜单展开、新增店铺弹窗；弹窗不保存，取消退出。
5. 视口设为 390×844 CSS px，拍摄窄屏主界面；结束后恢复视口。
6. 比较矩形与 computed style，定位具体差异；正式宿主的业务数据不同，不应硬改为示例内容。

截图是工具输出的 JPEG，存在压缩误差，不能要求与渲染图每个像素相等。尺寸与样式优先核对同名 JSON、冻结 CSS 和规格，必要时在同环境重新抓取两份无损图比较。记录系统和 GPU 差异，不增加 CSS 偏移掩盖字体渲染差异。

JSON 的 `geometry` 覆盖 `#app` 内有非零尺寸的元素，包含视口外内容，不含 app 外菜单/弹窗，不是可见元素数量审计。两主题 SVG 图标子元素不同，不能仅凭元素数不同判定布局改变。

旧文档 382/328 个元素零误差属于历史轮次，不是当前或正式入口验收。本轮截图如实保留窄屏大金额换行；另做移动排版优化时，需独立记录变更。

### 6.2 验证动效及启停

静态对照后重新打开总动效。每项记录“通过 / 未通过 / 未测”，不能把源码检查当作目标设备的流畅性测试。

| 验收动作 | 通过标准 |
|---|---|
| 新测试源首次打开 | 默认侧光；背景随时间流动；按钮写“日间模式” |
| 切换、刷新、再次打开 | 记住主题和总动效；不闪白、不跳页、不丢输入 |
| 导航/业务重绘 | 按钮只有一个；无重复 canvas/监听器；不反复播面板入场 |
| 连续观察侧光 | 光束持续变化且延伸足够；不是静态渐变、整屏闪烁或全页变色 |
| 两主题划过卡片和间隙 | 同款短尾；月白粒子可见；跨子卡片不重置为闪烁反光 |
| 快速划过、急转、停稳 | 无跨屏长线；停稳约 420ms 后消失并停止粒子 RAF |
| 切月白后移动 | Side Rays 隐藏且无持续背景绘制；粒子仍工作，旧色点清空 |
| 输入/编辑/按住拖拽 | 清空拖尾，文字选择、数字输入、原业务拖动正常 |
| 指针靠边、滚动、离开窗口 | 不新增页面横向溢出；相应事件清空拖尾；表格内部滚动正常 |
| 总动效关闭/打开 | 背景停止持续动画、粒子清空；恢复后按主题运行 |
| 系统减少动态效果 | 背景、粒子与微动效停止持续动画；恢复设置后行为正常 |
| 粗指针/触屏 | 无粒子，触控与滚动正常 |
| 页面隐藏/恢复 | 背景暂停、粒子清空；恢复侧光时继续，月白无背景循环 |
| WebGL 不可用/上下文丢失 | UI 可读、业务可用，无持续报错；恢复时背景重建；2D 粒子独立 |
| 高刷新率/DPR | 不限 30fps、不自动降档；背景 DPR=min(原生,2)，粒子原生 DPR |
| 系统减少透明度 | 侧光按实色规则呈现，控件、菜单和弹窗可读 |

RAF 生命周期用独立测试页调度计数或浏览器 Performance 核对。月白停稳后无粒子循环、侧光仍有背景循环是预期，不能混为一谈。目标 Windows 设备需记录分辨率、DPR、刷新率及显卡后实测，不承诺所有机器零卡顿。

### 6.3 核对交互和业务

- 主题按钮的 Tab、Enter、Space 可用，焦点可见；右上角控件没有被挤出视口。
- 店铺菜单定位正确，Esc 关闭后焦点返回，鼠标和键盘选择保持原行为。
- 新增店铺弹窗可打开、取消、Esc 关闭；焦点管理和原生 top layer 保持，输入区域无粒子。
- 参数输入立即重算，没有滚动数字、逐行入场、动画延迟或额外提交。
- 规格展开/收起、表格编辑、冻结列、横向滚动、当前行高亮保持；动效层点击穿透。
- 测算、总账、规则、商品转表、备份/迁移及正式版更新界面均核对两主题；错误、禁用、成功、空状态可读。
- 使用现有业务测试和独立数据回归，不向用户正式账本写入演示记录。

## 7. 检查并记录施工结果

运行冻结校验，再检查迁移后的 JavaScript。当前项目语法检查入口为：

```bash
node scripts/check.cjs
```

业务回归按施工时仓库真实入口运行，记录命令、退出码及结果，不假定存在 `npm test`。当前 `package.json` 没有 scripts。本轮文档检查不能替代后续正式集成验收。

打包前核对资源：当前 [electron-builder.config.cjs](../electron-builder.config.cjs) 用 `**/*` 并排除 `docs/`；[scripts/package.cjs](../scripts/package.cjs) 也排除 `docs/`。仅放在冻结目录不等于产品已包含效果，需迁移至实际 `public/`、从正式入口引用并核对成品。保留 shader 头部及 Side Rays 完整许可。只在对应任务范围内打包或发布。

完成正式集成后提交以下记录，未运行的项目明确写“未测”：

```text
参考版本：ui-approved-20260919-v1
实际产品入口与代码版本：
迁移文件及相对冻结包的差异：
宿主 DOM / 事件映射：
布局保持情况及新旧截图路径：
浏览器/系统/GPU、视口、DPR、刷新率：
两主题、微星拖尾、偏好记忆、启停验收：
键盘、菜单、弹窗、输入、业务回归：
检查命令、退出码及结果：
打包许可与资源检查（如本次涉及）：
已知差异、未测项及原因：
```

回退时只撤回本次视觉引用、主题入口和相关适配，保留业务数据与无关修改。不用 `git reset --hard` 或清空存储来回退 UI。

## 8. 给接手会话的完整指令

下面可直接复制到新会话，要求实现到当前正式入口：

> 请读取 `docs/ui-approved-spec-20260919.md` 和 `docs/ui-implementation-guide-20260919.md`，先运行 `python3 docs/ui-approved-20260919/verify.py` 并启动冻结参考页，再按 `ui-approved-20260919-v1` 将已确定的 UI 优化接入当前正式工作台。默认侧光剧场，日间为 02C 月白，两者都启用微星粒子拖尾，右上角单按钮切换且记忆偏好。不改变当前业务布局、功能和数据，不默认限帧或自动降档。直接复用冻结视觉文件、完整 shader 和精确粒子参数；宿主选择器不同时做最小适配并记录。不把预览业务脚本、sandbox、iframe、工具栏、示例数据或已淘汰方案带入产品。保留其他会话改动，不覆盖冻结包。按指南核对两主题截图、真实动态、键盘与业务行为，报告实际测试结果和未测项。此次先完成本地集成与验证，不包含发布。

## 9. 本轮文档交付的核对记录

本节只记录 2026-09-19 文档与参考包检查，不代替未来正式集成验收。

| 检查 | 本轮结果 |
|---|---|
| `python3 docs/ui-approved-20260919/verify.py` | 通过：36 个源码/资源、16 个证据文件的长度和 SHA-256 一致，HTML/CSS 本地依赖齐全 |
| `--compare-live` | 返回 1：当前 `public/review-20260918.css`、`public/review-20260918-import.js`、`public/review-20260918.js` 与快照不同；差异位于宿主业务/基础样式，8 个视觉文件一致。保留当前改动与冻结快照，不相互覆盖 |
| JavaScript 语法 | `node scripts/check.cjs` 通过；冻结目录中 16 个顶层 JS 模块逐个 `node --check` 通过 |
| 文档 | 两份新文档及两份旧记录中的 40 个本地 Markdown 链接有效；无行尾空格 |
| 静态服务 | 按第 2 节启动后，36 个冻结文件均返回 HTTP 200，响应内容哈希与清单一致 |
| 视觉证据 | 已保存并查看 8 张截图，含两主题的桌面、窄屏、菜单、弹窗；8 份同名 JSON 保留样式与几何测量；JPEG 后缀和尺寸已核对 |
| 参数 | 已与冻结源码核对主题状态、Side Rays uniform、DPR、微动效时长和粒子采样/绘制参数 |

本轮未接入正式入口，也未执行正式版完整业务回归、打包发布或目标 Windows GPU 性能验收。历史动效测试结果可追溯，但不冒充本轮重新测试；后续施工必须重新完成第 6 节的真实交互验收。
