// L'objet formulaire d'un composant (la rune `µform(@)`, mjs_form.ts) : la construction le détecte sur le seul appel écrit par le
// projet, l'embarque avec ce qu'il lit (les règles en schémas standard, le contrôle des types, l'état réactif), et une appli qui ne
// l'écrit pas n'en a pas un octet — même avec un <vars>, des champs liés et `<@@field>`. Le comportement au navigateur réel est joué
// par formulaire-objet-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// un formulaire de trois champs typés, avec ou sans l'objet
function source(avecObjet: boolean): string {
  return `<vars>
  $age   int 18..120
  $nick  string 3..20 ! 'admin' | 'root'
  $email string 3..60
</vars>

<script>
  $age   = 30
  $email = 'ann@exemple.fr'
${avecObjet ? '  $form  = µform(this)\n' : ''}</script>

<form action="/inscription" method="post">
  <@@field label="Âge"><input name="age" type="number" value=!{$age}></@@field>
  <@@field label="Pseudo"><input name="nick" value=!{$nick}></@@field>
  <input name="email" value=!{$email}>
  <button>Envoyer</button>
</form>
`
}

// le build de production en un seul fichier, minifié (les réglages de l'appli du banc), navigation comprise
async function construire(nom: string, src: string): Promise<string> {
  const root = mjsTmp(nom)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'main.mjs'), src)
  const out     = join(root, 'dist')
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/dist', forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod', runtime: ['ujs', 'ajax', 'vault'] } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(out, 'bundle.js'), 'utf-8')
}

