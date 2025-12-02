import { AIModelAdapter, Env } from '../types';

export class GeminiModel implements AIModelAdapter {
  private apiKey: string;
  private baseUrl: string;
  private modelName: string;

  // 默认值：指向 Google 官方 API
  private static readonly DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
  // 默认值：使用 Imagen 3 标准版
  private static readonly DEFAULT_MODEL = 'imagen-3.0-generate-001'; 

  constructor(apiKey: string, env?: Env) {
    if (!apiKey) throw new Error('Gemini API Key is missing');
    this.apiKey = apiKey;
    // 优先读取环境变量，没有则用默认值
    this.baseUrl = env?.AI_MODEL_URL || GeminiModel.DEFAULT_BASE_URL;
    this.modelName = env?.AI_MODEL_NAME || GeminiModel.DEFAULT_MODEL;
  }

  async generateImage(prompt: string): Promise<ArrayBuffer> {
    // 自动判断模式：如果模型名包含 'gemini'，使用 Chat 接口；否则使用 Imagen 接口
    if (this.modelName.toLowerCase().includes('gemini')) {
      return this.generateWithGemini(prompt);
    } else {
      return this.generateWithImagen(prompt);
    }
  }

  /**
   * 模式 A: Gemini 通用模型 (如 gemini-2.0-flash-exp)
   * 接口: :generateContent
   */
  private async generateWithGemini(prompt: string): Promise<ArrayBuffer> {
    const cleanBaseUrl = this.baseUrl.replace(/\/+$/, '');
    // ⚠️ 注意：下面使用的是反引号 `
    const url = `\({cleanBaseUrl}/\){this.modelName}:generateContent?key=${this.apiKey}`;

    // 构造 Chat 格式请求，明确要求 IMAGE 模态
    const payload = {
      contents: [{
        parts: [{ text: `Generate a realistic blackboard chalk drawing of: ${prompt}` }]
      }],
      generationConfig: {
        responseModalities: ["IMAGE"] 
      }
    };

    console.log(`[Gemini-Chat] Sending to ${this.modelName}...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`Gemini Chat API Failed: \({response.status} - \){txt}`);
    }

    const data = await response.json() as any;
    
    // 解析 Gemini 的 Inline Data
    try {
      const part = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (part && part.inlineData && part.inlineData.data) {
        return this.base64ToArrayBuffer(part.inlineData.data);
      }
      throw new Error('No image data found in Gemini response (Model might have refused to generate image)');
    } catch (e) {
      console.error('Gemini Response Dump:', JSON.stringify(data).slice(0, 200));
      throw e;
    }
  }

  /**
   * 模式 B: Imagen 专用模型 (如 imagen-3.0-generate-001)
   * 接口: :predict
   */
  private async generateWithImagen(prompt: string): Promise<ArrayBuffer> {
    const cleanBaseUrl = this.baseUrl.replace(/\/+$/, '');
    // ⚠️ 注意：下面使用的是反引号 `
    const url = `\({cleanBaseUrl}/\){this.modelName}:predict?key=${this.apiKey}`;

    const payload = {
      instances: [{ prompt: prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "4:3", 
        outputOptions: { mimeType: "image/png" }
      }
    };

    console.log(`[Imagen] Sending to ${this.modelName}...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`Imagen API Failed: \({response.status} - \){txt}`);
    }

    const data = await response.json() as any;
    
    // 解析 Imagen 的 bytesBase64Encoded
    if (data.predictions?.[0]?.bytesBase64Encoded) {
      return this.base64ToArrayBuffer(data.predictions[0].bytesBase64Encoded);
    }
    
    throw new Error('Invalid response format from Imagen API');
  }

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