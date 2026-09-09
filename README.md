# MindmapChat

> 基于「思维导图」的 AI 对话应用 —— **"把对话变成思维导图，让每一次追问都有迹可循"**

[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF.svg)](https://vite.dev)
[![Ant Design](https://img.shields.io/badge/AntD-5-0170FE.svg)](https://ant.design)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6.svg)](https://www.typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-5-339933.svg)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14-4169E1.svg)](https://www.postgresql.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

## 📋 项目简介

MindmapChat 是一款创新的 AI 对话工具，将传统线性对话以**思维导图**形式可视化呈现。每个问题、回答、追问都作为节点展开，帮助用户清晰梳理思路、追溯对话脉络。

- **网页端**：React 19 + Vite，浏览器直接访问
- **桌面端**：Electron 跨平台客户端（macOS / Windows / Linux），与网页端共用同一服务端数据
- **多服务商**：内置阿里云百炼、腾讯混元，基于 OpenAI 兼容协议可扩展

## ✨ 核心特性

- 🧠 **思维导图对话**：自研思维导图渲染（非第三方图库），支持缩放、平移、自动适配、全屏浏览
- 💬 **流式响应**：SSE 实时流式输出，打字机效果
- 👤 **角色长期会话**：每位用户对每个角色模板只保留一个持续会话，网页端与桌面端一致
- 🔐 **用户鉴权**：JWT + bcrypt 实现注册 / 登录 / 角色权限（管理员 / 普通用户）
- 🤖 **多模型支持**：阿里云百炼（DashScope）、腾讯混元（TokenHub），多地域 endpoint，支持思考模式与联网搜索（视供应商）
- 🎨 **精美 UI**：Ant Design 5 + 自定义主题色（#6366f1），响应式适配桌面 / 移动端
- 📝 **Markdown 渲染**：代码高亮、GFM 表格、原始 HTML、数学公式
- 💾 **数据持久化**：PostgreSQL 存储用户 / 会话 / 思维导图节点 / 消息 / 配置
- 🧪 **人格分裂体验**：一次性多角色并行问答，脑形动画展示，不留存任何数据（详见下文）

### 🧪 人格分裂体验

侧边栏的"人格分裂"进入一次性多角色体验页。可按名称、类型、地区和性格筛选并选择 2—6 个现有角色模板，将一个问题并行交给所有人格；每个回答最多显示 100 个字符，并以球形动画从脑形输入区弹出。全部完成后会生成一段不超过 200 字的综合结论。

该体验**不创建会话、面板或消息**，不把问题和回答写入数据库或浏览器本地存储。离开页面、刷新或点击"重新玩一次"都会清空本轮内容。

## 🏗️ 技术架构

```
┌───────────────────┐
│  前端 (Client)     │
│ React 19 + Vite   │
│ AntD 5 + zustand  │
└────────┬──────────┘
         │ REST + SSE
         ▼
┌───────────────────┐
│ 后端 (Server)      │
│ Express 5 + Node  │
│ chat-proxy.js     │
└────────┬──────────┘
         │ pg 连接池
         ▼
┌───────────────────┐
│  PostgreSQL DB    │
│  thinkchat 库      │
└───────────────────┘
```

### 技术栈详情

| 分类 | 技术 | 说明 |
|------|------|------|
| **前端框架** | React 19 + TypeScript | 组件化开发，类型安全 |
| **构建工具** | Vite 6 | 快速开发服务器，生产打包 |
| **UI 组件** | Ant Design 5 | 企业级组件库，中文支持 |
| **状态管理** | zustand | 轻量级全局状态 |
| **路由** | react-router-dom 7 | 页面路由与权限守卫 |
| **Markdown** | react-markdown + rehype-highlight + remark-gfm + rehype-raw | 富文本渲染、代码高亮、GFM、原始 HTML |
| **导图渲染** | 自研（DOM 定位 + 缩放平移） | 思维导图节点布局与交互，无第三方图库依赖 |
| **后端框架** | Express 5 | REST API + 静态文件服务 |
| **数据库** | PostgreSQL + pg | 关系型数据存储，连接池管理 |
| **安全** | jsonwebtoken + bcryptjs | JWT 鉴权 + 密码哈希 |
| **AI 代理** | chat-proxy.js | 多服务商 OpenAI 兼容接口统一适配 |
| **桌面端** | Electron + electron-builder | 跨平台桌面客户端与安装包 |

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（含全局 `fetch`，用于流式代理）
- PostgreSQL ≥ 14
- npm 或 pnpm

### 1. 安装依赖

```bash
git clone <your-repo-url>
cd mindmapchat
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少填写 JWT_SECRET 与 PG_* 数据库连接参数
```

### 3. 初始化数据库

`init-db.js` 会自动创建 `thinkchat` 数据库并建表（幂等，可重复执行）：

```bash
node init-db.js
```

### 4. 开发模式

```bash
# 同时启动后端 API（端口 3001）与前端 Vite（端口 5173）
npm run dev:all

# 或分开启动
npm run dev:server   # 后端 API 代理
npm run dev          # 前端开发服务器
```

> 开发模式下前端通过 Vite 代理访问后端，登录注册后即可开始对话。

### 5. 生产构建

```bash
# 构建前端到 dist/
npm run build

# 启动生产服务器（端口 11113，同时提供 API 与静态文件）
npm run start
```

### 6. 桌面客户端

桌面端工程位于 `mindmapchatdesktop/`，支持 macOS、Windows 和 Linux：

```bash
npm run desktop:install   # 安装桌面端依赖
npm run desktop:start     # 开发模式启动
npm run desktop:pack      # 生成当前平台未安装应用目录
npm run desktop:dist      # 生成当前平台安装包
```

桌面客户端默认连接 `http://localhost:11113`，可在"文件 → 服务器设置"中修改，或通过环境变量指定：

```bash
MINDMAPCHAT_SERVER_URL=http://your-host:11113 npm run desktop:start
```

详细说明见 [`mindmapchatdesktop/README.md`](mindmapchatdesktop/README.md)。

## 🔧 配置说明

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `JWT_SECRET` | ✅ | JWT 签名密钥，**缺失时生产服务器拒绝启动** |
| `MINDMAPCHAT_ADMIN_USERNAME` | 可选 | 管理员白名单（逗号分隔多个用户名）；注册该用户名即成为管理员，未配置则无管理员 |
| `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` | ✅ | PostgreSQL 连接参数（默认 `localhost:5432` / `pg` / 空 / `thinkchat`） |
| `DASHSCOPE_API_KEY` | 视供应商 | 阿里云百炼（DashScope）API Key |
| `ALIYUN_WORKSPACE_ID` | 视供应商 | 阿里云百炼业务空间 ID（部分地域需要） |
| `TENCENT_TOKENHUB_API_KEY` | 可选 | 腾讯混元 TokenHub API Key |
| `BASE_URL` | 可选 | 文件上传拼接的公网访问地址（如 `http://your-host:11113`），留空则生成相对路径 |
| `MINDMAPCHAT_SERVER_URL` | 可选 | 桌面端默认连接的服务端地址（默认 `http://localhost:11113`） |

### 配置优先级

```
客户端传入配置 > 服务端全局配置 > 代码默认值
```

用户可在"设置"面板维护自己的模型配置；管理员可在全局配置中设置默认供应商 / 模型 / 系统提示词。

## 🔑 配置你自己的 AI Key

### 作为部署者（管理员）

**先声明管理员账号**：在 `.env` 中设置 `MINDMAPCHAT_ADMIN_USERNAME`（支持逗号分隔多个用户名）。使用该用户名注册后即为管理员；若该用户已存在，重启服务后生效。

然后通过环境变量或管理员面板设置**全局默认模型**，所有未自带 Key 的用户将使用你的配置：

1. **环境变量方式**（推荐）：在 `.env` 中填写 `DASHSCOPE_API_KEY`、`TENCENT_TOKENHUB_API_KEY` 等
2. **管理员面板方式**：登录后进入"设置" → "全局模型配置"，选择供应商、填写 Key、模型名、系统提示词

> ⚠️ 全局配置中的 Key **对普通用户不可见**（接口已脱敏），用户只能使用模型，无法读取密钥。

### 作为普通用户（BYOK）

每位用户也可以在个人设置中填写**自己的 API Key**（Bring Your Own Key）：

1. 点击左下角"设置" → "模型配置"
2. 开启"使用自己的 Key"
3. 填写供应商、模型名、API Key、Base URL
4. 保存后，你的所有对话将使用**你自己**的 Key，与全局配置完全隔离

Key 存储在数据库 `user_configs` 表中，仅本人可见。

### 接入新服务商

`chat-proxy.js` 基于 **OpenAI 兼容协议** 实现。只要填写自定义 `baseUrl` + `apiKey`，即可接入任何 OpenAI 兼容服务（如 Ollama、vLLM、第三方 API 等），无需修改代码。

## 📁 项目结构

```
mindmapchat/
├── src/                        # 前端源码（React 19 + TS）
│   ├── components/             # 通用组件（MarkdownRenderer / SettingsPanel / ModelConfigModal ...）
│   ├── hooks/                  # 自定义 Hooks（useResponsive）
│   ├── pages/
│   │   ├── mindmap/            # 思维导图子模块（MindMapView / ChatInput / MessagePanel ...）
│   │   ├── MindmapChat.tsx     # 思维导图对话主页面
│   │   ├── LoginPage.tsx       # 登录页
│   │   ├── RegisterPage.tsx    # 注册页
│   │   ├── PersonalitySplit.tsx# 人格分裂体验页
│   │   └── UserQuestionsPage.tsx # 我的问题页
│   ├── store/useStore.ts       # Zustand 全局状态
│   ├── utils/                  # 工具函数（建议、人格选择、气泡布局、日志）
│   ├── App.tsx                 # 根组件与路由
│   └── main.tsx                # 入口文件
├── server-prod.js              # 生产服务器（API + 静态文件，端口 11113）
├── server.js                   # 开发 API 代理（端口 3001）
├── chat-proxy.js               # 多服务商模型代理（OpenAI 兼容）
├── db.js                       # PostgreSQL 连接池与自动迁移
├── init-db.js                  # 数据库初始化（自动建库建表）
├── mindmapchatdesktop/         # Electron 桌面客户端
├── tests/                      # 人格分裂相关单元测试
├── .env.example                # 环境变量模板
├── package.json
└── tsconfig.json
```

## 🗄️ 数据模型

> 思维导图以"面板（Panel）"为节点、以"消息（Message）"为内容。点击 AI 回复末尾的"追问"建议时，会派生出新的子面板，形成树状对话结构：

### 核心表结构

```sql
-- 用户表
users (id, username, password_hash, nickname, is_admin, created_at)

-- 用户配置表（每用户模型配置）
user_configs (user_id, provider, api_key, model, temperature, ...)

-- 全局配置表（管理员设置，id=1 单行）
global_config (id, provider, api_key, model, system_prompt, ...)

-- 会话表
conversations (id, user_id, title, background, data_version, role_template_id, ...)

-- 面板表（思维导图节点，容器 / 消息两种类型）
panels (id, conversation_id, parent_id, title, type, sort_order, summary, ...)

-- 消息表
messages (id, panel_id, role, content, suggestions, reasoning, parent_message_id, ...)
```

## 🔌 API 概览

核心接口（全部需要 `Authorization: Bearer <token>`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat` | 流式对话（SSE），支持思考模式 / 联网搜索 / 图片 |
| `POST` | `/api/personality-split` | 人格分裂并行问答 |
| `POST` | `/api/personality-split/summary` | 人格分裂综合总结 |
| `POST` | `/api/register` / `/api/login` | 注册 / 登录 |
| `GET/POST/PUT/DELETE` | `/api/conversations` | 会话管理 |
| `POST` | `/api/conversations/:id/sync` | 多端同步（版本号机制） |
| `GET/POST/PUT/DELETE` | `/api/panels`、`/api/messages` | 导图节点与消息 |
| `POST` | `/api/panels/:id/summarize` | 节点对话总结 |
| `GET/PUT` | `/api/config`、`/api/config/global` | 用户 / 全局模型配置 |
| `GET/POST/PUT/DELETE` | `/api/role-templates` | 角色模板管理（管理员） |
| `POST` | `/api/upload` | 图片上传 |

## 📦 部署指南

### PM2 进程管理（推荐）

```bash
npm install -g pm2
npm run build
pm2 start server-prod.js --name mindmapchat
pm2 save
pm2 startup
```

### Nginx 反向代理（HTTPS 终结）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:11113;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;   # SSE 长连接
    }
}
```

### Docker（自建镜像）

仓库未内置 Dockerfile，可参考以下示例自行构建：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 11113
CMD ["npm", "run", "start"]
```

## 🔐 安全建议

1. **通过 `MINDMAPCHAT_ADMIN_USERNAME` 环境变量声明管理员**，公开部署请勿依赖任何默认/内置账号（普通注册用户不会自动获得任何权限）
2. **生产环境务必设置强 `JWT_SECRET`**（缺失时服务拒绝启动）
3. **API Key 一律通过环境变量注入**，不要硬编码或提交到仓库
4. **数据库密码使用强随机密码**，PostgreSQL 仅监听内网或配置 SSL
5. **配置 HTTPS 反向代理**（Nginx + Let's Encrypt）
6. **定期备份数据库**
7. 开启 GitHub Secret scanning 与 Dependabot（如托管在 GitHub）

## 🧪 测试

```bash
npm run test:personality   # 人格分裂相关单元测试
```

## 🤝 贡献指南

1. Fork 本仓库并克隆到本地
2. 创建特性分支：`git checkout -b feature/xxx`
3. 提交更改：`git commit -am 'feat: 添加 xxx 功能'`
4. 推送分支：`git push origin feature/xxx`
5. 提交 Pull Request

### 代码规范

- 使用 TypeScript 严格模式
- 组件使用函数式 + Hooks 写法
- 提交信息遵循 Conventional Commits
- 新功能建议补充对应的单元测试（参考 `tests/`）

## 📄 版本历史

详见 [CHANGELOG.md](./CHANGELOG.md)

## 📞 支持与维护

- 🐛 问题反馈：提交 Issue
- 💡 功能建议：创建 Discussion
- 📧 商务合作：请联系项目维护者

## 📜 开源协议

本项目采用 [MIT](./LICENSE) 协议开源。

---

> 💡 **提示**：首次使用请先 `cp .env.example .env` 配置环境变量并运行 `node init-db.js` 初始化数据库，然后在登录页注册账号。
