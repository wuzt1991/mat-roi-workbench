# 地垫工作台图标 · v1.1.1

用户要求借鉴 Codex 子智能体头像的视觉风格，并把两个系统中的软件名称统一为“地垫工作台”。

风格参考来自本机 Codex 的子智能体头像资源：柔和配色、圆润几何轮廓、轻微渐变、半透明叠色与白色分隔。只参考视觉语言，正式图标为原创绘制的双层地垫图形，没有使用原头像的路径或图像文件。

设计使用薄荷青和淡紫两张圆角地垫，三道等长条纹表现地垫表面纹理；交叠部分采用蓝青叠色。桌面版放在浅色圆角底上，外侧保留透明像素。避免把文字缩进小图标。

本轮没有可调用的内建生图工具，且未配置 OPENAI_API_KEY，因此未调用生图接口。采用可编辑 SVG 设计，再通过 AppKit 栅格化为 PNG，并生成 macOS ICNS 和含 16/24/32/48/64/128/256 七档尺寸的 Windows ICO。

源文件：public/assets/brand-mark.svg；生成脚本：scripts/icons.cjs、scripts/icon.swift；桌面源图与打包资源位于 build/；界面使用 public/assets/app-icon.png。

名称同步到 package.json productName、Electron app.name、Mac .app、CFBundleName/DisplayName、Windows .exe 和文件属性、安装包以及界面。内部数据库位置、应用 Bundle ID、草稿 profile 与单实例锁保持兼容旧版。

重建：先运行 node scripts/icons.cjs，再运行 npm run check、npm test，最后执行 MAT_ELECTRON_ZIPS="$PWD/.runtime-archives" npm run package。

验证记录：66 项已有测试通过；Mac 中文名称应用在隔离数据目录实际启动，页面标题、图标资源加载和保存状态正确，浏览器错误日志为空。Mac CFBundleName、CFBundleDisplayName、CFBundleExecutable 均为“地垫工作台”，签名检查通过。Windows PE 资源中的产品名、内部名、原始文件名已经核对，七档图标字节与源 ICO 完全一致。两端业务文件与已测试源码一致，包内没有用户数据库。Windows 尚未实机启动验证。
