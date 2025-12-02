/**
 * 提示词管理器
 * 根据用户输入和选择的风格，构建最终发给 AI 的 Prompt
 */
export function buildPrompt(characterName: string, style: string = 'blackboard'): string {
  switch (style.toLowerCase()) {
    case 'cloud':
      return buildCloudPrompt(characterName);
    case 'blackboard':
    default:
      return buildBlackboardPrompt(characterName);
  }
}

// 核心：黑板画提示词模板
function buildBlackboardPrompt(name: string): string {
  return `
    "A raw, documentary-style close-up photograph of a classroom. 
    The focal point is a large, slightly worn green blackboard with visible cloudy white eraser smudges and chalk residue on the surface. 
    Drawn on this textured surface is a masterpiece chalk art of ${name}. 
    The character is depicted in a dynamic pose, rendered with thick, dusty chalk strokes in vibrant colors (pink, yellow, blue). 
    To the right, vertical Chinese text '${name}' is written in hand-written chalk calligraphy. 
    The foreground is out of focus, featuring the worn edge of an old wooden podium with a battered box of colorful chalks and scattered broken pieces. 
    In the corner, a stack of worn paper textbooks sits on a desk. 
    The lighting is natural window light, highlighting the matte, dusty texture of the board. 
    Realistic, nostalgic, high texture, 8k resolution, photorealistic."
  `.trim();
}

// 预留：云彩画提示词模板
function buildCloudPrompt(name: string): string {
  return `A fluffy white cloud formation in a bright blue sky shaped exactly like ${name}...`;
}