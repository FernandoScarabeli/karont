import { useEffect, useState } from "react";
import { getBridge } from "./index.ts";

export type ServiceStatusState = "no-bridge" | "connecting" | "connected" | "disconnected";

export type ServiceStatusValue = {
  state: ServiceStatusState;
  info?: { serviceVersion: string };
};

export function useServiceStatus(): ServiceStatusValue {
  const [status, setStatus] = useState<ServiceStatusValue>(() => ({
    state: getBridge() ? "connecting" : "no-bridge",
  }));

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setStatus({ state: "no-bridge" });
      return;
    }

    let mounted = true;
    let requestSequence = 0;

    const refreshInfo = () => {
      const sequence = ++requestSequence;
      setStatus({ state: "connecting" });

      void bridge.request("system.info", {}).then(
        (info) => {
          if (!mounted || sequence !== requestSequence) return;
          setStatus({ state: "connected", info: { serviceVersion: info.serviceVersion } });
        },
        () => {
          if (!mounted || sequence !== requestSequence) return;
          setStatus({ state: "disconnected" });
        },
      );
    };

    const unsubscribe = bridge.onEvent((event) => {
      if (event.event !== "bridge.status") return;
      if (event.payload.state === "connected") {
        refreshInfo();
        return;
      }

      requestSequence += 1;
      setStatus({ state: event.payload.state });
    });

    refreshInfo();

    return () => {
      mounted = false;
      requestSequence += 1;
      unsubscribe();
    };
  }, []);

  return status;
}
