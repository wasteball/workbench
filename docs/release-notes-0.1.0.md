# Workbench 0.1.0

Workbench 的首个公开预览版。它是一个本地优先的浏览器扩展，用于打开、编辑、预览、导出和分享 Markdown；用户只在需要上传时连接自己的存储。

## 新增内容

- Markdown 阅读、源码编辑和分屏预览，支持 GFM、代码高亮、KaTeX 和 Mermaid 图表查看工具。
- 阅读态任务复选框可直接更新 Markdown，并自动保存为浏览器恢复草稿。
- Markdown、独立 HTML、DOCX 与浏览器打印/PDF 输出。
- 本地文件上传队列、分享记录和 Markdown 在线分享。
- 自有上传网关、阿里云 OSS 长期 AccessKey 和 STS 临时凭证连接。
- 一个集中式设置中心：外观、输出、菜单排序、Popup 快捷项、网页快捷方式和存储连接均在此配置。
- 本地优先数据规则、配置脱敏导入/导出、第三方许可证清单和发布扫描。

## 发布附件

| 文件 | 用途 | SHA-256 |
| --- | --- | --- |
| `workbench-browser-extension-0.1.0-chrome.zip` | Chrome MV3 包 | `3410910ceac3327661493febce23b8c99b9e0cd9379778c3d6b64b3fcdeb732c` |
| `workbench-browser-extension-0.1.0-edge.zip` | Edge MV3 包 | `3410910ceac3327661493febce23b8c99b9e0cd9379778c3d6b64b3fcdeb732c` |
| `SHA256SUMS.txt` | 两个发布包的校验清单 | 见附件内容 |

Safari 当前只提供由 `npm run build:safari` 生成的 Web Extension 资源。正式 Safari 安装包还需要在 macOS/Xcode 中转换、签名并完成实机验证。

## 数据与权限

- 本地文件默认不会上传；未修改正文不会写入浏览器数据库。
- 只有用户主动上传或在线分享时，内容才会发送到用户选择的存储服务。
- 默认权限仅包含本地设置和下载。网站访问和剪贴板写入会在实际需要时请求。
- 不包含 Workbench 自有账户、遥测、内置 OSS 地址或预置凭据。

## 已知限制

- 上传网关和阿里云 OSS 需要由使用者提供自己的连接信息，并完成真实 RAM、CORS 和服务端验收。
- 旧版能力尚未完整迁移，逐项状态见[功能迁移矩阵](feature-migration.md)。
- Chrome 稳定版无法由自动化工具通过命令行加载未打包扩展；商店发布前需在 `chrome://extensions` 做一次最终人工验收。

## 升级说明

这是首个公开版本，没有既有 Workbench 扩展数据迁移步骤。首次使用可直接编辑和导出 Markdown；需要上传或分享时，在“设置 - 存储连接”配置自己的网关或阿里云 OSS。
