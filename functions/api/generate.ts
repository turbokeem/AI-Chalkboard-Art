import { Env, GenerateRequest } from '../types';
import { buildPromptWithEnv } from '../lib/prompts';
import { KeyManager } from '../lib/key-manager';
import { GeminiModel } from '../lib/gemini'; 
import { GeminiAdvanced } from '../lib/gemini-advanced';
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
    
    if (adminConfig?.prompts && adminConfig.prompts.length > 0) {
      // 使用自定义提示词
      const customPrompt = adminConfig.prompts.find(p => 
        p.key === body.style || p.name === body.style
      );
      
      if (customPrompt) {
        // 如果自定义提示词是完整内容，使用完整内容
        if (customPrompt.prompt && customPrompt.prompt.length > 50) {
          prompt = customPrompt.prompt.replace(/\$\{name\}/g, body.character_name);
          console.log('使用自定义完整提示词:', customPrompt.key);
        } else {
          // 简单提示词，使用原有逻辑
          prompt = await buildPromptWithEnv(body.character_name, customPrompt.key, env);
          console.log('使用自定义简单提示词:', customPrompt.key);
        }
      } else {
        // 回退到内置提示词
        prompt = await buildPromptWithEnv(body.character_name, body.style, env);
        console.log('回退到内置提示词:', body.style);
      }
    } else {
      // 默认使用内置提示词
      prompt = await buildPromptWithEnv(body.character_name, body.style, env);
      console.log('使用内置提示词:', body.style);
    }

    console.log('最终提示词长度:', prompt.length);

    // 4. 选择API服务（支持多API配置）
    let imageBuffer;
    let usedApi = 'Google Gemini';
    
    if (adminConfig?.api_configs && adminConfig.api_configs.length > 0) {
      // 使用管理员配置的API服务
      const enabledApis = adminConfig.api_configs.filter(api => api.enabled && api.key);
      console.log('可用的API服务数量:', enabledApis.length);
      
      for (const apiConfig of enabledApis) {
        try {
          console.log(`尝试使用API服务: ${apiConfig.name}`);
          const aiModel = new GeminiAdvanced(apiConfig);
          imageBuffer = await aiModel.generateImage(prompt);
          usedApi = apiConfig.name;
          console.log(`API服务 ${apiConfig.name} 成功`);
          break; // 成功则跳出循环
        } catch (error) {
          console.error(`API服务 ${apiConfig.name} 失败:`, error.message);
          continue; // 失败则尝试下一个API
        }
      }
      
      if (!imageBuffer) {
        // 如果所有自定义API都失败，尝试默认Gemini
        console.log('所有自定义API失败，尝试默认Gemini');
        try {
          const keyManager = new KeyManager(env.GEMINI_API_KEY);
          const selectedKey = keyManager.getNextKey();
          const modelName = env.AI_MODEL_NAME || 'gemini-3-pro-image-preview';
          const baseUrl = env.AI_MODEL_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
          
          const aiModel = new GeminiModel(selectedKey, modelName, baseUrl);
          imageBuffer = await aiModel.generateImage(prompt);
        } catch (fallbackError) {
          console.error('默认Gemini也失败:', fallbackError);
          throw new Error('所有API服务都失败了');
        }
      }
    } else {
      // 默认使用Gemini（保持原有逻辑）
      console.log('使用默认Gemini服务');
      const keyManager = new KeyManager(env.GEMINI_API_KEY);
      const selectedKey = keyManager.getNextKey();
      const modelName = env.AI_MODEL_NAME || 'gemini-3-pro-image-preview';
      const baseUrl = env.AI_MODEL_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
      
      const aiModel = new GeminiModel(selectedKey, modelName, baseUrl);
      imageBuffer = await aiModel.generateImage(prompt);
    }

    // 5. 保存图片到 R2
    const safeFilename = body.character_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const imageUrl = await saveImageToR2(env, imageBuffer, safeFilename);

    // 6. 返回结果
    return new Response(JSON.stringify({ 
      success: true, 
      image_url: imageUrl,
      prompt_used: prompt,
      api_used: usedApi,
      style: body.style
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('Generation Error:', err);
    console.error('Error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    return new Response(JSON.stringify({ 
      success: false, 
      error: err.message || 'Internal Server Error' 
    }), { status: 500 });
  }
};