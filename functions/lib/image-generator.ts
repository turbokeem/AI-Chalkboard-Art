/**
 * 统一的图片生成调度器 - 支持多API提供商和自动切换
 */
import { Env } from '../types';
import { APIManager, APIProvider } from './api-manager';
import { GeminiModel } from './gemini';
import { GeminiAdvanced } from './gemini-advanced';
import { GrokAPI } from './grok';
import { KeyManager } from './key-manager';

export class ImageGenerator {
  private env: Env;
  private apiManager: APIManager;

  constructor(env: Env) {
    this.env = env;
    this.apiManager = new APIManager(env);
  }

  /**
   * 使用可用的API生成图片，支持自动切换和轮询
   * @param prompt 图片生成提示词
   * @returns 生成的图片Buffer
   */
  async generateImage(prompt: string): Promise<{ imageBuffer: ArrayBuffer; provider: string }> {
    console.log(`[ImageGenerator] Starting image generation with prompt length: ${prompt.length}`);
    
    let lastError: Error | null = null;
    const usedKeys: string[] = []; // 记录已使用的密钥，避免重复
    const maxAttempts = 5; // 最大尝试次数
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`[ImageGenerator] Attempt ${attempts}/${maxAttempts}`);
      
      try {
        // 获取最佳API提供商
        const provider = await this.apiManager.selectBestProvider(usedKeys);
        
        if (!provider) {
          throw new Error('No available API providers');
        }

        console.log(`[ImageGenerator] Using provider: ${provider.name} (${provider.provider})`);
        
        // 根据提供商类型调用对应的API
        let imageBuffer: ArrayBuffer;
        
        switch (provider.provider) {
          case 'gemini':
            imageBuffer = await this.generateWithGemini(provider, prompt);
            break;
          case 'grok':
            imageBuffer = await this.generateWithGrok(provider, prompt);
            break;
          case 'custom':
            // 自定义API，使用Gemini Advanced（兼容现有配置）
            imageBuffer = await this.generateWithCustom(provider, prompt);
            break;
          default:
            throw new Error(`Unknown provider type: ${provider.provider}`);
        }

        // 成功生成，更新统计
        this.apiManager.updateProviderStats(provider.id, true);
        
        console.log(`[ImageGenerator] Successfully generated image using ${provider.name}`);
        
        return {
          imageBuffer,
          provider: provider.name
        };

      } catch (error) {
        lastError = error as Error;
        console.error(`[ImageGenerator] Attempt ${attempts} failed:`, error.message);
        
        // 将失败的密钥加入排除列表
        // 这里需要根据实际情况逻辑处理，暂时跳过
        
        if (attempts >= maxAttempts) {
          break;
        }
      }
    }

    // 所有尝试都失败了
    const errorMessage = `Failed to generate image after ${attempts} attempts. Last error: ${lastError?.message}`;
    console.error(`[ImageGenerator] ${errorMessage}`);
    throw new Error(errorMessage);
  }

  /**
   * 使用 Gemini API 生成图片
   */
  private async generateWithGemini(provider: APIProvider, prompt: string): Promise<ArrayBuffer> {
    if (provider.type === 'env') {
      // 环境变量配置，使用KeyManager支持多密钥轮询
      const keyManager = new KeyManager(provider.key);
      const selectedKey = keyManager.getNextKey();
      
      const model = new GeminiModel(
        selectedKey,
        this.env
      );
      return await model.generateImage(prompt);
    } else {
      // 管理后台配置
      const config = {
        name: provider.name,
        key: provider.key,
        url: provider.baseUrl,
        model: provider.model || 'gemini-3-pro-image-preview'
      };
      
      const model = new GeminiAdvanced(config);
      return await model.generateImage(prompt);
    }
  }

  /**
   * 使用 Grok API 生成图片
   */
  private async generateWithGrok(provider: APIProvider, prompt: string): Promise<ArrayBuffer> {
    const grok = new GrokAPI(
      provider.baseUrl || 'https://api.x.ai/v1',
      provider.key,
      provider.model || 'grok-2-image'
    );
    
    return await grok.generateImage(prompt);
  }

  /**
   * 使用自定义API生成图片（兼容现有配置）
   */
  private async generateWithCustom(provider: APIProvider, prompt: string): Promise<ArrayBuffer> {
    const config = {
      name: provider.name,
      key: provider.key,
      url: provider.baseUrl,
      model: provider.model || 'gemini-3-pro-image-preview'
    };
    
    const model = new GeminiAdvanced(config);
    return await model.generateImage(prompt);
  }

  /**
   * 获取所有API提供商的状态
   */
  async getProviderStatuses(): Promise<any[]> {
    return await this.apiManager.getProviderStatuses();
  }

  /**
   * 测试特定API提供商
   */
  async testProvider(providerId: string): Promise<boolean> {
    const providers = await this.apiManager.getAvailableProviders();
    const provider = providers.find(p => p.id === providerId);
    
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    try {
      // 使用简单的测试提示词
      const testPrompt = "A simple red circle on white background";
      
      switch (provider.provider) {
        case 'grok':
          const grok = new GrokAPI(
            provider.baseUrl || 'https://api.x.ai/v1',
            provider.key,
            provider.model || 'grok-2-image'
          );
          return await grok.testConnection();
          
        case 'gemini':
        case 'custom':
          // Gemini API的连接测试
          const testUrl = `${provider.baseUrl.replace(/\/$/, '')}/${provider.model}:generateContent?key=${provider.key}`;
          const response = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: "test"
                }]
              }]
            })
          });
          return response.ok;
          
        default:
          return false;
      }
    } catch (error) {
      console.error(`[ImageGenerator] Test failed for ${provider.name}:`, error);
      return false;
    }
  }
}