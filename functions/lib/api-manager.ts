/**
 * API配置管理器 - 支持多API提供商和智能轮询
 */

import { Env } from '../types';
import { KeyManager } from './key-manager';
import { GrokAPI } from './grok';

export interface APIProvider {
  name: string;           // API名称 (如 "Gemini", "Grok")
  provider: string;       // 提供商标识 (如 "gemini", "grok")
  type: 'env' | 'custom'; // 类型：环境变量或自定义配置
  key: string;            // API密钥
  baseUrl: string;        // API基础URL
  model: string;          // 模型名称
  enabled: boolean;       // 是否启用
  priority: number;       // 优先级 (1-10, 数字越小优先级越高)
  rateLimit?: number;     // 速率限制 (可选)
  lastUsed?: number;      // 最后使用时间
  errorCount?: number;    // 错误计数
}

export interface GenerationResult {
  success: boolean;
  imageBuffer?: ArrayBuffer;
  imageUrl?: string;
  provider?: string;
  error?: string;
  debug?: any;
}

export class APIManager {
  private env: Env;
  private keyManager: KeyManager;
  private disabledAPIs: Map<string, number> = new Map(); // API名称 -> 禁用时间

  constructor(env: Env) {
    this.env = env;
    this.keyManager = new KeyManager(env);
  }

  /**
   * 获取所有可用的API提供商
   */
  async getAvailableAPIs(): Promise<APIProvider[]> {
    const apis: APIProvider[] = [];
    
    // 1. 环境变量Gemini API
    const geminiKey = this.env.GEMINI_API_KEY;
    if (geminiKey && geminiKey.trim().length > 0) {
      apis.push({
        name: "Gemini",
        provider: "gemini",
        type: "env",
        key: geminiKey,
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-3-pro-image-preview",
        enabled: true,
        priority: 1
      });
    }
    
    // 2. 第三方API配置
    const thirdPartyConfigs = await this.getThirdPartyConfigs();
    apis.push(...thirdPartyConfigs);
    
    // 3. 过滤和排序
    return apis
      .filter(api => api.enabled && !this.isAPIDisabled(api.name))
      .sort((a, b) => {
        // 按优先级排序，相同优先级按错误次数排序
        if (a.priority !== b.priority) return a.priority - b.priority;
        return (a.errorCount || 0) - (b.errorCount || 0);
      });
  }

  /**
   * 获取第三方API配置
   */
  private async getThirdPartyConfigs(): Promise<APIProvider[]> {
    try {
      const configData = await this.env.KV_AI_CHALKBOARD.get('admin_config');
      if (!configData) return [];
      
      const config = JSON.parse(configData);
      if (!config.api_configs || !Array.isArray(config.api_configs)) return [];
      
      return config.api_configs
        .filter(api => api.enabled)
        .map(api => ({
          name: api.name,
          provider: api.provider,
          type: "custom" as const,
          key: api.api_key,
          baseUrl: api.base_url,
          model: api.model,
          enabled: api.enabled,
          priority: api.priority || 5,
          errorCount: api.error_count || 0
        }));
    } catch (error) {
      console.error(`[APIManager] 获取第三方配置失败:`, error);
      return [];
    }
  }

  /**
   * 检查API是否被禁用
   */
  private isAPIDisabled(apiName: string): boolean {
    const disabledTime = this.disabledAPIs.get(apiName);
    if (!disabledTime) return false;
    
    // 30分钟后自动重新启用
    if (Date.now() - disabledTime > 30 * 60 * 1000) {
      this.disabledAPIs.delete(apiName);
      console.log(`[APIManager] ${apiName} 自动重新启用`);
      return false;
    }
    
    return true;
  }

  /**
   * 禁用失败的API
   */
  private disableAPI(apiName: string) {
    this.disabledAPIs.set(apiName, Date.now());
    console.log(`[APIManager] ${apiName} 已禁用30分钟`);
  }

