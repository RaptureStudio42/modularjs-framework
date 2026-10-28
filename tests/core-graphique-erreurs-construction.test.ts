// module cœur <@@chart> : ce qui est écrit en dur dans le code se vérifie à la construction. Un mot inconnu de shape, stats, step, axis,
// toolbar ou shapes, une couleur de série refusée (« ; », « : », guillemet, url(…)) ou que le navigateur ne saurait pas lire (un mot qui
// n'est ni une teinte ni une couleur nommée du CSS, un # sans 3, 4, 6 ou 8 chiffres, une fonction qui n'est pas de couleur), une combinaison impossible (stats sur des barres
// empilées, un anneau, une carte, un radar ou un calendrier, trend sur un histogramme ; step="year" ou un axe qui n'est pas une date sur un calendrier ; un radar de moins de 3 lignes écrites) arrêtent la
// construction en disant le mot, l'attribut et les valeurs permises, en français et en anglais. Une valeur venue d'une variable passe : le
// module la vérifie à l'exécution. Dans le doute (deux mots, un mot préfixé par un moteur, une fonction suivie d'autre chose), rien n'est refusé. Les listes du contrôle sont celles du module.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import * as coreChart from '../src/bundler/core-chart.js'
import { CHART_WORDS, CHART_HUES, CHART_SAFE_COLOR, unknownColor, writtenColors } from '../src/bundler/core-chart.js'

