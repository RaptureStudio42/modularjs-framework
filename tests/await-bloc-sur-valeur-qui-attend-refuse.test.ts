// un bloc {await} qui traite une valeur qui attend comme une promesse (`$fiche = await charger($id)`, puis `{await $fiche}`) : la valeur vaut
// undefined jusqu'à la réponse, puis la réponse, jamais une promesse. Quand sa valeur peut être la valeur qui attend (`{await ($fiche)}`,
// `{await $fiche ?? null}`, `{await $fiche or null}`, `{await $ok ? $fiche : null}`, un opérande de `and`), sa branche d'attente ne se
// montrait pas ; `.then`, `.catch`, `.finally` appelés sur elle cassaient à la réponse ; `Promise.all([$fiche])`, `Promise.all([$fiche, 1])`,
// `Promise.resolve($fiche)` réussissaient tout de suite, sans la réponse, et `Promise.race`, `Promise.any` la rendaient tout de suite, même à
// côté d'un appel. Refusé à la construction : le message cite la tête du bloc telle qu'écrite, effet compris (`*skeleton`), sa ligne quand
// elle est sûre (sinon aucune), et dit les deux formes à écrire, qui montrent l'attente puis la fiche. Restent permis : un {await} sur une
// promesse, sur un appel qui cite la valeur (appelé avec undefined, puis avec la réponse), sur un champ de la valeur, avec `.keep` ; une
// liste de `Promise.all` ou `allSettled` qui porte aussi un appel ou une autre promesse (elle attend celle-ci, puis la fiche) ; ce qu'écrit
// le corps d'un rappel. Un enfant qui attend une prop reçoit la réponse, pas une promesse : le parent qui garde la valeur qui attend montre
// l'attente (`{if µpending($fiche)}…{else}<@enfant data={$fiche}>{end}`), une seule demande part ; une promesse passée sans await y montre
// l'attente

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { refus, compile } from './helpers/derivee-await-refus.js'
import { monter, demandes, repondre, ecran, pause } from './helpers/derivee-await-banc.js'

// le script (lignes 1 à 5 du fichier), `$fiche` valant `valeur`, puis le gabarit (ligne 6)
const fiche     = (valeur: string, gabarit: string, lang = '') => `<script${lang}>\n  $id     = 1\n  charger = (i) -> fetch("/api/fiche-#{i}").then((r) -> r.json())\n  $fiche  = ${valeur}\n</script>\n${gabarit}\n`
const bloc      = (tete: string) => `${tete}\n  <i>attente</i>\n{success f}\n  <p>{f.nom}</p>\n{end}`
// le bloc sans branche d'attente écrite : `*skeleton` la fait
const squelette = (tete: string) => `${tete}\n{success f}\n  <p>{f.nom}</p>\n{end}`
const attend    = 'await charger($id)'
const enJs      = (tete: string) => `<script lang="js">\n  $id = 1\n  charger = (i) => fetch('/api/fiche-' + i).then((r) => r.json())\n  $fiche = await charger($id)\n</script>\n${bloc(tete)}\n`
const parent    = (valeur: string) => fiche(valeur, '<@enfant data={$fiche}>')
const enfant    = bloc('{await $data}') + '\n'
// un appel qui cite la valeur qui attend : `chercher` demande l'adresse de ce qu'il reçoit
const cherche   = `<script>\n  $id      = 1\n  charger  = (i) -> fetch("/api/fiche-#{i}").then((r) -> r.json())\n  chercher = (f) -> fetch("/api/chercher-#{f?.nom}").then((r) -> r.json())\n  $fiche   = await charger($id)\n</script>\n${bloc('{await chercher($fiche)}')}\n`
// à côté de la valeur qui attend, une autre promesse (`$p`) et un appel qui la cite (`chercher`)
const liste     = (gabarit: string) => `<script>\n  $id      = 1\n  charger  = (i) -> fetch("/api/fiche-#{i}").then((r) -> r.json())\n  chercher = (f) -> fetch("/api/chercher-#{f?.nom}").then((r) -> r.json())\n  $p       = fetch("/api/p").then((r) -> r.json())\n  $fiche   = await charger($id)\n</script>\n${gabarit}\n`

