// Les erreurs et les avertissements du parseur citent la ligne du FICHIER, même quand le fichier commence par des
// lignes vides : le HTML est rogné en tête avant d'être analysé, sa première ligne (`firstLine`) est alors celle où
// il commence vraiment dans le fichier. Sans lignes vides en tête, rien ne change. Chaque message du parseur qui
// cite une ligne a son cas : trois lignes vides, la ligne du fichier ; sans elles, la ligne du HTML.

import assert from 'node:assert/strict'
import { setMessagesLang } from '../src/messages/index.js'
import { parse } from '../src/parser/index.js'
import { compile } from '../src/generator/compile.js'
import { transpile } from '../src/transpiler/index.js'

// 'erreur' et 'avertissement' passent par transpile() (le chemin d'un vrai fichier) ; 'direct' appelle compile() avec
// `firstLine`, pour les messages que le transpileur attrape avant le parseur ou qu'une option réveille
interface Cas {
  nom: string
  genre: 'erreur' | 'avertissement' | 'direct'
  html: string
  // `p` : la ligne du fichier où commence le HTML (celle de son premier `<p>a</p>`) ; les morceaux du message à y retrouver
  cite: (p: number) => string[]
  options?: Record<string, unknown>
}

const P = '<p>a</p>\n'

const CAS: Cas[] = [
  { nom: 'chaîne non fermée dans une valeur', genre: 'erreur', html: P + '<div title={\'ab\\}>x</div>\n', cite: p => ['CHAÎNE NON FERMÉE', `ligne ${p + 1} n'est jamais refermée`] },
  { nom: 'accolade non refermée', genre: 'erreur', html: P + '<p>{ $a + $b</p>\n', cite: p => ['EXPRESSION NON FERMÉE', `ouvert ligne ${p + 1} n'a pas de`] },
  { nom: '{for} : item qui est un symbole du framework', genre: 'erreur', html: P + '{for µ in $l}x{end}\n', cite: p => [`ligne ${p + 1} : « µ » est un symbole du framework`] },
  { nom: '{const} : nom qui est un symbole du framework', genre: 'erreur', html: P + '{const $ = 1}\n', cite: p => [`ligne ${p + 1} : « $ » est un symbole du framework`] },
  { nom: '{success} : argument qui est un symbole du framework', genre: 'erreur', html: P + '{await $p}{success µ}x{end}\n', cite: p => [`ligne ${p + 1} : « µ » est un symbole du framework`] },
  { nom: '{error} : argument qui est un symbole du framework', genre: 'erreur', html: P + '{await $p}{success d}x{error µ}y{end}\n', cite: p => [`ligne ${p + 1} : « µ » est un symbole du framework`] },
  { nom: '{for} : nom réservé', genre: 'erreur', html: P + '{for el in $l}x{end}\n', cite: p => ['NOM RÉSERVÉ', `Ligne ${p + 1}, bloc \`{for}\``] },
  { nom: '{const} : nom réservé', genre: 'erreur', html: P + '{const e = 1}\n', cite: p => ['NOM RÉSERVÉ', `Ligne ${p + 1}, bloc \`{const}\``] },
  { nom: '{for} : index réservé', genre: 'erreur', html: P + '{for el, x in $l}y{end}\n', cite: p => ['NOM RÉSERVÉ', `Ligne ${p + 1}, bloc \`{for}\``] },
  { nom: '{success} : nom réservé', genre: 'erreur', html: P + '{await $p}{success el}x{end}\n', cite: p => ['NOM RÉSERVÉ', `Ligne ${p + 1}, bloc \`{success}\``] },
  { nom: '{error} : nom réservé', genre: 'erreur', html: P + '{await $p}{success d}x{error el}y{end}\n', cite: p => ['NOM RÉSERVÉ', `Ligne ${p + 1}, bloc \`{error}\``] },
  { nom: '{if} non fermé', genre: 'erreur', html: P + '{if true}x\n', cite: p => ['BLOC NON FERMÉ', `\`{if true}\` ouvert ligne ${p + 1} n'a pas de`] },
  { nom: '{for} non fermé', genre: 'erreur', html: P + '{for i in $l}x\n', cite: p => ['BLOC NON FERMÉ', `\`{for i in $l}\` ouvert ligne ${p + 1} n'a pas de`] },
  { nom: '{await} non fermé', genre: 'erreur', html: P + '{await $p}x\n', cite: p => ['BLOC NON FERMÉ', `\`{await $p}\` ouvert ligne ${p + 1} n'a pas de`] },
  { nom: '{key} non fermé', genre: 'erreur', html: P + '{key $a}x\n', cite: p => ['BLOC NON FERMÉ', `\`{key $a}\` ouvert ligne ${p + 1} n'a pas de`] },
  { nom: 'effet : espace avant la parenthèse', genre: 'erreur', html: P + '<p *neon (#0ff)>x</p>\n', cite: p => [`*neon (…) (ligne ${p + 1})`] },
  { nom: 'transition : espace avant la parenthèse', genre: 'erreur', html: P + '<p @in=*neon (#0ff)>x</p>\n', cite: p => [`*neon (…) (ligne ${p + 1})`] },
  { nom: 'effet : réglages après un =', genre: 'erreur', html: P + '<p *neon=#0ff>x</p>\n', cite: p => [`*neon=… (ligne ${p + 1})`] },
  { nom: 'attribut écrit deux fois', genre: 'erreur', html: P + '<p class="a" class="b">x</p>\n', cite: p => ['ATTRIBUT DUPLIQUÉ', `(ligne ${p + 1})`] },
  { nom: 'accolade seule dans une balise', genre: 'erreur', html: P + '<div {$a ? \'x\' : \'y\'}>x</div>\n', cite: p => [`(ligne ${p + 1}) : un \`{expr}\` seul`] },
  { nom: '{await *skeleton} dans un <svg>', genre: 'erreur', html: P + '<svg>\n{await $p *skeleton}{success d}<text>{d}</text>{end}\n</svg>\n', cite: p => [`ligne ${p + 2} : {await … *skeleton} dans un <svg>`] },
  { nom: '{await *skeleton} avec la branche d\'attente écrite', genre: 'erreur', html: P + '{await $p *skeleton}<p>attente</p>{success d}<b>{d}</b>{end}\n', cite: p => [`ligne ${p + 1} : {await … *skeleton} — la branche d'attente est déjà écrite`] },
  { nom: '{await *skeleton} sans {success}', genre: 'erreur', html: P + '{await $p *skeleton}{end}\n', cite: p => [`ligne ${p + 1} : {await … *skeleton} — le squelette se tire`] },
  { nom: '{const} sans « nom = valeur »', genre: 'erreur', html: P + '{const 1 = 2}\n', cite: p => [`{const …} invalide (ligne ${p + 1})`] },
  { nom: '{const} sans expression', genre: 'erreur', html: P + '{const a = }\n', cite: p => [`{const a = …} (ligne ${p + 1}) : expression vide`] },
  { nom: '{for} : item et index homonymes', genre: 'erreur', html: P + '{for x, x in $l}y{end}\n', cite: p => [`{for x, x in …} (ligne ${p + 1})`] },
  { nom: '{for} : syntaxe invalide', genre: 'erreur', html: P + '{for x of $l}y{end}\n', cite: p => [`{for x of $l} invalide (ligne ${p + 1})`] },
  { nom: '{{ … } : une seule accolade fermante', genre: 'erreur', html: P + '<p>{{ $a }</p>\n', cite: p => ['DOUBLE ACCOLADE INCOMPLÈTE', `ligne ${p + 1} : une seule accolade fermante`] },
  { nom: '{else if …}', genre: 'erreur', html: P + '<p>{else if $a}</p>\n', cite: p => [`{else if $a} (ligne ${p + 1})`] },
  { nom: '<@view/> auto-fermée', genre: 'erreur', html: P + '<@view/>\n', cite: p => [`<@view/> (ligne ${p + 1}) : auto-fermeture interdite`] },
  { nom: 'balise jamais refermée', genre: 'erreur', html: P + '<div>\nx\n', cite: p => ['BALISE NON FERMÉE', `ouverte ligne ${p + 1} n'a pas de`] },
  { nom: 'balise jamais refermée, ouverte sur plusieurs lignes', genre: 'erreur', html: P + '<div\n  class="a"\n>\nx\n', cite: p => ['BALISE NON FERMÉE', `ouverte ligne ${p + 1} n'a pas de`] },
  { nom: 'commentaire jamais refermé', genre: 'erreur', html: P + '<!-- jamais fermé\n', cite: p => ['COMMENTAIRE NON FERMÉ', `ouvert ligne ${p + 1} n'a pas de`] },
  { nom: '<@fill> sans nom', genre: 'erreur', html: P + '<@fill></@fill>\n', cite: p => [`<@fill> sans nom (ligne ${p + 1})`] },
  { nom: '<@fill> dont le premier attribut n\'est pas un nom', genre: 'erreur', html: P + '<@fill nom="x"></@fill>\n', cite: p => [`<@fill> sans nom (ligne ${p + 1})`] },
  { nom: '<@fill> avec deux noms', genre: 'erreur', html: P + '<@fill a b></@fill>\n', cite: p => [`(ligne ${p + 1}) : un seul nom de slot`] },
  { nom: '<@fill> au nom dynamique', genre: 'erreur', html: P + '<@fill {x}></@fill>\n', cite: p => [`(ligne ${p + 1}) : nom dynamique refusé`] },
  { nom: '<@fill> : un texte nu', genre: 'erreur', html: P + '<@fill a>\ntexte\n</@fill>\n', cite: p => [`<@fill a> (ligne ${p + 2}) : un texte ne peut pas`] },
  { nom: '<@fill> : une interpolation nue', genre: 'erreur', html: P + '<@fill a>\n{$x}\n</@fill>\n', cite: p => [`<@fill a> (ligne ${p + 2}) : un texte ne peut pas`] },
  { nom: '<@fill> imbriqué', genre: 'erreur', html: P + '<@fill a>\n<@fill b></@fill>\n</@fill>\n', cite: p => [`<@fill> imbriqué (ligne ${p + 2})`] },
  { nom: '<@fill> : un enfant qui porte déjà son slot', genre: 'erreur', html: P + '<@fill a>\n<p slot="b">x</p>\n</@fill>\n', cite: p => [`<p slot="…"> (ligne ${p + 2}) : cet enfant`] },
  { nom: 'balise fermante orpheline', genre: 'erreur', html: P + '</div>\n', cite: p => ['BALISE FERMANTE ORPHELINE', `\`</div>\` ligne ${p + 1} : aucune balise ouvrante`] },
  { nom: 'jeton de flux orphelin au milieu', genre: 'erreur', html: P + '{end}\n<p>b</p>\n', cite: p => ['JETON ORPHELIN', `\`{end}\` ligne ${p + 1} : aucun bloc ouvrant`] },
  { nom: 'fermeture mal appariée (avertissement : les deux lignes)', genre: 'avertissement', html: P + '<div>\n<span>\na\n</div>\n', cite: p => [`<span> ouverte ligne ${p + 2} n'est pas refermée par </span> : </div> rencontrée ligne ${p + 4} à la place`] },
  { nom: 'jeton de flux en trop à la fin (avertissement)', genre: 'avertissement', html: P + '{if true}x{end}{end}\n', cite: p => [`\`{end}\` ligne ${p + 1} : aucun bloc ouvrant`] },
  { nom: '{? …} : un nom de modèle invalide', genre: 'direct', html: P + '{? 9}x{end}', cite: p => [`{? 9} ligne ${p + 1} : un nom de modèle`] },
  { nom: '{? …} jamais refermé', genre: 'direct', html: P + '{? timer}x\n', cite: p => ['BLOC NON FERMÉ', `\`{? timer}\` ouvert ligne ${p + 1} n'a pas de`] },
  { nom: 'modèle en fichier choisi par une valeur calculée entre guillemets', genre: 'direct', html: P + '<@carte layout="x{$v}">y</@carte>', cite: p => [`<@carte> ligne ${p + 1} : carte a des modèles`], options: { models: { dev: { carte: ['compacte'] } } } },
]

