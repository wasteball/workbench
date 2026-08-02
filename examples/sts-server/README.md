# Workbench STS 参考服务

这是一个只使用 Node.js 标准库的最小协议示例。它适合单用户自托管和联调，不包含多用户登录、数据库、限流基础设施或生产部署平台配置。

## 运行

1. 复制 `.env.example` 中的字段到部署平台的安全环境变量，不要创建真实 `.env` 提交到仓库。
2. 使用一个只能执行 `sts:AssumeRole` 的服务端 RAM 用户。
3. 为 `ALIYUN_ROLE_ARN` 指向的角色配置只覆盖目标 Bucket/前缀的基础权限；本服务还会附加会话 Policy 收窄范围。
4. 设置精确的扩展 Origin 和长随机 Bearer token。
5. 启动服务：

```bash
npm start
```

6. 通过 HTTPS 反向代理公开服务，把 URL 和 `Authorization: Bearer ...` 请求头填入 Workbench 的 STS 连接。

Node.js 不会自动读取 `.env`。本示例假设环境变量由 shell、容器或部署平台注入。

启动时会拒绝通配 Origin、非扩展 Origin、短于 32 个字符的 Bearer token，以及超出 900 至 3600 秒范围的 STS 有效期。

## 安全限制

- 服务拒绝请求中与环境变量不一致的地域、Bucket 或前缀。
- CORS 不是认证；每个请求仍需 Bearer token。
- 共享 token 只适合单用户部署。多人环境必须接入真实身份与逐用户授权。
- 服务端长期 AccessKey 不得写入代码、日志、客户端响应或扩展设置。
- 生产环境应增加反向代理限流、结构化安全日志、健康检查和密钥轮换。
- 不要把该服务直接暴露在明文 HTTP 上。

接口格式见[STS 集成指南](../../docs/sts-integration.md)。
