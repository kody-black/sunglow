# 火烧云预测系统

本项目基于 Node.js + React 实现，支持全国省市区县的火烧云概率预测。

## 功能特点

- **前后端分离**：后端 Express 提供 API，前端 React 页面交互
- **全国城市支持**：内置 cities.json，支持省/市/区县三级联动选择
- **自动定位**：进入网页自动获取地理位置，智能推荐最近城市并自动查询
- **天气数据**：基于 OpenWeather API 获取未来天气
- **概率算法**：根据云量、湿度、能见度等气象条件综合计算火烧云概率
- **美观易用**：Ant Design 风格，支持手动选择和自动定位

## 目录结构

```
sunglow/
├── cities.json         # 城市经纬度数据（后端和前端都用）
├── server/             # 后端 Express API
│   └── index.js
├── web/                # 前端 React 项目
│   ├── package.json
│   ├── public/
│   │   └── cities.json # 前端用城市数据
│   └── src/
│       └── App.js
├── env.template        # .env 配置模板
└── ...
```

## 使用方法

### 1. 配置 OpenWeather API 密钥
在 `server` 目录下创建 `.env` 文件，可参考根目录下的 `env.template`：
```
# 复制 env.template 为 .env 并填写你的密钥
OPENWEATHER_API_KEY=你的API密钥
```

### 2. 启动后端
```bash
cd server
npm install
node index.js
```
默认监听 5000 端口。

### 3. 启动前端
```bash
cd web
npm install  # 首次需安装依赖
npm start
```
默认监听 3000/3001 端口。

### 4. 访问页面
浏览器打开 [http://localhost:3000](http://localhost:3000)（或终端提示端口）。

- 页面会自动请求地理位置，自动查询最近城市的火烧云概率
- 也可手动选择省/市/区县，查询任意城市

## 主要依赖
- express、axios、moment、dotenv、cors（后端）
- react、antd、axios（前端）

## 注意事项
- 需科学上网以保证 OpenWeather API 可用
- API 密钥需有效，否则天气查询会失败
- 前端和后端端口不能冲突，已默认分离

## 效果截图
![1753971274968t.jpg](https://fastly.jsdelivr.net/gh/kody-black/pictures@main/images/1753971274968t.jpg)

---
如有问题或建议，欢迎反馈！ 