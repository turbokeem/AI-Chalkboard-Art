import { AIModelAdapter } from '../types';

export class GeminiModel implements AIModelAdapter {
  private apiKey: string;

  constructor(apiKey: string, private modelName: string, private baseUrl: string) {
    if (!apiKey) {
      throw new Error('Gemini API Key is missing');
    }
    this.apiKey = apiKey;
  }

  async generateImage(prompt: string): Promise<ArrayBuffer> {
    // 构造模型预测 URL
    const url = `${this.baseUrl}/models/${this.modelName}:predict?key=${this.apiKey}`;

    const payload = {
      instances: [
        {
          prompt: prompt
        }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: "4:3", 
        outputOptions: {
          mimeType: "image/png"
        }
      }
    };

    try {
      console.log(`[Gemini] Sending request to ${this.modelName} at ${this.baseUrl}...`);
      
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

      if (!data.predictions || !data.predictions[0] || !data.predictions[0].bytesBase64Encoded) {
        console.error('[Gemini] Unexpected response structure:', JSON.stringify(data).slice(0, 200));
        throw new Error('Invalid response format from Gemini API');
      }

      const base64String = data.predictions[0].bytesBase64Encoded;
      return this.base64ToArrayBuffer(base64String);

    } catch (error: any) {
      console.error('[Gemini] Generation failed:', error);
      throw error;
    }
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