describe('objet formulaire (µform) — le cœur ne l’emporte que si l’appli l’écrit', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('la rune µform(@) compile en µ.form(this), que la construction détecte', async () => {
    const { output } = await transpile('<vars>\n$age int 18..120\n</vars>\n<script>\n$age = 20\n$form = µform(@)\n</script>\n<p>{$form.valid}</p>', { moduleName: 'form-objet' })
    assert.match(output, /µ\.form\(this\)/)
    assert.ok(scanCompiledFeatures(output).has('form'))
  })

  it('détection exacte : µ.form et mjs.form, jamais le formulaire d’un champ, un autre nom du cœur, un texte ou une classe', () => {
    for (const js of ['const f = µ.form(this)', 'let f = µ.form', 'µ?.form(this)', 'µ . form(this)', 'mjs.form(this)', 'var f = \\u00b5.form(this)', 'f(...µ.form(this))']) assert.ok(scanCompiledFeatures(js).has('form'), js)
    for (const js of ['n = input.form', 'el.form.requestSubmit()', 'µ._mjs_formReset(this, a, b)', 'µ._mjs_formErr(this, n, e)', 'µ.formX(this)', 'opts.mjs.form(this)', 'p.textContent = "µ.form(this)"', '.form{color:red}', '// µ.form plus tard\nn = 1']) assert.ok(!scanCompiledFeatures(js).has('form'), js)
  })

  it('la clé form entraîne les règles, le contrôle des types et l’état réactif, chargés avant elle ; jamais l’inverse', () => {
    const avec = new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['form'])).files
    for (const f of ['mjs_form.ts', 'mjs_rules.ts', 'mjs_types.ts', 'mjs_state.ts', 'mjs_lifecycle.ts']) assert.ok(avec.includes(f), f)
    assert.ok(avec.indexOf('mjs_rules.ts') < avec.indexOf('mjs_form.ts') && avec.indexOf('mjs_state.ts') < avec.indexOf('mjs_form.ts'))
    assert.ok(!new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['rules', 'types'])).files.includes('mjs_form.ts'))
    assert.ok(new Bundler({ runtime: ['form'] } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_form.ts'))
  })

  it('une liste runtime explicite qui omet vault : un composant qui lit µres (<@@field>) emmène le sac des réponses, rien sans lui', () => {
    const lit = new Bundler({ runtime: ['ujs', 'ajax'] } as any).resolveRuntimeFiles(scanCompiledFeatures('const e = µ.res.errors')).files
    assert.ok(lit.includes('mjs_store_globals.ts'))
    for (const js of ['const e = 1', 'const e = µ.result', 'const e = config.res.errors']) assert.ok(!new Bundler({ runtime: ['ujs', 'ajax'] } as any).resolveRuntimeFiles(scanCompiledFeatures(js)).files.includes('mjs_store_globals.ts'), js)
  })

  it('un formulaire sans l’objet (<vars>, champs liés, <@@field>) n’embarque pas son code ; avec l’objet, si', async () => {
    const sans = await construire('form-objet-sans', source(false))
    const avec = await construire('form-objet-avec', source(true))
    assert.ok(!sans.includes('form[aria-busy="true"]'), 'le code de l’objet est entré sans µform')
    assert.ok(avec.includes('form[aria-busy="true"]'), 'le code de l’objet manque avec µform')
  })

  it('la lecture de µres se cherche sur le code : une chaîne, un texte gabarit ou un commentaire qui le nomment n’emmènent pas le sac', () => {
    const sac = (js: string) => new Bundler({ runtime: ['ujs', 'ajax'] } as any).resolveRuntimeFiles(scanCompiledFeatures(js)).files.includes('mjs_store_globals.ts')
    for (const js of ['const t = \'voir µ.res dans la doc\'', 'const t = "µ.res.errors"', 'const t = `µ.res`', '// lire µ.res.errors\nconst t = 1', '/* µ.res */ const t = 1']) assert.ok(!sac(js), js)
    for (const js of ['const e = µ.res.errors', 'const t = `${µ.res.flash}`', 'const t = \'µ.res\'; const e = µ.res']) assert.ok(sac(js), js)
  })

  it('la navigation ne dit à l’objet que ses refus (422) : le départ d’un envoi se lit sur mjs:visit, sans appel de plus', () => {
    const ujs  = readFileSync(new URL('../src/runtime/mjs_ujs.ts', import.meta.url), 'utf-8')
    const form = readFileSync(new URL('../src/runtime/mjs_form.ts', import.meta.url), 'utf-8')
    assert.equal(ujs.split('_mjs_formTell').length - 1, 1, 'un seul appel de la navigation, à la réponse 422')
    assert.match(form, /addEventListener\('mjs:visit'/)
  })

  it('la doc dit à qui vaut un refus du serveur, ce que l’envoi emporte et quand se prend la valeur de départ', () => {
    const types = readFileSync(new URL('../docs/37-types.md', import.meta.url), 'utf-8')
    const nav   = readFileSync(new URL('../docs/21-navigation.md', import.meta.url), 'utf-8')
    const coeur = readFileSync(new URL('../docs/30-modules-coeur.md', import.meta.url), 'utf-8')
    for (const [doc, texte] of [[types, 'pour les seuls champs que le formulaire refusé a emportés'], [nav, 'pour les seuls champs que le formulaire refusé a emportés'], [types, 'même dans l\'objet du composant qui a écrit le formulaire'], [nav, 'même dans l\'objet du composant qui a écrit le formulaire'], [types, 'déplacé dans un autre arbre sans être détruit'], [coeur, 'même écrit par ce composant'], [types, 'à l\'arrivée du champ'], [types, 'au moment où l\'envoi part'], [types, 'Un champ appartient au composant qui l\'entoure de plus près'], [types, 'Le `<@@field>` qu\'un parent écrit entre les balises d\'un enfant léger lit donc l\'objet de cet enfant'], [coeur, 'jamais dans celui d\'un ancêtre'], [coeur, 'Le `<@@field>` d\'un composant sans objet lit `µres.errors`'], [types, 'quelle que soit leur valeur'], [nav, 'quelle que soit leur valeur'], [coeur, 'une case décochée l\'est'], [types, 'remplace le relevé de l\'envoi d\'avant'], [types, 'avant ce que votre code change ensuite'], [nav, 'avant ce que votre code change ensuite'], [coeur, 'avant ce que votre code change ensuite']]) assert.ok(doc.includes(texte), texte)
    assert.ok(!types.includes('deux composants d\'une page ne se prêtent pas leurs erreurs.'), '37-types : les composants imbriqués')
    for (const doc of [types, nav]) assert.ok(!doc.includes('et dans celui du propriétaire de chaque champ d\'un autre composant que ce formulaire a emporté'), 'refus : les seuls champs emportés')
    for (const faux of ['valeurs que la navigation a envoyées', 'prise juste après le premier affichage', 'Un champ appartient au composant dont le gabarit l\'a écrit', 'lit de lui-même l\'objet du composant qui l\'a écrit']) assert.ok(!types.includes(faux), faux)
    assert.ok(!nav.includes('elles répondent aux valeurs du départ de la requête'), '21-navigation')
  })
})
