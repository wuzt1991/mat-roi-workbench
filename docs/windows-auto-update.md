# Windows 自动更新

这份说明面向维护公开 GitHub 仓库的发布者。当前版本只支持 Windows x64；macOS 不参与自动更新。

## 更新行为

工作台顶部的“检查更新”按钮连接固定的 GitHub Releases 源。应用不会在启动时自动检查，也不会自动下载或打断当前工作。

| 状态 | 工作台显示 | 用户操作 |
| --- | --- | --- |
| 检查中 | 正在检查更新… | 等待请求完成 |
| 无新版本 | 当前已是最新版 | 继续使用当前版本 |
| 有新版本 | 发现新版本 vX.Y.Z | 点击下载更新 |
| 下载中 | 正在后台下载 XX% | 继续编辑工作台 |
| 已下载 | 已下载，重启安装 | 保存完成后点击重启安装 |
| 失败 | 更新失败，继续使用当前版本 | 继续使用当前版本，稍后重试 |

只有主进程调用 `electron-updater`。渲染页面只能通过 preload 暴露的四个固定动作触发检查、下载、安装和状态监听，不能传入 URL 或命令。

重启安装前，应用会向当前渲染窗口询问是否可以退出。存在未保存修改、保存队列 pending、正在保存、保存失败、版本冲突或打开编辑对话框时，按钮保持禁用。SQLite 数据目录位于应用安装目录之外，更新只替换应用文件，不迁移或删除 `workbench.sqlite`。

## 配置 GitHub 仓库

首次发布前，先创建公开仓库并把本项目源码推送到默认分支。不要把个人访问令牌写入源码或安装包。

1. 在 GitHub 创建公开仓库，例如 `mat-roi-workbench`。
2. 在仓库 `Settings > Actions > General` 将工作流权限设为允许读写仓库内容，或保留工作流顶部的 `contents: write` 权限声明。
3. 确认 `.github/workflows/release.yml` 已进入默认分支。
4. 确认 `package.json` 的 `version` 与准备发布的 tag 一致。

构建配置从环境变量读取 owner 和仓库名：

```sh
MAT_UPDATE_OWNER=your-github-owner \
MAT_UPDATE_REPO=your-public-repo \
npm run package:win
```

本地 `package:win` 永远使用 `--publish never`，产物写入 `dist-builder/`。配置了 owner 和 repo 后，electron-builder 会生成 NSIS 安装包、`latest.yml` 和 blockmap 元数据。未设置这两个变量时不会写入虚构仓库，构建仍可用于静态检查，但不能发布更新源。

## 发布 v1.1.7

在 Windows runner 上创建 tag 会运行测试、语法检查、NSIS 构建，并使用 GitHub Actions 内置 `GITHUB_TOKEN` 创建或更新 Release：

```sh
npm version 1.1.7 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: v1.1.7"
git tag v1.1.7
git push origin main v1.1.7
```

工作流从 `github.repository_owner` 和 `github.event.repository.name` 设置 `MAT_UPDATE_OWNER`、`MAT_UPDATE_REPO`，因此仓库名称不需要硬编码。Release 资产至少包含：

- `地垫工作台-1.1.7-windows-x64.exe`
- `latest.yml`
- 对应的 `.blockmap`

发布前请在 Actions 日志确认 `npm test`、`npm run check` 和 `npm run release` 均返回退出码 0。Windows 安装包和真实升级流程需要 Windows 机器验证；本机 macOS 不能替代该验证。

## 旧 ZIP 版迁移

旧 ZIP/解压版没有安装器，也没有自动更新元数据。用户首次迁移时需要手动运行 v1.1.7 NSIS 安装包，并选择原来的安装位置或新的位置。应用数据目录保持原路径：

- Windows：`%LOCALAPPDATA%\MatROIWorkbench\workbench.sqlite`
- macOS（仅保留既有数据，不提供自动更新）：`~/Library/Application Support/MatROIWorkbench/workbench.sqlite`

安装器覆盖应用文件不会覆盖上述 SQLite 文件。首次启动后检查店铺、计划、账目和商品转表规则；之后从 GitHub Releases 下载的版本会在后台下载，只有点击“重启安装”才会退出并安装。

## 未签名包限制

首版不购买 Windows 代码签名证书。Windows SmartScreen 可能显示“未知发布者”或拦截首次运行；用户需要在确认来源后选择“更多信息 > 仍要运行”。签名证书不能通过 GitHub Actions 内置 token 代替，后续购买证书后再增加签名步骤。

## 故障处理

网络失败、GitHub 不可用、源配置缺失或下载校验失败时，工作台只显示错误状态并继续使用当前版本。不要删除数据目录来排查更新问题；先导出 Excel 备份，再重试检查更新或手动安装新的 NSIS 包。
