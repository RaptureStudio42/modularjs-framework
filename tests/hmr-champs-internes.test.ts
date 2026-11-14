// La garde du rechargement à chaud (mjs_hotswap.ts) laisse de côté les champs que le cœur et le code compilé écrivent sur une instance
// après sa construction, et eux seuls : une liste exacte, jamais un préfixe. Ce test relit leurs sources et compare : un champ interne
// nouveau, absent de la liste, ferait recharger la page à chaque échange ; un nom de trop laisserait sans garde le champ de l'appli qui
// le porterait. Un champ de l'appli au nom qui ressemble à un interne (`_mjsFmt`, `_gl_1`) n'y est jamais.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const hotswap  = join(repoRoot, 'src', 'runtime', 'mjs_hotswap.ts')

// receveurs qui ne sont jamais une instance de composant (prise, entrée de dérivée, réglages, feuille, magasin, main d'arrêt d'une minuterie…) ; `this` désigne un autre
// objet dans les fichiers de la prise, du magasin, du ressort, de l'interpolation et du cache de pages ; `e`, dans sortable.mjs, est l'appui du pointeur, que la liste la plus proche marque pour que celle qui la contient ne le prenne pas ; dans select.mjs, le clic, que la liste marque pour que son panneau ne se ferme pas quand il vient d'elle. Tout autre receveur peut être une
// instance (un composant est aussi un nœud de la vue de son parent : ligne de liste, référence, nœud animé)
const PAS        = new Set(['µ', 'window', 'globalThis', 'h', 'v', 'val', 'obj', 'off', 'settings', 'fixed', 'setup', 'setupIn', 'setupOut', 'f', 'refs', 'run', 'reg', 'sheet', 'cover', 'shieldWait', 'err', 'own', 'sock', 'shelf', 'layer', 'toute', 's', 'out', 'nodes', '__nodes', 'relay', 'P', '__mjsLdProto', 'prototype', 'main'])
const AUTRE_THIS = /^mjs_(socket|game|lobby|chat|accounts|store|spring|interpolate|page_cache)\.ts$/
const APPUI      = /^(?:sortable|select)\.mjs$/
const ECRIT      = /([\wµ$]+|\})\s*\.\s*(_mjs_\w+|_shadow|_state|_mjsSkelBusy)\s*(?:=(?!=)|\|\|=|\?\?=|&&=|\+=|-=|\+\+|--)|delete\s+([\wµ$]+)\.(_mjs_\w+|_shadow|_state)/g

function sources(): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|mjs)$/.test(f)) out.push(p)
    }
  }
  for (const d of ['runtime', 'transpiler', 'generator', 'core-modules']) walk(join(repoRoot, 'src', d))
  return out
}

function ecrits(): Set<string> {
  const noms = new Set<string>()
  for (const f of sources()) {
    const t = readFileSync(f, 'utf8').replace(/var _mjsHotInternes = [^\n]*/, '')
    let m: RegExpExecArray | null
    ECRIT.lastIndex = 0
    while ((m = ECRIT.exec(t))) {
      const recv = m[1] || m[3]
      const nom  = m[2] || m[4]
      if (PAS.has(recv) || /^[A-Z]/.test(recv)) continue
      if (recv === 'this' && AUTRE_THIS.test(basename(f))) continue
      if (recv === 'e' && APPUI.test(basename(f))) continue
      noms.add(nom)
    }
  }
  return noms
}

// la liste fixe, puis les noms qu'ajoute un bloc balisé du cœur (`Object.assign(_mjsHotInternes, { … })`) : ceux d'une partie que la
// construction retire quand aucune unité ne s'en sert, et qui partent avec elle ; des clés nues, que le minifieur raccourcit comme les champs
const cles = (objet: string): string[] => objet.split(',').map((c) => c.trim()).filter((c) => c !== '').map((c) => {
  assert.match(c, /^[A-Za-z_$][\w$]*: 1$/, `clé nue attendue, un nom écrit entre guillemets ne serait pas raccourci : ${c}`)
  return c.slice(0, -3)
})
function liste(): string[] {
  const texte  = readFileSync(hotswap, 'utf8')
  const m      = /^var _mjsHotInternes = \{ ([^}]*) \};$/m.exec(texte)
  assert.ok(m, 'liste des champs internes introuvable dans mjs_hotswap.ts')
  const ajouts = texte.split('\n').filter((l) => l.startsWith('Object.assign(_mjsHotInternes, {')).flatMap((l) => cles(/\{ ([^}]*) \}/.exec(l)![1]))
  return [...cles(m[1]), ...ajouts]
}

describe('mjs dev — champs hors garde du rechargement à chaud : la liste exacte des champs internes', function () {
  it('la liste est celle des champs que le cœur et le code compilé écrivent sur une instance', () => {
    const l      = liste()
    const vus    = ecrits()
    const manque = [...vus].filter(n => !l.includes(n)).sort()
    const trop   = l.filter(n => !vus.has(n)).sort()
    assert.deepEqual(manque, [], `champs internes absents de la liste (à y ajouter) : ${manque.join(' ')}`)
    assert.deepEqual(trop, [], `noms de la liste que plus rien n'écrit (à retirer) : ${trop.join(' ')}`)
    assert.equal(new Set(l).size, l.length, 'nom en double dans la liste')
  })

  it('aucun préfixe : un champ de l\'appli au nom qui ressemble à un interne reste gardé', () => {
    const l = new Set(liste())
    for (const nom of ['_mjsFmt', '_gl_1', '_gl_12', '_mjs', '_mjs_', '_mjsX', '_set', '_shadowRoot', '_stateBis']) assert.ok(!l.has(nom), `« ${nom} » ne doit pas être hors garde`)
    for (const nom of l) assert.match(nom, /^[\w$]+$/, `« ${nom} » : un nom, pas un motif`)
  })
})
