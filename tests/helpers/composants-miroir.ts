// les composants des tests du miroir vivant (`µclone el, mirror: true`) : une carte (compteur, dérivés, prop, saisie liée, liste, objet profond,
// enfant à état propre, µmount et reffet qui notent leur instance et `@@isMirror`, une liste remplie par son script, au premier niveau), l'enfant à
// état propre, le composant Civet qui pose les miroirs par la rune, ceux en CoffeeScript et en JavaScript qui les demandent

export const SOURCES_MIROIR: Record<string, string> = {
  'carte.mjs': [
    '<script>',
    '  $n = 0',
    '  $titre = \'sans titre\'',
    '  $texte = \'\'',
    '  $items = [{ nom: \'a\' }]',
    '  $profond = { a: { b: 1 } }',
    '  $remplie = []',
    '  $remplie.push 1',
    '  $remplie.push 2',
    '  $double = $n * 2',
    '  $noms = $items.map((x) -> x.nom).join(\',\')',
    '  @@uid = window.__uid = (window.__uid or 0) + 1',
    '  @ajouter = (nom) -> $items.push({ nom: nom })',
    '  @creuser = -> $profond.a.b++',
    '  @renommer = (t) -> $titre = t',
    '  @remplacer = -> $items = [{ nom: \'z\' }]',
    '',
    '  µmount ->',
    '    window.__monte.push [@@uid, @@isMirror]',
    '',
    '  µeffect ->',
    '    window.__vus.push "#{@@uid}:#{$n}"',
    '</script>',
    '<p class="n">{$n}</p>',
    '<p class="double">{$double}</p>',
    '<p class="titre">{$titre}</p>',
    '<p class="texte">{$texte}</p>',
    '<p class="noms">{$noms}</p>',
    '<p class="profond">{$profond.a.b}</p>',
    '<p class="remplie">{$remplie.join(\',\')}</p>',
    '<input class="saisie" aria-label="saisie" value=!{$texte}>',
    '<button class="plus" @click={$n++}>+</button>',
    '<@compteur base={$n}></@compteur>',
    '<slot></slot>',
    ''
  ].join('\n'),
  'compteur.mjs': [
    '<script>',
    '  $base = 0',
    '  $propre = 0',
    '</script>',
    '<p class="base">{$base}</p>',
    '<p class="propre">{$propre}</p>',
    '<button class="propre-plus" @click={$propre++}>+</button>',
    ''
  ].join('\n'),
  'liste.mjs': [
    '<script>',
    '  $t = \'Bonjour\'',
    '  @miroir = (el) -> µclone el, mirror: true',
    '  @titrer = (v) -> $t = v',
    '</script>',
    '<@carte titre={$t}><span class="glisse">glissé</span></@carte>',
    '<div class="zone"></div>',
    ''
  ].join('\n'),
  'cofmiroir.mjs': [
    '<script lang="coffee">',
    '  @miroir = (el) -> µclone el, mirror: true',
    '</script>',
    '<p class="c">c</p>',
    ''
  ].join('\n'),
  'jsmiroir.mjs': [
    '<script lang="js">',
    '  this.miroir = (el) => µ.clone(el, { mirror: true });',
    '</script>',
    '<p class="j">j</p>',
    ''
  ].join('\n')
}
