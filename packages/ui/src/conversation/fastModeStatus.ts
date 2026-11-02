import { t } from "../i18n/pt-BR.ts";

export function fastUnavailableMessage(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  return reason === "extra_usage_disabled"
    ? t.chat.fastUnavailableExtraUsage
    : t.chat.fastUnavailableGeneric;
}
