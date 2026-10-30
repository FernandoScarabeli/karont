export type Delivery = 'submitted' | 'failed' | 'unavailable' | 'disabled';
export class NotificationCenter {
  private seen = new Set<string>();
  readonly history: { event: string; status: Delivery; at: number }[] = [];
  enabled = true;
  constructor(private deliver: (title: string, click: () => void, fail: () => void) => boolean) {}
  notify(key: string, title: string, click: () => void) {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value!);
    const entry = { event: key.split(':')[0], status: 'submitted' as Delivery, at: Date.now() };
    this.history.push(entry);
    if (this.history.length > 50) this.history.shift();
    if (!this.enabled) {
      entry.status = 'disabled';
      return;
    }
    try {
      if (
        !this.deliver(title, click, () => {
          entry.status = 'failed';
        })
      )
        entry.status = 'unavailable';
    } catch {
      entry.status = 'failed';
    }
  }
}
