# MindmapChat Desktop

MindmapChat 的跨平台桌面客户端。应用通过安全的 Electron 窗口连接 MindmapChat 服务，保留登录状态、思维导图交互、流式 AI 响应和现有服务端数据。

桌面端与网页端共用角色会话：同一用户再次点击同一角色时会回到原会话，不会重复新建；角色历史和当前输入会随服务端数据保持一致。

桌面端也可从侧边栏进入“人格分裂”，使用与网页端一致的多角色并行回答、脑形动画和一次性数据规则；该体验不会保存为历史会话。

## 运行

```bash
cd mindmapchatdesktop
npm install
npm start
```

默认连接 `http://localhost:11113`。可以从“文件 → 服务器设置”修改，也可以在启动时临时指定：

```bash
MINDMAPCHAT_SERVER_URL=http://localhost:5173 npm start
```

## 打包

```bash
# 生成当前平台的未安装应用目录
npm run pack

# 生成当前平台的安装包
npm run dist
```

构建产物位于 `release/`。electron-builder 支持 macOS（DMG/ZIP）、Windows（NSIS）和 Linux（AppImage）。

安装包只包含桌面客户端，不包含 PostgreSQL、API Key 或服务端源码；所有业务数据仍由所连接的 MindmapChat 服务管理。

## 安全设计

- 渲染进程关闭 Node.js 集成，并启用上下文隔离与沙箱。
- 非当前服务域名的链接交给系统默认浏览器打开。
- 服务器地址只允许 HTTP/HTTPS，且拒绝在 URL 中嵌入账号密码。
- 登录信息保存在 Electron 的独立持久化会话中，不写入项目目录。
