// i18n — un appel OPTIONNEL de la traduction (`µt?.(…)`, `µt?(…)`, `µ.t?.(…)`, `µ?.t(…)`) est repéré comme `µt(…)`. Les repérages ne
// cherchaient que `µ.t(` dans le compilé, ou `µt(` dans le source : un composant sans `@i18n` qui ne traduisait que par un appel optionnel
// ne recevait pas la ligne d'instance `_mjs_i18n = [null,null]` (il ne suivait pas la langue), le texte et la liste d'une branche `{await}`
// ne suivaient pas la langue, une clé absente était signalée sans sa ligne, et la forme objet de `@confirm` et `@title` refusait
// `text: µt?.(…)`. Sans le module de traduction, `µt?.(…)`, `µ.t?.(…)` et `µ?.t?.(…)` rendent `undefined` sans erreur : un `runtime`
// sans 'i18n' reste accepté ; `µ?.t(…)` lève une erreur, et suit la règle de `µt(…)` (refus). Une valeur calculée qui lit un appel
// optionnel reste hors de la liste blanche du rechargement à chaud (la page se recharge)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { hotScriptFacts } from '../src/bundler/transpile-msg.js'
import { transpile } from '../src/transpiler/index.ts'

async function compile(lignes: string[], nom: string): Promise<string> {
  const { output } = await transpile(lignes.join('\n'), { moduleName: nom })
  return output
}

const compte = (texte: string, motif: RegExp): number => (texte.match(motif) ?? []).length

