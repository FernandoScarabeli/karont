import { createContext } from "react";

// Fixa a rolagem no fim da lista, se o usuário estiver lá. Chamado logo depois de
// cada quadro de texto revelado, antes da pintura. A identidade é estável.
export const FollowBottomContext = createContext<() => void>(() => {});