async function construire(etiquette: string, page: string): Promise<{ fichier: string, texte: string }> {
  const root   = mjsTmp(etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gk-page.mjs'), page)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { fichier: join(srcDir, 'gk-page.mjs'), texte: stats.errors.map((e: any) => String(e?.message ?? e)).join('\n') }
}

const DONNEES = `<script>\n  $lignes = [{ x: 'a', v: 1 }]\n  $series = [{ key: 'v' }]\n</script>\n`
const FORMES  = 'line area dots bar stack histogram pie heatmap radar calendar'
const COULEUR = 'écrivez un nom de teinte (blue orange green pink violet gold), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \\ », « /* » ni url(…).'

const FAUTES = DONNEES + [
  '<@@chart rows={$lignes} series={$series} shape="courbe"></@@chart>',
  '<@@chart rows={$lignes} series={$series} stats="mean moyenne"></@@chart>',
  '<@@chart rows={$lignes} series={$series} step="quinzaine"></@@chart>',
  '<@@chart rows={$lignes} series={$series} axis="heure"></@@chart>',
  '<mjs-core-chart rows={$lignes} series={$series} shape="Line"></mjs-core-chart>',
  '<@@chart rows={$lignes} series={[{ key: \'v\', color: \'red;x\' }, { key: \'w\', color: "url(x.png)" }, { key: \'z\', color: \'green\' }]}></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="heatmap" stats="mean"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="radar" stats="median q1"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="calendar" stats="trend"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="pie" stats="mean"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="stack" stats="median q1"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="histogram" stats="mean trend"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="calendar" step="year"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="calendar" axis="number"></@@chart>',
  '<@@chart rows={[{ x: \'a\', v: 1 }, { x: \'b\', v: 2 }]} series={$series} shape="radar"></@@chart>',
  '<@@chart rows={$lignes} series={$series} toolbar="legend legende" shapes="line courbe"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'v\', color: \'bleu\' }, { key: \'w\', color: \'#12\' }, { key: \'z\', color: \'#12345\' }, { key: \'y\', color: \'teinte(1)\' }, { key: \'u\', color: \'inherit\' }]}></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: "v", "color": "rouge;x" }, { key: "w", \'color\': \'red /* x */\' }, { key: "z", color: `gris` }]}></@@chart>',
  '<@@chart rows={$lignes} series={$series} timezone="Europe/Pariss"></@@chart>',
  '<@@chart rows={$lignes} series={$series} timezone="heure locale"></@@chart>',
  '<@@chart rows={$lignes} series={$series} decimals="11"></@@chart>',
  '<@@chart rows={$lignes} series={$series} decimals="2.5"></@@chart>',
  '<@@chart rows={$lignes} series={$series} decimals="-1"></@@chart>',
  '<@@chart rows={$lignes} series={$series} decimals={12}></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'v\', color: \'0\' }, { key: \'w\', color: \'1.5\' }]}></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'v\', axis: \'droite\' }, { key: \'w\', "axis": "Right" }, { key: \'z\', axis: \'right\' }, { key: \'u\', axis: 2 }]}></@@chart>',
].join('\n') + '\n'

const ATTENDUS = [
  `<@@chart shape="courbe"> — « courbe » n'est pas une valeur connue de shape (valeurs connues : ${FORMES}). Corrigez la faute de frappe.`,
  '<@@chart stats="mean moyenne"> — « moyenne » n\'est pas une valeur connue de stats (valeurs connues : mean median q1 q3 trend). Corrigez la faute de frappe.',
  '<@@chart step="quinzaine"> — « quinzaine » n\'est pas une valeur connue de step (valeurs connues : auto day week month year). Corrigez la faute de frappe.',
  '<@@chart axis="heure"> — « heure » n\'est pas une valeur connue de axis (valeurs connues : date datetime number category). Corrigez la faute de frappe.',
  `<mjs-core-chart shape="Line"> — « Line » n'est pas une valeur connue de shape (valeurs connues : ${FORMES}). Corrigez la faute de frappe.`,
  `<@@chart series={…}> — la couleur « red;x » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « url(x.png) » est refusée : ${COULEUR}`,
  '<@@chart shape="heatmap" stats="mean"> — la forme heatmap ne trace pas stats « mean » (formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar). Retirez « mean » de stats ou changez de forme.',
  '<@@chart shape="radar" stats="median q1"> — la forme radar ne trace pas stats « median q1 » (formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar). Retirez « median q1 » de stats ou changez de forme.',
  '<@@chart shape="calendar" stats="trend"> — la forme calendar ne trace pas stats « trend » (formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar). Retirez « trend » de stats ou changez de forme.',
  '<@@chart shape="pie" stats="mean"> — la forme pie ne trace pas stats « mean » (formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar). Retirez « mean » de stats ou changez de forme.',
  '<@@chart shape="stack" stats="median q1"> — la forme stack ne trace pas stats « median q1 » (formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar). Retirez « median q1 » de stats ou changez de forme.',
  '<@@chart shape="histogram" stats="mean trend"> — la forme histogram ne trace pas stats « trend » (formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar). Retirez « trend » de stats ou changez de forme.',
  '<@@chart shape="calendar" step="year"> — step="year" ne va pas avec la forme calendar (valeurs possibles : auto day week month).',
  '<@@chart shape="calendar" axis="number"> — axis="number" ne va pas avec la forme calendar (valeurs possibles : date datetime).',
  '<@@chart shape="radar" rows={…}> — un radar demande au moins 3 lignes, une par axe : 2 sont écrites.',
  '<@@chart toolbar="legend legende"> — « legende » n\'est pas une valeur connue de toolbar (valeurs connues : legend shapes stats step). Corrigez la faute de frappe.',
  `<@@chart shapes="line courbe"> — « courbe » n'est pas une valeur connue de shapes (valeurs connues : ${FORMES}). Corrigez la faute de frappe.`,
  `<@@chart series={…}> — la couleur « bleu » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « #12 » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « #12345 » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « teinte(1) » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « inherit » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « rouge;x » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « red /* x */ » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « gris » est refusée : ${COULEUR}`,
  `<@@chart timezone="Europe/Pariss"> — « Europe/Pariss » n'est pas un fuseau connu : écrivez local (l'heure de l'écran du visiteur) ou le nom d'une zone IANA (Europe/Paris, America/New_York, UTC…), ou retirez timezone pour afficher les heures telles qu'elles sont écrites.`,
  `<@@chart timezone="heure locale"> — « heure locale » n'est pas un fuseau connu : écrivez local (l'heure de l'écran du visiteur) ou le nom d'une zone IANA (Europe/Paris, America/New_York, UTC…), ou retirez timezone pour afficher les heures telles qu'elles sont écrites.`,
  '<@@chart decimals="11"> — decimals attend un nombre entier de 0 à 10, le nombre de chiffres après la virgule : « 11 » ne convient pas.',
  '<@@chart decimals="2.5"> — decimals attend un nombre entier de 0 à 10, le nombre de chiffres après la virgule : « 2.5 » ne convient pas.',
  '<@@chart decimals="-1"> — decimals attend un nombre entier de 0 à 10, le nombre de chiffres après la virgule : « -1 » ne convient pas.',
  '<@@chart decimals={12}> — decimals attend un nombre entier de 0 à 10, le nombre de chiffres après la virgule : « 12 » ne convient pas.',
  `<@@chart series={…}> — la couleur « 0 » est refusée : ${COULEUR}`,
  `<@@chart series={…}> — la couleur « 1.5 » est refusée : ${COULEUR}`,
  '<@@chart series={…}> — axis « droite » d\'une série n\'est pas une valeur connue (valeurs connues : left right). Corrigez la faute de frappe.',
  '<@@chart series={…}> — axis « Right » d\'une série n\'est pas une valeur connue (valeurs connues : left right). Corrigez la faute de frappe.',
  '<@@chart series={…}> — axis « 2 » d\'une série n\'est pas une valeur connue (valeurs connues : left right). Corrigez la faute de frappe.',
]

// tout passe : des valeurs venues de variables (même fausses, le module les vérifie à l'exécution), des valeurs justes écrites en dur,
// une combinaison dont un côté est une variable, des valeurs vides (la valeur par défaut), un radar vide, des lignes qui ne sont pas un
// tableau écrit, un étalement (ce qu'il pose ne se sait pas au build)
const JUSTES = `<script>\n  $lignes = [{ x: '2026-10-01', v: 1 }]\n  $series = [{ key: 'v', color: 'url(x)' }]\n  $forme = 'courbe'\n  $stats = 'moyenne'\n  $pas = 'quinzaine'\n  $axe = 'heure'\n  $reglages = { stats: 'mean' }\n  $outils = 'legend legende'\n  $formes = 'line courbe'\n  $teinte = 'bleu'\n  $zone = 'Lune/Mer'\n  $chiffres = 42\n  $cote = 'droite'\n</script>\n` + [
  '<@@chart rows={$lignes} series={$series} timezone="local" decimals="0"></@@chart>',
  '<@@chart rows={$lignes} series={$series} timezone="Europe/Paris" decimals="10"></@@chart>',
  '<@@chart rows={$lignes} series={$series} timezone=" UTC " decimals={2}></@@chart>',
  '<@@chart rows={$lignes} series={$series} timezone={$zone} decimals={$chiffres}></@@chart>',
  '<@@chart rows={$lignes} series={$series} timezone="" decimals=""></@@chart>',
  '<@@chart rows={$lignes} series={$series} decimals={2.0}></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape={$forme} stats={$stats} step={$pas} axis={$axe}></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'v\', color: \'#c0392b\' }, { key: \'w\', color: \'Green\' }, { key: \'z\', color: 3 }, { key: \'y\', color: \'var(--ma-teinte)\' }, { key: \'u\', color: "rgb(1 2 3 / 50%)" }, { key: \'t\', color: \'\' }]} shape="line" stats="mean, median q1 q3 trend" step="week" axis="date"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="heatmap" stats={$stats}></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="pie" stats={$stats}></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="histogram" stats="mean median q1 q3"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape={$forme} stats="trend"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape={$forme} stats="mean"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="calendar" step="month" axis="datetime"></@@chart>',
  '<@@chart rows={[{ x: \'a\', v: 1 }, { x: \'b\', v: 2 }, { x: \'c\', v: 3 }]} series={$series} shape="radar"></@@chart>',
  '<@@chart rows={[]} series={$series} shape="radar"></@@chart>',
  '<@@chart rows={[...$lignes, { x: \'b\', v: 2 }]} series={$series} shape="radar"></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="" stats="" step="" axis=""></@@chart>',
  '<@@chart {...$reglages} shape="calendar"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'a\', color: \'rebeccapurple\' }, { key: \'b\', color: \'Canvas\' }, { key: \'c\', color: \'currentColor\' }, { key: \'d\', color: \'transparent\' }, { key: \'e\', color: \'#abcd\' }, { key: \'f\', color: \'#A1B2C3D4\' }, { key: \'g\', color: \'oklch(70% 0.1 200)\' }, { key: \'h\', color: \'color-mix(in srgb, red 50%, blue)\' }, { key: \'i\', color: \'light-dark(#000, #fff)\' }, { key: \'j\', color: \'HSL(200 50% 50%)\' }, { key: \'k\', color: \'-webkit-link\' }, { key: \'l\', color: \'red blue\' }, { key: \'m\', color: \'rgb(1 2 3) x\' }]} toolbar="legend shapes stats step" shapes="line, bar pie"></@@chart>',
  '<@@chart rows={$lignes} series={$series} toolbar={$outils} shapes={$formes}></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'v\', axis: \'left\' }, { key: \'w\', axis: " right " }, { key: \'z\', axis: \'\' }, { key: \'y\', axis: $cote }, { key: \'x\', name: "le champ axis: \'gauche\'" }]}></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'v\', axis: \'gauche\', name: "#{$cote}" }]}></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'v\', name: "le champ color: \'x;y\'" }, { key: \'w\', color: \'oklch(from var(--marque) calc(l * 0.8) c h)\' }, { key: \'z\', color: "#{$teinte}" }]} shape=" pie " step=" week " axis=" category " toolbar=" legend , shapes " shapes=" pie bar "></@@chart>',
].join('\n') + '\n'

describe('<@@chart> — ce qui est écrit en dur se vérifie à la construction', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('chaque mot inconnu, chaque couleur refusée, chaque combinaison impossible arrête la construction avec son message', async () => {
    const { fichier, texte } = await construire('graphique-fautes', FAUTES)
    for (const attendu of ATTENDUS) assert.ok(texte.includes(`[bundler] ${fichier} : ${attendu}`), `message absent : ${attendu}\n--- erreurs :\n${texte}`)
    const lignes = texte.split('\n').filter((l) => l.includes('chart'))
    assert.equal(lignes.length, ATTENDUS.length, `une ligne par faute, rien de plus :\n${lignes.join('\n')}`)
  })

  it('des valeurs venues de variables, des valeurs justes, vides ou incertaines ne bloquent rien', async () => {
    const { texte } = await construire('graphique-justes', JUSTES)
    assert.equal(texte, '', texte)
  })

  it('en anglais aussi', async () => {
    setMessagesLang('en')
    try {
      const { fichier, texte } = await construire('graphique-fautes-en', DONNEES + '<@@chart rows={$lignes} series={$series} shape="calendar" step="year" stats="moyenne"></@@chart>\n<@@chart rows={$lignes} series={[{ key: \'v\', color: \'a:b\' }]} shape="radar" stats="mean"></@@chart>\n<@@chart rows={[{ x: \'a\', v: 1 }]} series={$series} shape="radar"></@@chart>\n<@@chart rows={$lignes} series={$series} shape="stack" stats="mean"></@@chart>\n<@@chart rows={$lignes} series={$series} timezone="Mars/Olympus" decimals="12"></@@chart>\n<@@chart rows={$lignes} series={[{ key: \'v\', axis: \'droite\' }]}></@@chart>\n')
      for (const attendu of [
        '<@@chart stats="moyenne"> — "moyenne" is not a known value of stats (known values: mean median q1 q3 trend). Fix the typo.',
        '<@@chart shape="calendar" step="year"> — step="year" does not go with the calendar shape (possible values: auto day week month).',
        '<@@chart shape="calendar" stats="moyenne"> — the calendar shape does not draw stats "moyenne" (shapes that draw statistics: line area dots bar histogram; trend: line area dots bar). Remove "moyenne" from stats or change the shape.',
        '<@@chart shape="stack" stats="mean"> — the stack shape does not draw stats "mean" (shapes that draw statistics: line area dots bar histogram; trend: line area dots bar). Remove "mean" from stats or change the shape.',
        '<@@chart series={…}> — the color "a:b" is refused: write a theme hue name (blue orange green pink violet gold), an integer of 1 or more (past 6, the hues start over) or a CSS color the browser can read, without ";", ":", quote, brace, "<", ">", "\\", "/*" or url(…).',
        '<@@chart shape="radar" stats="mean"> — the radar shape does not draw stats "mean" (shapes that draw statistics: line area dots bar histogram; trend: line area dots bar). Remove "mean" from stats or change the shape.',
        '<@@chart shape="radar" rows={…}> — a radar needs at least 3 rows, one per axis: 1 written.',
        '<@@chart timezone="Mars/Olympus"> — "Mars/Olympus" is not a known time zone: write local (the visitor\'s screen time) or the name of an IANA zone (Europe/Paris, America/New_York, UTC…), or remove timezone to show the hours as they are written.',
        '<@@chart decimals="12"> — decimals expects a whole number from 0 to 10, the number of digits after the decimal point: "12" does not fit.',
        '<@@chart series={…}> — axis "droite" of a series is not a known value (known values: left right). Fix the typo.',
      ]) assert.ok(texte.includes(`[bundler] ${fichier}: ${attendu}`), `message absent : ${attendu}\n--- erreurs :\n${texte}`)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('la règle des couleurs : une couleur valide passe (`*` d\'une couleur relative compris), jamais « ; », « : », guillemet, accolade, « < », « > », « \\ », « /* » ni url(…)', () => {
    for (const ok of ['oklch(from var(--marque) calc(l * 0.8) c h)', 'rgb(1 2 3 / 50%)', '#c0392b', 'color-mix(in srgb, red 40%, transparent)', 'var(--ma-teinte, #fff)']) assert.ok(CHART_SAFE_COLOR.test(ok), ok)
    for (const ko of ['red;x', 'a:b', 'a"b', 'a\'b', 'a`b', 'a{b', 'a}b', 'a<b', 'a>b', 'a\\b', 'red /* x */', 'url(x.png)', 'URL (x)']) assert.equal(CHART_SAFE_COLOR.test(ko), false, ko)
    assert.deepEqual(['bleu', '#12', '#12345', 'teinte(1)', 'inherit', '0', '00', '1.5', '-2'].filter((c) => !unknownColor(c)), [], 'refusées à coup sûr')
    assert.deepEqual(['red', 'Green', 'rebeccapurple', 'Canvas', 'currentColor', '#abcd', 'HSL(1 2% 3%)', 'light-dark(#000, #fff)', '-webkit-link', 'red blue', 'rgb(1 2 3) x'].filter((c) => unknownColor(c)), [], 'acceptées, ou le doute')
    assert.deepEqual(writtenColors(`[{ key: 'v', name: "le champ color: 'x;y'" }, { key: "w", "color": "red;x" }, { 'color': \`gris\` }, { color: 'a\\'b' }, { color: maTeinte }, cond ? color : 'z']`), ['red;x', 'gris'])
    assert.deepEqual(writtenColors(`[{ color: 'red;x', name: "#{nom}" }]`), [], 'une interpolation : rien de sûr')
  })

  it('les listes du contrôle sont celles du module (formes, statistiques, formes qui en tracent, axes, teintes, couleur permise) et de la couche de calcul (pas)', () => {
    const module = readFileSync(new URL('../src/core-modules/chart.mjs', import.meta.url), 'utf-8')
    const calcul = readFileSync(new URL('../src/runtime/mjs_chart.ts', import.meta.url), 'utf-8')
    const cles   = (bloc: string) => [...bloc.matchAll(/(\w+):/g)].map((m) => m[1])
    assert.deepEqual(CHART_WORDS.shape, cles(/^ {2}SHAPES = \{([^}]*)\}/m.exec(module)![1]))
    assert.deepEqual(CHART_WORDS.stats, [.../^ {2}STATS = \{\n([\s\S]*?)\n {2}\}/m.exec(module)![1].matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]))
    assert.deepEqual(CHART_WORDS.axis, [.../^ {2}AXES = \[([^\]]*)\]/m.exec(module)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
    assert.deepEqual(CHART_WORDS.step, [.../^var _chrSteps = \[([^\]]*)\]/m.exec(calcul)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
    assert.deepEqual(CHART_WORDS.toolbar, [.../^ {2}TOOLKIT = \[([^\]]*)\]/m.exec(module)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
    assert.deepEqual(CHART_WORDS.shapes, CHART_WORDS.shape)
    assert.deepEqual(coreChart.CHART_STATS_SHAPES, [.../^ {2}STATS_SHAPES = \[([^\]]*)\]/m.exec(module)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
    assert.deepEqual(coreChart.CHART_TREND_SHAPES, [.../^ {2}TREND_SHAPES = \[([^\]]*)\]/m.exec(module)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
    assert.deepEqual(coreChart.CHART_SERIES_AXES, [.../^ {2}SIDES\s*= \[([^\]]*)\]/m.exec(module)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
    assert.deepEqual(CHART_HUES, cles(/^ {2}HUES = \{([^}]*)\}/m.exec(module)![1]))
    assert.equal(CHART_SAFE_COLOR.source, /^ {2}SAFE_COLOR = \/(.*)\/i$/m.exec(module)![1])
    assert.equal(CHART_SAFE_COLOR.flags, 'i')
  })
})
