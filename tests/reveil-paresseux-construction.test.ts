// `@wake` à la construction : sur la balise d'un composant, une valeur fixe, view ou interaction, compilée en attribut `mjs-wake` (rendu
// aussi par le serveur), le même code pour les deux ; `@wake=interaction` accepté quel que soit le mode de rendu du bloc `render`, `ssr`
// compris (ce que l'utilisateur a fait dans la page du serveur passe à la vue au réveil) ; `@wake=idle` refusé (un réveil au repos du
// navigateur fait plus de travail qu'une page sans `@wake`, sans gain sur `view`) ; refusé aussi sur une balise qui n'est pas un composant,
// sans valeur, avec une autre valeur ou une valeur calculée. Le code du réveil (runtime/mjs_wake.ts et les blocs qui l'appellent dans le
// cœur) n'entre au cœur que si une page écrit `@wake` : une appli qui ne l'écrit pas n'en porte pas un octet ; celui de `interaction`
// (l'écoute des signes d'intention, passive, sans rien annuler, arrêter ni rejouer, et le passage à la vue de ce que l'utilisateur a fait)
// n'entre au cœur de production que si une page écrit `@wake=interaction` ; aucun ne demande le repos du navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function compile(src: string): Promise<string> {
  return (await transpile(src, { moduleName: 'page' } as any)).output
}

async function refus(src: string): Promise<string> {
  try {
    await compile(src)
  }
  catch (e: any) {
    return String(e.message)
  }
  return ''
}

