# Windows 在线更新维护

适用于 Windows x64 安装版。macOS 不使用此更新通道。

## 客户端行为

1.2.x 客户端使用 `common/update-config.cjs` 固定的阿里云 OSS 地址；早期 1.1.x 使用 GitHub Releases。正式发布要同时维护两个通道，不能只推送代码或上传测试附件。

用户点击“检查更新 → 下载更新 → 重启安装”。启动时不自动检查，不自动下载，不因普通退出自动安装。未保存、保存失败、版本冲突或未完成文件任务时，退出保护阻止安装。数据目录位于应用目录之外，安装器只替换应用文件。

## 候选与正式发布

1. 检查当前版本发布记录和 `validation/release-acceptance.json`，完成所要求的环境与 Office 验收。
2. 在发布分支运行 `windows-candidate.yml`。所有任务必须通过，报告对应同一安装程序及业务载荷。
3. `update-readiness.yml` 只读取更新源并检查 CI 凭据是否配置，不上传文件，也不输出凭据。
4. 把 `v<package.json版本>` 标签指向已通过正式候选的准确源码提交。标签触发 `release.yml`，发布期间串行执行。
5. 发布程序校验既定安装包，先暂存国内不可变附件、匿名下载校验，再创建或续传 GitHub 草稿，最后切换国内 latest.yml 并公开 GitHub Release。发布不重新构建。
6. 发布后两个 Windows 旧客户端使用未修改的真实更新地址完成检查、下载、重启和数据保留验证；公共文件下载结果必须与候选哈希一致。

`npm run package:win` 使用 `--publish never`；`npm run release` 禁用。不要用本地重建包覆盖已验收的同版本文件，不强推标签或覆盖不同的已发布附件。

## 更新源检查

```sh
node scripts/publish-oss-update.cjs validation/candidate
node scripts/publish-oss-update.cjs validation/candidate --preflight
node scripts/publish-oss-update.cjs validation/candidate --verify-public
```

第一条只校验本地文件；第二条读取当前线上清单并拒绝降级；第三条要求线上已经是本次候选，并完整下载校验安装包及 blockmap。`--stage-assets` 和 `--publish` 仅在授权发布工作流使用现有 CI secrets。

`UserDisable` 是 OSS 服务端错误，先检查阿里云账号或服务状态。更新清单被禁用时，不先公开另一通道并宣称全部在线更新成功。若发布中途失败，按记录检查每个通道的实际状态；同字节附件可安全续传，已有不同内容必须停止调查。

## 数据与旧版迁移

Windows 数据路径：`%LOCALAPPDATA%\MatROIWorkbench\workbench.sqlite`。旧 ZIP 版需先手动安装 NSIS 包。旧版卡在恢复页时可直接运行新版安装包覆盖安装，不要删除原数据目录排查。

当前 Windows 安装包未购买商业代码签名，SmartScreen 可能显示未知发布者。任何发布说明都不能把构建日志中的签名工具步骤写成已取得签名证书。
