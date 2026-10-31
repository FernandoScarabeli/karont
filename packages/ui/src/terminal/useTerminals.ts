import type { TerminalInfo } from "@karont/contract";
import { useEffect, useState } from "react";
import { getBridge } from "../bridge/index.ts";

type TerminalsState = {
  terminals: TerminalInfo[];
  error: boolean;
};

export function useTerminals(): TerminalsState {
  const [state, setState] = useState<TerminalsState>({ terminals: [], error: false });

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setState({ terminals: [], error: false });
      return;
    }

    let mounted = true;
    let receivedChange = false;
    const unsubscribe = bridge.onEvent((event) => {
      if (event.event !== "terminals.changed") return;
      receivedChange = true;
      if (mounted) setState({ terminals: event.payload.terminals, error: false });
    });

    void bridge.request("terminals.list", {}).then(
      ({ terminals }) => {
        if (mounted && !receivedChange) setState({ terminals, error: false });
      },
      () => {
        if (mounted && !receivedChange) setState({ terminals: [], error: true });
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}

export function getTerminalDisplayTitles(terminals: TerminalInfo[]): Map<string, string> {
  const originalOrder = new Map(terminals.map((terminal, index) => [terminal.id, index]));
  const ordered = [...terminals].sort((left, right) => {
    const startDifference = Date.parse(left.startedAt) - Date.parse(right.startedAt);
    if (startDifference !== 0) return startDifference;
    return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
  });
  const occurrences = new Map<string, number>();
  const titles = new Map<string, string>();

  for (const terminal of ordered) {
    const occurrence = (occurrences.get(terminal.title) ?? 0) + 1;
    occurrences.set(terminal.title, occurrence);
    titles.set(terminal.id, occurrence > 1 ? `${terminal.title} (${occurrence})` : terminal.title);
  }

  return titles;
}
