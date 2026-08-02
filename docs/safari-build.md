# Safari 构建与验收

> 历史文档：项目从 `0.1.6` 起只维护和发布 Chrome 插件，本指南不再属于当前发布流程。

WXT 可以在任意支持 Node.js 的系统生成 Safari Web Extension 资源，但 Safari App Extension 包装、签名和运行只能在 macOS 与 Xcode 中完成。

## 1. 生成资源

```bash
npm ci
npm run build:safari
```

输出目录为 `.output/safari-mv2`。构建成功不等于 Safari 已验收。

## 2. 转换为 Xcode 项目

在安装了当前 Xcode 的 macOS 上运行：

```bash
xcrun safari-web-extension-converter .output/safari-mv2 \
  --project-location build/safari \
  --app-name Workbench \
  --bundle-identifier com.example.workbench
```

发布前必须把 `com.example.workbench` 替换为仓库所有者控制的唯一 Bundle Identifier。转换器参数可能随 Xcode 版本变化；以当前 `xcrun safari-web-extension-converter --help` 为准。

如果已存在 Xcode 包装项目，应更新 Web Extension 资源，而不是每次创建新的签名目标。

## 3. Xcode 设置

1. 为 macOS 容器 App 和 Safari Extension 选择正确 Team。
2. 确认两个 Target 的 Bundle Identifier 唯一且层级一致。
3. 检查最低 macOS 版本和 Safari 版本。
4. 检查转换后的权限说明，不增加未使用权限。
5. 在 Debug 和 Release 配置中确认扩展资源来自同一构建版本。
6. 使用真实签名运行容器 App，并在 Safari 设置中启用扩展。

## 4. 必测流程

- Popup 能打开完整工作台和设置。
- 新建 Markdown、编辑并在关闭/重开后恢复草稿。
- 打开单个文件和整个文件夹；文件句柄不可用时正确降级为下载副本。
- 阅读、源码和窄屏布局无裁切或重叠。
- GFM、代码、KaTeX 和 Mermaid 正常显示，恶意 HTML 被清理。
- HTML、DOCX 下载和浏览器打印/PDF 可完成。
- 配置导出不含 AccessKey、用户标识和请求头值。
- 网站权限按目标域名申请，拒绝后本地功能继续可用。
- 上传网关、OSS AccessKey 和 STS 分别在测试环境验证。
- 私有链接的有效期不超过 STS 凭证有效期。
- 清除本地数据后，设置、草稿、分享记录和已保存凭据消失。

## 5. 已知平台差异

- Safari 对 File System Access API 和持久文件句柄的支持与 Chromium 不同。首版最低承诺是能下载保存副本，不承诺原地写回。
- `browser.storage.session` 不可用时，未记住的 Secret 只保存在扩展运行内存，重启后需要重新填写。
- 网站权限提示、打印界面和下载位置由 Safari 控制，文案和 Chromium 不完全相同。
- Safari 使用 MV2 兼容产物；业务代码不得据此直接依赖 Chromium MV3 API。

## 6. 发布证据

发布说明中记录：

- macOS、Xcode 和 Safari 的实际版本；
- 测试日期、构建提交和签名方式；
- 上述流程的通过/失败结果；
- 与 Chrome/Edge 不同的降级行为；
- App Store Connect 或独立分发所需的隐私与权限说明。

没有这些实机记录时，只能说明“可生成 Safari 资源”，不能宣称“Safari 已支持并通过验收”。
