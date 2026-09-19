# 地垫工作台 UI 确定版规格

本文件面向接手实现的会话和开发者，记录用户最终确定的外观与动效。复现目标是随文冻结的实现：**默认侧光剧场，日间使用 02C 月白；两种模式都使用微星粒子拖尾**。布局、业务流程和计算规则沿用宿主工作台。冻结日期为 2026-09-19，版本为 `ui-approved-20260919-v1`。

具体施工顺序见 [施工与验收步骤](ui-implementation-guide-20260919.md)。完整代码、依赖及哈希见 [冻结文件清单](ui-approved-20260919/reference/manifest.json)。不要仅凭文字、截图或外部参考站重新设计；相同宿主结构下，直接复用冻结视觉文件才是精确还原路径。

## 1. 最终决定与优先级

以下表格取代旧探索文档中的“当前推荐”。后续用户明确提出的新要求优先于本规格；在没有新要求时，以冻结代码的实际效果为准。

| 项目 | 确定结果 |
|---|---|
| 主题数量 | 只保留侧光、日间月白两个主题 |
| 首次打开 | 无已存偏好时为侧光；不根据操作系统深浅色自动选主题 |
| 返回使用 | 恢复用户上次选择的主题和总动效开关 |
| 侧光 | 深色烟色玻璃面板，右上方持续流动的 Side Rays 光影 |
| 日间 | 02C 月白，近白珠光表面、低饱和银灰色系、少量暖灰折射 |
| 鼠标拖尾 | 两个主题均为微星粒子；月白使用适合浅底的配色 |
| 拖尾形态 | 小光点和少量四角星，局部散开、短时间消散，保留系统指针 |
| 模式入口 | 工作台右上角一个按钮，显示可切换到的模式 |
| 性能取舍 | 不默认限帧，不根据设备性能自动降画质或关效果；用户可切换月白或手动关动效 |
| 布局与业务 | 不重排区域，不改变间距、字号、控件尺寸、数据与业务事件；表面圆角、颜色和阴影按本规格 |
| 左侧蓝色标记 | 导航选中项不恢复之前试验中的蓝色左侧竖条 |
| 比较控件 | 银光短尾、冰晶像素、拖尾选择器、“播放演示”均已撤下 |

“月白不要鼠标跟随”是较早决定，已经被用户随后提出的“月白也启用这个拖尾特效”覆盖。月白保留 `data-ui-pearl-motion="none"`，仅表示禁用旧面板反光，不表示关闭微星粒子。

## 2. 基准包及复现边界

冻结包包含完整可运行的独立预览，避免工作区后续修改让接手会话丢失基准。包内不含用户浏览器的 localStorage、店铺草稿或系统偏好导出；演示数据来自自带的 `ReviewModel.seed()`。

| 内容 | 数量 | 用途 |
|---|---:|---|
| 视觉与动效模块 | 8 | 正式集成时迁移的核心实现 |
| 预览入口、外壳、数据隔离脚本 | 5 | 独立复现用，不能整体带入正式业务入口 |
| 宿主业务和基础样式 | 15 | 固定 DOM、层叠样式与示例行为，作为对照，不用于覆盖正在开发的业务代码 |
| 字体、图标、库、模板等资源 | 7 | 保证脱离外网也可打开基准 |
| Side Rays 许可文件 | 1 | 随 shader 保留来源与许可 |
| 总计 | 36 | 每个文件均有字节数和 SHA-256 |

冻结包位置为 `docs/ui-approved-20260919/reference/public/`。直接入口为 `ui-refinement-frame.html`；带外观说明和总动效开关的入口为 `ui-refinement-preview.html`。二者是同一个工作台，外层工具栏不属于正式产品布局。

相同代码、数据、字体、浏览器、视口、DPR、滚动位置、焦点和动画时间才适合做像素比较。Windows 与 macOS 的中文系统字体、抗锯齿和 GPU 可能产生细小差异；这些不能通过修改配色或随意调整布局来“修正”。Side Rays 是实时 shader，随时间变化的截图不能直接当作静态误差。

