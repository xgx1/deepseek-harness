/** Browser-safe vocabulary of the `agentConfigs` Remote namespace. */

/** One named bundle of skill globs and MCP servers. */
export interface AgentConfigView {
  /** Name the project selection refers to. */
  readonly name: string
  /** Skill allow globs the config contributes. */
  readonly skills: readonly string[]
  /** MCP servers the config enables. */
  readonly mcp: readonly string[]
}

/** Roster plus the selection governing one project working directory. */
export interface AgentConfigSelectionView {
  /** Every config the home document declares. */
  readonly configs: readonly AgentConfigView[]
  /** Names selected for this project; empty leaves the project ungoverned, which allows no MCP server. */
  readonly selected: readonly string[]
  /** Parse error message; absent when the document parsed. */
  readonly error?: string
}

/** Addresses one project working directory. */
export interface AgentConfigRequest {
  /** Absolute project working directory. */
  readonly cwd: string
}

/** Replaces the selection of one project. */
export interface AgentConfigWrite {
  /** Absolute project working directory. */
  readonly cwd: string
  /** The complete replacement selection; empty removes the project entry. */
  readonly selected: readonly string[]
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The selection named an undeclared config, or the document could not be persisted. */
    'agent-configs/rejected': { readonly reason: string }
  }
}
