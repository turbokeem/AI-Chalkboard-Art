/**
 * API 密钥管理器 - 支持多密钥轮询使用
 * 将单个环境变量中的逗号分隔密钥自动分割并轮询使用
 */
export class KeyManager {
  private keys: string[];
  private currentIndex: number = 0;

  constructor(apiKeyEnv: string) {
    // 支持逗号分隔的多个 API 密钥
    this.keys = apiKeyEnv.split(',')
      .map(key => key.trim())
      .filter(key => key.length > 0);
    
    if (this.keys.length === 0) {
      throw new Error('No valid API keys provided');
    }

    // 随机初始位置，避免多个实例总是从同一个密钥开始
    this.currentIndex = Math.floor(Math.random() * this.keys.length);
    console.log(`[KeyManager] Initialized with ${this.keys.length} keys`);
  }

  /**
   * 获取下一个可用的 API 密钥
   * 使用轮询算法确保密钥按顺序使用
   */
  getNextKey(): string {
    const key = this.keys[this.currentIndex];
    
    // 移动到下一个密钥
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    
    console.log(`[KeyManager] Using key ending in ...${key.slice(-6)} (${this.currentIndex}/${this.keys.length})`);
    return key;
  }

  /**
   * 获取密钥总数
   */
  getKeyCount(): number {
    return this.keys.length;
  }

  /**
   * 检查是否有多个密钥
   */
  hasMultipleKeys(): boolean {
    return this.keys.length > 1;
  }
}