# 发布检查清单

本清单用于 GitHub Release、Chrome/Edge 商店包和 Safari 包装发布。每次发布复制一份到 Release Issue，填写实际版本和证据链接。

## 1. 范围与版本

- [ ] `package.json`、扩展 manifest 和变更日志版本一致。
- [ ] [功能迁移矩阵](feature-migration.md)中的发布范围已逐项完成或明确写入 Known limitations。
- [ ] 没有把“部分完成”“需外部验收”描述为完整支持。
- [ ] `CHANGELOG.md` 已把本次内容从 Unreleased 移到具体版本。
- [ ] README 的浏览器支持表述与本次真实验收一致。

## 2. 代码质量

```bash
npm ci
npm run notices
npm run scan:release
npm run docs:check
npm run lint
npm run check
npm test
npm run build:chrome
npm run build:edge
npm run build:safari
```

- [ ] 所有命令退出码为 0。
- [ ] 依赖安装使用锁文件，未出现未审查的锁文件变更。
- [ ] `THIRD_PARTY_NOTICES.md` 和 `THIRD_PARTY_LICENSES.txt` 与当前生产依赖一致。
- [ ] 大体积 chunk 警告已评估，Popup 和首页首屏不加载 OSS、DOCX 或 Mermaid 重模块。
- [ ] 生成的三个 manifest 权限与预期一致。

## 3. 安全与隐私

- [ ] 发布扫描没有旧品牌、内部网址、机器绝对路径、AccessKey、私钥或公共 CDN/代理。
- [ ] 默认网关 API、Bucket、用户标识、请求头和阿里云凭据均为空。
- [ ] 配置导出样例不含 AccessKey ID/Secret、用户标识和请求头值。
- [ ] 恶意 Markdown 测试覆盖脚本、事件属性和危险协议。
- [ ] 未修改的本地文件正文不会写入 IndexedDB。
- [ ] 清除本地数据会移除草稿、记录、设置和已保存凭据。
- [ ] `PRIVACY.md`、`SECURITY.md` 和商店权限说明一致。
- [ ] GitHub Private vulnerability reporting 已启用。

## 4. Chrome 与 Edge

分别记录实际浏览器版本、系统版本和测试日期。

- [ ] 从全新浏览器配置加载打包产物，不使用开发缓存。
- [ ] Chrome 稳定版通过 `chrome://extensions` 完成一次最终人工加载。Chrome 已不支持测试工具用命令行加载未打包扩展，不能把该工具限制误判为产品验收。
- [ ] Popup 打开工作台、设置、新建、打开和上传路由正确。
- [ ] 1440px 与 390px 页面无文字裁切、重叠或内部横向滚动。
- [ ] 新建、编辑、恢复草稿、保存副本和最近文档可用。
- [ ] GFM、代码、KaTeX、Mermaid 和大纲可用。
- [ ] Markdown、HTML、DOCX 和打印/PDF 完成一次真实输出。
- [ ] 网站权限在读取 URL 时按站点申请，拒绝后本地功能不受影响。
- [ ] 网页快捷方式在新标签页打开，不能读取 Workbench 数据。
- [ ] 控制台无未解释错误，页面无 `pageerror`。

## 5. 存储验收

所有测试使用专用 Bucket、最小 RAM 权限和可撤销凭据；凭据不进入截图、日志或 Issue。

### 上传网关

- [ ] 非敏感接口契约已归档：认证、字段、错误、大小、覆盖、链接访问与过期、健康检查。
- [ ] 小文件上传、超限、认证失败、网络断开和取消分别验证。
- [ ] 返回链接由未登录收件人按契约验证。
- [ ] 确认本地删除记录不会删除远端对象。

### 阿里云 AccessKey

- [ ] AccessKey 来自独立 RAM 用户，不是主账号。
- [ ] CORS、地域、Endpoint、Bucket 和前缀经过真实浏览器验证。
- [ ] “仅本次使用”重启后 Secret 消失。
- [ ] “在此浏览器记住”可连接，导出配置仍不含凭据。
- [ ] 私有签名链接和公开链接分别验证访问行为。
- [ ] 无列表/删除权限时，相应界面不提供误导操作。

### 阿里云 STS

- [ ] STS 服务使用 HTTPS 和真实用户认证。
- [ ] Bucket、前缀和能力由服务端固定或授权，不信任请求体扩权。
- [ ] 正常签发、401、403、错误结构、短于 5 分钟和过期刷新分别验证。
- [ ] 签名链接有效期不超过临时凭证有效期。
- [ ] STS 失败时本地编辑和导出继续可用。

## 6. Safari

- [ ] 在 macOS 使用当前 Xcode 转换 `.output/safari-mv2`。
- [ ] 容器 App 和扩展 Target 使用正式唯一 Bundle Identifier。
- [ ] 签名、启用和重新安装流程通过。
- [ ] 按 [Safari 构建指南](safari-build.md)完成全部实机流程。
- [ ] 记录实际 macOS、Xcode、Safari 版本和已知降级。
- [ ] 未通过实机时，发布说明只写“可生成 Safari 资源”。

## 7. 发布产物

- [ ] Chrome 和 Edge 分别生成 zip，解压后 manifest 位于根目录。
- [ ] Safari Xcode Archive 来自相同提交和版本。
- [ ] 产物中包含图标、隐私/许可入口所需材料，不含源码映射和测试数据。
- [ ] 为每个产物生成 SHA-256 校验值。
- [ ] 在全新目录解压并加载一次最终 zip。
- [ ] Git tag、GitHub Release 标题和附件命名一致。
- [ ] Release notes 包含新增、修复、已知限制、数据/权限变化和升级说明。

## 8. 发布后

- [ ] GitHub Release 和商店页面链接可访问。
- [ ] 安装说明与实际包一致。
- [ ] 隐私政策和安全报告入口在仓库中可找到。
- [ ] 建立下一版本 Issue，记录本次被明确后置的迁移项。
