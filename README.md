# AI Chalkboard Art Generator

生成黑板风格AI艺术作品的智能生成器，支持多种大语言模型和多API提供商的智能兜底方案。

## ✨ 核心功能

### 🎨 智能图片生成
- **多风格支持**: 教室黑板粉笔画、卡通风格等
- **智能提示词**: 自动优化提示词以达到最佳效果
- **实时生成**: 快速响应，用户体验友好

### 🤖 多API智能兜底
- **主要支持**: Google Gemini API (环境变量配置)
- **第三方支持**: Grok API、其他OpenAI兼容API
- **智能轮询**: 自动故障转移，优先级管理
- **详细监控**: API状态监控和错误诊断

### 🔧 管理后台
- **安全认证**: 基于Token的安全管理系统
- **API配置**: 一键添加、测试、管理多个第三方API
- **提示词管理**: 自定义提示词模板
- **实时监控**: API状态和性能监控

### 🛡️ 可靠性保障
- **3层保护机制**: 智能兜底 → 紧急恢复 → 详细错误报告
- **自动恢复**: 失败API自动重新启用（30分钟后）
- **错误隔离**: 单个API失败不影响整体服务
- **详细日志**: 完整的调用链路追踪

## 🚀 快速开始

### 1. 部署到 Cloudflare Pages

```bash
# 克隆仓库
git clone https://github.com/keenturbo/AI-Chalkboard-Art.git
cd AI-Chalkboard-Art

# 部署到Cloudflare Pages
npx wrangler pages deploy public
```

### 2. 环境变量配置

在 Cloudflare Dashboard → Pages → Settings → Environment variables 中设置：

```
GEMINI_API_KEY=your_gemini_api_key_here
KV_AI_CHALKBOARD=your_kv_namespace_here
R2_BUCKET=your_r2_bucket_here
```

### 3. 管理后台访问

- **地址**: `https://your-domain.com/admin.html`
- **默认账号**: `admin` / `admin`
- **首次使用**: 登录后立即修改密码

## 📋 使用指南

### 基础使用

1. **访问主页面**: `https://your-domain.com`
2. **输入角色/物品名称**: 如"Hello Kitty"、"皮卡丘"、"小猫咪"
3. **选择风格**: 默认黑板风，支持扩展
4. **点击生成**: AI自动选择最佳API生成图片

### 管理后台

#### 🔐 账号管理
- **登录**: `admin` / `admin`（默认）
- **修改密码**: 在"基础设置"中更新凭证
- **Token管理**: 自动生成安全令牌

#### 🤖 API配置

1. **添加第三方API**:
   - API名称: 如"Grok"
   - 提供商: 选择对应类型
   - 基础URL: API服务地址
   - API密钥: 服务商提供的密钥
   - 模型名称: 如"grok-4.1-fast"

2. **测试连接**:
   - 点击"测试连接"验证配置
   - 查看详细的连接测试结果

3. **优先级管理**:
   - 数字越小优先级越高
   - Gemini环境变量默认优先级1
   - 第三方API建议设置2-10

#### 📝 提示词管理

- **内置提示词**: 黑板画风格提示词
- **自定义提示词**: 支持简单的名称替换
- **完整提示词**: 支持复杂的多语言模板

## 🔧 高级配置

### 多API兜底策略

```
优先级1: Gemini (环境变量)
优先级2: Grok API (第三方)
优先级3: 其他第三方API
紧急恢复: 强制使用Gemini环境变量
```

### 错误处理机制

1. **API失败**: 自动切换到下一个可用API
2. **3次失败**: 自动禁用30分钟
3. **全部失败**: 启动紧急恢复模式
4. **详细报告**: 返回完整的诊断信息

### 环境变量详解

```bash
# 必需配置
GEMINI_API_KEY=your_gemini_key          # Gemini API密钥
KV_AI_CHALKBOARD=your_kv_namespace       # KV存储命名空间
R2_BUCKET=your_r2_bucket                 # R2存储桶

# 可选配置
AI_MODEL_URL=                             # 第三方API URL（预留）
```

## 🛠️ 技术架构

### 前端技术
- **HTML5**: 响应式设计
- **CSS3**: 现代样式和动画
- **JavaScript ES6+**: 模块化开发
- **Cloudflare Pages**: 静态托管

### 后端技术
- **Cloudflare Functions**: Serverless API
- **TypeScript**: 类型安全
- **KV存储**: 配置和缓存
- **R2存储**: 图片文件存储

### API集成
- **Google Generative AI**: 图片生成API
- **OpenAI兼容API**: 标准化接口
- **RESTful设计**: 统一的API规范

## 📊 系统监控

### 实时状态
- 总API数量
- 启用/禁用状态
- 错误计数统计

### 性能指标
- 响应时间统计
- API调用次数
- 成功率监控

### 错误诊断
- 详细的错误日志
- API响应状态
- 调试信息输出

## 🔒 安全特性

### 认证系统
- Token-Based认证
- 定期令牌更新
- 多种Token传递方式

### 数据保护
- 敏感信息加密存储
- API密钥安全保管
- 前端数据脱敏

## 🚀 故障排查

### 常见问题

**Q: 主页显示空白？**
A: 检查Cloudflare Functions部署状态，等待1-2分钟自动部署完成。

**Q: API测试失败？**
A: 验证API密钥格式和端点URL是否正确，确认网络连接正常。

**Q: 生成失败提示429错误？**
A: 系统会自动切换到备用API，建议添加更多第三方API作为兜底。

### 调试工具

- 控制台日志查看
- Cloudflare Functions日志
- API状态监控面板

## 📈 未来规划

### 功能增强
- [ ] 更多图片风格支持
- [ ] 批量生成功能
- [ ] 图片历史记录
- [ ] 用户反馈系统

### API扩展
- [ ] 更多第三方API支持
- [ ] 本地模型集成
- [ ] 自定义API端点
- [ ] API市场集成

### 性能优化
- [ ] 缓存机制优化
- [ ] CDN加速
- [ ] 智能预加载
- [ ] 性能监控仪表板

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

### 开发环境设置

```bash
# 克隆项目
git clone https://github.com/keenturbo/AI-Chalkboard-Art.git
cd AI-Chalkboard-Art

# 安装依赖
npm install

# 本地开发
npm run dev
```

### 代码规范
- TypeScript严格模式
- ESLint代码检查
- Prettier格式化
- 统一的日志格式

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- Google Generative AI API
- OpenAI API标准
- Cloudflare Workers/Pages
- 所有开源贡献者

---

🚀 **享受AI生成的黑板艺术作品！**

如有问题，请提交Issue或联系维护者。