import { describe, expect, it } from 'vitest'
import { ZH_DESCRIPTIONS } from '../src/zh-descriptions.ts'
import { jsonSchemaToTs, renderToolsSdk } from '@deepseek-ai/dsh-tool-executor-ptc/src/ts-types.ts'
import type { ToolSdkSchema } from '@deepseek-ai/dsh-tool-executor-ptc/src/ts-types.ts'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools/src/json-schema.ts'
import { parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'

describe('jsonSchemaToTs', () => {
  it('maps every unified schema construct', () => {
    const cases: [unknown, string][] = [
      [{ type: 'string' }, 'string'],
      [{ type: 'number' }, 'number'],
      [{ type: 'integer' }, 'number'],
      [{ type: 'boolean' }, 'boolean'],
      [{ type: 'null' }, 'null'],
      [{ type: 'string', enum: ['a', 'b'] }, '"a" | "b"'],
      [{ type: 'number', enum: [1, 2] }, '1 | 2'],
      [{ type: 'integer', const: 2 }, '2'],
      [{ type: 'boolean', const: true }, 'true'],
      [{ type: 'null', const: null }, 'null'],
      [{ type: 'string', enum: ['a', 'b'], const: 'a' }, '"a"'],
      [{ oneOf: [{ type: 'string' }, { type: 'null' }] }, 'string | null'],
      [{ type: 'array', items: { type: 'number' } }, 'number[]'],
      [{ type: 'array', items: { type: 'string', enum: ['x', 'y'] } }, '("x" | "y")[]'],
      [{ type: 'array' }, 'JsonValue[]'],
      [{ type: 'object' }, 'Record<string, JsonValue>'],
      [{ type: 'object', additionalProperties: false }, 'Record<string, never>'],
      [{ type: 'object', properties: {} }, 'Record<string, JsonValue>'],
      [{ type: 'object', properties: {}, additionalProperties: false }, 'Record<string, never>'],
      [{
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'integer' }, label: { type: 'string' } },
        required: ['id'],
      }, ['{', '  id: number;', '  label?: string;', '}'].join('\n')],
      [{}, 'JsonValue'],
    ]
    for (const [schema, expected] of cases) {
      expect(jsonSchemaToTs(schema), JSON.stringify(schema)).toBe(expected)
    }
  })

  it('renders objects with required/optional keys, nested shapes, and per-property docs', () => {
    const schema = parameterSchemaSpecToJsonSchema({
      path: { type: 'string', required: true, description: 'Absolute file path' },
      limit: { type: 'number' },
      opts: {
        type: 'object',
        additionalProperties: true,
        properties: { deep: { type: 'boolean', required: true } },
      },
    })
    expect(jsonSchemaToTs(schema)).toBe([
      '{',
      '  /** Absolute file path */',
      '  path: string;',
      '  limit?: number;',
      '  opts?: {',
      '    deep: boolean;',
      '  } & Record<string, JsonValue>;',
      '} & Record<string, JsonValue>',
    ].join('\n'))
  })

  it('is total: unsupported or hostile constructs degrade to unknown, never throw', () => {
    const cases: unknown[] = [
      undefined,
      null,
      42,
      'string-schema',
      { oneOf: [{ type: 'string' }] },
      { $ref: '#/defs/x' },
      { type: 'object', properties: 7 },
      { type: 'object', properties: { bad: { $ref: 'x' } } },
      { type: 'string', enum: [1, 2] },
      { type: 'string', enum: [] },
    ]
    for (const schema of cases) {
      expect(() => jsonSchemaToTs(schema), JSON.stringify(schema)).not.toThrow()
    }
    expect(jsonSchemaToTs({ oneOf: [] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'object', properties: 7 })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'object', properties: { bad: { $ref: 'x' } }, required: ['bad'] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'string', enum: [1, 2] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'string', enum: [] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'object', properties: { a: { type: 'string' } }, required: [7] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'object', properties: { weird: 42 } })).toBe('unknown')
  })

  it('escapes a comment-closer inside a description so the generated JSDoc cannot end early', () => {
    const rendered = jsonSchemaToTs({
      type: 'object',
      properties: { glob: { type: 'string', description: 'a pattern like packages/*/tool-*/ over here' } },
    })
    expect(rendered).not.toContain('tool-*/ over')
    expect(rendered).toContain(String.raw`tool-*\/ over`)
  })

  it('renders deeply nested unions without using the JavaScript call stack', () => {
    const depth = 5_000
    let schema: unknown = { type: 'string' }
    for (let index = 0; index < depth; index++) schema = { oneOf: [schema, { type: 'null' }] }

    const rendered = jsonSchemaToTs(schema)

    expect(rendered.startsWith('string | null')).toBe(true)
    expect(rendered.length).toBe('string'.length + depth * ' | null'.length)
  })
})

