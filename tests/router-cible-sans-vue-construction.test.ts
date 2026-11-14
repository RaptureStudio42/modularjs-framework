// Une route dont la cible n'a aucune <@view> dans l'appli arrête la construction, sur la lecture même du compilateur : un bloc
// `<routes target>`, une table `@routes` qui nomme sa vue en toutes lettres ; le message nomme la forme, le fichier, la ligne et la
// vue à écrire. Une vue sous un {if} (le cas `{if $user}<@view root>{else}…{end}`), dans un partiel inclus, avec un contenu, ou
// écrite dans un autre fichier (le contenu glissé dans le <slot> d'un composant de mise en page) compte ; une vue écrite dans un
// commentaire HTML ou dans une chaîne du script ne compte pas, ni un bloc <routes> commenté ou cité dans une chaîne. Limite : le
// contrôle porte sur toute l'appli.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const ROUTES = (cible: string) => `<routes target="${cible}">\n  /     page-a\n</routes>\n\n`

async function construire(nom: string, sources: Record<string, string>): Promise<{ erreurs: string[], refus: string[] }> {
  const root = mjsTmp('routeur-cible-sans-vue-' + nom)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'page-a.mjs'), '<p>A</p>\n')
  for (const [f, c] of Object.entries(sources)) writeFileSync(join(src, f), c)
  const b  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'dev' } as any)
  const st = await b.compile()
  await b.close()
  const erreurs = st.errors.map((e: any) => String(e.message ?? e))
  return { erreurs, refus: erreurs.filter((e) => e.includes('ROUTE SANS VUE')) }
}

describe('construction : une route dont la cible n\'a aucune <@view> dans l\'appli est refusée', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('bloc <routes target> sans aucune vue de ce nom : refus, avec la forme, le fichier, la ligne et la vue à écrire', async () => {
    const r = await construire('nom', { 'app.page.mjs': '<p>titre</p>\n' + ROUTES('main') + '<@view root>\n' })
    assert.equal(r.refus.length, 1, r.erreurs.join('\n'))
    assert.match(r.refus[0], /<routes target="main">/)
    assert.match(r.refus[0], /ligne 2/)
    assert.match(r.refus[0], /app\.page\.mjs/)
    assert.match(r.refus[0], /Écrivez <@view main>/)
  })

  it('table @routes écrite en toutes lettres, et vue nommée en toutes lettres d\'une table dont les chemins se calculent : refus', async () => {
    const r = await construire('script', { 'app.page.mjs': '<script>\n@routes =\n  main:\n    \'/\': \'page-a\'\n</script>\n<@view root>\n' })
    assert.equal(r.refus.length, 1, r.erreurs.join('\n'))
    assert.match(r.refus[0], /@routes\['main'\]/)
    assert.match(r.refus[0], /ligne 2/)
    const s = await construire('script-calcule', { 'app.page.mjs': '<script>\nchemin = \'/\'\n@routes[\'side\'] = {}\n@routes[\'side\'][chemin] = \'page-a\'\n</script>\n<@view root>\n' })
    assert.equal(s.refus.length, 1, s.erreurs.join('\n'))
    assert.match(s.refus[0], /@routes\['side'\]/)
  })

  it('partiel sans la vue, vue écrite dans un commentaire HTML ou dans une chaîne du script : refus', async () => {
    for (const [nom, sources] of Object.entries({
      'partiel':     { 'app.page.mjs': ROUTES('main') + '<@include cadre>\n', '_cadre.mjs': '<nav>n</nav>\n' },
      'commentaire': { 'app.page.mjs': ROUTES('main') + '<!-- <@view main> -->\n<p>x</p>\n' },
      'chaine':      { 'app.page.mjs': ROUTES('main') + '<script>\n$d = \'<@view main>\'\n</script>\n<p>{$d}</p>\n' },
    } as Record<string, Record<string, string>>)) {
      const r = await construire(nom, sources)
      assert.equal(r.refus.length, 1, nom + ' : ' + r.erreurs.join('\n'))
      assert.match(r.refus[0], /<routes target="main">/)
    }
  })

  it('aucun refus : vue dans un partiel, sous un {if}, dans le {else}, avec un contenu, glissée dans le <slot> d\'un layout, table @routes servie, bloc <routes> commenté ou cité', async () => {
    const r = await construire('justes', {
      'matrix.page.mjs':  ROUTES('root') + '<script>\n$user = false\n</script>\n{if $user}<@view root>{else}<p>connexion</p>{end}\n',
      'sinon.page.mjs':   ROUTES('root') + '<script>\n$ok = false\n</script>\n{if $ok}\n  <p>x</p>\n{else}\n  <@view root>\n{end}\n',
      'contenu.page.mjs': ROUTES('root') + '<script>\n$ok = false\n</script>\n{if $ok}\n  <@view root>\n    <p>attente</p>\n  </@view>\n{end}\n',
      'inclus.page.mjs':  ROUTES('menu') + '<@include zone>\n',
      '_zone.mjs':        '<nav>n</nav>\n<@view menu>\n',
      'cadre.page.mjs':   ROUTES('corps') + '<div><slot></slot></div>\n',
      'parent.mjs':       '<script>\n$ok = true\n</script>\n<mjs-cadre>\n  {if $ok}\n    <@view corps>\n  {end}\n</mjs-cadre>\n',
      'table.page.mjs':   '<script>\n@routes =\n  root:\n    \'/\': \'page-a\'\n</script>\n<@view root>\n',
      'commente.mjs':     '<!--\n<routes target="vieux">\n  /  page-a\n</routes>\n-->\n<p>x</p>\n',
      'cite.mjs':         '<script>\n$ex = \'<routes target="exemple">\'\n</script>\n<p>{$ex}</p>\n',
    })
    assert.deepEqual(r.refus, [])
    assert.deepEqual(r.erreurs, [])
  })

  it('limite : le contrôle porte sur toute l\'appli — deux composants routés vers main, un seul écrit la vue, aucun refus', async () => {
    const r = await construire('global', { 'a.page.mjs': ROUTES('main') + '<p>pas de vue</p>\n', 'b.page.mjs': ROUTES('main') + '<@view main>\n' })
    assert.deepEqual(r.refus, [])
  })
})