## 3. 文件职责与加载顺序

视觉效果依赖基础 CSS 和覆盖层共同生效。尤其不能只复制 `ui-material-studies.css`，遗漏它前面的通用表面层。

| 核心文件（冻结路径） | 职责 |
|---|---|
| [ui-appearance.js](ui-approved-20260919/reference/public/ui-appearance.js) | 首屏主题、偏好记忆、右上角切换按钮、全局 API |
| [ui-refinement.css](ui-approved-20260919/reference/public/ui-refinement.css) | 通用表面、控件、表格、菜单、弹窗与 CSS 微动效 |
| [ui-material-studies.css](ui-approved-20260919/reference/public/ui-material-studies.css) | 月白与侧光覆盖、颜色、材质、切换按钮样式 |
| [ui-side-rays.js](ui-approved-20260919/reference/public/ui-side-rays.js) | 原始 Side Rays GLSL 与原生 WebGL 封装 |
| [ui-material-studies.js](ui-approved-20260919/reference/public/ui-material-studies.js) | 背景渲染调度、主题与可见性切换、WebGL 丢失/恢复 |
| [ui-cursor-trails.css](ui-approved-20260919/reference/public/ui-cursor-trails.css) | 鼠标画布层级、定位、裁剪和点击穿透 |
| [ui-cursor-trails.js](ui-approved-20260919/reference/public/ui-cursor-trails.js) | 微星粒子采样、绘制、配色与启停 |
| [ui-refinement-motion.js](ui-approved-20260919/reference/public/ui-refinement-motion.js) | 主动导航与展开设置的 Web Animations API 动效 |

CSS 层叠顺序固定为：`styles.css` → `revision.css` → `workspace.css` → `responsive.css` → `review-20260918.css` → `ui-refinement.css` → `ui-material-studies.css` → `ui-cursor-trails.css`。对应的完整 HTML 是 [ui-refinement-frame.html](ui-approved-20260919/reference/public/ui-refinement-frame.html)。宿主 CSS 中的 `body`、`:nth-child(n)`、`!important` 和后置规则都会影响最终外观，不得只看第一条同名选择器。

`ui-appearance.js` 是 `<head>` 中的普通同步脚本，在样式和内容绘制前运行。其余视觉脚本使用 `defer`；先加载 `ui-side-rays.js`，再加载 `ui-material-studies.js`。业务渲染脚本之后加载微交互脚本，保持当前事件顺序。

基础资源使用本地 `assets/InterVariable.woff2`、中文系统字体、`assets/lucide.min.js` 和 `assets/app-icon.png`。字体栈为 `InterVariable, "PingFang SC", "Microsoft YaHei", sans-serif`。不替换字体、图标形状或品牌标识。

## 4. 主题状态、API 与存储

主题状态集中在 `UiAppearance`，CSS、背景与拖尾读取同一组根节点属性。不得让背景、按钮和正文各自保存独立主题。

| 根节点属性 | 侧光 | 日间月白 |
|---|---|---|
| `data-ui-refine` | `true` | `true` |
| `data-ui-material` | `rays` | `pearl` |
| `data-ui-pearl-palette` | 空字符串 | `moon` |
| `data-ui-pearl-motion` | `none` | `none` |
| `data-ui-cursor-trail` | `spark` | `spark` |
| `data-ui-motion` | `true` 或 `false`，按偏好 | 同左 |
| `meta[name="color-scheme"]` | `dark` | `light` |

| 对外接口 | 确定行为 |
|---|---|
| `UiAppearance.getState()` | 返回 `{ mode, motion }`；mode 为 `rays` 或 `day` |
| `UiAppearance.setMode(value)` | `day` 选择月白，其余值归一为 `rays`；持久化后应用 |
| `UiAppearance.setMotion(value)` | 转为布尔值并持久化；关闭时取消当前页面已有动画 |
| `ui-appearance-change` | 每次应用后在 `document` 派发，预览外壳据此同步 |

