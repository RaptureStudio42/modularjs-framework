// HASHED_OUTPUT_RE matche N'IMPORTE QUELLE
// extension au motif `nom-8hex.ext` — pruneOrphans() retire donc tout fichier d'outputDir qui
// matche cette FORME et n'est pas dans emittedThisCompile, SANS savoir si le bundler l'a un jour
// produit. docs/32-cli-et-configuration.md:377 promet noir sur blanc : « Jamais touchés : … et
// tout fichier étranger au build. » Faux pour un fichier dont le NOM ressemble par coïncidence à
// une sortie hachée (rapport-deadbeef.pdf déposé à la main).
//
// Correctif : registre `.mjs-outputs.json` (à côté du manifeste, réécrit à chaque build réussi)
// des EXTENSIONS que CE bundler sait produire (.js/.css/.map + imageConfig.formats, accumulées
// avec les extensions RÉELLEMENT émises au fil des builds) — un fichier dont l'extension n'y
// figure jamais n'est PAS un candidat à la purge, même s'il ressemble à une sortie. Garde muette
// interdite : un registre PRÉSENT mais illisible bloque toute la purge (skipped explicite),
// jamais une purge au hasard.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, unlinkSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const comp = (lettre: string) => ['<script>', '  $x = 1', '</script>', `<p>{$x} ${lettre}</p>`].join('\n')

// consigne des noms au registre des sorties (`.mjs-outputs.json`, clé `files`), comme l'aurait fait le build qui les a
// écrits : le ménage ne retire que ce que ce registre liste, jamais un fichier sur la seule forme de son nom
function consigner(dossier: string, ...noms: string[]): void {
  const chemin   = join(dossier, '.mjs-outputs.json')
  const registre = JSON.parse(readFileSync(chemin, 'utf-8'))
  registre.files = [...new Set([...(registre.files ?? []), ...noms])].sort()
  writeFileSync(chemin, JSON.stringify(registre, null, 2) + '\n')
}

