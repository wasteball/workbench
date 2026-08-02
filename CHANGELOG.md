# 变更日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，并计划在首个稳定版本后遵循语义化版本。

## [0.1.0] - 2026-08-02

### Added

- Chrome、Edge 和 Safari 浏览器扩展构建入口。
- 工具栏 Popup 与完整工作台页面。
- 统一设置中心、主题、菜单排序/隐藏、Popup 快捷项和网页工具。
- 网页快捷方式编辑，以及 Popup 最多三项的明确固定规则。
- 本地优先的 Markdown 文档、恢复草稿和最近文档。
- CodeMirror 源码编辑、阅读/分屏模式、查找替换、撤销与重做。
- GFM、代码高亮、KaTeX、Mermaid 图表查看工具、安全 HTML 清理和文档大纲。
- 阅读态任务勾选会同步更新 Markdown 源码，并进入恢复草稿流程。
- Markdown、独立 HTML、DOCX 导出和浏览器打印/PDF。
- 文件上传队列、本地分享历史和 Markdown 在线分享。
- 已有上传网关、阿里云 OSS AccessKey 和 STS 连接器。
- 配置脱敏导入/导出与本地数据清除。
- 单元测试、三浏览器构建检查和真实 Edge 扩展自动化流程。

### Changed

- 合并原先按 HTML/Word 区分的 Markdown 工作区，格式改为统一导出选项。
- 网页工具改为独立标签页快捷方式，不再把任意远程网页作为扩展内数据通道。
- 本地分享记录与云端对象分开表达，避免把删除本地记录误解为删除远端文件。
- 移动端 Markdown 工具栏改为稳定两行布局，文档列表默认收起。

### Security

- 删除所有内置存储地址、Bucket、用户标识和凭据默认值。
- 长期 AccessKey Secret 支持仅会话使用，配置导出始终脱敏。
- 本地 Markdown 渲染不依赖运行时 CDN 或公共代理。

### Known Limitations

- 上传网关尚缺生产接口契约和真实环境验收。
- Safari 仍需 macOS/Xcode 转换、签名和实机验证。
- 旧版能力的剩余迁移状态见[功能迁移矩阵](docs/feature-migration.md)。