localStorage 使用 `mat-workbench-ui-study-mode-v1` 和 `mat-workbench-ui-study-motion-v1`。只有已存主题值 `day` 会恢复月白；只有已存动效值字符串 `false` 会关闭动效。存储不可用时，当前会话仍可切换。监听 `storage` 事件同步其他同源窗口；不读取已经废弃的 `mat-workbench-ui-study-trail-v1`。

模式切换只更新外观属性、meta 和按钮，不刷新页面，不重新计算业务，不迁移草稿，也不让视图跳回首页。当前实现没有主题交叉淡入动画。日间模式会停止 Side Rays 的持续绘制，但微星粒子仍在移动鼠标时绘制。

## 5. 模式切换按钮

按钮挂在现有 `.topbar-right`，ID 为 `ui-mode-toggle`，类型为 `button`。它的文字是目标模式，不是当前模式。

| 项目 | 规格 |
|---|---|
| 侧光中显示 | 太阳图标＋“日间模式”；aria-label 为“切换为日间模式” |
| 月白中显示 | 月亮图标＋“侧光模式”；aria-label 为“切换为侧光模式” |
| 桌面尺寸 | 高 32px、最小宽 100px、左右 padding 10px、gap 7px、圆角 8px |
| 字体 | 12px，line-height 1 |
| 图标 | 16×16，viewBox 24×24，描边 1.6，圆角端点/连接 |
| 月白背景 | `rgba(255,255,255,.6)`；hover 使用 `--primary-soft` |
| 侧光背景/边/字 | `#ffffff08` / `#ffffff25` / `#e1e9f5`；hover `#ffffff16` |
| 键盘焦点 | 2px `--primary` 外轮廓，offset 3px |
| ≤640px | 最小高度 44px |

业务当前会替换 `#app` 的直接子节点。按钮初始化后，用 `MutationObserver({ childList: true })` 观察 `#app`，按 ID 防止重复；不观察整棵业务子树，也不轮询。主题键盘操作沿用原生 button 的 Enter/Space 行为。

## 6. 布局与尺寸基线

保留现有左右导航关系、指标/费用双栏、下方规格表、现有页面和弹窗内容。主要改动是表面材质，不用增大留白来制造“高级感”。

下表来自冻结页在 **1440×1000 CSS 像素、直接工作台入口、自带示例数据、顶部未滚动** 时的实际测量；两主题的矩形相同。完整属性和逐元素尺寸记录见 [侧光 JSON](ui-approved-20260919/evidence/rays-1440x1000-static.json) 与 [月白 JSON](ui-approved-20260919/evidence/moon-1440x1000-static.json)。

| 区域 | x / y / 宽 / 高（px） | 关键样式 |
|---|---|---|
| 侧栏 | 0 / 0 / 220 / 1000 | padding `0 14px 16px` |
| 顶栏 | 220 / 0 / 1220 / 64 | padding `0 28px` |
| 页面标题区 | 220 / 64 / 1220 / 113 | padding `26px 28px 24px` |
| 顶部双栏区域 | 248 / 177 / 1164 / 464 | 列间隔 20px |
| 当前测算面板 | 248 / 177 / 572 / 464 | padding `18px 20px` |
| 投放与费用面板 | 840 / 177 / 572 / 464 | padding `18px 20px` |
| 第一个指标卡 | 269 / 240 / 259 / 185 | padding 18px，指标 gap 12px |
| 下方规格面板 | 248 / 663 / 1164 / 884.171875 | padding `0 24px 20px`；高度由内容决定 |
| 主题按钮 | 1312 / 15.5 / 100 / 32 | 切换不改变占位 |