function makeProject(prefix: string) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  return { root, srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

describe('bundler — pruneOrphans() ne purge jamais une extension étrangère au bundler', function () {
  this.timeout(20000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it("un fichier au NOM hachage-compatible mais d'extension JAMAIS produite par ce bundler (.pdf/.zip) survit à DEUX builds", async function () {
    const { srcDir, outDir, manifest } = makeProject('prune-etranger')
    writeFileSync(join(srcDir, 'a.mjs'), comp('a'))

    const bundler1 = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifest })
    const stats1 = await bundler1.compile()
    assert.equal(stats1.errors.length, 0, stats1.errors.map(e => e.message).join('\n'))

    const etrangerPdf = 'rapport-annuel-1a2b3c4d.pdf'
    const etrangerZip = 'export-donnees-deadbeef.zip'
    writeFileSync(join(outDir, etrangerPdf), Buffer.from('%PDF-1.4 pas un vrai pdf mais peu importe'))
    writeFileSync(join(outDir, etrangerZip), Buffer.from('PK\x03\x04 pas une vraie archive'))

    const p1 = bundler1.pruneOrphans()
    assert.ok(!p1.removed.includes(etrangerPdf) && !p1.removed.includes(etrangerZip),
      `AVANT le fix : pruneOrphans() retirait un .pdf/.zip jamais produit par ce bundler, au seul motif que son nom ressemble à une sortie hachée. removed=${p1.removed.join(', ')}`)
    assert.ok(existsSync(join(outDir, etrangerPdf)), 'le PDF doit survivre au 1er prune')
    assert.ok(existsSync(join(outDir, etrangerZip)), 'le ZIP doit survivre au 1er prune')
    await bundler1.close()

    // 2e build (nouvelle instance, comme un vrai `mjs build` relancé) : la promesse porte sur
    // DEUX builds, pas un seul.
    const bundler2 = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifest })
    const stats2 = await bundler2.compile()
    assert.equal(stats2.errors.length, 0, stats2.errors.map(e => e.message).join('\n'))
    const p2 = bundler2.pruneOrphans()
    assert.ok(!p2.removed.includes(etrangerPdf) && !p2.removed.includes(etrangerZip),
      `le PDF/ZIP doit survivre aussi au 2e build. removed=${p2.removed.join(', ')}`)
    assert.ok(existsSync(join(outDir, etrangerPdf)), 'le PDF doit survivre au 2e build')
    assert.ok(existsSync(join(outDir, etrangerZip)), 'le ZIP doit survivre au 2e build')
    await bundler2.close()
  })

  it('un ANCIEN chunk RÉELLEMENT produit par ce bundler (composant renommé) est bien purgé — la protection ne doit pas geler la purge légitime', async function () {
    const { srcDir, outDir, manifest } = makeProject('prune-vrai-orphelin')
    writeFileSync(join(srcDir, 'a.mjs'), comp('a'))
    writeFileSync(join(srcDir, 'b.mjs'), comp('b'))

    const bundler1 = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifest })
    const stats1 = await bundler1.compile()
    assert.equal(stats1.errors.length, 0, stats1.errors.map(e => e.message).join('\n'))
    const bJs = readdirSync(outDir).find(f => /^b-[0-9a-z]{5}\.js$/.test(f))
    assert.ok(bJs, `attendu un b-<hash>.js après le 1er build : ${readdirSync(outDir).join(', ')}`)
    await bundler1.close()

    unlinkSync(join(srcDir, 'b.mjs'))
    const bundler2 = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifest })
    const stats2 = await bundler2.compile()
    assert.equal(stats2.errors.length, 0, stats2.errors.map(e => e.message).join('\n'))
    const { removed } = bundler2.pruneOrphans()
    assert.ok(removed.includes(bJs!), `b-<hash>.js (vraie sortie devenue orpheline) doit toujours être purgé. removed=${removed.join(', ')}`)
    assert.ok(!existsSync(join(outDir, bJs!)), 'b-<hash>.js doit avoir disparu du disque')

    await bundler2.close()
  })

  it("registre .mjs-outputs.json PRÉSENT mais illisible : pruneOrphans() ne purge RIEN et le dit (garde muette interdite)", async function () {
    const { root, srcDir, outDir, manifest } = makeProject('prune-registre-illisible')
    writeFileSync(join(srcDir, 'a.mjs'), comp('a'))

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifest })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    // corrompt le registre APRÈS le build (simule un fichier illisible/tronqué) — logé à côté du
    // MANIFESTE (join(root, 'bundle.js') ici, PAS outDir dans cette fixture)
    writeFileSync(join(root, '.mjs-outputs.json'), '{ceci n est pas du JSON valide')

    const zombie = 'zombie-0123abcd.js'
    writeFileSync(join(outDir, zombie), 'export {}\n')

    const { removed, failed, skipped } = bundler.pruneOrphans()
    assert.equal(skipped, 'registry-unreadable', `un registre illisible doit bloquer TOUTE la purge et le dire, trouvé skipped=${skipped}`)
    assert.deepEqual(removed, [])
    assert.deepEqual(failed, [])
    assert.ok(existsSync(join(outDir, zombie)), 'rien ne doit être purgé quand le registre est illisible — même un vrai zombie survit plutôt que de deviner')

    await bundler.close()
  })

  it('après un build de production (fichiers de messages en .json au registre), un .json du projet au nom hachage-compatible survit ; un ancien fichier de messages ne reste pas', async function () {
    const { srcDir, outDir } = makeProject('prune-json-projet')
    writeFileSync(join(srcDir, 'a.mjs'), comp('a'))
    const manifest = join(outDir, 'bundle.js')

    const bundler1 = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifest, env: 'prod' })
    const stats1 = await bundler1.compile()
    assert.equal(stats1.errors.length, 0, stats1.errors.map(e => e.message).join('\n'))
    assert.ok(readdirSync(outDir).some(f => /^mjs_err-fr-[0-9a-z]{5}\.json$/.test(f)), `attendu un fichier de messages : ${readdirSync(outDir).join(', ')}`)
    await bundler1.close()

    const duProjet = 'catalogue-1a2b3c4d.json'
    const perime   = 'mjs_err-fr-00000000.json'
    writeFileSync(join(outDir, duProjet), '{"produits":[]}')
    writeFileSync(join(outDir, perime), '{}')
    // l'ancien fichier de messages, écrit par un build précédent : consigné au registre comme ce build l'aurait fait
    consigner(outDir, perime)

    const bundler2 = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifest, env: 'prod' })
    const stats2 = await bundler2.compile()
    assert.equal(stats2.errors.length, 0, stats2.errors.map(e => e.message).join('\n'))
    const { removed, skipped } = bundler2.pruneOrphans()
    assert.equal(skipped, undefined, `la purge doit avoir tourné : ${skipped}`)
    assert.ok(!removed.includes(duProjet) && existsSync(join(outDir, duProjet)), `un .json du projet ne doit jamais être purgé. removed=${removed.join(', ')}`)
    // l'ancienne empreinte d'un fichier réécrit part dès le build, avant la purge
    assert.ok(!existsSync(join(outDir, perime)), `un ancien fichier de messages ne doit pas rester : ${readdirSync(outDir).join(', ')}`)

    await bundler2.close()
  })
})