async function erreur(src: string): Promise<string> {
  try { await transpile(src, { moduleName: 'parseur-ligne' }) } catch (e: any) { return String(e.message) }
  return ''
}

async function avertissements(src: string): Promise<string> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'parseur-ligne' }) } finally { console.warn = orig }
  return vus.join('\n')
}

// compile() appelé tel quel : `firstLine` donné, ou absent quand le HTML commence à la ligne 1
function direct(html: string, p: number, options: Record<string, unknown> = {}): string {
  try { compile(html, { moduleName: 'parseur-ligne', ...(p > 1 ? { firstLine: p } : {}), ...options } as any) } catch (e: any) { return String(e.message) }
  return ''
}

async function sortie(c: Cas, vides: number): Promise<string> {
  if (c.genre === 'direct') return direct(c.html, vides + 1, c.options)
  const src = '\n'.repeat(vides) + c.html
  return c.genre === 'erreur' ? erreur(src) : avertissements(src)
}

function retrouve(c: Cas, message: string, p: number): void {
  for (const morceau of c.cite(p)) assert.ok(message.includes(morceau), `« ${morceau} » attendu dans :\n${message || '(aucun message)'}`)
}

describe('parseur : les lignes citées sont celles du fichier, lignes vides en tête comprises', function () {
  this.timeout(60000)

  for (const c of CAS) {
    it(`${c.nom} : trois lignes vides en tête, la ligne du fichier`, async () => {
      retrouve(c, await sortie(c, 3), 4)
    })

    it(`${c.nom} : sans ligne vide en tête, la ligne du HTML (rien ne change)`, async () => {
      retrouve(c, await sortie(c, 0), 1)
    })
  }

  it('une seule ligne vide en tête', async () => {
    const m = await erreur('\n<p>a</p>\n{if true}x\n')
    assert.ok(m.includes('`{if true}` ouvert ligne 3 n\'a pas de'), m)
  })

  it('des blancs mêlés en tête (espaces, tabulation) : seules les lignes comptent', async () => {
    const m = await erreur('  \n\t\n   \n<p>a</p>\n{if true}x\n')
    assert.ok(m.includes('`{if true}` ouvert ligne 5 n\'a pas de'), m)
  })

  it('des lignes vides AVANT un <script> : la ligne du fichier, comme sans lignes vides', async () => {
    const m = await erreur('\n\n<script>\n$x = 1\n</script>\n<p>a</p>\n{if true}x\n')
    assert.ok(m.includes('`{if true}` ouvert ligne 7 n\'a pas de'), m)
    const sans = await erreur('<script>\n$x = 1\n</script>\n<p>a</p>\n{if true}x\n')
    assert.ok(sans.includes('`{if true}` ouvert ligne 5 n\'a pas de'), sans)
  })

  it('l\'avertissement du parseur et celui du générateur d\'un même fichier citent des lignes cohérentes', async () => {
    const vus = await avertissements('\n\n\n<button disabled="false">ok</button>\n{if true}x{end}{end}\n')
    assert.match(vus, /parseur-ligne \(ligne 4\) : <button disabled="false">/, vus)
    assert.ok(vus.includes('`{end}` ligne 5 : aucun bloc ouvrant'), vus)
  })

  it('en anglais : « line » à la place de « ligne », même numéro', async () => {
    setMessagesLang('en')
    try {
      assert.ok((await erreur('\n\n\n<p>a</p>\n{if true}x\n')).includes('`{if true}` opened at line 5 has no matching'))
      assert.ok((await avertissements('\n\n\n<p>a</p>\n{if true}x{end}{end}\n')).includes('`{end}` line 5: no opening block'))
      assert.ok((await avertissements('\n\n\n<p>a</p>\n<div>\n<span>\na\n</div>\n')).includes('<span> opened line 6 is not closed by </span>: </div> found line 8 instead'))
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('les nœuds de l\'arbre portent la ligne du fichier : parse() avec firstLine', () => {
    const racine = parse('<p>a</p>\n{if $x}\n  <b>{$y}</b>\n{end}\ntexte', [], { firstLine: 10 })
    const p      = racine.children.find(n => n.type === 'tag')!
    const si     = racine.children.find(n => n.type === 'if')!
    const texte  = racine.children.filter(n => n.type === 'text').pop()!
    const b      = si.branches[0].children.find(n => n.type === 'tag')!
    assert.equal(p.line, 10)
    assert.equal(si.line, 11)
    assert.equal(b.line, 12)
    assert.equal(b.children[0].line, 12)
    assert.equal(texte.line, 14)
  })

  it('parse() sans firstLine : les lignes du HTML reçu, rogné en tête', () => {
    const racine = parse('\n\n<p>a</p>\n{if $x}b{end}')
    assert.equal(racine.children.find(n => n.type === 'tag')!.line, 1)
    assert.equal(racine.children.find(n => n.type === 'if')!.line, 2)
  })

  it('une erreur du générateur qui cite la ligne d\'un nœud du parseur : celle du fichier', async () => {
    const m = await erreur('\n\n\n<p>a</p>\n{for i in $l}{await $p}{success d}{d}{end}{end}\n')
    assert.ok(m.includes('{await} (ligne 5)'), m)
    const sans = await erreur('<p>a</p>\n{for i in $l}{await $p}{success d}{d}{end}{end}\n')
    assert.ok(sans.includes('{await} (ligne 2)'), sans)
  })

  it('la faute d\'un effet porte la ligne du fichier sur l\'erreur (mjsLine)', async () => {
    let erreurEffet: any = null
    try { await transpile('\n\n\n<p>a</p>\n<p *titre>x</p>\n', { moduleName: 'parseur-ligne' }) } catch (e) { erreurEffet = e }
    assert.ok(erreurEffet, 'la compilation devait échouer')
    assert.equal(erreurEffet.mjsLine ?? erreurEffet.cause?.mjsLine, 5)
  })
})
