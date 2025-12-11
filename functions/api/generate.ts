import { Env, GenerateRequest } from '../types';
import { buildPromptWithEnv } from '../lib/prompts';
import { KeyManager } from '../lib/key-manager';
import { GeminiModel } from '../lib/gemini';
import { GeminiAdvanced } from '../lib/gemini-advanced';
import { GrokAPI } from '../lib/grok';
import { saveImageToR2 } from '../lib/storage';

type GenerateBody = GenerateRequest & { customKey?: string };

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    // 1) 解析请求
    const body = (await request.json()) as GenerateBody;
    if (!body.character_name) {
      return new Response(JSON.stringify({ error: 'Character name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userKey = typeof body.customKey === 'string' ? body.customKey.trim() : '';
    console.log('开始生成图片:', { character: body.character_name, style: body.style, hasCustomKey: !!userKey });

    // 2) 加载管理员配置
    let adminConfig: any = null;
    try {
      const configResponse = await fetch(`${new URL(request.url).origin}/api/admin-config`);
      if (configResponse.ok) {
        adminConfig = await configResponse.json();
        console.log('加载管理员配置成功:', {
          apiCount: adminConfig.api_configs?.length || 0,
          promptCount: adminConfig.prompts?.length || 0,
        });
      }
    } catch (error) {
      console.error('加载管理员配置失败，使用默认配置:', error);
    }

    // 3) 构建提示词
    let prompt = '';
    const usedStyle = body.style || 'blackboard';
    if (adminConfig?.prompts && adminConfig.prompts.length > 0) {
      let matchedPrompt =
        adminConfig.prompts.find((p: any) => p.key === usedStyle) ||
        adminConfig.prompts.find((p: any) => p.name === usedStyle) ||
        adminConfig.prompts[0];

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

    let imageBuffer: ArrayBuffer | null = null;
    let usedApi = 'Unknown';
    const allErrors: string[] = [];

    // 4) 优先使用用户自带 Key（BYOK）
    if (userKey) {
      try {
        console.log('尝试用户自带 Key 调用 Gemini');
        const modelName = env.AI_MODEL_NAME || 'gemini-2.0-flash-preview-image-generation';
        const baseUrl = env.AI_MODEL_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
        const aiModel = new GeminiModel(userKey, modelName, baseUrl);
        imageBuffer = await aiModel.generateImage(prompt);
        usedApi = 'User Provided Gemini Key';
        console.log('✅ 用户 Key 成功生成图片');
      } catch (e: any) {
        const msg = `用户 Key 调用失败: ${e.message}`;
        console.error(msg);
        allErrors.push(msg);
      }
    }

    // 5) 配置的 API 列表
    const hasGeminiKey = !!(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
    if (!imageBuffer && adminConfig?.api_configs && adminConfig.api_configs.length > 0) {
      const enabledApis = adminConfig.api_configs
        .filter((api: any) => api.enabled)
        .sort((a: any, b: any) => (a.priority || 99) - (b.priority || 99));

      console.log(
        '可用API服务（按优先级排序）:',
        enabledApis.map((api: any) => ({
          name: api.name,
          provider: api.provider || 'gemini',
          priority: api.priority || 99,
          hasKey: !!(api.apiKey || api.key),
          baseUrl: api.baseUrl || api.url,
        })),
      );

      for (const apiConfig of enabledApis) {
        try {
          const apiKey = apiConfig.apiKey || apiConfig.key || '';
          const baseUrl = apiConfig.baseUrl || apiConfig.url || '';
          const model = apiConfig.model || '';
          const provider = apiConfig.provider || 'gemini';

          console.log(`尝试API: ${apiConfig.name} (provider: ${provider}, priority: ${apiConfig.priority || 99})`);

          if (provider === 'grok') {
            if (!apiKey) {
              console.log(`跳过 ${apiConfig.name}: Grok需要API密钥`);
              continue;
            }
            const grokApi = new GrokAPI({ baseUrl, apiKey, model });
            const imageUrl = await grokApi.generateImage(prompt);
            if (imageUrl) {
              const imageResponse = await fetch(imageUrl);
              if (imageResponse.ok) {
                imageBuffer = await imageResponse.arrayBuffer();
                usedApi = apiConfig.name;
                console.log(`✅ ${apiConfig.name} 成功生成图片`);
                break;
              } else {
                throw new Error(`下载Grok图片失败: ${imageResponse.status}`);
              }
            } else {
              throw new Error('Grok未返回图片URL');
            }
          } else if (provider === 'custom') {
            if (!apiKey) {
              console.log(`跳过 ${apiConfig.name}: 自定义API需要密钥`);
              continue;
            }
            const aiModel = new GeminiAdvanced({ name: apiConfig.name, url: baseUrl, key: apiKey, model, enabled: true });
            imageBuffer = await aiModel.generateImage(prompt);
            usedApi = apiConfig.name;
            console.log(`✅ ${apiConfig.name} 成功生成图片`);
            break;
          } else {
            // gemini 或未指定
            if (apiKey) {
              const aiModel = new GeminiAdvanced({ name: apiConfig.name, url: baseUrl, key: apiKey, model, enabled: true });
              imageBuffer = await aiModel.generateImage(prompt);
              usedApi = apiConfig.name;
              console.log(`✅ ${apiConfig.name} 成功生成图片`);
              break;
            } else if (hasGeminiKey) {
              const keyManager = new KeyManager(env.GEMINI_API_KEY);
              const selectedKey = keyManager.getNextKey();
              const modelName = model || env.AI_MODEL_NAME || 'gemini-2.0-flash-preview-image-generation';
              const url = baseUrl || env.AI_MODEL_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
              const aiModel = new GeminiModel(selectedKey, modelName, url);
              imageBuffer = await aiModel.generateImage(prompt);
              usedApi = apiConfig.name || 'Google Gemini';
              console.log(`✅ ${usedApi} 成功生成图片`);
              break;
            } else {
              console.log(`跳过 ${apiConfig.name}: 没有可用的API密钥`);
              continue;
            }
          }
        } catch (error: any) {
          const errorMsg = `${apiConfig.name} 失败: ${error.message}`;
          console.error(`❌ ${errorMsg}`);
          allErrors.push(errorMsg);
          continue;
        }
      }
    }

    // 6) 环境变量兜底
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

    // 7) 最终检查
    if (!imageBuffer) {
      console.error('❌ 所有API都失败:', allErrors);
      return new Response(
        JSON.stringify({
          success: false,
          error: '所有API服务都失败了',
          errors: allErrors,
          debug: {
            hasGeminiKey,
            configuredApis: adminConfig?.api_configs?.length || 0,
            promptLength: prompt.length,
            hasCustomKey: !!userKey,
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 8) 保存到 R2
    const safeFilename = body.character_name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').toLowerCase();
    const imageUrl = await saveImageToR2(env, imageBuffer, safeFilename);

    // 9) 返回结果
    return new Response(
      JSON.stringify({
        success: true,
        image_url: imageUrl,
        prompt_used: prompt,
        api_used: usedApi,
        style: usedStyle,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('❌ Generation Error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Internal Server Error',
        stack: err.stack,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};