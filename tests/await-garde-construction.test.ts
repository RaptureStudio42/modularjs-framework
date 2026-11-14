// {await.keep …} à la construction. L'option s'écrit sur le mot du bloc : aucune expression ne change de sens (un mot écrit après
// l'expression reste lu comme avant, un appel ou un opérande, et rien ne pose l'option en silence). Les deux lectures du gabarit
// (l'ancienne, l'arbre du lecteur unique) la lisent de la même façon. Un bloc sans option, qui ne lit ni `µpending` ni `µsignal`, se
// construit comme avant : sa portée, donc le nom temporaire d'un `{const}` de branche, et l'attache de l'attente posée à sa création.
// Chaque option n'entre au cœur de production d'une appli que si l'appli l'écrit : sans aucune, le cœur est celui d'un `{await}` ordinaire ;
// un cœur de développement les garde toutes, pour un composant compilé à part, et un composant construit pour le développement dit
// l'option que le cœur de sa page n'a pas. Une option mal écrite (`{await.kep …}`) ou une expression qui manque (`{await}`, `{await *skeleton}`)
// est refusée avec son message, sous les deux lectures ; l'exemple du message est une tête qui se construit (`*skeleton` la finit).
// `µpending` se repère dans le code de la branche seul : un texte, une chaîne ou un commentaire qui citent le mot laissent le code d'un
// mot quelconque ; l'interpolation d'une chaîne double d'un gestionnaire (`"état #{µpending}"`) le lit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as features from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { parse, type Node } from '../src/parser/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SCRIPT = "<script>\n  $q = 'a'\n  keep = 2\n  f = (v) -> Promise.resolve(v)\n  x = (v) -> v\n  load = (v) -> Promise.resolve(v)\n  chercher = (q, s) -> Promise.resolve([q])\n</script>\n"
const bloc   = (tete: string, succes = '<b>{v}</b>') => `${SCRIPT}{${tete}}\n  <i class="att">attente</i>\n{success v}\n  ${succes}\n{end}\n`

// le code compilé d'un composant (grammaire civet par défaut, ou js)
async function compiler(source: string, templateLang: 'civet' | 'js' = 'civet'): Promise<string> {
  return (await transpile(source, { moduleName: 'mjs-agc', templateLang } as any)).output
}

