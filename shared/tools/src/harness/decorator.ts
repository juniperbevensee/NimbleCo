// Cantrip-inspired tool decorator pattern
// Enables: tool("description", handler, { dependencies, schema })

import { z } from 'zod';
import { Tool, ToolContext } from '../base';

// Dependency injection (inspired by cantrip's Depends class)
export type DependencyFactory<T> = () => T | Promise<T>;

export class Depends<T> {
  constructor(public factory: DependencyFactory<T>) {}

  async resolve(overrides?: DependencyOverrides): Promise<T> {
    if (overrides) {
      // Check for override by this instance
      if (overrides.has(this)) {
        const override = overrides.get(this)!;
        const result = override();
        return result instanceof Promise ? await result : result;
      }

      // Check for override by factory name
      const factoryName = this.factory.name;
      if (factoryName && overrides.has(factoryName)) {
        const override = overrides.get(factoryName)!;
        const result = override();
        return result instanceof Promise ? await result : result;
      }
    }

    // Use default factory
    const result = this.factory();
    return result instanceof Promise ? await result : result;
  }
}

export type DependencyOverrides = Map<Depends<any> | string, DependencyFactory<any>>;

// Tool decorator types
export type ToolHandler<TArgs, TDeps, TResult = any> = (
  args: TArgs,
  deps: TDeps,
  ctx: ToolContext
) => Promise<TResult> | TResult;

export interface ToolOptions<TDeps = any> {
  name: string;
  category?: Tool['category'];
  zodSchema?: z.ZodType<any>;
  dependencies?: Record<string, Depends<any>>;
  ephemeral?: boolean | number;  // For context cleanup
}

// Convert Zod schema to JSON schema
function zodToJsonSchema(zodSchema: z.ZodType<any>): any {
  // Simplified conversion - in production would use zod-to-json-schema library
  const shape = (zodSchema as any)._def?.shape?.();

  if (!shape) {
    return {
      type: 'object',
      properties: {},
    };
  }

  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as z.ZodType<any>;
    const isOptional = zodType.isOptional();

    if (!isOptional) {
      required.push(key);
    }

    // Basic type mapping
    const typeName = (zodType as any)._def?.typeName;
    if (typeName === 'ZodString') {
      properties[key] = { type: 'string', description: (zodType as any)._def?.description || '' };
    } else if (typeName === 'ZodNumber') {
      properties[key] = { type: 'number', description: (zodType as any)._def?.description || '' };
    } else if (typeName === 'ZodBoolean') {
      properties[key] = { type: 'boolean', description: (zodType as any)._def?.description || '' };
    } else if (typeName === 'ZodArray') {
      properties[key] = { type: 'array', items: {}, description: (zodType as any)._def?.description || '' };
    } else {
      properties[key] = { type: 'object', description: (zodType as any)._def?.description || '' };
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

// Main tool decorator function
export function tool<TArgs extends Record<string, any>, TDeps extends Record<string, any> = {}>(
  description: string,
  handler: ToolHandler<TArgs, TDeps>,
  options: ToolOptions<TDeps>
): Tool {
  const { name, category = 'code', zodSchema, dependencies = {}, ephemeral = false } = options;

  // Convert Zod schema to JSON schema
  const parameters = zodSchema ? zodToJsonSchema(zodSchema) : { type: 'object', properties: {} };

  // Use cases derived from description (simplified)
  const use_cases = [description.toLowerCase()];

  const toolImpl: Tool = {
    name,
    description,
    category,
    use_cases,
    parameters,

    async handler(input: any, ctx: ToolContext) {
      try {
        // Validate input with Zod if schema provided
        if (zodSchema) {
          const parseResult = zodSchema.safeParse(input);
          if (!parseResult.success) {
            return {
              success: false,
              error: `Invalid input: ${parseResult.error.message}`,
            };
          }
        }

        // Resolve dependencies
        const resolvedDeps: any = {};
        const overrides = (ctx as any).dependency_overrides as DependencyOverrides | undefined;

        for (const [key, dep] of Object.entries(dependencies)) {
          resolvedDeps[key] = await dep.resolve(overrides);
        }

        // Execute handler
        const result = await handler(input, resolvedDeps, ctx);

        // Ensure result is serializable
        if (typeof result === 'object' && result !== null) {
          return result;
        }

        return { success: true, result };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  };

  // Store metadata for ephemeral cleanup
  (toolImpl as any).ephemeral = ephemeral;
  (toolImpl as any).dependencies = dependencies;

  return toolImpl;
}

// Helper: Create dependency with default that throws
export function createDependency<T>(name: string, message?: string): Depends<T> {
  return new Depends<T>(function () {
    throw new Error(
      message || `Dependency '${name}' not provided. Use dependency_overrides in ToolContext.`
    );
  } as any);
}

// Example usage patterns for documentation
export const exampleUsage = `
// 1. Simple tool (no dependencies)
const simpleTool = tool(
  "Do something simple",
  async (args: { value: string }, deps, ctx) => {
    return { result: args.value.toUpperCase() };
  },
  {
    name: "simple_tool",
    category: "code",
    zodSchema: z.object({
      value: z.string().describe("Input value"),
    }),
  }
);

// 2. Tool with dependencies
const getSandbox = createDependency<SandboxContext>("getSandbox");

const sandboxTool = tool(
  "Execute code in sandbox",
  async (args: { code: string }, deps: { sandbox: SandboxContext }, ctx) => {
    return await deps.sandbox.execute(args.code);
  },
  {
    name: "execute_in_sandbox",
    category: "code",
    zodSchema: z.object({
      code: z.string().describe("Code to execute"),
    }),
    dependencies: {
      sandbox: getSandbox,
    },
  }
);

// 3. Using tool with dependency override
const sandbox = await SandboxContext.create();
const context: ToolContext = {
  user_id: "test",
  platform: "mattermost",
  credentials: {},
  dependency_overrides: new Map([
    [getSandbox, () => sandbox],
  ]),
};

const result = await sandboxTool.handler({ code: "console.log('hi')" }, context);
`;
