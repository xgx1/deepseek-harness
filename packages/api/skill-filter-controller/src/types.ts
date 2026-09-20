/** Browser-safe vocabulary of the `skillFilter` Remote namespace. */

/** One allow/deny glob list pair, as stored in a skill-filter YAML config. */
export interface SkillFilterConfigView {
  /** Glob patterns that allow skills to be model-visible. */
  readonly allow: readonly string[]
  /** Glob patterns that deny skills. */
  readonly deny?: readonly string[]
}

/** One layer of the filter config, addressed for read or write. */
export interface SkillFilterConfigRequest {
  /** Project working directory whose `<cwd>/.dsh/skill-filter.yaml` is addressed. */
  readonly cwd: string
}

/** Replacement for one layer of the filter config. */
export interface SkillFilterConfigWrite {
  /** Project working directory whose config is written. */
  readonly cwd: string
  /** The complete config replacing the file; `allow` is required, `deny` optional. */
  readonly config: SkillFilterConfigView
}

/** Personal (user-level) config, or absent. */
export interface SkillFilterPersonalView {
  readonly exists: boolean
  /** Parse error message; absent when the file parsed or is missing. */
  readonly error?: string
  readonly config?: SkillFilterConfigView
}

/** Project (workspace-level) config, or absent. */
export interface SkillFilterProjectView {
  readonly exists: boolean
  /** Parse error message; absent when the file parsed or is missing. */
  readonly error?: string
  readonly config?: SkillFilterConfigView
}

/** The merged, effective config for one project cwd. */
export interface SkillFilterEffectiveView {
  /** Whether the personal config exists (absence disables filtering). */
  readonly personalExists: boolean
  /** Whether the project config exists. */
  readonly projectExists: boolean
  /** The merged effective config; absent when no personal config exists. */
  readonly config?: SkillFilterConfigView
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The config failed validation or could not be persisted. */
    'skill-filter/rejected': { readonly reason: string }
  }
}
