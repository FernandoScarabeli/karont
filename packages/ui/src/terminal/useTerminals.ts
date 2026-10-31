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
