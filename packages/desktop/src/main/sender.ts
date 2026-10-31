export type SenderDetails = {
  url: string;
  isMainFrame: boolean;
  belongsToOurWindow: boolean;
};

export function isAllowedSender(sender: SenderDetails): boolean {
  return sender.isMainFrame && sender.belongsToOurWindow && sender.url.startsWith("karont://app/");
}
