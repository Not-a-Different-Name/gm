# GM

GM 是一个面向桌面浏览器的可扩展体素沙盒游戏。第一阶段建立稳定的世界核心、区块坐标、种子生成、存档模型和模组边界；渲染、角色控制及联机功能按阶段接入。

## 当前状态

当前仓库是第一阶段的工程骨架，包含可测试的确定性世界基础逻辑和完整的架构说明。它还不是可游玩的版本。

## 快速开始

需要 Node.js 22 LTS 和 pnpm 10：

```bash
corepack enable
pnpm install
pnpm dev
```

常用检查：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 文档

- [项目架构](docs/architecture.md)
- [开发规范](docs/development-guide.md)
- [模组设计](docs/modding.md)
- [实施路线图](docs/roadmap.md)
- [服务器与存档](docs/server-and-storage.md)
