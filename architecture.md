# 燃气管网预测平台 — 架构说明

## 项目概述

本系统是一个面向城市燃气管网的智能预测桌面应用，基于 C/S 架构，支持完全离线使用。系统采用 LSTM 深度学习模型，根据历史采集数据（用气量、压力、温度）预测未来 14 天的用气量和管道压力走势。

---

## 开发工具链

### 版本控制：GitButler

使用 [GitButler](https://gitbutler.com) 作为版本控制界面（`but` 命令），替代传统 `git` 工作流。GitButler 支持虚拟分支管理，允许在同一工作区并行维护多条功能线，无需频繁切换分支。

```bash
# 查看当前变更状态
but status --json

# 提交指定文件的变更
but commit <branch> -m "描述" --changes <file-id> --json --status-after

# 推送到远程
but push
```

### 环境管理：Jetify Devbox

使用 [Jetify Devbox](https://www.jetify.com/devbox) 管理开发环境，通过 `devbox.json` 声明所有依赖（Node.js、Python、uv 等），确保所有开发者的环境完全一致，无需手动安装运行时。

```bash
# 进入隔离开发环境
devbox shell

# 运行项目脚本
devbox run dev
```

### 前端依赖：npm

前端（React + Electron）使用 [npm](https://www.npmjs.com) 管理 JavaScript 依赖。

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 打包桌面应用
npm run build
```

### 后端依赖：uv

Python 后端使用 [uv](https://docs.astral.sh/uv) 管理依赖和虚拟环境。`uv` 比 `pip` + `venv` 快 10-100 倍，并通过 `pyproject.toml` 锁定依赖版本。

```bash
# 安装 Python 依赖
uv sync

# 启动后端开发服务
uv run uvicorn backend.main:app --reload --port 8765
```

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                  Electron 桌面应用                    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │              React SPA (前端)                │    │
│  │                                              │    │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐ │    │
│  │  │ 用户切换  │  │ 数据导入  │  │ 预测仪表盘 │ │    │
│  │  │ UserSel  │  │  Import  │  │ Dashboard │ │    │
│  │  └──────────┘  └──────────┘  └───────────┘ │    │
│  │                                    │         │    │
│  │                              ┌─────────────┐│    │
│  │                              │ AI 点评面板  ││    │
│  │                              │ (需联网)    ││    │
│  │                              └─────────────┘│    │
│  └───────────────────┬─────────────────────────┘    │
│                      │ HTTP (localhost:8765)          │
│  ┌───────────────────▼─────────────────────────┐    │
│  │           Python FastAPI 后端                │    │
│  │                                              │    │
│  │  POST /api/upload   — 解析并存储 xlsx 数据   │    │
│  │  POST /api/train    — 触发 LSTM 模型训练     │    │
│  │  POST /api/predict  — 返回 14 天预测序列     │    │
│  │  GET  /api/users    — 列出已有用户           │    │
│  │                                              │    │
│  │  ┌──────────────────────────────────────┐   │    │
│  │  │           LSTM 模型 (PyTorch)         │   │    │
│  │  │  输入：滞后用气量、压力、温度、日期特征  │   │    │
│  │  │  输出：未来 14 天用气量 + 压力序列     │   │    │
│  │  └──────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
└─────────────────────────────────────────────────────┘
                          │
                  ┌───────▼────────┐
                  │  外部 LLM API  │
                  │ (AI 点评，可选) │
                  └────────────────┘
```

---

## 目录结构

```
260306/
├── devbox.json               # Devbox 环境声明（Node.js、Python、uv）
├── package.json              # npm 工作区根配置
│
├── electron/                 # Electron 主进程
│   └── main.js               # 启动/关闭 Python 子进程，窗口管理
│
├── src/                      # React 前端 (Vite + TypeScript)
│   ├── components/
│   │   ├── UserSelector.tsx
│   │   ├── ImportPage.tsx
│   │   ├── DashboardPage.tsx
│   │   └── CommentPanel.tsx
│   └── main.tsx
│
├── backend/                  # Python 后端
│   ├── pyproject.toml        # uv 依赖声明
│   ├── main.py               # FastAPI 入口
│   ├── model.py              # LSTM 模型定义
│   ├── trainer.py            # 训练、评估、误差验证逻辑
│   └── data_store/           # 各用户数据与模型文件
│       └── <user_id>/
│           ├── data.csv
│           └── model.pt
│
├── data.xlsx                 # 初始训练数据（中航锂电）
└── architecture.md           # 本文件
```

---

## 数据流

```
xlsx 导入
   │
   ▼
解析 → 存入 data_store/<user>/data.csv
   │
   ▼
训练（80% 训练 / 20% 测试，按时间顺序划分）
   │
   ├─ 单点误差 ≤ 8% → 保存 model.pt
   └─ 超出误差阈值 → 调整训练轮次后重试
         │
         ▼
预测请求 → 加载 model.pt → 滑动窗口推理 → 返回 14 天序列
         │
         ▼
前端渲染折线图（用气量 + 压力双图，含历史对比）
         │
         ▼
（可选）摘要文本 → LLM API → AI 点评文字
```

---

## 技术栈汇总

| 层级 | 技术 | 版本管理工具 |
|------|------|------------|
| 桌面壳 | Electron | npm |
| 前端框架 | React 18 + TypeScript + Vite | npm |
| 图表 | Recharts | npm |
| 样式 | Tailwind CSS | npm |
| API 框架 | FastAPI + uvicorn | uv |
| ML 框架 | PyTorch | uv |
| 数据处理 | pandas + openpyxl | uv |
| 环境隔离 | Jetify Devbox | — |
| 版本控制 | GitButler (`but`) | — |