指标数字在该基准视口的实际字号为 26px、字重 600、line-height 1.25，使用等宽数字特性；不能照抄旧 CSS 中未生效的 38px 或 42px。圆角差异见下面材质表；不要用圆角变化修改元素矩形尺寸。

响应式规则继续使用冻结宿主：≤1100px 取消 body 最小宽度；≤1000px 顶部双栏改为单列并允许顶栏换行；≤640px 导航改为顶部品牌＋“导航”按钮、侧栏内容按展开状态显示，主要横向边距 16px。粗指针设备沿用现有更大触控区域，且不启用鼠标粒子。

390×844 下已有大金额换行情况，基准截图如实保留；它不是本轮新增的排版要求，也不是已修复的问题。后续若单独优化手机字号，应另列变更，不能声称仍与此冻结布局逐像素一致。

## 7. 侧光材质与组件颜色

侧光是一层真实动态光影透过烟色面板。光影位于内容后方，正文与表格以明确的深浅对比保持可读。

| Token / 表面 | 精确值 |
|---|---|
| body 底色 | `#080b12` |
| `--ink` / `--muted` | `#f0f2f5` / `#b1b8c5` |
| `--line` / `--soft` | `rgba(224,230,242,.13)` / `#24272e` |
| `--primary` / hover / soft | `#b2cff9` / `#cadfff` / `#323e50` |
| 正值 / 负值 / 琥珀 | `#80d7b2` / `#ffa1a8` / `#eac48d` |
| 外层面板 | `rgba(27,31,40,.76)`，16px 圆角，`blur(20px)` |
| 面板边缘 | `rgba(237,244,255,.17)` |
| 面板阴影 | `inset 0 1px 0 rgba(255,255,255,.12), 0 10px 28px rgba(0,0,0,.16)` |
| 侧栏 / 顶栏 | `rgba(26,28,35,.9)` / `rgba(25,28,35,.83)` |
| 指标卡 | 12px 圆角；右上弱冷光径向渐变叠加 `145deg` 低透明白色渐变；精确表达式见冻结 CSS |
| 指标主数字 / 辅助字 | `#f4f6fa` / `#b6c0d0` |
| 选中导航 | `linear-gradient(140deg,#ffffff19,#ffffff09)`；字 `#f4f6fa`；无蓝色左条 |
| 普通按钮 | `linear-gradient(160deg,#363b46,#292d36)`，字 `#e2e9f4` |
| 普通主要按钮 | `linear-gradient(160deg,#d6e6fc,#afc9ed)`，字 `#172b46` |
| 确认入账 | `linear-gradient(155deg,#eed7b9,#d7b48a)`，字 `#3e2c18`，边 `#e7c69f` |
| 输入框 | 背景 `#171b23b3`，字 `#e6edf8`，边 `#ffffff26` |
| 输入框 focus | 背景 `#222936`，边 `#adc9ef`，outline `#b0d1ff66` |
| 表头 | 背景 `#222834`，字 `#bbc7d9` |
| 表格奇/偶行 | `#1c2029` / `#20252f`，字 `#e0e7f2` |
| 表格 hover / 编辑行 | `#2b3647` / `#2c3a50` |
| 弹窗与店铺菜单 | 背景 `#252b37ed`，字 `#edf2fa`，边 `#ffffff26` |
| 弹窗遮罩 | `#06090f85` |
| 菜单选中 / hover | `#40526b` / `#38465c` |

表格冻结首尾列必须保留 `.table-scroll table ...` 这一组后置高优先级规则，否则基础样式会把固定列渲染成浅色。错误、成功、禁用、输入焦点、标签和弹窗页脚的细项按冻结 CSS 原样复用，不仅覆盖首页。

## 8. 月白材质与组件颜色

月白固定使用 `pearl + moon`，不是默认冰青 `pearl`，也不是 `sage` 雾绿。月白的大面板不启用背景模糊；用静态珠光渐变、浅边缘和阴影形成质感。

