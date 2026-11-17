import { describe, expect, it } from "vitest";
import { mannerLine, roundHalfEven } from "../manner.js";

const paras = [
  "Я вышел из шлюза и сразу почувствовал холод. Коридор был пуст. Где-то наверху гудели вентиляторы, и этот гул я знал с детства.",
  "— Ты опоздал, — сказал Вернер.",
  "— Знаю.",
  "— Компания ждать не будет, — ответил он и отвернулся к стене, будто разговор ему надоел.",
  "Я промолчал. Мне нечего было ему сказать, а врать не хотелось.",
  "— Где свёрток? — спросил Вернер, не оборачиваясь.",
  "— У меня его нет. И не было никогда, если вам интересно.",
];
// Expected strings were computed by the Python original (build_pairs.py manner_line).
describe("mannerLine", () => {
  it("с репликами", () => {
    expect(mannerLine(paras.join("\n\n"))).toBe(
      "Манера: повествование от первого лица, предложения в среднем 6 слов, реплики 50% текста, реплика в среднем 7 слов, с подписью «сказал» 60% реплик",
    );
  });
  it("без реплик", () => {
    expect(mannerLine([paras[0], paras[4]].join("\n\n"))).toBe(
      "Манера: повествование от первого лица, предложения в среднем 7 слов, реплики 0% текста",
    );
  });
  it("roundHalfEven", () => {
    expect(roundHalfEven(6.5)).toBe(6);
    expect(roundHalfEven(7.5)).toBe(8);
    expect(roundHalfEven(2.4)).toBe(2);
  });
});
