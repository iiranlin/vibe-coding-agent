<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project runtime rules

- EdgeOne Agent 使用的服务端环境变量必须同步配置到 `.env.local`、`.env` 和 EdgeOne 远端项目；变更后必须重启本地 Agent worker，并验证运行进程已加载对应变量。
- 验证 Sandbox 预览时，不能只确认文件树或预览链接存在；必须同时检查预览地址返回有效 HTML，并确认页面 iframe 已实际渲染内容。
