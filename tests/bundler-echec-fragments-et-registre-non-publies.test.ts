// Construction en échec (`mjs build`) : rien n'est publié. Les fragments de traduction à nom clair (environnement de
// développement, ou `i18n.hash: false`) attendent la publication du manifeste, comme les feuilles de mise en page : le
// site servi gardait sinon son ancien `bundle.js` mais lisait déjà les nouveaux textes. Un premier build en échec dont
// le manifeste est rangé dans un dossier qui n'existe pas encore n'ajoute plus d'erreur Node brute (`ENOENT`) : le
// registre des sorties est écrit, le ménage suivant connaît les fichiers que ce build a déjà écrits.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const fautif = '<script>\n  $x = [1, 2\n</script>\n<p>{$x}</p>\n'

describe('une construction en échec ne publie ni fragment de traduction, ni erreur brute sur le registre', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('premier build en échec, dossier du manifeste absent : la seule erreur du composant, registre des sorties écrit', async () => {
    const root = mjsTmp('echec-dossier-manifeste')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.mjs'), '<p>a</p>\n')
    writeFileSync(join(src, 'b.mjs'), fautif)
    const man = join(root, 'dist', 'js', 'bundle.js')
    const b   = new Bundler({ sourceDir: src, outputDir: join(root, 'dist', 'assets'), manifestPath: man, keepFailedComponents: false })
    const s   = await b.compile()
    await b.close()
    assert.equal(s.errors.length, 1, s.errors.map(e => e.message).join('\n'))
    assert.doesNotMatch(s.errors[0].message, /ENOENT/)
    assert.equal(existsSync(man), false, 'manifeste publié par un build en échec')
    const registre = JSON.parse(readFileSync(join(root, 'dist', 'js', '.mjs-outputs.json'), 'utf-8'))
    assert.ok((registre.files ?? []).some((f: string) => f.startsWith('a-')), `fichiers écrits absents du registre : ${JSON.stringify(registre)}`)
  })

  it('build en échec : le fragment à nom clair reste celui du dernier build réussi, à l\'octet ; le build réussi suivant publie le nouveau', async () => {
    const root = mjsTmp('echec-fragment-clair')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(join(src, 'i18n', 'fr'), { recursive: true })
    writeFileSync(join(src, 'carte.mjs'), "<p>{µt('admin.titre')}</p>\n")
    writeFileSync(join(src, 'autre.mjs'), '<p>autre</p>\n')
    writeFileSync(join(src, 'i18n', 'fr', 'admin.json'), '{ "titre": "ANCIEN" }\n')
    const opts     = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), i18n: { default: 'fr' }, keepFailedComponents: false }
    const fragment = join(out, 'i18n', 'fr', 'admin.json')
    const s1 = await new Bundler(opts).compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])
    const servi     = readFileSync(fragment, 'utf-8')
    const manifeste = readFileSync(join(out, 'bundle.js'), 'utf-8')
    assert.equal(servi, '{"titre":"ANCIEN"}')

    writeFileSync(join(src, 'i18n', 'fr', 'admin.json'), '{ "titre": "NOUVEAU" }\n')
    writeFileSync(join(src, 'autre.mjs'), fautif)
    const b2 = new Bundler(opts)
    const s2 = await b2.compile()
    await b2.close()
    assert.equal(s2.errors.length, 1, s2.errors.map(e => e.message).join('\n'))
    assert.equal(readFileSync(join(out, 'bundle.js'), 'utf-8'), manifeste, 'bundle.js republié')
    assert.equal(readFileSync(fragment, 'utf-8'), servi, 'fragment servi réécrit par un build en échec')

    writeFileSync(join(src, 'autre.mjs'), '<p>autre corrigé</p>\n')
    const b3 = new Bundler(opts)
    const s3 = await b3.compile()
    await b3.close()
    assert.deepEqual(s3.errors.map(e => e.message), [])
    assert.equal(readFileSync(fragment, 'utf-8'), '{"titre":"NOUVEAU"}', 'le build réussi publie le nouveau texte')
  })
})