  /**
   * 使用Gemini API生成图片
   */
  private async tryGemini(prompt: string, excludeKeys: string[] = []): Promise<GenerationResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[APIManager] 🟢 尝试Gemini API...`);
      console.log(`[APIManager] 排除的密钥数量: ${excludeKeys.length}`);
      
      const imageBuffer = await this.keyManager.getImage(prompt, excludeKeys);
      
      if (!imageBuffer) {
        throw new Error('Gemini API返回空结果');
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`[APIManager] ✅ Gemini API成功 - 耗时: ${processingTime}ms`);
      
      return {
        success: true,
        imageBuffer,
        provider: "Gemini (环境变量)",
        debug: {
          provider: "gemini",
          processingTime,
          model: "gemini-3-pro-image-preview"
        }
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[APIManager] ❌ Gemini API失败 - 耗时: ${processingTime}ms, 错误:`, error.message);
      
      return {
        success: false,
        error: `Gemini API失败: ${error.message}`,
        provider: "Gemini",
        debug: {
          provider: "gemini",
          processingTime,
          error: error.message,
          type: error.constructor.name
        }
      };
    }
  }

  /**
   * 使用Grok API生成图片
   */
  private async tryGrok(proxy: string, model: string, apiKey: string, prompt: string): Promise<GenerationResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[APIManager] 🟡 尝试Grok API: ${proxy}`);
      console.log(`[APIManager] 模型: ${model}, 密钥长度: ${apiKey.length}`);
      
      const grokAPI = new GrokAPI({
        baseUrl: proxy,
        apiKey: apiKey,
        model: model
      });
      
      const imageUrl = await grokAPI.generateImage(prompt);
      
      // 获取图片数据
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`无法获取图片: ${response.status}`);
      }
      
      const imageBuffer = await response.arrayBuffer();
      
      const processingTime = Date.now() - startTime;
      console.log(`[APIManager] ✅ Grok API成功 - 耗时: ${processingTime}ms, URL: ${imageUrl}`);
      
      return {
        success: true,
        imageBuffer,
        imageUrl,
        provider: `Grok (${proxy})`,
        debug: {
          provider: "grok",
          baseUrl: proxy,
          model,
          processingTime,
          imageUrl
        }
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[APIManager] ❌ Grok API失败 - 耗时: ${processingTime}ms, 错误:`, error.message);
      
      return {
        success: false,
        error: `Grok API失败: ${error.message}`,
        provider: `Grok (${proxy})`,
        debug: {
          provider: "grok",
          baseUrl: proxy,
          model,
          processingTime,
          error: error.message,
          type: error.constructor.name
        }
      };
    }
  }

  /**
   * 使用其他第三方API生成图片
   */
  private async tryThirdParty(api: APIProvider, prompt: string): Promise<GenerationResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[APIManager] 🔵 尝试第三方API: ${api.name} (${api.provider})`);
      
      if (api.provider === 'grok') {
        return await this.tryGrok(api.baseUrl, api.model, api.key, prompt);
      }
      
      // 其他类型的第三方API可以在这里扩展
      throw new Error(`不支持的API提供商: ${api.provider}`);
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[APIManager] ❌ ${api.name} API失败 - 耗时: ${processingTime}ms, 错误:`, error.message);
      
      return {
        success: false,
        error: `${api.name} API失败: ${error.message}`,
        provider: api.name,
        debug: {
          provider: api.provider,
          baseUrl: api.baseUrl,
          model: api.model,
          processingTime,
          error: error.message,
          type: error.constructor.name
        }
      };
    }
  }

  /**
   * 智能图片生成 - 多API兜底
   */
  async generateImageWithFallback(prompt: string, excludeKeys: string[] = []): Promise<GenerationResult> {
    const startTime = Date.now();
    const attempts: any[] = [];
    
    console.log(`[APIManager] 🚀 开始智能图片生成 - 提示词长度: ${prompt.length}`);
    
    // 获取所有可用API
    const availableAPIs = await this.getAvailableAPIs();
    console.log(`[APIManager] 📋 可用API数量: ${availableAPIs.length}`);
    availableAPIs.forEach((api, index) => {
      console.log(`[APIManager] ${index + 1}. ${api.name} (优先级: ${api.priority})`);
    });

    // 1. 首先尝试Gemini环境变量API
    const geminiAPI = availableAPIs.find(api => api.provider === 'gemini' && api.type === 'env');
    if (geminiAPI) {
      console.log(`[APIManager] 🔄 尝试第 1/${availableAPIs.length + 1} 个API: Gemini (环境变量)`);
      const geminiResult = await this.tryGemini(prompt, excludeKeys);
      attempts.push(geminiResult.debug);
      
      if (geminiResult.success) {
        const totalTime = Date.now() - startTime;
        console.log(`[APIManager] ✅ Gemini成功！总耗时: ${totalTime}ms`);
        return {
          ...geminiResult,
          debug: {
            ...geminiResult.debug,
            totalAttempts: attempts.length,
            attempts,
            totalTime
          }
        };
      }
      
      console.log(`[APIManager] Gemini失败，继续尝试其他API...`);
    }

    // 2. 尝试第三方API（按优先级排序）
    for (let i = 0; i < availableAPIs.length; i++) {
      const api = availableAPIs[i];
      if (api.type === 'env') continue; // 跳过环境变量API
      
      const attemptNumber = (geminiAPI ? 1 : 0) + i + 1;
      console.log(`[APIManager] 🔄 尝试第 ${attemptNumber}/${availableAPIs.length + 1} 个API: ${api.name}`);
      
      const result = await this.tryThirdParty(api, prompt);
      attempts.push(result.debug);
      
      if (result.success) {
        const totalTime = Date.now() - startTime;
        console.log(`[APIManager] ✅ ${api.name}成功！总耗时: ${totalTime}ms`);
        return {
          ...result,
          debug: {
            ...result.debug,
            totalAttempts: attempts.length,
            attempts,
            totalTime
          }
        };
      }
      
      // 记录失败
      await this.recordAPIFailure(api.name, result.error);
      console.log(`[APIManager] ${api.name}失败，继续尝试下一个API...`);
    }

    // 3. 所有API都失败了
    const totalTime = Date.now() - startTime;
    console.error(`[APIManager] 💥 所有API都失败了！总耗时: ${totalTime}ms`);
    
    return {
      success: false,
      error: '所有API服务都失败了',
      debug: {
        totalAttempts: attempts.length,
        attempts,
        totalTime,
        availableAPIs: availableAPIs.map(api => ({
          name: api.name,
          provider: api.provider,
          priority: api.priority,
          type: api.type,
          enabled: api.enabled
        }))
      }
    };
  }

  /**
   * 记录API失败
   */
  private async recordAPIFailure(apiName: string, error: string) {
    // 增加错误计数
    if (apiName !== 'Gemini') {
      // 对于第三方API，更新错误计数
      const keyManager = new KeyManager(this.env);
      await keyManager.updateKeyStatus(apiName, 'failed', 0, error);
    }
    
    // 如果错误次数过多，暂时禁用该API
    const errorCount = await this.getAPIErrorCount(apiName);
    if (errorCount >= 3) {
      this.disableAPI(apiName);
    }
  }

  /**
   * 获取API错误次数
   */
  private async getAPIErrorCount(apiName: string): Promise<number> {
    try {
      const keyManager = new KeyManager(this.env);
      const status = await keyManager.getKeyStatus(apiName);
      return status?.error_count || 0;
    } catch {
      return 0;
    }
  }

  /**
   * 紧急恢复 - 使用最基础的Gemini配置
   */
  async emergencyRecovery(prompt: string): Promise<GenerationResult> {
    const startTime = Date.now();
    
    console.log(`[APIManager] 🆘 启动紧急恢复模式`);
    
    try {
      // 直接使用环境变量，忽略所有排除
      const geminiKey = this.env.GEMINI_API_KEY;
      if (!geminiKey) {
        throw new Error('未找到Gemini环境变量配置');
      }
      
      // 强制使用第一个可用的Gemini key
      const keyManager = new KeyManager(this.env);
      const imageBuffer = await keyManager.getImage(prompt, [], 0);
      
      if (!imageBuffer) {
        throw new Error('紧急恢复无法获取图片');
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`[APIManager] ✅ 紧急恢复成功 - 耗时: ${processingTime}ms`);
      
      return {
        success: true,
        imageBuffer,
        provider: "Gemini (紧急恢复)",
        debug: {
          provider: "gemini_emergency",
          processingTime,
          mode: "emergency_recovery"
        }
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[APIManager] 💥 紧急恢复也失败了 - 耗时: ${processingTime}ms, 错误:`, error.message);
      
      return {
        success: false,
        error: `紧急恢复失败: ${error.message}`,
        provider: "紧急恢复",
        debug: {
          provider: "emergency_recovery",
          processingTime,
          error: error.message,
          type: error.constructor.name
        }
      };
    }
  }

  /**
   * 获取详细的API状态信息
   */
  async getDetailedStatus(): Promise<any[]> {
    const availableAPIs = await this.getAvailableAPIs();
    
    const statuses = availableAPIs.map(api => ({
      name: api.name,
      provider: api.provider,
      type: api.type,
      priority: api.priority,
      enabled: api.enabled,
      disabled: this.isAPIDisabled(api.name),
      errorCount: api.errorCount || 0,
      baseUrl: api.baseUrl,
      model: api.model
    }));
    
    return statuses;
  }
}