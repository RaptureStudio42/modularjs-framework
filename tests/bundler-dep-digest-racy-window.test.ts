// Test de régression : `Bundler.depDigest` (src/bundler/index.ts) mémoïse le hachage d'une
// dépendance sur (mtimeNs, taille) — la mémoïsation ne vit que le temps d'un compile() (le
// mémo est vidé à chaque appel, cf. son bandeau) et n'est fiable QUE pour un fichier dont le
// mtime est ANTÉRIEUR au début du tour courant (`compileStartMs`, figé une fois au tout début
// de compile()). Un fichier dont le mtime tombe À ou APRÈS cet instant — donc potentiellement
// réécrit PENDANT que le tour est en cours — n'est jamais servi depuis le mémo, quels que
// soient (mtimeNs, taille) : sans cette garde, une collision forcée (`touch -d`, ou la
// granularité grossière de certains systèmes de fichiers) resservirait le digest de l'ANCIEN
// contenu pour un fichier réécrit en cours de route.
//
// `depDigest`/`compileStartMs` sont des membres TypeScript `private` — sans effet au runtime
// (pas de `#privé` réel) : accédés directement ici, comme le fait déjà l'accès à
// `bundler.cache` dans bundler-ujsform-wiring.test.ts et consorts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler } from '../src/bundler/index.js'

describe('Bundler.depDigest — fraîcheur relative au début du tour de compilation', function () {
  it('un fichier écrit AVANT le début du tour reste mémoïsé pour toute sa durée', function () {
    const root    = mjsTmp('depdigest-racy-avant')
    mkdirSync(root, { recursive: true })
    const fichier = join(root, '_bloc.mjs')
    writeFileSync(fichier, 'AAAA')

    const bundler = new Bundler({ sourceDir: root, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') }) as any
    // marge large (1s) : le tour est réputé avoir commencé BIEN APRÈS cette écriture, comme un
    // vrai fichier qui vient de déclencher `mjs dev`/watch avant même que compile() ne démarre.
    const st = statSync(fichier, { bigint: true })
    bundler.compileStartMs = Number(st.mtimeNs / 1_000_000n) + 1000

    const premier = (bundler.depDigest(fichier) as Buffer)

    // réécriture de MÊME longueur puis date forcée EXACTEMENT identique à la nanoseconde
    // (`touch -d @s.ns`, pas `utimesSync` qui perd la précision — cf. le même procédé dans
    // bundler-dep-digest-fraicheur.test.ts) : simule le cas où RIEN ne devrait avoir bougé du
    // point de vue de compile() (aucune ligne de ce tour ne réécrit ses propres dépendances).
    const avant = statSync(fichier, { bigint: true })
    writeFileSync(fichier, 'BBBB')
    const stamp = `@${avant.mtimeNs / 1000000000n}.${String(avant.mtimeNs % 1000000000n).padStart(9, '0')}`
    execFileSync('touch', ['-d', stamp, fichier])
    const apres = statSync(fichier, { bigint: true })
    assert.equal(apres.mtimeNs, avant.mtimeNs, 'la collision doit être EXACTE à la nanoseconde — sinon ce test ne prouve rien')
    assert.equal(apres.size, avant.size, 'la taille doit rester identique — sinon ce test ne prouve rien')

    const second = (bundler.depDigest(fichier) as Buffer)
    assert.equal(second, premier,
      'le fichier a été écrit avant le début du tour : sa réécriture ultérieure ne doit PAS déclencher de relecture — même référence de buffer, aucun nouveau hachage')
  })

  it('une collision (mtimeNs, taille) forcée PENDANT le tour reste détectée', function () {
    const root    = mjsTmp('depdigest-racy-pendant')
    mkdirSync(root, { recursive: true })
    const fichier = join(root, '_bloc.mjs')

    const bundler = new Bundler({ sourceDir: root, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') }) as any
    // le tour est réputé avoir commencé AVANT cette écriture (marge large, 1s) : la première
    // écriture du fichier a donc lieu PENDANT le tour, comme un fichier partagé qui se ferait
    // resauvegarder pendant que le build tourne encore.
    bundler.compileStartMs = Date.now() - 1000
    writeFileSync(fichier, 'AAAA')

    const premier = (bundler.depDigest(fichier) as Buffer).toString('hex')

    const avant = statSync(fichier, { bigint: true })
    writeFileSync(fichier, 'BBBB')
    const stamp = `@${avant.mtimeNs / 1000000000n}.${String(avant.mtimeNs % 1000000000n).padStart(9, '0')}`
    execFileSync('touch', ['-d', stamp, fichier])
    const apres = statSync(fichier, { bigint: true })
    assert.equal(apres.mtimeNs, avant.mtimeNs, 'la collision doit être EXACTE à la nanoseconde — sinon ce test ne prouve rien')
    assert.equal(apres.size, avant.size, 'la taille doit rester identique — sinon ce test ne prouve rien')

    const second = (bundler.depDigest(fichier) as Buffer).toString('hex')
    assert.notEqual(second, premier,
      'le fichier a été écrit PENDANT le tour : (mtimeNs, taille) identiques ne suffisent pas, le digest doit refléter le NOUVEAU contenu')
  })
})
