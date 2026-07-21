# XMind Preview

一个可安装的本地 XMind 预览 PWA。文件在浏览器本地解析与渲染，不上传到部署站点。

首页默认展示一张“XMind Preview 使用指南”思维导图；用户选择或拖入自己的文件后，预览内容会替换为该 XMind 文件。

## 预置导图切换

将要展示的 `.xmind` 文件放入 `public/maps/`，再登记到 `public/maps/catalog.json`。发布后，页面会在标题旁显示内容选择器，用户可在使用指南和预置导图之间切换：

```json
{
  "maps": [
    {
      "id": "sales-plan",
      "title": "销售计划",
      "file": "./maps/sales-plan.xmind"
    }
  ]
}
```

预置导图会随 GitHub Pages 一起公开发布，因此只适合放可公开访问的内容。

## 使用方式

在 Chrome 或其他 Chromium 浏览器中打开部署地址，点击地址栏右侧的安装图标，安装 `XMind Preview`。

安装后可以：

- 点击“打开”选择任意 `.xmind` 文件。
- 把 `.xmind` 文件拖入预览页。
- 在支持 File Handling API 的桌面 Chromium 浏览器中，从系统“打开方式”选择已安装的 `XMind Preview`。

```mermaid
flowchart LR
  A[访问 GitHub Pages] --> B[在浏览器安装 PWA]
  B --> C[选择或拖入 XMind 文件]
  C --> D[浏览器本地解析并预览]
```

## 发布到 GitHub Pages

项目已包含 GitHub Pages 工作流。首次发布：

1. 在 GitHub 创建一个新仓库，并将本项目推送到 `main` 分支。
2. 打开仓库的 `Settings`，进入 `Pages`，在 `Build and deployment` 中选择 `GitHub Actions`。
3. 推送完成后，等待 `Actions` 中的“发布 XMind Preview PWA”任务结束。
4. 访问 `https://<GitHub 用户名>.github.io/<仓库名>/`。

之后每次推送 `main` 分支，GitHub Pages 都会自动更新。把这个地址发给其他人，他们在 Chrome 打开并安装即可使用。

## 本地开发

```bash
pnpm install
pnpm dev
```

构建生产文件：

```bash
pnpm build
```

## 实现

- `@mind-elixir/import-xmind` 将 `.xmind` 转换为 Mind Elixir 数据。
- `mind-elixir` 负责渲染思维导图。
- `JSZip` 提取 XMind 内嵌的图片资源。
- Service Worker 缓存应用壳，以支持已安装应用的离线启动。
