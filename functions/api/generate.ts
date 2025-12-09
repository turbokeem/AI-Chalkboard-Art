import { Env, GenerateRequest } from '../types';
import { buildPromptWithEnv } from '../lib/prompts';
import { KeyManager } from '../lib/key-manager';
import { GeminiModel } from '../lib/gemini'; 
import { GeminiAdvanced } from '../lib/gemini-advanced';
import { GrokAPI } from '../lib/grok';
import { saveImageToR2 } from '../lib/storage';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    // 1. 解析请求
    const body = await request.json() as GenerateRequest;
    if (!body.character_name) {
      return new Response(JSON.stringify({ error: 'Character name is required' }), { status: 400 });
    }

    console.log('开始生成图片:', { character: body.character_name, style: body.style });

    // 2. 加载管理员配置
    let adminConfig = null;
    try {
      const configResponse = await fetch(`${new URL(request.url).origin}/api/admin-config`);
      if (configResponse.ok) {
        adminConfig = await configResponse.json();
        console.log('加载管理员配置成功:', { 
          apiCount: adminConfig.api_configs?.length || 0,
          promptCount: adminConfig.prompts?.length || 0 
        });
      }
    } catch (error) {
      console.error('加载管理员配置失败，使用默认配置:', error);
    }

    // 3. 构建提示词（支持自定义提示词）
    let prompt = '';
    let usedStyle = body.style || 'blackboard';
    
    if (adminConfig?.prompts && adminConfig.prompts.length > 0) {
      let matchedPrompt = null;
      matchedPrompt = adminConfig.prompts.find(p => p.key === usedStyle);
      if (!matchedPrompt) {
        matchedPrompt = adminConfig.prompts.find(p => p.name === usedStyle);
      }
      if (!matchedPrompt && adminConfig.prompts.length > 0) {
        matchedPrompt = adminConfig.prompts[0];
        console.log('使用第一个自定义提示词:', matchedPrompt.name);
      }
      
      if (matchedPrompt) {
        if (matchedPrompt.prompt && matchedPrompt.prompt.length > 20) {
          prompt = matchedPrompt.prompt.replace(/\$\{name\}/g, body.character_name);
          console.log('使用自定义完整提示词:', matchedPrompt.key, '长度:', prompt.length);
        } else {
          prompt = await buildPromptWithEnv(body.character_name, matchedPrompt.key, env);
          console.log('使用自定义简单提示词:', matchedPrompt.key);
        }
      }
    }
    
    if (!prompt) {
      prompt = await buildPromptWithEnv(body.character_name, usedStyle, env);
      console.log('使用内置提示词:', usedStyle);
    }

    console.log('最终提示词长度:', prompt.length, '前100字符:', prompt.substring(0, 100));

    // 4. 选择API服务（修复字段名兼容 + Provider适配）
    let imageBuffer: ArrayBuffer | null = null;
    let usedApi = 'Unknown';
    let allErrors: string[] = [];
    
    // 检查环境变量Gemini
    const hasGeminiKey = env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0;
    console.log('环境变量Gemini API密钥状态:', hasGeminiKey);
    
    if (adminConfig?.api_configs && adminConfig.api_configs.length > 0) {
      // 过滤启用的API，并按优先级排序（数字越小优先级越高）
      const enabledApis = adminConfig.api_configs
        .filter(api => api.enabled)
        .sort((a, b) => (a.priority || 99) - (b.priority || 99));
      
      console.log('可用API服务（按优先级排序）:', enabledApis.map(api => ({
        name: api.name,
        provider: api.provider,
        priority: api.priority,
        hasKey: !!(api.apiKey || api.key),
        baseUrl: api.baseUrl || api.url
      })));
      
      for (const apiConfig of enabledApis) {
        try {
          // 兼容两种字段名
          const apiKey = apiConfig.apiKey || apiConfig.key || '';
          const baseUrl = apiConfig.baseUrl || apiConfig.url || '';
          const model = apiConfig.model || '';
          const provider = apiConfig.provider || 'gemini';
          
          console.log(`尝试API: ${apiConfig.name} (provider: ${provider}, priority: ${apiConfig.priority})`);
          
          if (!apiKey && provider !== 'gemini') {
            console.log(`跳过 ${apiConfig.name}: 没有API密钥`);
            continue;
          }
          
          // 根据 provider 类型选择适配器
          if (provider === 'grok') {
            // 使用 Grok 适配器
            console.log(`使用Grok适配器: ${baseUrl}, model: ${model}`);
            const grokApi = new GrokAPI(baseUrl, apiKey, model);
            const imageUrl = await grokApi.generateImage(prompt);
            
            // Grok 返回的是 URL，需要下载图片
            if (imageUrl) {
              console.log(`Grok返回图片URL: ${imageUrl}`);
              const imageResponse = await fetch(imageUrl);
              if (imageResponse.ok) {
                imageBuffer = await imageResponse.arrayBuffer();
              } else {
                throw new Error(`下载Grok图片失败: ${imageResponse.status}`);
              }
            }
          } else if (provider === 'custom' || provider === 'gemini') {
            // 使用 Gemini 兼容适配器
            if (apiKey) {
              console.log(`使用GeminiAdvanced: ${baseUrl}, model: ${model}`);
              const aiModel = new GeminiAdvanced({
                name: apiConfig.name,
                url: baseUrl,
                key: apiKey,
                model: model,
                enabled: true
              });
              imageBuffer = await aiModel.generateImage(prompt);
            } else if (hasGeminiKey) {
              // 没有自定义key，使用环境变量
              const keyManager = new KeyManager(env.GEMINI_API_KEY);
              const selectedKey = keyManager.getNextKey();
              const modelName = model || env.AI_MODEL_NAME || 'gemini-2.0-flash-preview-image-generation';
              const url = baseUrl || env.AI_MODEL_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
              
              const aiModel = new GeminiModel(selectedKey, modelName, url);
              imageBuffer = await aiModel.generateImage(prompt);
            } else {
              throw new Error('没有可用的API密钥');
            }
          } else {
            console.log(`未知的provider类型: ${provider}`);
            continue;
          }
          
          if (imageBuffer && imageBuffer.byteLength > 0) {
            usedApi = apiConfig.name;
            console.log(`✅ ${apiConfig.name} 成功生成图片，大小: ${imageBuffer.byteLength} bytes`);
            break;
          }
        } catch (error: any) {
          const errorMsg = `${apiConfig.name} 失败: ${error.message}`;
          console.error(`❌ ${errorMsg}`);
          allErrors.push(errorMsg);
          continue;
        }
      }
    }
    
    // 兜底：使用环境变量的 Gemini
    if (!imageBuffer && hasGeminiKey) {
      try {
        console.log('所有自定义API失败，使用环境变量Gemini兜底');
        const keyManager = new KeyManager(env.GEMINI_API_KEY);
        const selectedKey = keyManager.getNextKey();
        const modelName = env.AI_MODEL_NAME || 'gemini-2.0-flash-preview-image-generation';
        const baseUrl = env.AI_MODEL_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
        
        const aiModel = new GeminiModel(selectedKey, modelName, baseUrl);
        imageBuffer = await aiModel.generateImage(prompt);
        usedApi = 'Google Gemini (环境变量兜底)';
        console.log('✅ 环境变量Gemini兜底成功');
      } catch (fallbackError: any) {
        console.error('❌ 环境变量Gemini兜底也失败:', fallbackError.message);
        allErrors.push(`环境变量Gemini兜底失败: ${fallbackError.message}`);
      }
    }

    // 5. 检查是否成功
    if (!imageBuffer) {
      console.error('❌ 所有API都失败:', allErrors);
      return new Response(JSON.stringify({ 
        success: false, 
        error: '所有API服务都失败了',
        errors: allErrors,
        debug: {
          hasGeminiKey,
          configuredApis: adminConfig?.api_configs?.length || 0,
          promptLength: prompt.length
        }
      }), { status: 500 });
    }

    // 6. 保存到 R2
    const safeFilename = body.character_name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').toLowerCase();
    const imageUrl = await saveImageToR2(env, imageBuffer, safeFilename);

    // 7. 返回结果
    return new Response(JSON.stringify({ 
      success: true, 
      image_url: imageUrl,
      prompt_used: prompt,
      api_used: usedApi,
      style: usedStyle
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('❌ Generation Error:', err);
    return new Response(JSON.stringify({ 
      success: false, 
      error: err.message || 'Internal Server Error',
      stack: err.stack
    }), { status: 500 });
  }
};