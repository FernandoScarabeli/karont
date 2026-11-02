export const sampleMarkdown = `# O que muda quando o texto chega em fluxo

Uma resposta chega em pequenos lotes: a ferramenta reúne fragmentos por um intervalo curto e envia à interface. Se cada lote aparece inteiro, a leitura acompanha a rede: surge uma frase, a tela pausa e outro trecho aparece. O conteúdo está certo, mas o ritmo parece irregular mesmo quando o agente trabalha sem interrupção.

Este protótipo separa ritmo de transporte e ritmo de leitura. As quatro colunas recebem o mesmo texto, com pausas e rajadas. A primeira mostra lotes de uma vez; as demais soltam palavras em passos regulares. O markdown conserva a estrutura, e o atraso acumulado faz o revelador acelerar para recuperar terreno.

O fluxo deve continuar fiel à resposta original:

- As quatro versões começam juntas e compartilham o mesmo texto de exemplo.
- Os lotes variam de 3 a 60 caracteres, próximos de 64 ms, com pausas e rajadas.
- Palavras inteiras e marcadores de markdown completos evitam cortes no meio de uma expressão.
- Movimento reduzido remove fade e desfoque, mas conserva a cadência.

O termo \`cadência\` permanece como código inline. No bloco abaixo, cada linha chega inteira e usa uma rotina curta para representar a atualização do texto recebido.

\`\`\`ts
export function receber(lote: string) {
  resposta += lote;
  exibir(resposta);
}
\`\`\`

Se poucos caracteres chegam, o revelador acompanha suavemente. Se acumulam, ele acelera. Ao fim da rede, o restante aparece em poucos quadros. A resposta segue selecionável e copiável no DOM; a animação muda só o ritmo de leitura. Esta tela usa dados de exemplo e o renderizador de markdown da conversa.`;