// la lecture de l'expression du bloc, et l'option posée ou non (le drapeau qui suit les variables de l'expression)
function lecture(js: string): { lecture: string, garde: boolean } {
  const m = /_mjs_updAwait\('await\d+', ([\s\S]*?), (?:\(\) => \{|null)/.exec(js)
  assert.ok(m, 'appel _mjs_updAwait introuvable')
  return { lecture: m[1], garde: /_mjs_updAwait\('await\d+', [\s\S]*?(?:\]|null), 1\);/.test(js) }
}

describe('{await.keep …} à la construction : forme, lectures du gabarit, code sans option, cœur', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  it('un mot écrit après l\'expression garde le sens d\'aujourd\'hui : aucune option posée', async () => {
    const cas: Array<[string, string]> = [
      ['await $q or keep', '() => ($.q || keep)'],
      ['await f x keep', '() => (f(x(keep)))'],
      ['await load keep', '() => (load(keep))'],
      ['await chercher($q) keep', '() => (chercher($.q)(keep))']
    ]
    for (const [tete, attendu] of cas) {
      const lu = lecture(await compiler(bloc(tete)))
      assert.deepEqual(lu, { lecture: attendu, garde: false }, `{${tete}}`)
    }
  })

  it('{await.keep …} : l\'option sur le mot du bloc, l\'expression entière et intacte, *skeleton avec elle, dans les deux grammaires', async () => {
    assert.deepEqual(lecture(await compiler(bloc('await.keep chercher($q, µsignal)'))), { lecture: '(_mjs_sig) => (chercher($.q, _mjs_sig))', garde: true })
    assert.deepEqual(lecture(await compiler(bloc('await.keep f x keep'))), { lecture: '() => (f(x(keep)))', garde: true }, 'le mot keep de l\'expression reste un nom')
    const squelette = await compiler(`${SCRIPT}{await.keep load($q) *skeleton}\n{success v}\n  <b>{v}</b>\n{end}\n`)
    assert.deepEqual(lecture(squelette), { lecture: '() => (load($.q))', garde: true })
    assert.ok(squelette.includes('mjs-skel-zone'), 'l\'attente prend la forme de {success}')
  })

  it('l\'arbre lit l\'option et l\'expression de chaque tête', async () => {
    const tetes: Array<[string, string]> = [['await.keep chercher($q, µsignal)', 'chercher($q, µsignal)'], ['await.keep load($q) *skeleton', 'load($q)'], ['await.keep\n  load($q)', 'load($q)'], ['await f x keep', 'f x keep'], ['await load($q)', 'load($q)']]
    for (const [tete, expr] of tetes) {
      const source = tete.includes('*skeleton') ? `${SCRIPT}{${tete}}\n{success v}\n  <b>{v}</b>\n{end}\n` : bloc(tete)
      await compiler(source)
      const arbre = parse(`{${tete}}${tete.includes('*skeleton') ? '' : 'x'}{success v}{v}{end}`).children.find((n: Node) => n.type === 'await')
      assert.ok(arbre, `{${tete}} : un bloc {await}`)
      assert.equal(arbre.expr, expr, `{${tete}} : l'expression du bloc`)
      assert.equal(arbre.keep, tete.startsWith('await.keep') ? true : undefined, `{${tete}} : l'option, posée seulement quand le bloc l'écrit`)
    }
  })

  it('sans option ni µpending : la portée d\'une branche est celle d\'aujourd\'hui (le {const} recréé garde son temporaire) et l\'attente pose son attache à sa création', async () => {
    const constante = await compiler(`${SCRIPT}{await load($q)}\n  <i>…</i>\n{success v}\n  {const n = v.length}\n  <button @click={x(n)}>{n}</button>\n{end}\n`)
    assert.ok(/_mjs_cst_1\b/.test(constante) && !/_mjs_cst_2\b/.test(constante), 'le {const} de la branche, 2e entrée de sa portée : _mjs_cst_1')
    assert.ok(!/_mjs_pnd|_mjs_sig/.test(constante), 'aucun nom de µpending ni de µsignal')
    const attache = await compiler(`<script>\n  $theme = 'clair'\n  $p = new Promise(->)\n  marque = (qui, th) -> (n) -> n.title = th\n</script>\n{await $p}\n  <i :attach={marque('att', $theme)}>attente</i>\n{success}\n  <b :attach={marque('ok', $theme)}>ok</b>\n{end}\n`)
    assert.equal(attache.split("marque('att'").length - 1, 2, 'l\'attache de l\'attente : posée à la création de l\'attente, et suivie par son effet')
    assert.equal(attache.split("marque('ok'").length - 1, 2, 'celle d\'une branche {success} sans nom aussi')
    const enCours = await compiler(`<script>\n  $theme = 'clair'\n  $p = new Promise(->)\n  marque = (qui, th, en) -> (n) -> n.title = th + en\n</script>\n{await $p}\n  <i :attach={marque('att', $theme, µpending)}>attente</i>\n{success v}\n  <b>{v}</b>\n{end}\n`)
    assert.equal(enCours.split("marque('att'").length - 1, 2, 'une attente qui lit µpending reste une branche sans nom : son attache est posée à sa création, puis suivie')
  })

  it('signaux : chaque option est repérée seule dans le code compilé, aucune sans elle', async () => {
    const vus = async (source: string) => {
      const s = features.scanCompiledFeatures(await compiler(source))
      return [features.AWAIT_KEEP, features.AWAIT_PENDING, features.AWAIT_SIGNAL].map((k) => s.has(k))
    }
    assert.deepEqual(await vus(bloc('await load($q)')), [false, false, false], 'sans option')
    assert.deepEqual(await vus(bloc('await.keep load($q)')), [true, false, false], 'keep seul')
    assert.deepEqual(await vus(bloc('await load($q)', '<b hidden={not µpending}>{v}</b>')), [false, true, false], 'µpending seul')
    assert.deepEqual(await vus(bloc('await chercher($q, µsignal)')), [false, false, true], 'µsignal seul')
  })

  // le cœur construit (non minifié) d'une appli d'un composant
  async function coeur(nom: string, source: string, env: 'dev' | 'prod'): Promise<string> {
    const root   = mjsTmp('agc-' + nom + '-' + env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env, minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    const fichier = readdirSync(outDir).find((f) => /^mjs_core/.test(f) && f.endsWith('.js'))
    assert.ok(fichier, `cœur introuvable dans ${readdirSync(outDir).join(', ')}`)
    return readFileSync(join(outDir, fichier), 'utf-8')
  }

  // les traces de chaque option dans un cœur : la relecture gardée, l'état « en cours », les contrôleurs d'annulation
  const traces = (c: string) => [/\bgarde\b.*arguments\[6\]|_mjs_srv = 2/.test(c), /\.pending = (?:true|false)/.test(c), /_mjsAwaitLire|_mjs_awaitCtrls/.test(c)]

  // la marque de chaque option dans un cœur, que lit un composant construit pour le développement (cf. compileAwait)
  const marques = (c: string) => ['Keep', 'Pending', 'Signal'].map((m) => c.includes(`_mjs_awaitHas${m} = 1`))

  it('cœur de production d\'une appli à {await} sans option : rien des options', async () => {
    const c = await coeur('sans', bloc('await load($q)'), 'prod')
    assert.ok(c.includes('_mjs_updAwait'), 'le bloc {await} est au cœur')
    assert.deepEqual(traces(c), [false, false, false])
    assert.deepEqual(marques(c), [false, false, false])
    assert.ok(!/<attente-(?:gardee|en-cours|signal)>/.test(c), 'les blocs balisés sont retirés')
  })

  it('cœur de développement d\'une appli à {await} sans option : les trois options y restent, pour un composant compilé à part', async () => {
    const c = await coeur('sans', bloc('await load($q)'), 'dev')
    assert.deepEqual(traces(c), [true, true, true])
    assert.deepEqual(marques(c), [true, true, true])
  })

  it('cœur de production : chaque option apporte son bloc et sa marque, et lui seul', async () => {
    const garde   = await coeur('garde', bloc('await.keep load($q)'), 'prod')
    const enCours = await coeur('encours', bloc('await load($q)', '<b hidden={not µpending}>{v}</b>'), 'prod')
    const signal  = await coeur('signal', bloc('await chercher($q, µsignal)'), 'prod')
    assert.deepEqual([traces(garde), marques(garde)], [[true, false, false], [true, false, false]], 'keep')
    assert.deepEqual([traces(enCours), marques(enCours)], [[false, true, false], [false, true, false]], 'µpending')
    assert.deepEqual([traces(signal), marques(signal)], [[false, false, true], [false, false, true]], 'µsignal')
  })

  it('un composant construit pour le développement dit l\'option que le cœur de sa page n\'a pas ; la production et le code sans option n\'en portent rien', async () => {
    const tous = bloc('await.keep chercher($q, µsignal)', '<b hidden={not µpending}>{v}</b>')
    const dev  = (await transpile(tous, { moduleName: 'mjs-agc', devWarnings: true } as any)).output
    assert.deepEqual(['Keep', 'Pending', 'Signal'].map((m) => dev.includes(`µ._mjs_awaitHas${m} ??= `)), [true, true, true], 'chaque marque vérifiée')
    for (const option of ['{await.keep}', 'µpending', 'µsignal']) assert.ok(dev.includes(`mjs-agc : ${option} est ignoré`), `le message nomme ${option}`)
    const prod = (await transpile(tous, { moduleName: 'mjs-agc', devWarnings: false } as any)).output
    assert.ok(!/_mjs_awaitHas/.test(prod), 'production : aucune vérification')
    const nu = (await transpile(bloc('await load($q)'), { moduleName: 'mjs-agc', devWarnings: true } as any)).output
    assert.ok(!/_mjs_awaitHas/.test(nu), 'sans option : aucune vérification')
  })

  // le message d'une construction refusée (vide si elle passe)
  async function refus(source: string): Promise<string> {
    try {
      await compiler(source)
    }
    catch (e) {
      return (e as Error).message
    }
    return ''
  }

  it('une option inconnue sur le mot du bloc est refusée, nommée, .keep proposé, sous les deux lectures', async () => {
    for (const [tete, mot] of [['await.kep chercher($q)', 'kep'], ['await.KEEP chercher($q)', 'KEEP'], ['await.keepx chercher($q)', 'keepx'], ['await. chercher($q)', '']]) {
      for (const source of [bloc(tete), `${SCRIPT}{${tete}}\n  <i>attente</i>\n{end}\n`, `${SCRIPT}<p>{${tete}}</p>\n`]) {
        const message = await refus(source)
        assert.ok(message.includes(`« .${mot} » n'est pas une option de {await} : la seule est .keep`), `{${tete}} : ${message}`)
      }
    }
  })

  it('l\'expression qui manque est refusée : {await}, {await.keep}, et l\'expression oubliée devant *skeleton, sous les deux lectures', async () => {
    const cas = [
      ['await', 'await', 'await charger($id)'], ['await ', 'await', 'await charger($id)'], ['await.keep', 'await.keep', 'await.keep charger($id)'], ['await.keep ', 'await.keep', 'await.keep charger($id)'],
      ['await *skeleton', 'await *skeleton', 'await charger($id) *skeleton'], ['await.keep *skeleton', 'await.keep *skeleton', 'await.keep charger($id) *skeleton'],
      ['await *skeleton(lignes: 3)', 'await *skeleton(lignes: 3)', 'await charger($id) *skeleton(lignes: 3)'],
      ['await *skeleton $p', 'await *skeleton $p', 'await $p *skeleton'], ['await.keep *skeleton $p', 'await.keep *skeleton $p', 'await.keep $p *skeleton'],
      ['await *skeleton(lines: 3) $p', 'await *skeleton(lines: 3) $p', 'await $p *skeleton(lines: 3)'],
      ['await *skeleton chercher($q, (a) -> a)', 'await *skeleton chercher($q, (a) -> a)', 'await chercher($q, (a) -> a) *skeleton']
    ]
    for (const [tete, ecrit, exemple] of cas) {
      const source  = `${SCRIPT}{${tete}}\n{success v}\n  <b>{v}</b>\n{end}\n`
      const message = await refus(source)
      assert.ok(message.includes(`{${ecrit}} — l'expression à attendre manque`) && message.includes(`comme {${exemple}}`), `{${tete}} : ${message}`)
      // l'expression écrite après *skeleton, remise devant lui : la forme proposée se construit, sa silhouette posée
      if (exemple.includes('charger($id)')) continue
      const propose = await compiler(`${SCRIPT}{${exemple}}\n{success v}\n  <b>{v}</b>\n{end}\n`)
      assert.ok(propose.includes('mjs-skel-zone'), `{${exemple}} : la silhouette de {success}`)
    }
  })

  it('construction de production d\'une option mal écrite, sans {success} : le message de l\'option, jamais celui d\'esbuild', async () => {
    await assert.rejects(coeur('faute', `${SCRIPT}{await.kep chercher($q)}\n  <p>attente</p>\n{end}\n`, 'prod'), (e: Error) => e.message.includes('« .kep » n\'est pas une option de {await}') && !/bogue du bundler|async/.test(e.message))
  })

  it('µpending se repère dans le code seul : un texte, une chaîne, un attribut écrit en dur laissent le code d\'un mot quelconque', async () => {
    const source = (corps: string) => `${SCRIPT}{await load($q)}\n  <i>…</i>\n{success v}\n  {const n = v.length}\n  ${corps}\n  <button @click={x(n)}>{n}</button>\n{end}\n`
    for (const corps of ['<p>Écrivez µpending pour savoir</p>', '<button @click={x(\'µpending\')}>a</button>', '<button @click={x("µpending")}>a</button>', '<p title="µpending">a</p>']) {
      const js = await compiler(source(corps))
      assert.equal(js.split('µpending').join('zpending'), await compiler(source(corps.split('µpending').join('zpending'))), `${corps} : le code d'un mot quelconque`)
      assert.ok(!/_mjs_pnd/.test(js) && /_mjs_cst_1\b/.test(js), `${corps} : ni µpending lu, ni temporaire renommé`)
      assert.ok(!features.scanCompiledFeatures(js).has(features.AWAIT_PENDING), `${corps} : le bloc de µpending n'entre pas au cœur`)
    }
  })

  it('un commentaire qui cite µpending n\'est pas une lecture : le code d\'un commentaire qui cite µ.pending, dans les deux grammaires', async () => {
    const source = (corps: string) => `${SCRIPT}{await load($q)}\n  <i>…</i>\n{success v}\n  {const n = v.length}\n  ${corps}\n  <button @click={x(n)}>{n}</button>\n{end}\n`
    const cas: Array<[string, 'civet' | 'js']> = [
      ['<p>{$q /* µpending */}</p>', 'civet'],
      ['<button @click={x(1) # µpending}>a</button>', 'civet'],
      ['<button @click={x(1) ### µpending ###}>a</button>', 'civet'],
      ['<button @click={x(1) /* µpending */}>a</button>', 'civet'], ['<button @click={\n    x(1) // µpending\n  }>a</button>', 'civet']
    ]
    for (const [corps, tl] of cas) {
      const js = await compiler(source(corps), tl)
      // une expression Civet garde son commentaire tel qu'écrit : seul le texte du commentaire diffère
      assert.equal(js.replace(/(\/\/|\/\*)( ?)µpending/g, '$1$2µ.pending'), await compiler(source(corps.replace('µpending', 'µ.pending')), tl), `${corps} (${tl}) : le code d'un commentaire qui cite µ.pending`)
      assert.ok(!/_mjs_pnd/.test(js) && /_mjs_cst_1\b/.test(js), `${corps} (${tl}) : ni µpending lu, ni temporaire renommé`)
      assert.ok(!features.scanCompiledFeatures(js).has(features.AWAIT_PENDING), `${corps} (${tl}) : le bloc de µpending n'entre pas au cœur`)
    }
    // ce qui n'est pas un commentaire reste une lecture : `#` et `###` d'une expression Civet (`this.length`)
    for (const [corps, tl] of [['<p>{$q # µpending\n  }</p>', 'civet'], ['<p>{$q ### µpending ###}</p>', 'civet']] as const) {
      const js = await compiler(source(corps), tl)
      assert.ok(/_mjs_pnd/.test(js) && !/µ\.pending/.test(js), `${corps} (${tl}) : µpending lu dans l'état du bloc`)
    }
    // une branche qui lit µpending : le gestionnaire qui ne le cite qu'en commentaire ne recrée pas sa valeur
    for (const tl of ['civet'] as const) {
      const lu = (mot: string) => compiler(bloc('await load($q)', `<p>{µpending}</p>\n  <button @click={x(1) # ${mot}}>a</button>`), tl)
      assert.equal((await lu('µpending')).replace(/(\/\/|\/\*)( ?)µpending/g, '$1$2µ.pending'), await lu('µ.pending'), `(${tl}) : le gestionnaire ne recrée pas µpending`)
    }
  })

  it('µpending dans l\'interpolation d\'une chaîne double d\'un gestionnaire : la valeur de la branche, dans les deux grammaires et les trois langages du script', async () => {
    const scripts = ['<script>\n  $q = \'a\'\n  load = (v) -> Promise.resolve(v)\n</script>\n', '<script lang="coffee">\n  $q = \'a\'\n  load = (v) -> Promise.resolve(v)\n</script>\n', '<script lang="js">\n  $q = \'a\'\n  load = (v) => Promise.resolve(v)\n</script>\n']
    const corps   = ['<button @click={console.log "état #{µpending}"}>a</button>', '<button @click={console.log("état #{ if µpending then \'oui\' else \'non\' }")}>a</button>', '<button @click={console.log """état #{µpending}"""}>a</button>', '<button @click={\n    n = 1\n    console.log "état #{µpending} #{n}"\n  }>a</button>']
    for (const tl of ['civet'] as const) for (const script of scripts) for (const c of corps) {
      const js = await compiler(`${script}{await.keep load($q)}\n  <i>…</i>\n{success v}\n  ${c}\n{end}\n`, tl)
      const nom = `${c} (${tl}, ${script.slice(0, 22).trim()})`
      assert.ok(/_mjs_awaitStates[^;\n]*\.get\('await\d+'\)[^;\n]*\bpending\b/.test(js) && /\$\{[^}]*\b_mjs_pnd\b/.test(js), `${nom} : la valeur de la branche, interpolée`)
      assert.ok(!/µ\.pending|µpending/.test(js), `${nom} : ni µ.pending, ni le mot brut`)
      assert.ok(features.scanCompiledFeatures(js).has(features.AWAIT_PENDING), `${nom} : le bloc de µpending entre au cœur`)
    }
    // un {const} de la branche lu par un gestionnaire, recalculé dans le gestionnaire (grammaire civet : son interpolation est lue)
    const constante = await compiler(bloc('await.keep load($q)', '{const etat = "état #{µpending}"}\n  <button @click={console.log etat}>a</button>'))
    assert.ok(!/µ\.pending|µpending/.test(constante) && constante.split('${_mjs_pnd}').length - 1 >= 2, 'le {const}, dans la branche et dans le gestionnaire')
    // une chaîne simple reste un texte ; une chaîne simple dans l'interpolation aussi
    for (const tl of ['civet'] as const) {
      const simple = await compiler(bloc('await load($q)', '<button @click={console.log \'état #{µpending}\'}>a</button>'), tl)
      assert.ok(simple.includes('\'état #{µpending}\'') && !/_mjs_pnd/.test(simple), `(${tl}) : la chaîne simple, un texte`)
      const citee = await compiler(bloc('await load($q)', '<button @click={console.log "état #{x(\'µpending\')}"}>a</button>'), tl)
      assert.ok(!/_mjs_pnd/.test(citee), `(${tl}) : le mot cité dans une chaîne de l'interpolation n'est pas une lecture`)
    }
  })

  it('µpending lu par le code d\'une branche : interpolation, liaison, gestionnaire en ligne ou entre guillemets, condition, classe, attribut calculé, gabarit, {const}', async () => {
    const corps = ['<p>{µpending}</p>', '<p hidden={not µpending}>a</p>', '<button @click={x(µpending)}>a</button>', '<button @click="x(µpending)">a</button>', '{if µpending}\n    <p>a</p>\n  {end}', '<p :class{µpending}="occupe">a</p>', '<p title="état {µpending}">a</p>', '<button @click={x(`a${µpending}`)}>a</button>', '{const occupe = µpending}\n  <p>{occupe}</p>']
    for (const c of corps) {
      const js = await compiler(bloc('await load($q)', c))
      assert.ok(/_mjs_pnd/.test(js) && !/µ\.pending/.test(js), `${c} : µpending lu dans l'état du bloc`)
      assert.ok(features.scanCompiledFeatures(js).has(features.AWAIT_PENDING), `${c} : le bloc de µpending entre au cœur`)
    }
  })
})
