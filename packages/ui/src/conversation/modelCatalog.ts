import type { ResultOf } from "@karont/contract";

type AgentModel = ResultOf<"agent.models">["models"][number];
type AgentModelList = Pick<ResultOf<"agent.models">, "models"> | null;

export function findModelByIdOrAlias(
  modelList: AgentModelList,
  modelId: string,
): AgentModel | undefined {
  return (
    modelList?.models.find((model) => model.id === modelId) ??
    modelList?.models.find((model) => model.aliases?.includes(modelId))
  );
}

export function defaultModel(modelList: AgentModelList): AgentModel | undefined {
  return modelList?.models.find((model) => model.isDefault) ?? modelList?.models[0];
}

export function resolveModelId(modelList: AgentModelList, preferredId: string): string {
  if (!preferredId) return defaultModel(modelList)?.id ?? "";
  return findModelByIdOrAlias(modelList, preferredId)?.id ?? preferredId;
}
