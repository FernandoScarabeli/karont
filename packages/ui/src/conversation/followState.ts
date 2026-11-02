// Acompanhamento do fim da lista durante o streaming. Só a intenção explícita do
// usuário (roda, teclas, toque, barra de rolagem) desliga o acompanhamento. O
// crescimento do texto, a troca de altura e a rolagem de ancoragem nunca desligam.

export type FollowState = "following" | "free";

export type FollowEvent =
  | { type: "userScrollUp" }
  | {
      type: "scroll";
      distanceFromBottom: number;
      previousDistanceFromBottom: number;
    }
  | { type: "newMessage" };

// Distância em pixels do fim que conta como "de volta ao fim".
export const RESUME_DISTANCE_PX = 24;

export function nextFollowState(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case "userScrollUp":
      return "free";
    case "newMessage":
      return "following";
    case "scroll": {
      // Só volta quando a rolagem aproxima do fim, não quando um movimento pequeno
      // para cima ainda cai dentro da faixa.
      const movedTowardBottom = event.distanceFromBottom < event.previousDistanceFromBottom;
      const backNearBottom = event.distanceFromBottom <= RESUME_DISTANCE_PX && movedTowardBottom;
      return backNearBottom ? "following" : state;
    }
  }
}
