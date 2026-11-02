import assert from "node:assert/strict";
import test from "node:test";
import { nextFollowState, RESUME_DISTANCE_PX } from "./followState.ts";

const scroll = (distanceFromBottom, previousDistanceFromBottom) => ({
  type: "scroll",
  distanceFromBottom,
  previousDistanceFromBottom,
});

test("sem entrada do usuário e com crescimento, continua acompanhando", () => {
  // Crescimento não gera evento: o estado segue como está.
  assert.equal(nextFollowState("following", scroll(0, 0)), "following");
  assert.equal(nextFollowState("following", scroll(635, 0)), "following");
});

test("encolher o conteúdo não desliga o acompanhamento", () => {
  assert.equal(nextFollowState("following", scroll(0, 120)), "following");
});

test("rolar para cima com a roda desliga o acompanhamento", () => {
  assert.equal(nextFollowState("following", { type: "userScrollUp" }), "free");
});

test("sem entrada do usuário, uma distância grande não desliga", () => {
  assert.equal(nextFollowState("following", scroll(300, 0)), "following");
});

test("rolar de volta para perto do fim retoma o acompanhamento", () => {
  assert.equal(
    nextFollowState("free", scroll(RESUME_DISTANCE_PX, RESUME_DISTANCE_PX + 200)),
    "following",
  );
  assert.equal(nextFollowState("free", scroll(0, 500)), "following");
});

test("um pequeno movimento para cima dentro da faixa não retoma", () => {
  assert.equal(nextFollowState("free", scroll(20, 0)), "free");
});

test("rolagem longe do fim, parado, continua livre", () => {
  assert.equal(nextFollowState("free", scroll(500, 500)), "free");
});

test("mensagem nova retoma o acompanhamento", () => {
  assert.equal(nextFollowState("free", { type: "newMessage" }), "following");
  assert.equal(nextFollowState("following", { type: "newMessage" }), "following");
});
