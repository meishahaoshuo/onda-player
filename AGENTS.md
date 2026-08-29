# AGENTS.md — AI 开发指引

本项目是「网页版本地音乐播放器」（Vue 3 + Vite + TypeScript，对标 Salt Player）。本文件是 AI 助手在本仓库工作的最高指引。

## 1. 必读标准文件（开发任何内容前先读）

| 文件 | 内容 | 何时读 |
|---|---|---|
| `docs/01-需求说明.md` | 功能需求与验收总纲 | 每次开发会话开始 |
| `docs/02-技术方案.md` | 技术栈/架构/数据模型/目录结构 | 涉及数据结构、服务层、新依赖时 |
| `docs/03-设计规范.md` | 配色/磨砂/布局/组件状态规范 | 写任何 UI 前后 |
| `docs/04-开发步骤.md` | 分阶段计划与当前进度 | 每次开发会话开始与结束 |

## 2. 工作流程（强制）

1. **开始**：读 `docs/04-开发步骤.md`，确认当前阶段；只做当前阶段内的事，禁止跨阶段批量开发。
2. **实现**：遵循 `docs/02-技术方案.md` 的结构与 `docs/03-设计规范.md` 的视觉规范；颜色/尺寸只引用 CSS 变量。
3. **验证**：每阶段结束运行 `npm run dev` 在浏览器中实际验证，对照 `docs/01-需求说明.md` 验收标准； TypeScript 检查用 `npm run build`（含 vue-tsc）。
4. **记录**：会话结束前更新 `devlog/YYYY-MM-DD.md`（当天日期，不存在则创建，模板见 devlog 目录内 `_TEMPLATE.md`）。
5. **提交**：更新 `docs/04-开发步骤.md` 进度标记后 `git commit`，一次阶段一个提交，message 用中文简述。

## 3. 约束

- 不引入 `docs/02-技术方案.md` 以外的新依赖；确有必要时先在日志中记录理由并更新 02 文档
- 不硬编码颜色/字号，一律用 `src/styles/main.css` 的 CSS 变量
- 保持零网络请求（隐私要求），不得引入任何遥测/CDN 资源
- 所有用户可见文案使用简体中文

## 4. 常用命令

```bash
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览 build 产物
```

## 5. 运行环境

- 需要 Chrome / Edge 浏览器（File System Access API）
- 页面必须通过 http(s) 访问，`file://` 打开无效
