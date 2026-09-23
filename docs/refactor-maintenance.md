# 重构后维护入口

适用源码：1.2.13 结构重构候选。当前使用流程以 `refactor-product-plan.md` 第 4 节及用户后续明确要求为准；完成情况见 `refactor-stage4.md`，历史版本的通过结果不能替代当前候选验收。

## 修改位置

| 需求 | 首选入口 | 约束 |
| --- | --- | --- |
| 导航、保存提示、模块不可用 | `shell-views.js`、`workbench-shell.js`、`app.js` | 唯一工作区和 SaveQueue；不要增加旧商品转表回退界面 |
| 商品列表、分组、厚度确认、编辑弹窗 | `product-transfer/views.js`、`product-transfer-ui.js` | 视图只读；商品范围使用服务端 groupId；保留拖放与直接导出 |
| 商品操作及未知结果恢复 | `product-transfer/controller.js`、`commands.js` | 写入带 mutationId；响应丢失先查回执，不盲目重试 |
| 商品识别与计算 | `product-recognition.js` | 不依赖 DOM；公式变更需要独立业务预期；本轮未改公式 |
| 商品会话、查询、撤销 | `server/import-session-store.cjs` | 单连接事务、修订号、代次、规则指纹；不按可见列表确定批量范围 |
| 可复用规则 | `rules-editor.js`、`rules-views.js` | 草稿校验成功后一次提交；保护手动售价和历史快照 |
| 销售导入 | `sales-import/model.js`、`controller.js`、`views.js`、`sales-import-ui.js` | 按整份候选计算分母；新增尺寸随应用提交；取消无残留 |
| 经营记录和总账 | `operating-records/` | 共用有效记录查询；冻结成本；更正和作废不抹去原记录 |
| 旧版备份与账目 | `compatibility.js` 及其调用的旧模型 | 按历史版本派发，不拿新公式重算旧账 |
| 成品内容 | `common/runtime-manifest.cjs` | 显式文件白名单；新增模块、许可证同步纳入 |

上表前端路径相对于 `public/`。不能仅因文件名包含 `legacy`、`v3` 就删除：`domain.js` 和 `workbook.js` 仍调用这些文件。`product-transfer.js` 只供历史原型和兼容测试使用，源码保留，但不再加载到正式页面或打入成品。

## 样式边界

- 商品转表：`product-transfer-ui.css`，页面 `.product-v4`，组件 `.pv4-*`、`.pv5-*`、`.pv6-*`；模块缺失状态 `.product-module-error`。
- 商品弹窗附加到 body，不能把其规则全部限定在 `.product-v4` 内，否则弹窗失去样式。
- 销售：`sales-import-ui.css`，`#sales-import-dialog` 与 `.sales-import-*`。
- 经营记录：`operating-records.css`，`.operating-*`；入账弹窗 `.operating-entry-dialog` 同样不依赖页面祖先。
- 全局表单、表格、按钮保留在现有共享样式；两主题使用 `ui-material-studies.css` 和 `ui-refinement.css`。不要为模块化重排整个级联顺序。
- Lattice、侧边光束及鼠标动效保留既有实现和减少动态效果设置。主题和页面改动必须复测滚动及小窗口。

## 验证与本地构建

```sh
npm test
npm run check
node scripts/release-validation/verify-stage3.cjs
node scripts/release-validation/verify-product-scroll.cjs
node scripts/release-validation/verify-stage4.cjs
```

使用 Node >=24。本机可在命令前加 `PATH=/Users/wuzt/.local/bin:$PATH`。Playwright 不进入生产依赖，用 `MAT_PLAYWRIGHT_MODULE` 指向本机可用模块。证据目录由 `MAT_VERIFY_OUTPUT` 指定。

实际 Mac 候选的业务回归设置 `MAT_STAGE3_INSTALLED`；商品完整回归设置 `MAT_SCROLL_INSTALLED`。阶段 4 升级与回退演练同时设置 `MAT_STAGE4_INSTALLED`、`MAT_STAGE4_PREVIOUS`。这些脚本只创建临时合成工作区；不得传入用户真实数据目录。

Mac：`npm run package -- --platform darwin --output <候选目录>`；Windows：`npm run package:win -- --config.directories.output=<候选目录>`，脚本固定 `--publish never`。本机有共享 node_modules 符号链接时，electron-builder 的依赖遍历可能漏包，应在隔离临时目录复制当前白名单、配置和锁文件并执行 `npm ci --omit=dev --ignore-scripts` 后构建，最终再从当前源码运行载荷审计；不要改动原施工树的依赖目录。

版本需要同步 `package.json`、`package-lock.json`、`common/runtime-manifest.cjs`、`common/runtime-dependencies.json` 及 index 的外壳脚本缓存号。生产依赖变更另行重新生成并核验依赖快照。

Windows 实际安装包业务回归：`node scripts/release-validation/run-installed.cjs <安装目录> business`，同时设置 `MAT_STAGE3_INSTALLED=<安装目录>/地垫工作台.exe`、`MAT_PLAYWRIGHT_MODULE` 和新的 `MAT_VERIFY_OUTPUT`。商品用 `scroll` 模式，分组性能用 `performance` 模式。安装包装入口会以该安装目录的 Electron 执行脚本，业务帮助模块通过 `MAT_VERIFY_ROOT` 加载同一载荷。

Electron 下读取整个 `app.asar` 的哈希必须使用 `original-fs`，普通 fs 会把 ASAR 当目录。业务原生窗口已由桌面入口导航，测试应等待首次导航完成；不要在初次加载期间再次 page.goto。Windows 结束测试时按 PID 清理该测试进程树，不能停止所有同名应用。

`verify-windows-rollback.cjs` 仅在 GitHub 托管 Windows runner 运行，以明确的旧／新安装器进行同目录覆盖升级和回退，保存后继续读取最新合成数据。候选 SHA-256 清单位于隔离测试分支 `validation/candidate/sha256.json`。`emit-ci-evidence.py` 将合成 JSON 报告压缩分段输出并附哈希，下载后必须完整重组验证；不得把 GitHub 截断的长 annotation 当完整报告。

Windows 原生验收与安装升级需 Windows 环境。`audit-windows-upgrade.cjs` 只接受 GitHub 托管的一次性 Windows runner，不能绕过环境保护。本地构建不等于原生通过，远程运行沿用用户授权边界。

## 交付和回退

同一候选必须对应固定源码、运行文件哈希、包内审计、真实窗口报告与安装包哈希。Mac ad-hoc 签名不等于 Apple 公证；Windows 构建日志中的 signtool 步骤不等于有发布证书。

验证完归档 Mac `.app`，校验每个文件、符号链接和执行权限后移除展开副本，避免系统展示多个应用入口。保留已验证回退 ZIP 和合成备份。不要清理用户真实备份或擅自替换 `/Applications` 中的使用版本。

## 历史方案索引

- 当前：`refactor-product-plan.md`、`refactor-product-result.md`、`refactor-stage3.md`、`refactor-stage4.md`、`next-release.md`。
- 商品导入前预设、旧自动补充弹窗和整页下拉编辑：已废弃，见 `product-flow-superseded-127-128.md`，不得重新作为当前需求。
- 1.2.10 及更早发布记录、`verification.md`、早期施工和原型文档：历史决策／证据；不表示 1.2.13 的验证结果。
- `docs/ui-approved-20260919/reference/`：历史视觉参考，不进入运行包，不因本轮清理覆盖它。