describe('bloc {await} sur une valeur qui attend : refusé à la construction', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, tete, source, ligne] of [
    ['la variable seule', '{await $fiche}', fiche(attend, bloc('{await $fiche}')), 6],
    ['avec .keep', '{await.keep $fiche}', fiche(attend, bloc('{await.keep $fiche}')), 6],
    ['entre parenthèses', '{await ($fiche)}', fiche(attend, bloc('{await ($fiche)}')), 6],
    ['opérande de ??', '{await $fiche ?? null}', fiche(attend, bloc('{await $fiche ?? null}')), 6],
    ['second opérande de ??', '{await null ?? $fiche}', fiche(attend, bloc('{await null ?? $fiche}')), 6],
    ['opérande de or', '{await $fiche or null}', fiche(attend, bloc('{await $fiche or null}')), 6],
    ['opérande de ||', '{await $fiche || null}', fiche(attend, bloc('{await $fiche || null}')), 6],
    ['branche de ? :', '{await $ok ? $fiche : null}', fiche(attend, bloc('{await $ok ? $fiche : null}')), 6],
    ['second opérande de and', '{await $ok and $fiche}', fiche(attend, bloc('{await $ok and $fiche}')), 6],
    ['premier opérande de and', '{await $fiche and charger(1)}', fiche(attend, bloc('{await $fiche and charger(1)}')), 6],
    ['premier opérande de and, puis un de ses champs', '{await $fiche and $fiche.x}', fiche(attend, bloc('{await $fiche and $fiche.x}')), 6],
    ['sa méthode then', '{await $fiche.then((r) -> r)}', fiche(attend, bloc('{await $fiche.then((r) -> r)}')), 6],
    ['sa méthode then, après ?.', '{await $fiche?.then((r) -> r)}', fiche(attend, bloc('{await $fiche?.then((r) -> r)}')), 6],
    ['sa méthode then, dans un appel', '{await charger($fiche.then((r) -> r))}', fiche(attend, bloc('{await charger($fiche.then((r) -> r))}')), 6],
    ['sa méthode catch', '{await $fiche.catch((e) -> null)}', fiche(attend, bloc('{await $fiche.catch((e) -> null)}')), 6],
    ['sa méthode finally', '{await $fiche.finally(-> null)}', fiche(attend, bloc('{await $fiche.finally(-> null)}')), 6],
    ['donnée à Promise.resolve', '{await Promise.resolve($fiche)}', fiche(attend, bloc('{await Promise.resolve($fiche)}')), 6],
    ['dans la liste de Promise.all', '{await Promise.all([$fiche])}', fiche(attend, bloc('{await Promise.all([$fiche])}')), 6],
    ['dans la liste de Promise.all, avec une valeur écrite', '{await Promise.all([$fiche, 1])}', fiche(attend, bloc('{await Promise.all([$fiche, 1])}')), 6],
    ['opérande de ?? dans la liste de Promise.race, à côté d\'un appel : rendue tout de suite', '{await Promise.race([charger(2), $fiche ?? null])}', fiche(attend, bloc('{await Promise.race([charger(2), $fiche ?? null])}')), 6],
    ['dans la liste de Promise.any, à côté d\'un appel : rendue tout de suite', '{await Promise.any([charger(2), $fiche])}', fiche(attend, bloc('{await Promise.any([charger(2), $fiche])}')), 6],
    ['sa méthode then, en JavaScript', '{await $fiche.then((r) => r)}', enJs('{await $fiche.then((r) => r)}'), 6],
    ['dans la liste de Promise.all, en JavaScript', '{await Promise.all([$fiche])}', enJs('{await Promise.all([$fiche])}'), 6],
    ['avec *skeleton : l\'effet cité', '{await $fiche *skeleton}', fiche(attend, squelette('{await $fiche *skeleton}')), 6],
    ['avec .keep et *skeleton', '{await.keep $fiche *skeleton}', fiche(attend, squelette('{await.keep $fiche *skeleton}')), 6],
    ['avec *skeleton, la même tête sans effet plus bas', '{await $fiche *skeleton}', fiche(attend, squelette('{await $fiche *skeleton}') + '\n' + bloc('{await $fiche}')), 6],
    ['sans effet, la même tête avec *skeleton plus bas', '{await $fiche}', fiche(attend, bloc('{await $fiche}') + '\n' + squelette('{await $fiche *skeleton}')), 6],
    ['opérande de or, script en CoffeeScript', '{await $fiche or null}', fiche(attend, bloc('{await $fiche or null}'), ' lang="coffee"'), 6],
    ['opérande de ?? en JavaScript', '{await $fiche ?? null}', enJs('{await $fiche ?? null}'), 6],
    ['dans un {if}', '{await ($fiche)}', fiche(attend, '{if $id}\n' + bloc('{await ($fiche)}') + '\n{end}'), 7],
    ['la même tête écrite aussi dans une chaîne : ligne incertaine, aucune', '{await $fiche ?? null}', fiche(attend, '<p>{"{await $fiche ?? null}"}</p>\n' + bloc('{await $fiche ?? null}')), ''],
  ] as Array<[string, string, string, number | '']>) {
    it(`${tete}, ${nom} : refusé, la tête telle qu'écrite, ${ligne === '' ? 'sans ligne' : 'la ligne ' + ligne} et les deux formes à écrire`, async () => {
      const message = await refus(source)
      const place   = ligne === '' ? `'refus.mjs' : ` : `'refus.mjs', ligne ${ligne} : `
      assert.ok(message.includes(`${place}« ${tete} » : $fiche est une valeur qui attend`), message)
      assert.ok(message.includes('« {if µpending($fiche)}…{else}…{end} »'), message)
      assert.ok(message.includes('« $fiche = charger($id) »'), message)
    })
  }

  for (const [nom, source] of [
    ['{await $fiche} sur une promesse ($fiche = charger($id))', fiche('charger($id)', bloc('{await $fiche}'))],
    ['{await $fiche ?? null} sur une promesse', fiche('charger($id)', bloc('{await $fiche ?? null}'))],
    ['{await charger($id)}', fiche('1', bloc('{await charger($id)}'))],
    ['{await.keep charger($id)}', fiche('1', bloc('{await.keep charger($id)}'))],
    ['{await charger($fiche)}, un appel qui cite la valeur qui attend', fiche(attend, bloc('{await charger($fiche)}'))],
    ['{await $fiche.x}, un champ de la valeur qui attend', fiche(attend, bloc('{await $fiche.x}'))],
    ['{await $fiche?.x}, un champ lu avec ?.', fiche(attend, bloc('{await $fiche?.x}'))],
    ['{await $id and charger(1)}, une variable ordinaire en premier opérande de and', fiche(attend, bloc('{await $id and charger(1)}'))],
    ['{await charger($id).then((r) -> r)}, then sur une promesse', fiche(attend, bloc('{await charger($id).then((r) -> r)}'))],
    ['{await $fiche.then((r) -> r)} sur une promesse ($fiche = charger($id))', fiche('charger($id)', bloc('{await $fiche.then((r) -> r)}'))],
    ['{await Promise.all([charger(1), charger(2)])}, sans la valeur qui attend', fiche(attend, bloc('{await Promise.all([charger(1), charger(2)])}'))],
    ['{await Promise.all([charger($fiche)])}, un appel qui cite la valeur qui attend', fiche(attend, bloc('{await Promise.all([charger($fiche)])}'))],
    ['{await Promise.resolve($fiche.x)}, un champ de la valeur qui attend', fiche(attend, bloc('{await Promise.resolve($fiche.x)}'))],
    ['{await $fiche *skeleton} sur une promesse', fiche('charger($id)', squelette('{await $fiche *skeleton}'))],
    ['{if µpending($fiche)} sur la valeur qui attend', fiche(attend, '{if µpending($fiche)}<i>attente</i>{else}<p>{$fiche.nom}</p>{end}')],
    ['{await Promise.all([chercher($fiche), $fiche])}, la liste porte aussi un appel', liste(bloc('{await Promise.all([chercher($fiche), $fiche])}'))],
    ['{await Promise.all([$p, $fiche])}, la liste porte aussi une promesse', liste(bloc('{await Promise.all([$p, $fiche])}'))],
    ['{await Promise.allSettled([charger(1), $fiche])}, la liste porte aussi un appel', liste(bloc('{await Promise.allSettled([charger(1), $fiche])}'))],
    ['{await chercher($fiche).then((r) -> Promise.all([r, $fiche]))}, dans le corps d\'un rappel', liste(bloc('{await chercher($fiche).then((r) -> Promise.all([r, $fiche]))}'))],
    ['{await $p.then((r) -> Promise.resolve($fiche))}, dans le corps d\'un rappel', liste(bloc('{await $p.then((r) -> Promise.resolve($fiche))}'))],
  ] as Array<[string, string]>) {
    it(`${nom} : permis`, async () => {
      assert.match(await compile(source), /_mjs_upd/)
    })
  }

  // une liste de Promise.all ou allSettled qui porte aussi un appel ou une autre promesse attend celle-ci : l'attente, puis la fiche
  for (const [tete, succes, reponses, fin] of [
    ['{await Promise.all([chercher($fiche), $fiche])}', '<p>{f[0].nom}-{f[1]?.nom}</p>', [['/api/chercher-undefined', 'Vide'], ['/api/fiche-1', 'Zed'], ['/api/chercher-Zed', 'Det']], '<p>Det-Zed</p>'],
    ['{await Promise.all([$p, $fiche])}', '<p>{f[0].nom}-{f[1]?.nom}</p>', [['/api/p', 'P'], ['/api/fiche-1', 'Zed']], '<p>P-Zed</p>'],
    ['{await Promise.allSettled([chercher($fiche), $fiche])}', '<p>{f[0].value.nom}-{f[1].value?.nom}</p>', [['/api/chercher-undefined', 'Vide'], ['/api/fiche-1', 'Zed'], ['/api/chercher-Zed', 'Det']], '<p>Det-Zed</p>'],
    ['{await chercher($fiche).then((r) -> Promise.all([r, $fiche]))}', '<p>{f[0].nom}-{f[1]?.nom}</p>', [['/api/chercher-undefined', 'Vide'], ['/api/fiche-1', 'Zed'], ['/api/chercher-Zed', 'Det']], '<p>Det-Zed</p>'],
  ] as Array<[string, string, Array<[string, string]>, string]>) {
    it(`${tete}, une liste qui attend aussi une promesse : l'attente, puis la fiche`, async () => {
      const w  = await monter('await-bloc-liste', { 'fiche.mjs': liste(`${tete}\n  <i>attente</i>\n{success f}\n  ${succes}\n{end}`) }, '<mjs-fiche></mjs-fiche>')
      const el = w.document.querySelector('mjs-fiche')
      await pause(60)
      assert.equal(ecran(el), '<i>attente</i>', 'avant les réponses')
      for (const [url, nom] of reponses) {
        await repondre(w, url, { nom })
        await pause(60)
      }
      assert.equal(ecran(el), fin, 'après les réponses')
    })
  }

  for (const [nom, source] of [
    ['{await $fiche} sur la promesse', fiche('charger($id)', bloc('{await $fiche}'))],
    ['{if µpending($fiche)} sur la valeur qui attend', fiche(attend, '{if µpending($fiche)}<i>attente</i>{else}<p>{$fiche.nom}</p>{end}')],
  ] as Array<[string, string]>) {
    it(`la forme conseillée, ${nom} : l'attente, puis la fiche`, async () => {
      const w  = await monter('await-bloc-sur-attente', { 'fiche.mjs': source }, '<mjs-fiche></mjs-fiche>')
      const el = w.document.querySelector('mjs-fiche')
      assert.deepEqual(demandes(w), ['/api/fiche-1'])
      assert.equal(ecran(el), '<i>attente</i>', 'avant la réponse')
      await repondre(w, '/api/fiche-1', { nom: 'Zed' })
      assert.equal(ecran(el), '<p>Zed</p>', 'après la réponse')
    })
  }

  it('{await chercher($fiche)}, un appel qui cite la valeur qui attend : appelé avec undefined jusqu\'à la réponse, puis avec la réponse', async () => {
    const w  = await monter('await-bloc-appel', { 'fiche.mjs': cherche }, '<mjs-fiche></mjs-fiche>')
    const el = w.document.querySelector('mjs-fiche')
    await pause(60)
    assert.deepEqual([...demandes(w)].sort(), ['/api/chercher-undefined', '/api/fiche-1'])
    assert.equal(ecran(el), '<i>attente</i>', 'avant la réponse')
    await repondre(w, '/api/fiche-1', { nom: 'Zed' })
    await pause(60)
    assert.ok(demandes(w).includes('/api/chercher-Zed'), JSON.stringify(demandes(w)))
    await repondre(w, '/api/chercher-Zed', { nom: 'Zed' })
    await pause(60)
    assert.equal(ecran(el), '<p>Zed</p>', 'après la réponse')
  })

  // la forme conseillée pour un enfant qui attend sa prop : le parent garde la valeur qui attend et montre l'attente, l'enfant ne change pas
  it('un enfant qui attend sa prop, sous {if µpending($fiche)} chez le parent : l\'attente chez le parent, une seule demande, puis la fiche chez l\'enfant', async () => {
    const source = fiche(attend, '{if µpending($fiche)}<i>attente</i>{else}<@enfant data={$fiche}>{end}')
    const w      = await monter('await-bloc-prop-parent', { 'p.mjs': source, 'enfant.mjs': enfant }, '<mjs-p></mjs-p>')
    const p      = w.document.querySelector('mjs-p')
    await pause(60)
    assert.deepEqual(demandes(w), ['/api/fiche-1'])
    assert.equal(ecran(p), '<i>attente</i>', 'avant la réponse')
    await repondre(w, '/api/fiche-1', { nom: 'Zed' })
    await pause(60)
    assert.deepEqual(demandes(w), ['/api/fiche-1'], 'aucune autre demande')
    assert.equal(ecran(p._shadow.querySelector('mjs-enfant')), '<p>Zed</p>', 'après la réponse')
  })

  // ce qu'aucun refus ne voit : l'enfant ne sait pas ce que le parent lui passe
  for (const [nom, valeur, avant] of [
    ['une valeur qui attend : la réponse, pas une promesse, donc aucune attente', attend, ''],
    ['une promesse, sans await : l\'attente, puis la fiche', 'charger($id)', '<i>attente</i>'],
  ] as Array<[string, string, string]>) {
    it(`un enfant qui attend sa prop ({await $data}) reçoit ${nom}`, async () => {
      const w  = await monter('await-bloc-prop', { 'p.mjs': parent(valeur), 'enfant.mjs': enfant }, '<mjs-p></mjs-p>')
      await pause(60)
      const el = w.document.querySelector('mjs-p')._shadow.querySelector('mjs-enfant')
      assert.ok(demandes(w).length > 0)
      assert.equal(ecran(el), avant, 'avant la réponse')
      // chaque demande partie reçoit sa réponse
      for (const url of demandes(w)) await repondre(w, url, { nom: 'Zed' })
      await pause(60)
      assert.equal(ecran(el), '<p>Zed</p>', 'après la réponse')
    })
  }
})