| Token / 表面 | 精确值 |
|---|---|
| `--pearl-base` / body | `#eef0f3` |
| `--pearl-tint` / `--pearl-secondary` | `#e5e9f0` / `#f2f0eb` |
| `--pearl-side` | `#fafbfc` |
| accent / hover / line | `#58667b` / `#465367` / `#d1d8e2` |
| `--pearl-rgb` | `111,130,157` |
| 主字 / 辅助字 | 通用层 `#253044` / `#5d697b`；局部 label、desc 按冻结 CSS |
| `--mat-control` | `#ffffffd9` |
| 外层面板圆角 / 边 | 18px / `#ffffffed` |
| 外层面板背景 | `radial-gradient(ellipse at 18% 0%,#fff,transparent 68%), linear-gradient(125deg,#fafcfc 12%,var(--pearl-tint) 62%,var(--pearl-secondary))` |
| 外层面板阴影 | `inset 1px 1px 1px #fff,inset -1px -1px 1px #ffffff70,0 10px 24px -14px rgba(var(--pearl-rgb),.27)` |
| 指标卡 | 14px 圆角，`linear-gradient(150deg,#ffffffed,#ffffff70)` |
| 指标负值 / 正值 | `#b63c45` / `#207655` |
| 侧栏 / 顶栏 | `#fafbfc` |
| 选中导航 | `linear-gradient(115deg,#fff,var(--pearl-tint))`，accent 色文字 |
| 普通主要按钮 | `#58667b`，hover `#465367` |
| 确认入账 | 保留通用层暖棕橙渐变 `linear-gradient(180deg,#b45a25,#aa501f)` 和白字 |
| 输入 focus | 白底，accent 边，`--pearl-line` 轮廓 |
| 表格 | 沿用通用精修层的半透明白/浅灰蓝行；冻结首尾列 `#f7faff` |
| 弹窗 | `linear-gradient(135deg,#fff,var(--pearl-side))` |
| 店铺菜单 | `--pearl-side`；选中 `--pearl-tint`；hover `--pearl-base` |

“确认入账”使用 `.confirm-entry.btn`，不能因为月白的 `--primary` 是银灰，就把入账按钮也改成银灰。表格编辑行原有的局部指示线与导航左条不是同一个规则，不能一起删除。

## 9. 通用表面与微交互

这部分在两个主题下都生效，颜色由主题覆盖。只有用户触发对应动作才播放，不因输入参数或业务整块重绘反复出现。

| 元素 / 场景 | 规格 |
|---|---|
| 外层面板选择器 | `.plan-overview .main-column,.parameter-rail,.plan-detail-card,.wide-content` |
| 普通控件圆角 | 按钮 9px、输入 8px、导航项 10px、表格外框 10px |
| 菜单 / 弹窗 | 菜单圆角 12px、选项 7px、弹窗 18px；菜单 blur 24px、弹窗 blur 28px；月白主体面板的 `--mat-blur:none` 不等于菜单/弹窗全无 blur |
| 弹窗遮罩 blur | 5px，主题单独覆盖遮罩颜色 |
| 统一 easing | `cubic-bezier(.2,.8,.2,1)` |
| 按钮按下 | 110ms，`translateY(1px) scale(.99)`；排除 disabled、`.nav-item` |
| 下拉箭头 transition | 160ms，沿用展开状态所给的 transform |
| 菜单向下展开 | 180ms，opacity 0→1，`translateY(-5px) scale(.975)`→none |
| 菜单向上展开 | 180ms，`translateY(5px) scale(.975)`→none，origin bottom center |
| 弹窗打开 | 220ms，opacity 0→1，`translateY(8px) scale(.985)`→none |
| 遮罩进入 | 180ms，opacity 0→1，ease-out |
| 主动导航/Tab | 180ms，`#main-content` opacity .5→1 |
| 展开规格设置 | 180ms，`#sku-options:not([hidden])` opacity 0→1，translateY(-5px)→none |
| 关闭菜单/弹窗、收起设置 | 沿用宿主即时行为，不增加退出等待 |
| 数值变化 | 立即显示真实结果，不做滚动计数或逐行入场 |