// une appli traduite (dictionnaire, `i18n.default`) dont le `runtime` est une liste sans 'i18n' : ses erreurs de construction
async function construireSansI18n(nom: string, source: string): Promise<string[]> {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  mkdirSync(join(srcDir, 'i18n'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'vue.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), runtime: ['hydrate'], i18n: { default: 'fr' } } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => e.message)
}

describe('i18n — appel optionnel de µt : repérages de la traduction', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('sans @i18n : la ligne d\'instance _mjs_i18n est posée pour µt?.(), µt?(), µ.t?.(), µ?.t()', async () => {
    for (const forme of ["µt?.('k')", "µt?('k')", "µ.t?.('k')", "µ?.t('k')"]) {
      const out = await compile([`<p>{${forme}}</p>`], 'mjs-i18n-opt-instance')
      assert.match(out, /_mjs_i18n = \[null,null\]/, `${forme} : ligne d'instance attendue`)
    }
  })

  it('sans @i18n : une propriété o.t?.() ne pose pas la ligne d\'instance', async () => {
    const out = await compile(['<script lang="js">', 'const o = { t: (x) => x }', "const a = o.t?.('k')", '</script>', '<p>{a}</p>'], 'mjs-i18n-opt-instance-garde')
    assert.doesNotMatch(out, /_mjs_i18n/)
  })

  it('branche {await} : le texte et la liste à µt?.() suivent la langue comme ceux à µt()', async () => {
    const source = (forme: string) => [
      '<script lang="civet">',
      '$p = Promise.resolve([1, 2])',
      '</script>',
      `{await $p}<p>…</p>{success v}<b>{${forme}('k')}</b>{for x in v}<i>{${forme}('l')}</i>{end}{end}`,
    ]
    const simple    = await compile(source('µt'), 'mjs-i18n-opt-await')
    const optionnel = await compile(source('µt?.'), 'mjs-i18n-opt-await')
    const texte = /_mjs_nodes\.t\d+; if\(_mjs_node && _mjsThis\._mjs_awaitLastRender/g
    const liste = /_mjs_awaitFors && this\._mjs_awaitFors\[/g
    assert.ok(compte(simple, texte) > 0 && compte(simple, liste) > 0, 'témoin µt() : effets du texte et de la liste')
    assert.equal(compte(optionnel, texte), compte(simple, texte), 'effet du texte de la branche')
    assert.equal(compte(optionnel, liste), compte(simple, liste), 'effet de la liste de la branche')
  })

  it('@confirm et @title en forme objet : text: µt?.(), µt?(), µ.t?.(), µ?.t() passent, clé préfixée par la section', async () => {
    const formes = ['µt?.', 'µt?', 'µ.t?.', 'µ?.t']
    const out    = await compile([
      "@i18n 'admin'",
      ...formes.map((f, i) => `<button :confirm={text: ${f}('kc${i}'), ok: 'Oui'}>b${i}</button>`),
      ...formes.map((f, i) => `<p :title={text: ${f}('kt${i}'), side: 'top'}>t${i}</p>`),
    ], 'mjs-i18n-opt-objet')
    for (let i = 0; i < formes.length; i++) {
      for (const k of [`kc${i}`, `kt${i}`]) {
        assert.match(out, new RegExp(`'admin\\.${k}'`), `${formes[i]} : ${k} préfixé`)
        assert.doesNotMatch(out, new RegExp(`'${k}'`), `${formes[i]} : ${k} jamais laissé nu`)
      }
    }
  })

  it('runtime sans \'i18n\' : une appli qui ne traduit que par µt?.(), µt?(), µ.t?.(), µ?.t?.() se construit comme avant', async () => {
    const erreurs = await construireSansI18n('i18n-opt-runtime-sur', '<p>{µt?.(\'titre\')}</p>\n<p>{µt?(\'titre\')}</p>\n<p>{µ.t?.(\'titre\')}</p>\n<p>{µ?.t?.(\'titre\')}</p>\n')
    assert.deepEqual(erreurs, [])
  })

  it('runtime sans \'i18n\' : µ?.t() (qui lève une erreur sans le module) est refusé comme µt(), avec quoi écrire', async () => {
    const erreurs = await construireSansI18n('i18n-opt-runtime-leve', '<p>{µ?.t(\'titre\')}</p>\n')
    assert.ok(erreurs.some(m => /Ajoutez 'i18n'/.test(m)), JSON.stringify(erreurs))
  })

  it('rechargement à chaud : une valeur calculée qui lit un appel optionnel reste hors de la liste blanche, µt() y reste admis', async () => {
    const verdict = async (forme: string) => {
      const out   = await compile(["@i18n 'admin'", '<script lang="civet">', '$n = 1', `$total = ${forme}('k', {n: $n})`, '</script>', '<p>{$total}</p>'], 'mjs-i18n-opt-chaud')
      const ligne = out.split('\n').find(l => l.includes('_mjs_setComputed(_mjsThis, \'total\''))
      assert.ok(ligne, `${forme} : valeur calculée compilée`)
      return hotScriptFacts(ligne!.trim().replace(/;$/, ''), 'export default 1')
    }
    assert.equal((await verdict('µt')).pure, true, 'témoin µt()')
    for (const forme of ['µt?.', 'µt?', 'µ?.t', 'µ.t?.']) {
      const v = await verdict(forme)
      assert.equal(v.pure, false, forme)
      assert.match(v.raison ?? '', /^dérivée : /, forme)
    }
  })

  it('mjs check : une clé absente écrite en appel optionnel est signalée avec sa ligne', async () => {
    const root     = mjsTmp('i18n-opt-cle-absente')
    const fichiers = {
      'i18n/fr.yml': 'titre: Bonjour\n',
      'accueil.mjs': '<p>{µt?.(\'absente.a\')}</p>\n<p>{µ?.t(\'absente.b\')}</p>\n',
      'script.mjs':  '<script>\n  msg = µt?.(\'absente.c\')\n</script>\n<p>{msg}</p>\n',
    }
    for (const [nom, texte] of Object.entries(fichiers)) {
      const chemin = join(root, 'app', 'modularjs', nom)
      mkdirSync(dirname(chemin), { recursive: true })
      writeFileSync(chemin, texte)
    }
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out', manifestPath: 'out/bundle.js', i18n: { default: 'fr' } }))
    const bundler = new Bundler(resolveBundlerOpts(findConfig(root)!.config, root) as any)
    const stats   = await bundler.compile()
    await bundler.close()
    const w = stats.warnings.filter((l: string) => l.endsWith('[lint.i18nKeyUnknown]'))
    assert.equal(w.length, 3, JSON.stringify(w))
    assert.match(w.find((l: string) => l.includes('absente.a')) ?? '', /accueil\.mjs.*ligne 1\b/s)
    assert.match(w.find((l: string) => l.includes('absente.b')) ?? '', /accueil\.mjs.*ligne 2\b/s)
    assert.match(w.find((l: string) => l.includes('absente.c')) ?? '', /script\.mjs.*ligne 2\b/s)
  })
})
