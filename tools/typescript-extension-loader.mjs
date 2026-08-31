// 让 Node 的原生 TypeScript 类型剥离模式解析仓库里无扩展名的 ESM 导入。
// 仅用于本地维护脚本，不进入 App 或服务端运行时。
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // 尝试下一个只读候选；都失败时抛回原始错误，便于定位真实导入。
      }
    }
    throw error;
  }
}
