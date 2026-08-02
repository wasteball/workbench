# STS 集成指南

STS 模式让 Workbench 只获得短期阿里云凭证。长期 AccessKey 留在用户自己的服务端，用于调用阿里云 `AssumeRole`，不能下发给扩展。

## 请求

Workbench 对用户配置的 HTTPS 地址发送：

```http
POST /workbench/sts
Content-Type: application/json
Authorization: Bearer <用户配置的认证值>
```

```json
{
  "region": "oss-cn-hangzhou",
  "bucket": "example-bucket",
  "prefix": "workbench/"
}
```

认证请求头由用户在设置中配置，值只保存在当前浏览器并在配置导出时移除。

## 成功响应

```json
{
  "accessKeyId": "STS.example",
  "accessKeySecret": "temporary-secret",
  "securityToken": "temporary-token",
  "expiration": "2026-08-01T05:30:00Z",
  "capabilities": ["upload", "list", "signed-link"]
}
```

`expiration` 可使用 ISO 8601 字符串或毫秒时间戳，返回时必须至少剩余 5 分钟。

允许的能力：

| 能力 | 界面用途 |
| --- | --- |
| `upload` | 上传文件和 Markdown 分享 |
| `list` | 查看当前前缀的云端对象 |
| `remove` | 删除远端对象 |
| `rename` | 复制为新对象并删除旧对象 |
| `signed-link` | 为私有对象生成限时链接 |
| `public-link` | 使用公开对象 URL |

能力列表是服务端对 RAM Policy 的声明，不替代阿里云权限检查。实际请求被拒绝时，Workbench 仍会显示明确错误并停止相应动作。

## 错误响应

使用稳定、无敏感信息的结构：

```json
{
  "code": "not_authorized",
  "message": "当前用户不能为这个存储空间申请凭证。"
}
```

- 未登录或 token 失效使用 `401`。
- 用户身份有效但无目标权限使用 `403`。
- 请求字段不合法使用 `400`。
- 签发服务暂时不可用使用 `503`。

不要在响应、日志或追踪信息中返回长期 AccessKey、完整 RAM Policy、内部堆栈或上游签名字符串。

## 服务端必须执行的检查

1. 验证调用者身份；不能只依赖 CORS。
2. 在服务端固定允许的地域、Bucket、对象前缀和能力。
3. 对请求体设置大小限制并拒绝未知字段或危险前缀。
4. 使用独立 RAM 角色和最小权限 Policy。
5. 把临时凭证有效期限制在业务需要范围内。
6. 只允许配置的扩展来源，并正确处理 `OPTIONS`。
7. 对签发频率、异常失败和权限变化做服务端审计，但不记录凭证内容。
8. 使用 HTTPS；生产环境不允许明文 HTTP。

## 参考实现

[`examples/sts-server`](../examples/sts-server/) 提供一个只依赖 Node.js 标准库的单用户参考服务：

- 使用 Bearer token 认证；
- 只接受环境变量固定的地域、Bucket 和前缀；
- 根据固定能力生成最小范围 Policy；
- 直接调用阿里云 STS `AssumeRole`；
- 返回 Workbench 所需的小写字段；
- 不把上游错误或凭据写入客户端响应。

该示例适合自托管和协议联调。多人环境应替换为现有登录体系、服务端会话和逐用户授权，不要把共享 Bearer token 硬编码进公开扩展。

## 联调清单

- STS 地址使用 HTTPS。
- 扩展设置中的地域、Bucket、前缀与服务端允许值完全一致。
- 认证请求头有效，配置导出后其值为空。
- 响应 `Date` 和 `expiration` 使用正确时间。
- 凭证剩余时间大于 5 分钟。
- `capabilities` 与 RAM Policy 一致。
- 上传、列表、私有签名链接分别用最小测试对象验证。
- 凭证过期或权限撤销后，新的远端动作停止，本地编辑和导出继续可用。