WAAPI 监听 `data-action` 值 `nav`、`tab`、`library-tab` 和 `sku-options`。已激活按钮不重复播放；先由业务事件更新内容，再在下一次 requestAnimationFrame 对目标播放。正式宿主事件名不同，需要做语义映射，不能为了视觉效果改变业务处理顺序。

## 10. Side Rays 背景参数与生命周期

复用 [冻结 shader](ui-approved-20260919/reference/public/ui-side-rays.js) 的完整片元代码。它不是一张渐变图、CSS 背景动画、模糊三角形，也不是让整个页面随鼠标改变底色。参考出处为 React Bits Side Rays；确切版本已本地冻结，不再从线上更新。

| 参数 | 确定值 |
|---|---:|
| 光源位置 | 右上；shader 坐标 `rayPos=(width×1.1, height×-0.5)` |
| `iSpeed` | 2.5 |
| `iIntensity` | 3.2 |
| `iSpread` | 2 |
| `iFlipX` / `iFlipY` / `iTilt` | 0 / 0 / 0 |
| `iSaturation` | 1.5 |
| `iBlend` | 0.75 |
| `iFalloff` | 0.85 |
| `iOpacity` | 1 |
| `iRayColor1` | `#EAB308`，RGB 234/255、179/255、8/255 |
| `iRayColor2` | `#96C8FF`，RGB 150/255、200/255、1 |
| 背景 DPR | `min(devicePixelRatio || 1, 2)` |

`intensity=3.2` 与 `falloff=.85` 是用户要求光影延长后的值，不能恢复到参考默认 2 / 1.6。GLSL 的颜色混合、两束光的不同速度、距离衰减和 alpha 计算必须一起保留；仅仅使用相同颜色不构成还原。

WebGL 使用 `alpha:true, premultipliedAlpha:false, antialias:false, depth:false`，一个满屏三角形 `[-1,-1,3,-1,-1,3]`。画布 `#ui-rays-canvas` 固定铺满视口，pointer-events none，z-index 0；侧光下 `#app` 为 position relative、z-index 1。

渲染通过 requestAnimationFrame 跟随设备刷新率，不固定为 30fps 或 60fps。时间增量为 `min(now-previous,50ms)`，首次增量 `1000/60ms`；这是恢复或长任务后的时间步保护，不是限帧。主题切换保留累计 elapsed，重新加载页面从 0 开始。

侧光首次可见时才创建 WebGL。隐藏页面、关闭动效、系统减少动态效果时停止持续绘制；关闭动效仍可绘制静态侧光帧。切换月白隐藏背景画布并停止其循环；回侧光恢复。context lost 时停止，restored 时重新创建。不可用时保留暗色 UI，Canvas 2D 粒子不依赖 WebGL。

## 11. 微星粒子精确规格

两个主题共用 [同一拖尾代码](ui-approved-20260919/reference/public/ui-cursor-trails.js)，只改变颜色。每个点由普通光点与少量四角星组成，没有大面积烟雾、液体、光环、鼠标替身或卡片倾斜。

