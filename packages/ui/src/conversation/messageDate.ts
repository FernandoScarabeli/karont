/** Data e hora como o chat mostra: "17:14 · 1 de nov." (com o ano, se não for o atual). */
const messageDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
});
const messageDateFormatterWithYear = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const messageTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function formatMessageDateTime(createdAt: string): string {
  const date = new Date(createdAt);
  const formatter =
    date.getFullYear() === new Date().getFullYear()
      ? messageDateFormatter
      : messageDateFormatterWithYear;
  return `${messageTimeFormatter.format(date)} · ${formatter.format(date)}`;
}
