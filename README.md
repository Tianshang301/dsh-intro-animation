# dsh-intro-animation

DeepSeek Harness（DSH）的开场动画插件。安装后，打开 Harness Web / 桌面端会先全屏播放一段约 13 秒的开场动画，然后自动淡出进入主界面。

## 效果

黑底白线逐笔勾勒持剑角色与凤凰 → 金光扩散 → 晕染上色 → 剑刃高光、凤凰光影与烟花 → `Into the Unknown` / AGI 愿景文案 → `DEEPSEEK · INTO THE UNKNOWN` 落款收尾。画面主体为原 SVG 素材，未改动。

## 安装

仓库地址：<https://github.com/Tianshang301/dsh-intro-animation>

在 Harness 的「插件」页选择「安装本地 / 从 URL」，指向本目录或上述仓库 URL。也可用 CLI（需先安装 DSH）：

```bash
dsh plugin --profile web add /绝对路径/dsh-intro-animation
```

安装后重启该 profile（package manifest 与 client 元数据在进程内缓存，重启才生效）。

## 配置

在插件目录新建 `intro.config.json`（不受版本管理影响），可覆盖默认值：

```json
{
  "enabled": true,
  "playMode": "once",
  "autoCloseMs": 13600,
  "skipLabel": "跳过动画"
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否启用开场动画 |
| `playMode` | `once` | `once`=每个标签会话只播一次；`always`=每次页面加载都播；`never`=不自动播 |
| `autoCloseMs` | `13600` | 超时兜底关闭时间（毫秒） |
| `skipLabel` | `跳过动画` | 跳过按钮文案 |
| `overlayOpacity` | `1` | 浮层不透明度 |

修改配置后重启 profile；已打开的页面会在 host 重启后自动收到 client 半更新。

运行期也可在浏览器控制台手动控制：

```js
dshIntroAnimation.replay() // 重新播放
dshIntroAnimation.stop()   // 立即结束
```

## 结构

```
dsh-intro-animation/
├── package.json          # dsh.bundle + dsh.client manifest
├── cordis.patch.yml      # 向组合树插入插件行
├── index.js              # Host 半：静态资源路由 + client 半发布
├── client.js             # Client 半：全屏浮层播放、跳过、淡出
├── assets/intro.html     # 开场动画（自包含，含内嵌线稿与矢量素材）
└── scripts/selfcheck.mjs # 离线自检
```

## 离线自检

```bash
node scripts/selfcheck.mjs
```

校验 manifest、patch、host/client 契约与动画资源完整性，不启动 DSH、不联网。

## 边界与安全

- 只提供本机只读路由：`/dsh-intro/asset/intro.html` 与 `/dsh-intro/config`，其他路径 404。
- 不注册工具、不读写工作区、不读取会话内容、不联网、不保存凭据。
- 以当前 DSH 进程权限运行；安装第三方插件前请审阅源码。
- 尊重浏览器 `prefers-reduced-motion` 由动画自身处理；本插件浮层不阻塞跳过按钮。

## 许可

MIT