| 项目 | 确定值 / 行为 |
|---|---|
| 画布 | 272×272 CSS px，中心 136/136；像素尺寸 `round(272×原生DPR)` |
| 点存储 | 固定 64 个点的环形数组，不随 pointermove 创建 DOM |
| 采样间距 | 6px；不足 6px 不新增点 |
| 历史路径范围 | 点距当前指针超过 108px 时移除 |
| 生命周期 | 420ms，以时间而非帧数计算 |
| 指针中心留空 | 半径 7px，evenodd clip；保留系统指针与点击目标 |
| 高频移动 | 每次仅插值最近 108px 路径，避免跨屏长线 |
| 透明度时间衰减 | `(1-max(age,0)/420)^1.5` |
| 距离淡出 | `min(1,(108-distance)/24)`，与时间衰减相乘 |
| 向外偏移角 | `seed×2.39996` 弧度 |
| 向外偏移距离 | `2+(age/420)×10` px；含粒子光晕后约 125px 范围 |
| 半径 | 每第 4 个点 2px，其余 1.1px；乘以 `1-(age/420)×.6` |
| 柔光 | 半径为当前粒子半径的 2.4 倍，alpha 为衰减值×.14 |
| 核心光点 | alpha 为衰减值×.95；每第 3 个点使用 accent，其余 core |
| 四角星 | 每第 7 个点绘制两条交叉短线，横/竖各 ±3.5px，线宽 .7px，alpha×.55 |
| 停止移动 | 最多约 420ms 后清空并结束 RAF；下一次移动再唤醒 |
| 主题切换 | 清空旧点，之后按新主题颜色采样；不把旧配色残留带过去 |

| 粒子颜色 | 侧光 | 月白 |
|---|---|---|
| halo | `#aedee7` | `#b1c9ce` |
| core | `#e4f5f7` | `#738a95` |
| accent | `#c3dcd1` | `#819c91` |
| star | `#eaf9f9` | `#647e8a` |

拖尾外层 `#ui-cursor-trail-layer` 为 fixed、inset 0、overflow hidden、pointer-events none、z-index 8、contain strict。内部画布 absolute，用 translate3d 移到 `(clientX-136,clientY-136)`；外层裁剪防止指针靠近边缘时扩展页面滚动宽度。两层 aria-hidden，不占据业务布局。

仅在精确指针、动效开启、页面可见、系统未要求减少动态、主题为 rays/pearl 时启用。触屏事件、按住鼠标按钮拖拽、input/textarea/select、`[contenteditable="true"]`、dialog 和 `[role="dialog"]` 上清空。pointerout 离开文档、pointerdown、pointercancel、scroll、blur、pagehide、resize、媒体查询变化和相关主题属性变化也清空。

启用微星后，旧 `.ui-surface-light` 面板大反光不再创建。保持 `data-ui-cursor-trail="spark"`，不要把旧的 panel glare 或珠光 ring/arc 叠加回来。

## 12. 性能与可访问性边界

用户明确选择由自己决定何时降低动效负担。代码不依据低 FPS、低端设备、电量、屏幕面积等条件自动改主题或降低效果。

| 条件 | Side Rays | 微星粒子 |
|---|---|---|
| 侧光＋动效开启 | 持续 RAF | 移动/消散期间 RAF |
| 月白＋动效开启 | 停止并隐藏 | 移动/消散期间 RAF |
| 手动关闭动效 | 静态画面，无持续 RAF | 清空，无 RAF |
| `prefers-reduced-motion: reduce` | 无持续 RAF | 清空，无 RAF |
| 页面隐藏 | 暂停 | 清空 |
| 鼠标停下 | 继续背景动画 | 尾迹消散后停止 |
| 仅粗指针/触屏 | 背景规则不变 | 不启用 |
| WebGL 不可用 | 暗色静态 UI | Canvas 2D 可独立工作 |

背景现有 DPR 上限 2 是当前参考实现的规格；不要误写成“无限 DPR”。粒子使用原生 DPR，不与背景共享上限。不得加入 30fps、DPR 1.25、固定两百万像素或自动降档。固定粒子数量、隐藏页面暂停、停稳停止空转属于当前实现，不改变可见效果。

`prefers-reduced-transparency` 下侧光面板改为实色 `#22252d`，blur none；弹窗和菜单按冻结覆盖规则处理。正常情况下保留原生焦点、Esc、Tab、弹窗 top layer 和菜单定位。动效层不能拦截指针或让控件不可操作。

## 13. 截图与测量证据

