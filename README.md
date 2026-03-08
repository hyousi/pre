## 打包发布

### 自动发布（推荐）

通过 GitHub Actions 在 macOS 和 Windows runner 上并行构建，push 一个 `v*` tag 即可触发：

```bash
git tag v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

Actions 约 20-30 分钟完成，GitHub Release 页面会自动出现：
- `燃气管网预测平台-0.1.0.dmg`（macOS）
- `燃气管网预测平台 Setup 0.1.0.exe`（Windows）

### 本地构建（当前平台验证）

```bash
# 进入 devbox 环境
devbox shell

# 安装全部依赖（含 pyinstaller）
devbox run install-all

# 一键打包（生成当前平台的安装包）
devbox run pack
```

产物输出至 `release/` 目录。

**分步执行：**

```bash
npm run build:backend    # PyInstaller → backend-dist/gas_backend/（首次约 5-8 分钟）
npm run build:renderer   # Vite + tsc → dist/
npm run build:electron   # electron-builder → release/
```

### 注意事项

- PyInstaller 首次构建需下载 torch / Prophet / Stan 二进制，耗时较长
- macOS 构建产物无代码签名，首次运行需在系统偏好设置 → 安全性中手动允许
- Windows 构建产物无代码签名，SmartScreen 会弹出警告，点击"仍要运行"即可
- 用户数据（训练模型、上传文件）存储在系统标准 userData 目录，卸载重装后数据保留

---

## Algorithm 

给定一个用户城市燃气管网的采集数据（采集时间，当日用气量， 压力， 温度），通过训练一个机器学习模型 ，预测未来一段时间的数据。

**要求：**
1. 预测值与实际值误差 8% 以内
2. data.xlsx 需要作为训练集和测试集

## User Interface

**要求：**
1. 使用 C/S 架构，支持离线使用，使用 React Spa + Electron 打包
2. 支持导入
3. 展示用户未来 2 周的用气量和压力的预测走势，需要图标展示
4. (optional) 支持对预测结果进行点评.
5.

## Training Metrics

### 沃尔沃（2026-03-08 训练）

**数据集：** 训练集 73 条 / 测试集 19 条（时间分割 80/20）

| 指标 | Prophet |
|------|---------|
| 用气量 MAPE | 1052.88% |
| 压力 MAPE | 0.91% |
| 用气量最大 APE | 3088.82% |
| 压力最大 APE | 1.60% |
| 达到 8% 要求 | ✗ |

> 更新时间：2026-03-08 17:00:49
