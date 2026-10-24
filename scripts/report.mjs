import { desktopValid } from './desktop-proof.mjs';
import { summarize } from './benchmark-series.mjs';
import fs from 'node:fs';
const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const n = (v) => (typeof v === 'number' ? v.toFixed(2) : 'indisponível');
export function renderReport(daemon, desktop, series) {
  let report = `# Resultados locais — Fase 0\n\nGerado em ${new Date().toISOString()}. Valores individuais da última execução; quando disponível, a série abaixo consolida pelo menos cinco rodadas. Sem garantia estatística.\n\n`;
  if (daemon?.metrics?.roundtrip) {
    const h = daemon.host,
      m = daemon.metrics;
    report += `Host: ${h.cpu}, ${h.logicalCPUs} CPUs lógicas, ${n(h.ramGiB)} GiB RAM; ${h.platform} ${h.release}; Node ${h.node}; Electron ${h.electron}; ${h.display}. Consulte os JSONs para a distribuição e os valores brutos.\n\n`;
    report += `| Métrica do daemon (um processo Node) | Medição |\n|---|---:|\n| Início até handshake/ping | ${n(m.startupMs)} ms |\n| RAM ociosa RSS / PSS | ${n(m.idle.rssMiB)} / ${n(m.idle.pssMiB)} MiB |\n| CPU ociosa (um núcleo = 100%) | ${n(m.idle.cpuPercentOneCore)}% |\n| RAM streaming RSS / PSS | ${n(m.streaming.rssMiB)} / ${n(m.streaming.pssMiB)} MiB |\n| CPU streaming | ${n(m.streaming.cpuPercentOneCore)}% |\n| Socket ida e volta p50 / p95 | ${n(m.roundtrip.p50Ms)} / ${n(m.roundtrip.p95Ms)} ms |\n| Amostras de socket | ${m.roundtrip.samples} |\n\n`;
    report += `CPU 0,00% significa nenhum tick de CPU contabilizado na janela de aproximadamente 5 s, não ausência absoluta de custo. O streaming deste cenário é somente o contador sintético, sem Electron conectado. O início inclui polling de até 50 ms. O benchmark não mede fsync sob falha elétrica.\n\n`;
  }
  if (desktopValid(desktop)) {
    report += `## Desktop — verificado com sandbox\n\n`;
    for (const artifact of desktop.artifacts ?? [])
      report += `[${artifact.split('/').at(-1)}](${artifact.replace(/^benchmarks\//, '')}) · `;
    report += '\n\n';
    const m = desktop.metrics;
    report += `| Cenário | Electron RSS / PSS MiB | Daemon RSS / PSS MiB | CPU Electron / daemon % |\n|---|---:|---:|---:|\n`;
    for (const key of ['idle', 'streaming', 'editor', 'noWindow']) {
      const c = m[key];
      if (!c) continue;
      report += `| ${key} | ${n(c.electron.rssMiB)} / ${n(c.electron.pssMiB)} | ${n(c.daemon.rssMiB)} / ${n(c.daemon.pssMiB)} | ${n(c.electron.cpuPercentOneCore)} / ${n(c.daemon.cpuPercentOneCore)} |\n`;
    }
    report += `\nAbertura Electron: ${n(m.electronStartupMs)} ms. Reabertura: ${n(m.reopenMs)} ms. Intervalo de frames p95: ${n(m.responsiveness.frameGapP95Ms)} ms; ${m.responsiveness.over50ms} intervalos acima de 50 ms.\n\n${desktop.checks.map((c) => '- ' + c).join('\n')}\n\n`;
  } else {
    const legacySandbox =
      desktop?.stage === undefined && /sandbox preflight.*SUID sandbox/s.test(desktop?.error ?? '');
    const sandboxHost = desktop?.failure?.kind === 'sandbox-host' || legacySandbox;
    const stage = desktop?.failure?.stage ?? desktop?.stage ?? 'não registrada';
    report += `## Desktop — aceite bloqueado\n\n`;
    if (sandboxHost)
      report += `O preflight nativo falhou ao iniciar o Electron com sandbox obrigatório. O diagnóstico do host e a intervenção administrativa necessária estão em [SANDBOX_LINUX.md](../docs/SANDBOX_LINUX.md).\n\n`;
    else if (desktop?.passed === true)
      report += `O resultado declara sucesso mas não contém a evidência mínima do sandbox real. Não foi aceito.\n\n`;
    else if (desktop)
      report += `A execução falhou na etapa **${stage}**. Não se atribui essa falha ao sandbox sem evidência específica.\n\n`;
    else report += `Nenhuma execução desktop foi registrada.\n\n`;
    report += `Fechamento/reabertura, tray e consumo desktop permanecem sem aceite. Consulte [resultado completo](desktop-latest.json).\n\n`;
    if (desktop?.failure?.message)
      report += `Erro registrado: ${desktop.failure.message.split('\n')[0]}\n\n`;
  }

  if (series) {
    let summary;
    try {
      if (series.passed !== true) throw Error('Série incompleta');
      summary = summarize(series.desktop);
    } catch (e) {
      report += `## Série desktop — sem aceite\n\n${e.message}. Consulte [manifesto](series-latest.json).\n\n`;
    }
    if (summary) {
      const m = summary.metrics;
      report += `## Série SPEC-001 — ${summary.rounds} rodadas válidas\n\nAmbiente: ${summary.host.testEnvironment}. [Manifesto e JSONs brutos](${series.directory.replace(/^benchmarks\//, '')}/manifest.json). p95 entre cinco rodadas é o máximo (nearest-rank); não é intervalo de confiança.\n\n| Tempo | Mediana ms | p95 ms |\n|---|---:|---:|\n`;
      for (const [key, label] of [
        ['coldStartMs', 'Partida integrada, processos/perfil novos'],
        ['electronStartupMs', 'Shell com daemon pronto'],
        ['reopenMs', 'Reabertura'],
        ['frameGapP95Ms', 'p95 rAF por rodada'],
        ['focusToPaintMs', 'Foco até dois rAF (proxy)'],
      ])
        report += `| ${label} | ${n(m[key].median)} | ${n(m[key].p95)} |\n`;
      report += `\nCache do SO preservado; preflight aquece bibliotecas antes da abertura instrumentada. Xvfb não mede latência física de display.\n\n| Cenário / escopo | RSS mediana / p95 MiB | PSS mediana / p95 MiB | CPU mediana / p95 % de um núcleo |\n|---|---:|---:|---:|\n`;
      for (const scenario of ['idle', 'streaming', 'editor', 'noWindow'])
        for (const scope of ['electron', 'daemon', 'total']) {
          const c = m[scenario][scope];
          report += `| ${scenario} / ${scope} | ${n(c.rssMiB.median)} / ${n(c.rssMiB.p95)} | ${n(c.pssMiB.median)} / ${n(c.pssMiB.p95)} | ${n(c.cpuPercentOneCore.median)} / ${n(c.cpuPercentOneCore.p95)} |\n`;
        }
      report += `\nTotal é soma das árvores medidas simultaneamente; RSS soma páginas compartilhadas repetidas. Streaming inclui editor aberto; editor adiciona digitação sintética; noWindow mantém streaming e shell/tray sem renderer.\n\nProposta RAM <200 MB: PSS total ocioso mediano **${n((m.idle.total.pssMiB.median * 1048576) / 1e6)} MB**. CPU ociosa total mediana **${n(m.idle.total.cpuPercentOneCore.median)}%**. Esses números não aprovam o orçamento: requer revisão explícita, assim como o protocolo IPC.\n\n`;
    }
  }

  report += `## Evidência preliminar da interface\n\nA UI foi renderizada e inspecionada em 1440 px e 900 px. Os [oito painéis de fluxo e editor](history/initial-phase0/desktop-eight-panels.png) e a [vista compacta](history/initial-phase0/desktop-compact.png) são de uma execução inicial em que o Playwright adicionou sua flag padrão de desativar sandbox. Essa execução foi descartada para o aceite; o código/harness atuais recusam essa condição.\n\nNessa execução preliminar foram observados: Electron ocioso ~884 MiB RSS somada / 377 MiB PSS e ~2,16% de um núcleo; com streaming/editor ~903 MiB RSS / 393 MiB PSS; abertura ~526 ms e intervalo rAF p95 ~6,1 ms. Esses valores não são benchmark válido da configuração final; o daemon ainda tinha launcher auxiliar e o renderer consultava a cada 250 ms mesmo ocioso. Não se inferem aprovação do orçamento de memória ou segurança desses números.\n\n## Metas propostas e pendências\n\nAbertura <2 s, RAM ociosa <200 MB, CPU ociosa <1% e feedback <100 ms continuam metas propostas. O daemon isolado apresenta consumo baixo nesta carga. A evidência preliminar do desktop excedeu a proposta de RAM, mesmo considerando PSS. A série válida, quando presente, compara Electron/daemon/total. A soma RSS repete páginas compartilhadas; PSS é apresentada separadamente. A aprovação do orçamento permanece pendente, mesmo após validação funcional.\n\nNão há resultado de CLIs ou modelos: nenhum foi integrado. GNOME/KDE, X/menus de tray físicos, suspensão real, reinício de sessão e pacote distribuível continuam pendentes. Execuções válidas em X11 virtual são identificadas acima e não provam integração com um compositor físico. [Procedimento de repetição](../docs/BENCHMARKS.md).\n`;
  return report;
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const report = renderReport(
    read('benchmarks/daemon-latest.json'),
    read('benchmarks/desktop-latest.json'),
    read('benchmarks/series-latest.json'),
  );
  fs.mkdirSync('benchmarks', { recursive: true });
  fs.writeFileSync('benchmarks/RESULTADOS.md', report);
  console.log('benchmarks/RESULTADOS.md');
}