截图使用冻结源码和内置示例数据，在 macOS 的当前内嵌浏览器拍摄。主页面直接打开 frame，**不包含预览工具栏**，滚动位置为顶部。总动效关闭后重新加载，侧光以 elapsed=0 的静态帧作基准；因此图片不用于展示粒子运动，运动以第 10、11 节和源码为准。菜单/弹窗截图保留对应交互焦点，切换后主题按钮可能显示 hover/focus 状态。

| 状态 | 侧光 | 月白 |
|---|---|---|
| 桌面 1440×1000 | [截图](ui-approved-20260919/evidence/rays-1440x1000-static.jpg) | [截图](ui-approved-20260919/evidence/moon-1440x1000-static.jpg) |
| 桌面店铺菜单 | [截图](ui-approved-20260919/evidence/rays-menu-1440x1000-static.jpg) | [截图](ui-approved-20260919/evidence/moon-menu-1440x1000-static.jpg) |
| 桌面新增店铺弹窗 | [截图](ui-approved-20260919/evidence/rays-dialog-1440x1000-static.jpg) | [截图](ui-approved-20260919/evidence/moon-dialog-1440x1000-static.jpg) |
| 窄屏 390×844 | [截图](ui-approved-20260919/evidence/rays-390x844-static.jpg) | [截图](ui-approved-20260919/evidence/moon-390x844-static.jpg) |

截图按工具原始输出保存为 JPEG，未二次编码；压缩边缘不作为零像素差验收依据。每张 JPG 旁有同名 JSON，包含模式、动效状态、视口、主要组件 computed style 和 `#app` 内具有尺寸的元素矩形。这些 JSON 的元素总数不是“视口可见元素数”；菜单和弹窗在 app 外，需同时查看截图与原样式。证据文件哈希见 [证据清单](ui-approved-20260919/evidence/manifest.json)。

内置数据用于排除数值差异：地垫旗舰店、当前测算、7 个规格；广告消耗 1000、支付 ROI 4、平台扣点 5%、税点 2%、退款 3/1/6/2%；四项指标为 10.40、¥-615.20、¥4,000.00、¥4,215.20。不要将这些演示数值写死到正式计算结果。

## 14. 历史残留与正式集成边界

冻结 CSS 为保证原样复现，仍包含未激活的 `glass`、`ceramic`、`crystal`、`sage` 和旧 pearl ring/arc/trail 分支；背景宿主仍有旧面板反光逻辑。它们没有用户入口，按当前属性组合也不会运行。复用文件时可以保留，但不能据此重新添加候选方案。

[旧优化记录](ui-refinement-20260918.md) 和 [材质探索记录](ui-material-studies.md) 仅用于追溯。其中的 100/140/150/160/180ms 初版参数、默认玻璃主题、三个大胆案例、月白无跟随、大面积扫光、银光短尾/冰晶像素都不是本次施工目标。

当前正式 `public/index.html` 使用 `app.js`、`persistence.js` 等文件，预览使用 `review-20260918.js` 和隔离的 ReviewModel，两个入口并不相同。不得用整个冻结业务页面替换正式软件。正式集成必须按 [施工步骤](ui-implementation-guide-20260919.md) 保留业务并适配宿主选择器。

预览隔离键是 `mat-workbench-ui-study-20260918`，来自 `ui-refinement-sandbox.js`；这不是产品数据迁移方案。预览外壳、iframe、工具栏、“修改复核原型”文案、演示数据和冻结业务库也不是新增产品功能。顶部主题切换按钮及两个主题、微星粒子才是正式迁移目标。

参考许可保留 [react-bits-side-rays.txt](ui-approved-20260919/reference/public/licenses/react-bits-side-rays.txt) 的完整文本与 shader 头部。微星粒子为本地 Canvas 实现，没有引入 React、Three.js、OGL 或 GSAP 依赖。正式打包、完整业务回归及目标 Windows GPU 性能不在本次文档交付中冒称已验收。
