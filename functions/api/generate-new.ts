/**
 * 新版本图片生成API - 智能多API兜底系统
 */
import { Env, GenerateRequest } from '../types';
import { buildPromptWithEnv } from '../lib/prompts';
import { ImageGenerator } from '../lib/image-generator';
import { saveImageToR2 } from '../lib/storage';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const startTime = Date.now();

  try {
    // 1. 解析请求
    const body = await request.json() as GenerateRequest;
    if (!body.character_name) {
      return Response.json({ 
        success: false, 
        error: '角色名称是必需的' 
      }, { status: 400 });
    }

    console.log(`[Generate-New] 开始处理请求: ${body.character_name} / ${body.style}`);
    console.log(`[Generate-New] 请求ID: ${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

    // 2. 加载管理员配置
    let adminConfig = null;
    try {
      const configResponse = await fetch(`${new URL(request.url).origin}/api/admin-config`);
      if (configResponse.ok) {
        adminConfig = await configResponse.json();
        console.log(`[Generate-New] ✅ 管理员配置加载成功:`, {
          apiConfigs: adminConfig.api_configs?.length || 0,
          prompts: adminConfig.prompts?.length || 0,
          hasCredentials: !!adminConfig.credentials
        });
      }
    } catch (error) {
      console.warn(`[Generate-New] ⚠️ 管理员配置加载失败，使用默认配置:`, error.message);
    }

    // 3. 构建提示词
    let prompt = '';
    let usedStyle = body.style || 'blackboard';
    
    if (adminConfig?.prompts && adminConfig.prompts.length > 0) {
      // 使用自定义提示词的逻辑
      let matchedPrompt = null;
      
      // 优先按key匹配
      matchedPrompt = adminConfig.prompts.find(p => p.key === usedStyle);
      
      // 如果key没匹配到，尝试按name匹配
      if (!matchedPrompt) {
        matchedPrompt = adminConfig.prompts.find(p => p.name === usedStyle);
      }
      
      // 如果还是没匹配到，使用第一个自定义提示词
      if (!matchedPrompt && adminConfig.prompts.length > 0) {
        matchedPrompt = adminConfig.prompts[0];
        console.log(`[Generate-New] 使用第一个自定义提示词: ${matchedPrompt.name}`);
      }
      
      if (matchedPrompt) {
        // 使用自定义提示词
        if (matchedPrompt.prompt && matchedPrompt.prompt.length > 20) {
          prompt = matchedPrompt.prompt.replace(/\$\{name\}/g, body.character_name);
          console.log(`[Generate-New] ✅ 使用自定义完整提示词: ${matchedPrompt.key} (长度: ${prompt.length})`);
        } else {
          // 简单提示词
          prompt = await buildPromptWithEnv(body.character_name, matchedPrompt.key, env);
          console.log(`[Generate-New] ✅ 使用自定义简单提示词: ${matchedPrompt.key}`);
        }
      }
    }
    
    // 如果没有自定义提示词，使用内置提示词
    if (!prompt) {
      prompt = await buildPromptWithEnv(body.character_name, usedStyle, env);
      console.log(`[Generate-New] ✅ 使用内置提示词: ${usedStyle}`);
    }

    console.log(`[Generate-New] 📝 最终提示词长度: ${prompt.length}`);
    console.log(`[Generate-New] 📝 提示词预览: ${prompt.substring(0, 150)}...`);

    // 4. 使用智能图片生成器
    const imageGenerator = new ImageGenerator(env);
    
    // 首先尝试智能兜底生成
    const generationResult = await imageGenerator.generateImageWithFallback(prompt);
    
    if (!generationResult.success) {
      console.error(`[Generate-New] ❌ 智能生成失败:`, generationResult.error);
      
      // 尝试紧急恢复
      console.log(`[Generate-New] 🆘 启动紧急恢复模式`);
      const emergencyResult = await imageGenerator.emergencyRecovery(prompt);
      
      if (!emergencyResult.success) {
        // 彻底失败，返回详细错误信息
        const totalTime = Date.now() - startTime;
        
        return Response.json({
          success: false,
          error: '所有API服务都失败了',
          details: generationResult.error,
          debug: {
            ...generationResult.debug,
            emergencyError: emergencyResult.error,
            totalProcessingTime: totalTime,
            timestamp: new Date().toISOString(),
            requestId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          },
          suggestion: '请检查:\n1. 环境变量 GEMINI_API_KEY 是否正确配置\n2. 管理员后台的API配置是否完整有效\n3. 网络连接是否正常',
          availableAPIs: await imageGenerator.getDetailedStatus()
        }, { status: 500 });
      } else {
        console.log(`[Generate-New] ✅ 紧急恢复成功！`);
        generationResult.imageBuffer = emergencyResult.imageBuffer;
        generationResult.provider = emergencyResult.provider;
      }
    }

    // ✅ 成功生成图片
    const imageBuffer = generationResult.imageBuffer!;
    const totalTime = Date.now() - startTime;

    console.log(`[Generate-New] ✅ 图片生成成功！`);
    console.log(`[Generate-New] 📊 处理详情:`, {
      provider: generationResult.provider,
      processingTime: totalTime,
      promptLength: prompt.length,
      attempts: generationResult.debug?.attempts?.length || 1
    });

    // 5. 保存图片到 R2
    const safeFilename = body.character_name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').toLowerCase();
    const imageUrl = await saveImageToR2(env, imageBuffer, safeFilename);

    console.log(`[Generate-New] ✅ 图片已保存到R2: ${imageUrl}`);

    // 6. 返回成功结果
    const response = {
      success: true,
      image_url: imageUrl,
      prompt_used: prompt,
      api_used: generationResult.provider,
      style: usedStyle,
      processing_time: totalTime,
      debug: {
        provider: generationResult.provider,
        attempts: generationResult.debug?.attempts?.length || 1,
        promptLength: prompt.length,
        timestamp: new Date().toISOString()
      }
    };

    console.log(`[Generate-New] ✅ 请求处理完成，总耗时: ${totalTime}ms`);
    
    return Response.json(response, {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err: any) {
    const totalTime = Date.now() - startTime;
    
    console.error(`[Generate-New] 🔥 系统级错误:`, {
      message: err.message,
      stack: err.stack,
      name: err.constructor.name,
      processingTime: totalTime
    });

    return Response.json({
      success: false,
      error: '服务器内部错误',
      details: err.message,
      debug: {
        errorType: err.constructor.name,
        stack: err.stack,
        processingTime: totalTime,
        timestamp: new Date().toISOString()
      }
    }, { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};

// 为OPTIONS请求添加CORS支持
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};