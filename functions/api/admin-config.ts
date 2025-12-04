/**
 * 管理员配置API - 统一认证和配置管理
 */
import { defaultConfig } from '../lib/prompts';

export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

async function verifyToken(request: Request, env: any): Promise<{ valid: boolean; adminConfig?: any; error?: string }> {
  try {
    // 尝试多种Token获取方式
    const authHeader = request.headers.get('Authorization');
    let token = null;
    
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      // 尝试从cookie获取
      const cookieHeader = request.headers.get('Cookie');
      if (cookieHeader) {
        const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
          const [key, value] = cookie.trim().split('=');
          acc[key] = value;
          return acc;
        }, {});
        token = cookies.admin_token;
      }
    }

    console.log(`[AdminConfig] 🔍 Token验证: ${token ? '存在' : '不存在'}`);

    if (!token) {
      return { valid: false, error: '缺少认证令牌' };
    }

    // 获取管理员配置
    const configData = await env.KV_AI_CHALKBOARD.get('admin_config');
    if (!configData) {
      console.log('[AdminConfig] 📁 管理员配置不存在，使用默认配置');
      
      // 创建默认配置
      const defaultAdminConfig = {
        credentials: {
          username: 'admin',
          password: 'admin',
          token: generateSecureToken()
        },
        prompts: defaultConfig,
        api_configs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await env.KV_AI_CHALKBOARD.put('admin_config', JSON.stringify(defaultAdminConfig));
      
      return { 
        valid: false, 
        error: '管理员配置初始化完成，请重新登录',
        adminConfig: defaultAdminConfig
      };
    }

    const adminConfig = JSON.parse(configData);
    const storedToken = adminConfig.credentials?.token;
    
    // 支持新旧两种字段格式
    const legacyToken = adminConfig.admin_credentials?.token;
    const activeToken = storedToken || legacyToken;
    
    if (!activeToken) {
      console.log('[AdminConfig] 🔑 管理员令牌未配置');
      return { valid: false, error: '管理员令牌未配置' };
    }

    if (token !== activeToken) {
      console.log(`[AdminConfig] ❌ Token不匹配: ${token.substring(0, 10)}... !== ${activeToken.substring(0, 10)}...`);
      return { valid: false, error: '认证令牌无效' };
    }

    console.log('[AdminConfig] ✅ Token验证成功');
    return { valid: true, adminConfig };
  } catch (error) {
    console.error('[AdminConfig] Token验证异常:', error);
    return { valid: false, error: '认证验证失败' };
  }
}

function generateSecureToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export async function onRequestGet(context: any) {
  const { request, env } = context;

  try {
    console.log('[AdminConfig] 🌐 收到GET请求');
    
    // 验证管理员权限
    const authResult = await verifyToken(request, env);
    if (!authResult.valid) {
      return new Response(JSON.stringify({
        success: false,
        error: authResult.error
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const adminConfig = authResult.adminConfig;

    console.log(`[AdminConfig] 📋 返回配置信息: 
      - 凭证: ${adminConfig.credentials ? '已配置' : '未配置'}
      - 提示词: ${adminConfig.prompts?.length || 0}个
      - API配置: ${adminConfig.api_configs?.length || 0}个
    `);

    // 不返回敏感信息
    const safeConfig = {
      ...adminConfig,
      credentials: {
        username: adminConfig.credentials?.username,
        token: adminConfig.credentials?.token
      },
      admin_credentials: adminConfig.admin_credentials ? {
        username: adminConfig.admin_credentials?.username,
        token: adminConfig.admin_credentials?.token
      } : undefined
    };

    return new Response(JSON.stringify({
      success: true,
      config: safeConfig
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('[AdminConfig] ❌ GET请求失败:', error);
    return new Response(JSON.stringify({
      success: false,
      error: '获取配置失败',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestPost(context: any) {
  const { request, env } = context;

  try {
    console.log('[AdminConfig] 🌐 收到POST请求');
    
    const body = await request.json();
    const { action, data } = body;

    console.log(`[AdminConfig] 📝 操作类型: ${action}`);

    switch (action) {
      case 'login':
        return await handleLogin(env, data);
      
      case 'update_credentials':
        return await handleUpdateCredentials(env, data);
      
      case 'update_prompts':
        return await handleUpdatePrompts(env, data);
      
      default:
        return new Response(JSON.stringify({
          success: false,
          error: '不支持的操作类型'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

  } catch (error: any) {
    console.error('[AdminConfig] ❌ POST请求失败:', error);
    return new Response(JSON.stringify({
      success: false,
      error: '操作失败',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

async function handleLogin(env: any, data: any) {
  try {
    console.log(`[AdminConfig] 🔐 用户登录: ${data.username}`);

    // 获取管理员配置
    const configData = await env.KV_AI_CHALKBOARD.get('admin_config');
    let adminConfig;

    if (!configData) {
      console.log('[AdminConfig] 📁 首次登录，创建默认配置');
      
      adminConfig = {
        credentials: {
          username: 'admin',
          password: 'admin',
          token: generateSecureToken()
        },
        prompts: defaultConfig,
        api_configs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await env.KV_AI_CHALKBOARD.put('admin_config', JSON.stringify(adminConfig));
    } else {
      adminConfig = JSON.parse(configData);
    }

    // 支持新旧两种字段格式
    const credentials = adminConfig.credentials || adminConfig.admin_credentials;
    
    if (!credentials) {
      return new Response(JSON.stringify({
        success: false,
        error: '管理员凭证未配置'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 验证用户名和密码
    if (data.username !== credentials.username || data.password !== credentials.password) {
      console.log(`[AdminConfig] ❌ 登录失败: 用户名或密码错误`);
      return new Response(JSON.stringify({
        success: false,
        error: '用户名或密码错误'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 生成新的访问令牌
    credentials.token = generateSecureToken();
    credentials.updated_at = new Date().toISOString();

    // 统一存储格式
    adminConfig.credentials = credentials;
    if (adminConfig.admin_credentials) {
      delete adminConfig.admin_credentials;
    }
    adminConfig.updated_at = new Date().toISOString();

    await env.KV_AI_CHALKBOARD.put('admin_config', JSON.stringify(adminConfig));

    console.log(`[AdminConfig] ✅ 登录成功: ${data.username}`);

    return new Response(JSON.stringify({
      success: true,
      message: '登录成功',
      token: credentials.token,
      user: {
        username: credentials.username
      }
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('[AdminConfig] ❌ 登录失败:', error);
    return new Response(JSON.stringify({
      success: false,
      error: '登录失败',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

async function handleUpdateCredentials(env: any, data: any) {
  try {
    console.log(`[AdminConfig] 🔐 更新管理员凭证`);
    
    // 获取当前配置
    const configData = await env.KV_AI_CHALKBOARD.get('admin_config');
    if (!configData) {
      return new Response(JSON.stringify({
        success: false,
        error: '管理员配置不存在'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const adminConfig = JSON.parse(configData);

    // 验证当前凭证
    const currentCredentials = adminConfig.credentials || adminConfig.admin_credentials;
    
    if (!currentCredentials || 
        data.currentUsername !== currentCredentials.username || 
        data.currentPassword !== currentCredentials.password) {
      console.log(`[AdminConfig] ❌ 当前凭证验证失败`);
      return new Response(JSON.stringify({
        success: false,
        error: '当前用户名或密码错误'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 更新凭证
    const newCredentials = {
      username: data.newUsername.trim(),
      password: data.newPassword.trim(),
      token: generateSecureToken(),
      updated_at: new Date().toISOString()
    };

    adminConfig.credentials = newCredentials;
    if (adminConfig.admin_credentials) {
      delete adminConfig.admin_credentials;
    }
    adminConfig.updated_at = new Date().toISOString();

    await env.KV_AI_CHALKBOARD.put('admin_config', JSON.stringify(adminConfig));

    console.log(`[AdminConfig] ✅ 凭证更新成功: ${newCredentials.username}`);

    return new Response(JSON.stringify({
      success: true,
      message: '管理员凭证更新成功，请重新登录',
      token: newCredentials.token
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('[AdminConfig] ❌ 凭证更新失败:', error);
    return new Response(JSON.stringify({
      success: false,
      error: '凭证更新失败',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

async function handleUpdatePrompts(env: any, data: any) {
  try {
    console.log(`[AdminConfig] 📝 更新提示词配置: ${data.prompts?.length || 0}个`);

    // 获取当前配置
    const configData = await env.KV_AI_CHALKBOARD.get('admin_config');
    if (!configData) {
      return new Response(JSON.stringify({
        success: false,
        error: '管理员配置不存在'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const adminConfig = JSON.parse(configData);

    // 验证提示词数据
    if (!data.prompts || !Array.isArray(data.prompts)) {
      return new Response(JSON.stringify({
        success: false,
        error: '提示词数据格式错误'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 更新提示词
    adminConfig.prompts = data.prompts;
    adminConfig.updated_at = new Date().toISOString();

    await env.KV_AI_CHALKBOARD.put('admin_config', JSON.stringify(adminConfig));

    console.log(`[AdminConfig] ✅ 提示词更新成功: ${data.prompts.length}个`);

    return new Response(JSON.stringify({
      success: true,
      message: '提示词配置更新成功'
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('[AdminConfig] ❌ 提示词更新失败:', error);
    return new Response(JSON.stringify({
      success: false,
      error: '提示词更新失败',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}