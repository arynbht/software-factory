export type { Change, Generator } from "./types.js";
export {
  applyChanges,
  type ApplyOptions,
  type ChangeAction,
  type ChangeResult,
} from "./apply.js";
export { generators } from "./registry.js";
export {
  type GeneratorError,
  planControl,
  planControls,
  type PlanResult,
} from "./run.js";
export {
  renderTemplate,
  resolveTemplateVars,
  SUPPORTED_LICENSES,
  templateGenerator,
  templateVars,
  type TemplateVars,
} from "./template.js";
export { mergeJsonGenerator } from "./merge-json.js";
export { mergeYamlGenerator } from "./merge-yaml.js";
export { githubSettingGenerator } from "./github-setting.js";
export { commandGenerator } from "./command.js";
export { claudeGenerator } from "./claude.js";