describe('@wake à la construction', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('sur la balise d\'un composant : l\'attribut mjs-wake, pour view et pour interaction', async () => {
    for (const v of ['view', 'interaction']) {
      assert.match(await compile(`<@carte :wake=${v} nom="a"></@carte>\n`), new RegExp(`<mjs-carte mjs-wake='${v}' nom='a'>`))
      assert.match(await compile(`<@carte :wake="${v}"></@carte>\n`), new RegExp(`<mjs-carte mjs-wake='${v}'>`))
    }
  })

  it('refusé hors d\'un composant, sans valeur, avec une autre valeur, ou calculé', async () => {
    assert.match(await refus('<div :wake=view>x</div>\n'), /« :wake » sur une balise <div> : le réveil paresseux se pose sur la balise d'un composant/)
    const nu = await refus('<@carte :wake></@carte>\n')
    assert.match(nu, /« :wake » : :wake attend une valeur fixe, view .* ou interaction .*par exemple :wake=view/)
    assert.ok(!nu.includes('idle'), 'le message ne propose que view et interaction')
    assert.match(await refus('<@carte :wake=bientot></@carte>\n'), /« :wake=bientot » : :wake attend une valeur fixe/)
    assert.match(await refus('<script>\n  $q = \'view\'\n</script>\n\n<@carte :wake={$q}></@carte>\n'), /« :wake=\{\$q\} » : :wake attend une valeur fixe/)
  })

  it('@wake=interaction construit comme view : seul l\'attribut change, plus, en développement, le texte de son avertissement', async () => {
    for (const env of [{}, { devWarnings: true }]) {
      const vue   = (await transpile('<@carte :wake=view nom="a"></@carte>\n', { moduleName: 'page', ...env } as any)).output
      const int   = (await transpile('<@carte :wake=interaction nom="a"></@carte>\n', { moduleName: 'page', ...env } as any)).output
      const texte = int.split('\n').filter((l) => l.includes('_mjs_wakeMiss'))
      assert.equal(texte.length, 'devWarnings' in env ? 1 : 0, 'le texte de l\'avertissement, en développement seulement')
      assert.equal(int.split('\n').filter((l) => !l.includes('_mjs_wakeMiss')).join('\n'), vue.replace("mjs-wake='view'", "mjs-wake='interaction'"))
    }
  })

  // une appli d'un composant et de sa page, bâtie avec le bloc `render` donné (aucun : null) ; les erreurs de la construction
  async function batir(render: any, page = '<@carte :wake=interaction></@carte>\n'): Promise<string[]> {
    const root   = mjsTmp('reveil-render')
    const srcDir = join(root, 'src')
    const out    = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'carte.mjs'), '<p>carte</p>\n')
    writeFileSync(join(srcDir, 'page.mjs'), page)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev', minify: false, ...(render ? { render } : {}) } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    return stats.errors.map((e: any) => String(e.message ?? e))
  }

  it('@wake=interaction accepté quel que soit le mode du bloc render, ssr compris (sans bloc render aussi) ; view de même', async () => {
    for (const render of [{ default: 'ssr' }, { default: 'ssr:replace' }, { default: 'ssr:markers', routes: { '/a': { component: 'mjs-page', mode: 'ssr' } } }, { default: 'ssr:markers' }, { default: 'ssr:positional' }, { default: 'ssr:diff' }, { default: 'prerender' }, { default: 'csr' }, { routes: { '/a': { component: 'mjs-page' } } }, null]) assert.deepEqual(await batir(render), [], JSON.stringify(render))
    assert.deepEqual(await batir({ default: 'ssr' }, '<@carte :wake=view></@carte>\n'), [])
  })

  it('@wake=idle refusé : le message dit que le composant ne se réveille pas au repos du navigateur, et d\'écrire @wake=view', async () => {
    for (const src of ['<@carte :wake=idle></@carte>\n', '<@carte :wake="idle" nom="a"></@carte>\n']) {
      const msg = await refus(src)
      assert.match(msg, /« :wake=idle » : .*repos du navigateur.*Écrivez :wake=view/, msg)
    }
  })

  it('construit pour le développement, le composant pose le texte de l\'avertissement « sans effet » ; rien en production', async () => {
    const src = '<@carte :wake=view></@carte>\n<@carte :wake="view" nom="a"></@carte>\n'
    const dev = (await transpile(src, { moduleName: 'page', devWarnings: true } as any)).output
    const prod = (await transpile(src, { moduleName: 'page' } as any)).output
    assert.equal(dev.split('_mjs_wakeLost').length, 2, 'une fois par composant')
    assert.match(dev, /« :wake » sur <\{balise\}> : sans effet, le composant se réveille dès le démarrage\. Sa page du serveur n'existe plus quand il démarre/)
    assert.ok(!prod.includes('_mjs_wakeLost'), 'absent en production')
    // le texte de l'élément que la vue n'a pas à sa place (`interaction`) : pour interaction seulement, une fois par composant
    assert.ok(!dev.includes('_mjs_wakeMiss'), 'absent avec view seul')
    const devI = (await transpile('<@carte :wake=interaction></@carte>\n<@carte :wake=interaction nom="a"></@carte>\n', { moduleName: 'page', devWarnings: true } as any)).output
    const prodI = (await transpile('<@carte :wake=interaction></@carte>\n', { moduleName: 'page' } as any)).output
    assert.equal(devI.split('_mjs_wakeMiss').length, 2, 'une fois par composant')
    assert.match(devI, /« :wake=interaction » sur <\{balise\}> : au réveil, la vue du composant n'a pas reçu ce que l'utilisateur avait fait dans la page du serveur/)
    assert.ok(!prodI.includes('_mjs_wakeMiss'), 'absent en production')
  })

  // le cœur (non minifié) d'une appli de deux composants, sans `@wake` (''), avec `@wake=view` ou avec `@wake=interaction`
  async function coeur(avec: '' | 'view' | 'interaction', env: 'dev' | 'prod'): Promise<string> {
    const root   = mjsTmp('reveil-coeur')
    const srcDir = join(root, 'src')
    const out    = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'carte.mjs'), '<p>carte</p>\n')
    writeFileSync(join(srcDir, 'page.mjs'), `<@carte${avec ? ' :wake=' + avec : ''}></@carte>\n`)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: 'split', env, minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors, [])
    const nom = readdirSync(out).find((n) => /^mjs_core.*\.js$/.test(n))
    assert.ok(nom, 'le cœur est écrit')
    return readFileSync(join(out, nom!), 'utf-8')
  }

  for (const env of ['dev', 'prod'] as const) it(`le code du réveil n'entre au cœur que si une page écrit @wake, celui de interaction qu'avec elle en production (${env})`, async () => {
    const sans = await coeur('', env)
    const vue  = await coeur('view', env)
    const avec = await coeur('interaction', env)
    for (const marque of ['_mjs_wakeHold', '_mjs_wakeNew', '_mjs_wakeLater', '<reveil>']) assert.ok(!sans.includes(marque), `${marque} absent du cœur sans @wake`)
    for (const coeurAvec of [vue, avec]) for (const marque of ['_mjs_wakeHold', '_mjs_wakeNew', '_mjs_wakeLater', 'IntersectionObserver']) assert.ok(coeurAvec.includes(marque), `${marque} présent dans le cœur avec @wake`)
    // le réveil ne demande pas le repos du navigateur : pas un requestIdleCallback de plus dans le cœur avec @wake que sans
    for (const coeurAvec of [vue, avec]) assert.equal(coeurAvec.split('requestIdleCallback').length, sans.split('requestIdleCallback').length, 'requestIdleCallback : pas un de plus avec @wake')
    // `interaction` : une seule écoute des signes d'intention, passive, rien n'est annulé, arrêté ni rejoué ; au réveil, le composant apprend
    // ce que l'utilisateur a fait dans la page du serveur par `input` et `change` (deux envois), et le champ de texte qui garde le focus, par
    // `change` à sa sortie (deux écoutes, un envoi) ; en production, une appli qui n'écrit que view n'en porte rien
    const compte = (c: string, m: string) => c.split(m).length - sans.split(m).length
    assert.deepEqual([compte(avec, 'addEventListener'), compte(avec, 'dispatchEvent'), compte(avec, ':focus-within')], [3, 3, 1], 'interaction : une écoute, deux envois, et le change à la sortie du champ de texte')
    assert.ok(avec.split('passive').length > sans.split('passive').length, 'l\'écoute du réveil est passive')
    assert.deepEqual([compte(vue, 'addEventListener'), compte(vue, 'dispatchEvent'), compte(vue, ':focus-within')], env === 'prod' ? [0, 0, 0] : [3, 3, 1], env === 'prod' ? 'view seul en production : rien de interaction' : 'développement : le cœur garde tout')
    for (const coeurAvec of [vue, avec]) for (const marque of ['preventDefault', 'stopPropagation', 'stopImmediatePropagation', 'requestSubmit']) assert.equal(coeurAvec.split(marque).length, sans.split(marque).length, `${marque} : pas un de plus avec @wake`)
  })
})
