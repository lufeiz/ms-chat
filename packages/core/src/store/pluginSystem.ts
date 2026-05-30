import { HookType, HookHandler, PluginContext, PluginRegistration } from '../model';

/**
 * @deprecated since 1.0.0 — 使用 `@ms-chat/core/v2` 的 `PluginSystem`。
 * v2 版本新增 transform 钩子、before 短路、unregister/unregisterAll 与 disposer。
 * 本类将在 2.0.0 移除。迁移指南：docs/migration-v1-to-v2.md。
 */
export class PluginSystem {
    private hooks: Map<string, Map<HookType, Array<{
        handler: HookHandler,
        priority: number
    }>>> = new Map()

    register(registration: PluginRegistration) {
        const { targetFunction, hookType, handler, priority = 0 } = registration
        
        if (!this.hooks.has(targetFunction)) {
        this.hooks.set(targetFunction, new Map())
        }
        
        const functionHooks = this.hooks.get(targetFunction)!
        if (!functionHooks.has(hookType)) {
        functionHooks.set(hookType, [])
        }
        
        const handlers = functionHooks.get(hookType)!
        handlers.push({ handler, priority })
        handlers.sort((a, b) => b.priority - a.priority)
    }

    async executeHooks<T>(
        functionName: string,
        hookType: HookType,
        context: Omit<PluginContext<T>, 'functionName'>
    ): Promise<void> {
        const functionHooks = this.hooks.get(functionName)
        if (!functionHooks) return

        const handlers = functionHooks.get(hookType)
        if (!handlers) return

        for (const { handler } of handlers) {
            await handler({ functionName, ...context })
        }
    }
    // 差个卸载
}

/**
 * @deprecated since 1.0.0 — 使用 `@ms-chat/core/v2` 的 `createWrappedFunction`。
 * 本函数将在 2.0.0 移除。迁移指南：docs/migration-v1-to-v2.md。
 */
export function createWrappedFunction<T extends (...args: any[]) => any>(
    originalFn: T,
    functionName: string,
    pluginSystem: PluginSystem
  ): (...args: Parameters<T>) => Promise<ReturnType<T> | boolean> {
    return async function(...args: Parameters<T>): Promise<ReturnType<T> | boolean> {
      try {
        // 执行前置钩子
        await pluginSystem.executeHooks(functionName, 'before', { args })
        
        // 执行原函数
        const result = await originalFn(...args)
        
        // 执行后置钩子
        await pluginSystem.executeHooks(functionName, 'after', { args, result })
        
        return result
      } catch (error) {
        // 执行错误钩子
        await pluginSystem.executeHooks(functionName, 'error', { 
          args, 
          error: error instanceof Error ? error : new Error(String(error)) 
        })
        throw error
      }
    }
  }
