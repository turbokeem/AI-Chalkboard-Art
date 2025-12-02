# AI粉笔画 - 智能黑板画生成器

## 项目简介
一个基于Cloudflare架构的模块化AI绘图Web应用，用户输入动漫角色名称，后端通过高级提示词模板调用Google Gemini-3-Pro-Image模型生成逼真的黑板粉笔画风格图像。

- **前端**：简洁现代的网页界面，输入框+展示区
- **后端**：Cloudflare Workers无服务器架构
- **存储**：Cloudflare R2对象存储
- **AI模型**：Google Gemini-3-Pro-Image（香蕉大模型）
- **可扩展**：模块化设计，支持添加新画风和新AI模型

## 功能特点
- 🎨 **专业提示词**：内置"Universal Blackboard Art Generator"高级提示词模板
- 🖼️ **逼真效果**：生成具有中国教室环境氛围的写实黑板粉笔画
- 🚀 **无服务器**：基于Cloudflare Workers，零运维成本
- 📁 **图片存储**：自动存储到Cloudflare R2，支持访问链接
- 🔧 **模块化**：提示词和AI模型接口函数化，便于扩展
- 💰 **低成本**：按请求付费，无固定服务器费用

## 技术架构

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   前端界面   │────▶│ Cloudflare      │────▶│ Gemini API      │
│ (Pages)      │     │ Workers         │     │ (文生图)         │
└─────────────┘     └─────────────────┘     └─────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Cloudflare R2   │
                  │ (图片存储)       │
                  └─────────────────┘
```

## 快速部署

### 前置条件
- Cloudflare账号（免费套餐即可）
- Google Cloud账号（用于Gemini API）
- Node.js 16+ 环境
- Git

---

### 1. 克隆项目
```bash
git clone https://github.com/keenturbo/AI-Chalkboard-Art.git
cd AI-Chalkboard-Art
```

### 2. 获取Google Gemini API密钥
1. 访问 [Google AI Studio](https://aistudio.google.com/)
2. 创建新项目或选择现有项目
3. 启用 "Generative AI API" 
4. 创建API密钥
5. 复制API密钥备用

### 3. 配置Cloudflare CLI
```bash
# 安装Wrangler CLI
npm install -g wrangler

# 登录Cloudflare
wrangler login
```

### 4. 创建Cloudflare R2存储桶
```bash
# 创建R2存储桶
wrangler r2 bucket create chalkboard-images

# 记录存储桶名称，后续配置会用到
```

### 5. 配置环境变量
创建 `wrangler.toml` 文件：
```toml
name = "ai-chalkboard-art"
main = "src/index.js"
compatibility_date = "2023-10-30"

[env.production]
vars = { GEMINI_API_KEY = "你的Gemini_API密钥" }

[[env.production.r2_buckets]]
binding = "IMAGES"
bucket_name = "chalkboard-images"
```

### 6. 部署后端（Cloudflare Workers）
```bash
# 安装依赖
npm install

# 部署到Cloudflare
wrangler deploy
```

### 7. 配置域名（可选）
```bash
# 绑定自定义域名
wrangler custom-domains add api.yourdomain.com
```

### 8. 部署前端（Cloudflare Pages）
1. 将前端代码上传到GitHub仓库
2. 登录Cloudflare Dashboard
3. 进入Pages页面
4. 连接GitHub仓库
5. 配置构建命令（如需要）
6. 部署完成

---

## 详细配置指南

### 后端代码结构
```
src/
├── index.js              # Workers入口文件
├── models/
│   ├── prompt-manager.js # 提示词管理器
│   ├── model-adapter.js  # AI模型接口适配器
│   └── gemini-client.js  # Gemini API客户端
└── utils/
    ├── image-storage.js  # R2存储工具
    └── response.js       # 响应格式化
```

### 提示词管理
```javascript
// models/prompt-manager.js
class PromptManager {
  static getPrompt(style, characterName) {
    switch(style) {
      case 'blackboard':
        return this.generateBlackboardPrompt(characterName);
      case 'cloud':
        return this.generateCloudPrompt(characterName);
      // 可扩展更多风格
      default:
        return this.generateBlackboardPrompt(characterName);
    }
  }
  
  static generateBlackboardPrompt(name) {
    return `A raw, documentary-style close-up photograph of a classroom...${name}...`;
  }
}
```

### AI模型接口
```javascript
// models/model-adapter.js
class ModelAdapter {
  static async generateImage(model, prompt) {
    switch(model) {
      case 'gemini':
        return GeminiClient.generate(prompt);
      case 'kling':
        return KlingClient.generate(prompt);
      case 'grok':
        return GrokClient.generate(prompt);
      // 可扩展更多模型
      default:
        return GeminiClient.generate(prompt);
    }
  }
}
```

## API接口

### 生成图片
```
POST /api/generate
Content-Type: application/json

{
  "character_name": "疯狂动物城2",
  "style": "blackboard",
  "model": "gemini"
}
```

**响应示例：**
```json
{
  "success": true,
  "image_url": "https://r2.example.com/chalkboard-xxx.jpg",
  "character_name": "疯狂动物城2",
  "style": "blackboard",
  "generated_at": "2024-01-01T12:00:00Z"
}
```

## 扩展开发

### 添加新的画风
1. 在 `PromptManager` 中添加新的 `generateXxxPrompt()` 方法
2. 更新前端的风格选择菜单
3. 测试新画风效果

### 添加新的AI模型
1. 在 `models/` 目录下创建新的客户端文件
2. 在 `ModelAdapter` 中添加新的模型 case
3. 配置相应的环境变量和API密钥

## 成本估算

### Cloudflare Workers
- 免费套餐：10万请求/天
- 付费套餐：$0.5/百万请求

### Cloudflare R2
- 免费套餐：10GB存储 + 100万次读取/月
- 付费套餐：$0.015/GB/月 + $0.00036/读取

### Gemini API
- Imagen 3：$0.03-0.08/张（根据分辨率）
- 月度免费配额：一定数量的免费调用

**预估单次调用成本：$0.03-0.08**

## 故障排除

### 常见问题
1. **Gemini API调用失败**
   - 检查API密钥是否正确
   - 确认项目权限和预算设置

2. **R2存储上传失败**
   - 检查存储桶权限配置
   - 确认存储桶名称正确

3. **Workers部署失败**
   - 检查 `wrangler.toml` 配置
   - 确认依赖版本兼容性

### 调试方法
```bash
# 本地开发
wrangler dev

# 查看日志
wrangler tail

# 测试API
curl -X POST https://your-worker.workers.dev/api/generate \
  -H "Content-Type: application/json" \
  -d '{"character_name":"test","style":"blackboard","model":"gemini"}'
```

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/new-style`)
3. 提交变更 (`git commit -am 'Add new art style'`)
4. 推送到分支 (`git push origin feature/new-style`)
5. 创建Pull Request

## 许可证
MIT License

## 联系方式
GitHub: [@keenturbo](https://github.com/keenturbo)

---

**开始使用AI粉笔画，让动漫角色在黑板上重生！** 🎨✨