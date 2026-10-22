# 项目指纹与来源核验 / Project provenance

项目使用固定公开项目 ID、核心源码 SHA-256 清单、网页元数据、HTTP 响应头和
可见来源声明标识 L4D2-Control。指纹不采集设备、浏览器、SteamID 或部署者信息，
不联网回传，也不会因为指纹不同而关闭服务。

## 核验

```sh
npm run fingerprint:check
```

命令校验 `Project fingerprint.json` 与选定核心源码是否一致，不一致时返回非零状态。
公开接口 `GET /.well-known/l4d2-control.json` 提供项目 ID、来源地址、许可及构建摘要。
响应头为 `X-L4D2-Project`、`X-L4D2-Fingerprint` 和 `X-L4D2-License`。
网页 `<meta>` 和页脚展示同一标识。

本地清单只能证明当前文件与该清单一致。核验是否为官方版本，还需与官方仓库
相应提交中的清单比较。复制者可以移除或重写公开源码中的标记，指纹不提供
不可删除或不可伪造的保证；商业限制由项目许可声明表达。

## 维护

修改核心源码后运行以下命令，并将新清单与源码一起提交、部署：

```sh
npm run fingerprint:build
npm run fingerprint:check
```

覆盖范围明确列在 `project fingerprint.js` 的 `SOURCE_FILES`。
私有配置、账号库、地图和下载插件不在指纹范围内。构建过程只读取这个固定清单，
不会扫描服务器其他文件。修改版应保留项目来源，并说明与官方版本的差别。

## English

The fixed public project ID, selected-source SHA-256 manifest, HTML metadata,
response headers, and visible attribution identify the project. No device or user
fingerprint, telemetry, private configuration, or player data is collected.

`npm run fingerprint:check` validates the local manifest. To establish official
provenance, compare it with the manifest in the corresponding official repository
commit. The local manifest is not a digital signature. Public source can be
modified or have markers removed; the non-commercial license defines permitted
use, while fingerprints support source comparison. Mismatches do not disable the
server. Rebuild and commit the manifest after legitimate source changes.
