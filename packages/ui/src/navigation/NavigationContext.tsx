import { createContext, type PropsWithChildren, useCallback, useContext, useState } from "react";

export type View =
  | { name: "home" }
  | { name: "new-conversation" }
  | { name: "terminal"; id: string }
  | { name: "settings"; section: "agents" };

type NavigationState = {
  view: View;
  navigate: (view: View) => void;
};

const NavigationContext = createContext<NavigationState | null>(null);

export function NavigationProvider({ children }: PropsWithChildren) {
  const [view, setView] = useState<View>({ name: "home" });
  const navigate = useCallback((nextView: View) => setView(nextView), []);

  return (
    <NavigationContext.Provider value={{ view, navigate }}>{children}</NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationState {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("useNavigation deve ser usado dentro de NavigationProvider.");
  return navigation;
}
