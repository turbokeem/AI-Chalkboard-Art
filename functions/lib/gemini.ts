import { AIModelAdapter } from '../types';

/**
 * Google Gemini / Imagen 图像生成模型适配器
 * 直接使用 REST API 以减少 Worker 体积
 */
export class GeminiModel implements AIModelAdapter {
  private apiKey: string;
  // Google 的图像生成模型端点
  // 如果官方发布了新模型 (如 gemini-3-pro-image)，只需更新这里的 MODEL_NAME
  private static readonly BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
  // 目前 Imagen 3 的标准 API 名称，根据实际情况可调整
  private static readonly MODEL_NAME = 'imagen-3.0-generate-001'; 

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API Key is missing');
    }
    this.apiKey = apiKey;
  }

  /**
   * 调用 API 生成图片
   * @param prompt 处理后的提示词
   * @returns 图片的二进制数据 (ArrayBuffer)
   */
  async generateImage(prompt: string): Promise<ArrayBuffer> {
    const url = `${GeminiModel.BASE_URL}/${GeminiModel.MODEL_NAME}:predict?key=${this.apiKey}`;

    // 构建请求体 (Google Imagen REST API 标准格式)
    const payload = {
      instances: [
        {
          prompt: prompt
        }
      ],
      parameters: {
        sampleCount: 1,
        // 黑板画通常适合横向构图 (4:3 或 16:9)
        aspectRatio: "4:3", 
        // 只有部分模型支持以下参数，Imagen 3 通常支持
        outputOptions: {
          mimeType: "image/png"
        }
      }
    };

    try {
      console.log(`[Gemini] Sending request to ${GeminiModel.MODEL_NAME}...`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Gemini] API Error:', response.status, errorText);
        throw new Error(`Gemini API Failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;

      // 解析响应结构
      // Google API 成功响应通常结构: { predictions: [ { bytesBase64Encoded: "..." } ] }
      if (!data.predictions || !data.predictions[0] || !data.predictions[0].bytesBase64Encoded) {
        console.error('[Gemini] Unexpected response structure:', JSON.stringify(data).slice(0, 200));
        throw new Error('Invalid response format from Gemini API');
      }

      const base64String = data.predictions[0].bytesBase64Encoded;
      return this.base64ToArrayBuffer(base64String);

    } catch (error: any) {
      console.error('[Gemini] Generation failed:', error);
      // 这里可以增加重试逻辑，或者切换备用模型的逻辑
      throw error;
    }
  }

  /**
   * 辅助函数：将 Base64 字符串转换为 ArrayBuffer
   * Workers 环境下处理二进制数据的标准方式
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}