describe('renderToolsSdk', () => {
  const bash: ToolSdkSchema = {
    name: 'bash',
    description: 'Run a shell command.',
    parameters: parameterSchemaSpecToJsonSchema({
      command: { type: 'string', required: true },
      description: { type: 'string', required: true },
    }) as unknown as Record<string, unknown>,
    output: {
      type: 'object',
      additionalProperties: false,
      properties: { exitCode: { type: 'integer' } },
      required: ['exitCode'],
    },
  }
  const exotic: ToolSdkSchema = {
    name: 'my-mcp.tool',
    description: 'Exotic name.',
    parameters: parameterSchemaSpecToJsonSchema({}) as unknown as Record<string, unknown>,
    output: { type: 'array', items: { type: 'string' } },
  }

  it('declares every tool in lexicographic order with quoted keys for exotic names', () => {
    const text = renderToolsSdk([exotic, bash])
    expect(text).toContain('interface ToolArgsMap {')
    expect(text).toContain('interface ToolOutputMap {')
    expect(text).toContain('type ToolName = keyof ToolOutputMap')
    expect(text).toContain('declare class ToolCallError extends Error')
    expect(text).toContain('readonly toolName: ToolName;')
    expect(text).toContain('declare const tools: {')
    expect(text).toContain('type JsonValue = null | boolean | number | string')
    expect(text.indexOf('bash: {')).toBeGreaterThan(0)
    expect(text).toContain('"my-mcp.tool":')
    expect(text.indexOf('bash:')).toBeLessThan(text.indexOf('"my-mcp.tool":'))
    expect(text).toContain('exitCode: number;')
    expect(text).toContain('"my-mcp.tool": string[];')
    expect(text).toContain('[K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;')
    expect(text).toContain('/** Run a shell command. */')
    // The fixed instruction lines the model relies on.
    expect(text).toContain('`description`，一句话说明这个程序做什么')
    expect(text).toContain('工具调用失败会抛出 `ToolCallError`')
    expect(text).toContain('只读调用并发执行')
    expect(text).toContain('无损 JSON')
  })

  it('renders a known description in Chinese', () => {
    const english = Object.keys(ZH_DESCRIPTIONS)[0] as string
    const text = renderToolsSdk([{ ...bash, description: english }])
    expect(text).toContain((ZH_DESCRIPTIONS[english] as string).slice(0, 24))
  })

  it('lists the program before its description', () => {
    const text = renderToolsSdk([bash])
    expect(text).toContain('`code`')
    expect(text).toContain('`description`')
    expect(text).toContain('`run_code` 有两个必填参数：`code`')
  })

  it('keeps generated bindings inside a run_code program', () => {
    const text = renderToolsSdk([bash])
    expect(text).toContain('声明本身不会让名字变成可直接调用的工具')
    expect(text).toContain('只有另外以工具 schema 形式提供的名字才能直接调用')
    expect(text).toContain('`run_code({ code: "return await tools.bash({ description: \'Show current directory\', command: \'pwd\' })", description: "Show current directory" })`')
    expect(text).toContain('仅存在于程序里的 SDK 绑定：')
    expect(text).not.toContain('The available tools:')
  })

  it('keeps REPL output syntax distinct from function bodies', () => {
    const text = renderToolsSdk([bash], 'repl')
    expect(text).toContain('run_code({ code: "console.log(await tools.bash(')
    expect(text).not.toContain('return await tools.bash(')
    expect(text).not.toContain('异步 TypeScript 函数的函数体')
    expect(text).not.toContain('用 `return` 和/或 `console.log')
  })

  it('only shows a bash example accepted by the declared binding', () => {
    expect(renderToolsSdk([exotic])).not.toContain('tools.bash(')

    const commandOnly = {
      ...bash,
      parameters: parameterSchemaSpecToJsonSchema({
        command: { type: 'string', required: true },
      }) as unknown as Record<string, unknown>,
    }
    expect(renderToolsSdk([commandOnly]))
      .toContain('tools.bash({ command: \'pwd\' })')

    const incompatible = {
      ...bash,
      parameters: parameterSchemaSpecToJsonSchema({
        command: { type: 'string', required: true },
        cwd: { type: 'string', required: true },
      }) as unknown as Record<string, unknown>,
    }
    expect(renderToolsSdk([incompatible])).not.toContain('tools.bash(')

    const parameters = (value: JsonSchemaNode): ToolSdkSchema => ({
      ...bash,
      parameters: value as Record<string, unknown>,
    })
    const rejected: JsonSchemaNode[] = [
      { type: 'string' },
      { type: 'object', properties: {} },
      { type: 'object', properties: { command: { type: 'number' } } },
      { type: 'object', properties: { command: { type: 'string', const: 'date' } } },
      { type: 'object', properties: { command: { type: 'string', enum: ['date'] } } },
      {
        type: 'object',
        properties: { command: { type: 'string' }, description: { type: 'number' } },
        required: ['command', 'description'],
      },
    ]
    for (const schema of rejected) expect(renderToolsSdk([parameters(schema)])).not.toContain('tools.bash(')

    const constrained = parameters({
      type: 'object',
      properties: { command: { type: 'string', const: 'pwd', enum: ['pwd'] } },
    })
    expect(renderToolsSdk([constrained])).toContain('tools.bash({ command: \'pwd\' })')
  })

  it('uses a returned result in function-body mode', () => {
    const text = renderToolsSdk([bash])
    expect(text).toContain('return await tools.bash(')
    expect(text).toContain('异步 TypeScript 函数的函数体')
    expect(text).not.toContain('只有作为程序输出发出的值才会进入对话')
  })

  it('is deterministic: same tool set, byte-identical text regardless of input order', () => {
    expect(renderToolsSdk([bash, exotic])).toBe(renderToolsSdk([exotic, bash]))
    // Equal names sort stably (the comparator's equal arm).
    expect(renderToolsSdk([bash, bash])).toBe(renderToolsSdk([bash, bash]))
  })

  it('renders an empty declaration for an empty tool set', () => {
    const text = renderToolsSdk([])
    expect(text).toContain('interface ToolArgsMap {}')
    expect(text).toContain('interface ToolOutputMap {}')
  })
})
