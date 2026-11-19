// Le lecteur unique (src/reader) lit un fichier .mjs en un seul arbre : le gabarit et les sections par lui-même,
// chaque morceau de code (script, expression, gestionnaire) par le vrai Civet puis par acorn. Aucun compilateur
// ne l'emploie encore ; ces tests gardent sa lecture des pièges où les lecteurs faits main se trompent (bannières
// `######`, chaîne sur plusieurs lignes, regex d'un appel sans parenthèses, balise ou partiel cité en commentaire,
// balise raccourci jamais refermée), des écritures de MJS que Civet ne connaît pas (`§x`, `@@x`, `#x`, `&id`,
// `=:`, `@import` dans un script, valeur `{{…}}`) et des cas réels de chaînes, regex et bannières déjà corrigés
// dans le compilateur (composant, module `.civet`, fichier `*.server.mjs`).

import assert from 'node:assert/strict'
import { readFile, traverse, type File, type Node } from '../src/reader/index.js'

const S = (lignes: string[]): string => lignes.join('\n') + '\n'

// tous les textes du code (chaînes, regex, gabarits, commentaires), dans l'ordre du fichier
function textes(f: File, sorte?: string): string[] {
  return f.codes.flatMap((c) => c.texts).filter((t) => !sorte || t.kind === sorte).sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).map((t) => t.value)
}

function noms(f: File): string[] {
  return [...new Set(f.codes.flatMap((c) => c.names.map((n) => n.name)))].sort()
}

function noeuds(f: File, sorte: string): Node[] {
  const out: Node[] = []
  traverse(f, (n) => { if (n.kind === sorte) out.push(n) })
  return out
}

function sansFaute(f: File): void {
  assert.deepEqual(f.diagnostics.map((d) => d.position + ' ' + d.message), [], 'lu sans faute')
}

describe('lecteur unique : pièges des lecteurs faits main', function () {
  this.timeout(60000)

  it('une bannière de six dièses reste un commentaire, son titre n\'est pas du code', () => {
    const f = readFile(S(['<div>{$n}</div>', '<script>', '###### Réglages ######', '$n = 1', '</script>']), { file: 'd1.mjs' })
    sansFaute(f)
    assert.ok(textes(f, 'comment').some((t) => t.includes('Réglages')), 'le titre est dans un commentaire')
    assert.deepEqual(noms(f), ['$n'])
    assert.equal(textes(f, 'string').length, 0)
  })

  it('une chaîne sur deux lignes dont la seconde commence par # reste une seule chaîne', () => {
    const f = readFile(S(['<div>{$msg}</div>', '<script>', '$msg = \'prix en euros', '# deuxième ligne\'', '</script>']), { file: 'd2.mjs' })
    sansFaute(f)
    assert.deepEqual(textes(f, 'string'), ['prix en euros\n# deuxième ligne'])
    assert.deepEqual(textes(f, 'comment'), [])
  })

  it('regex d\'un appel sans parenthèses puis commentaire : chaîne, regex, chaîne, commentaire', () => {
    const f = readFile(S(['<div>{$t}</div>', '<script>', '$t = \'l\\\'eau\'.replace /\'/g, \'-\'  # retire l\'apostrophe', '</script>']), { file: 'd3.mjs' })
    sansFaute(f)
    assert.deepEqual(textes(f), ['l\'eau', '\'', '-', ' retire l\'apostrophe'])
  })

  it('une balise du cœur citée dans un commentaire du script n\'est ni une balise ni du code', () => {
    const f = readFile(S(['<div>{$n}</div>', '<script>', '# à remplacer un jour par <@@chart>', '$n = 1', '</script>']), { file: 'd4.mjs' })
    sansFaute(f)
    assert.ok(textes(f, 'comment').some((t) => t.includes('<@@chart>')))
    assert.equal(f.codes.flatMap((c) => c.texts).filter((t) => t.kind !== 'comment' && t.value.includes('@@chart')).length, 0, 'aucune chaîne du code ne la nomme')
    assert.equal(noeuds(f, 'tag').filter((b) => (b as { name: string }).name === '@@chart').length, 0, 'aucune balise <@@chart>')
  })

  it('un module du cœur cité en commentaire par un autre (bloc ###, commentaire #, commentaire HTML) n\'est cité nulle part en code', () => {
    const f = readFile(S([
      '<!-- la liste déroulante s\'appuie sur <@@field> -->',
      '<div class="boite"><slot></slot></div>',
      '<script>',
      '  ###',
      '  ancien rendu : <@@field label="x"> puis <@@option>',
      '  ###',
      '  # le bouton reprend <@@gauge> et <mjs-core-number>',
      '  $ouvert = false',
      '</script>',
    ]), { file: 'd5.mjs' })
    sansFaute(f)
    const balises = noeuds(f, 'tag').map((b) => (b as { name: string }).name)
    assert.deepEqual(balises, ['div', 'slot'])
    const enCode = f.codes.flatMap((c) => c.texts).filter((t) => t.kind !== 'comment').map((t) => t.value)
    assert.deepEqual(enCode, [])
    assert.equal(textes(f, 'comment').filter((t) => /@@field|@@gauge|mjs-core-number/.test(t)).length, 2)
    assert.equal(noeuds(f, 'htmlComment').length, 1)
  })

  it('un partiel cité dans un commentaire HTML est un commentaire, jamais une balise <@include>', () => {
    const f = readFile(S(['<!-- ancien : <@include partiel-absent> -->', '<div>{$n}</div>', '<script>', '$n = 1', '</script>']), { file: 'd6.mjs' })
    sansFaute(f)
    const c = noeuds(f, 'htmlComment')
    assert.equal(c.length, 1)
    assert.equal(f.source.slice(c[0].start, c[0].end), '<!-- ancien : <@include partiel-absent> -->')
    assert.equal(noeuds(f, 'tag').filter((b) => (b as { name: string }).name === '@include').length, 0)
  })

  it('un dièse collé à une lettre (#TODO) reste du code, comme aujourd\'hui : un nom, à sa place', () => {
    const src = S(['<div>{$n}</div>', '<script>', '#TODO revoir', '$n = 1', '</script>'])
    const f = readFile(src, { file: 'd7.mjs' })
    sansFaute(f)
    assert.deepEqual(textes(f, 'comment'), [])
    const todo = f.codes.flatMap((c) => c.names).find((n) => n.name === '#TODO')
    assert.ok(todo, '#TODO lu comme un nom')
    assert.equal(todo.start, src.indexOf('#TODO'))
  })

  it('du vrai code qui ressemble à un commentaire reste du code (adresse, regex, chaîne interpolée, ### dans une chaîne)', () => {
    const f = readFile(S([
      '<p>{$u}{$h}</p>',
      '<script>',
      '  $u = \'https://exemple.fr/#ancre\'',
      '  $re = /#\\d+/',
      '  $n = 1',
      '  $h = "<@@chart> n°#{$n} // pas un commentaire"',
      '  $c = \'### pas un bloc\'',
      '  $d = 2',
      '</script>',
    ]), { file: 'd8.mjs' })
    sansFaute(f)
    assert.deepEqual(textes(f, 'comment'), [])
    assert.deepEqual(textes(f, 'string'), ['https://exemple.fr/#ancre', '### pas un bloc'])
    assert.deepEqual(textes(f, 'regex'), ['#\\d+'])
    assert.ok(textes(f, 'template').some((t) => t.includes('<@@chart>')), 'la balise citée dans une chaîne du code est lue comme du code')
    assert.deepEqual(noms(f), ['$c', '$d', '$h', '$n', '$re', '$u'])
  })

  it('une balise raccourci jamais refermée est vide : son contenu revient au parent, en une seule lecture', () => {
    const f = readFile(S([
      '<div class="a"><@carte titre="x">texte de la carte</div>',
      '<p>la balise @carte s\'écrit &lt;@carte&gt;, sans </p>',
      '{if $ok}<@bulle>dedans{else}dehors{end}',
      '<@note>gardé</@note>',
      '<script>', '$ok = true', '</script>',
    ]), { file: 'd9.mjs' })
    sansFaute(f)
    const balises = noeuds(f, 'tag') as (Node & { nom: string, vide?: boolean, enfants: Node[] })[]
    const carte   = balises.find((b) => b.name === '@carte')
    const bulle   = balises.find((b) => b.name === '@bulle')
    const note    = balises.find((b) => b.name === '@note')
    assert.ok(carte?.empty && carte.children.length === 0, '<@carte> rendue vide')
    assert.ok(bulle?.empty && bulle.children.length === 0, '<@bulle> rendue vide avant {else}')
    assert.ok(note && !note.empty && note.children.length === 1, '<@note> refermée garde son contenu')
    const div = balises.find((b) => b.name === 'div')
    assert.deepEqual(div.children.map((n) => n.kind), ['tag', 'text'], 'le texte de la carte revient à la div, après la carte')
    assert.equal(f.source.slice(div.start, div.end), '<div class="a"><@carte titre="x">texte de la carte</div>')
  })
})

describe('lecteur unique : écritures de MJS que Civet ne connaît pas', function () {
  this.timeout(60000)

  it('§x, @@x, #x, &id et =: sont lus comme des noms, rendus dans leur écriture, à leur place', () => {
    const src = S(['<p>{$total}</p>', '<script>', '  $id = &id', '  $total =: §§prix + §taxe', '  @@aide = -> #champ', '</script>'])
    const f = readFile(src, { file: 'ecritures.mjs' })
    sansFaute(f)
    const lus = f.codes.flatMap((c) => c.names)
    for (const nom of ['&id', '$total', '§§prix', '§taxe', '@@aide', '#champ', '$id']) {
      const n = lus.find((x) => x.name === nom)
      assert.ok(n, nom + ' lu')
      assert.ok(src.startsWith(nom, n.start), nom + ' à sa place (' + n.start + ')')
    }
  })

  it('@import dans un script est une directive à sa place ; ses chaînes restent des chaînes', () => {
    const src = S(['<script>', '  @import µ$$panier, \'./magasin.civet.mjs\'', '  @persist $theme', '  $n = 1', '</script>', '<p>{$n}</p>'])
    const f = readFile(src, { file: 'directives.mjs' })
    sansFaute(f)
    const d = f.codes.flatMap((c) => c.directives)
    assert.deepEqual(d.map((x) => x.name), ['@import', '@persist'])
    assert.equal(d[0].start, src.indexOf('@import'))
    assert.deepEqual(textes(f, 'string'), ['./magasin.civet.mjs'])
  })

  it('une directive de racine est un nœud Directive ; @import dans <style> reste du CSS', () => {
    const src = S(['@import µ$$panier from \'./magasin.civet.mjs\'', '@display block', '<style>', '@import url(\'a.css\');', '</style>', '<p>x</p>'])
    const f = readFile(src, { file: 'racine.mjs' })
    sansFaute(f)
    assert.deepEqual(noeuds(f, 'directive').map((d) => (d as { name: string }).name), ['@import', '@display'])
    assert.equal(noeuds(f, 'style').length, 1)
  })

  it('valeur d\'attribut {{…}} : HTML calculé, lu comme du code', () => {
    const f = readFile(S(['<div html={{ $contenu }}></div>', '<div title="a {$t} b" @click={ $n += 1 } *fade(0.3s) :class{actif}={$ok} {...$reste}></div>', '<script>', '$contenu = \'<b>x</b>\'', '$t = 1', '$n = 0', '$ok = true', '$reste = {}', '</script>']), { file: 'attributs.mjs' })
    sansFaute(f)
    const div = noeuds(f, 'tag') as (Node & { attributs: { sorte: string, nom?: string, valeur?: string, code?: { mode: string } }[] })[]
    assert.deepEqual(div[0].attrs.map((a) => [a.kind, a.name, a.value]), [['attribute', 'html', 'raw']])
    assert.ok(div[0].attrs[0].code, 'le {{…}} est lu par Civet')
    assert.deepEqual(div[1].attrs.map((a) => a.kind), ['attribute', 'gesture', 'effect', 'class', 'spread'])
    assert.equal(div[1].attrs[1].code.mode, 'handler')
    assert.deepEqual(noms(f), ['$contenu', '$n', '$ok', '$reste', '$t'])
  })

  it('blocs du gabarit : {if}/{elsif}/{else}, {for … by clé}, {await … *skeleton}, {? disposition}, {const}', () => {
    const f = readFile(S([
      '{if $a}a{elsif $b}b{else}c{end}',
      '{for x, i in $liste by x.id}<li>{x.nom}</li>{end}',
      '{await $promesse *skeleton(3)}attente{success}ok{error}raté{end}',
      '{? barre}<nav></nav>{end}',
      '{const total = $a + $b}',
      '<script>', '$a = 1', '$b = 2', '$liste = []', '$promesse = null', '</script>',
    ]), { file: 'blocs.mjs' })
    sansFaute(f)
    const blocs = noeuds(f, 'block') as (Node & { name: string, disposition?: string, branches?: { kind: string }[] })[]
    assert.deepEqual(blocs.map((b) => b.name), ['if', 'for', 'await', 'if', 'const'])
    assert.deepEqual(blocs[0].branches.map((b) => b.kind), ['then', 'elsif', 'else'])
    assert.deepEqual(blocs[2].branches.map((b) => b.kind), ['then', 'success', 'error'])
    assert.equal(blocs[3].disposition, 'barre')
    assert.deepEqual(noms(f), ['$a', '$b', '$liste', '$promesse'])
  })
})

describe('lecteur unique : chaînes, regex et bannières des cas réels déjà corrigés dans le compilateur', function () {
  this.timeout(60000)

  const CAS: { nom: string, fichier: string, src: string, textes?: string[], chaines?: string[], commentaires?: number, avec?: string[], sans?: string[], options?: { langue?: string } }[] = [
    { nom: 'regex en appel implicite (apostrophe) puis commentaire #', fichier: 'a1.mjs', src: S(['<script>', '  $s = "l\'a"', '  $r = $s.replace /\'/g, "-"', '  # commentaire', '  $n = 1', '  @plus = -> $n++', '  $t = \'fin\'', '</script>', '<p>{$r}</p>']), textes: ['l\'a', '\'', '-', ' commentaire', 'fin'], avec: ['$n', '$r', '$s', '$t'] },
    { nom: 'regex en appel implicite (guillemet) puis commentaire #', fichier: 'a2.mjs', src: S(['<script>', '  $s = \'a"b\'', '  $r = $s.replace /"/g, \'-\'', '  # commentaire', '  $n = 1', '  $t = "fin"', '</script>']), textes: ['a"b', '"', '-', ' commentaire', 'fin'] },
    { nom: 'gabarit imbriqué qui porte une apostrophe', fichier: 'a3.mjs', src: S(['<script>', '  $liste = [\'a\', \'b\']', '  $html = `<ul>${ $liste.map((x) -> `<li>l\'${x}</li>`).join(\'\') }</ul>`', '  # commentaire', '  $n = 1', '</script>']), commentaires: 1, avec: ['$html', '$liste', '$n'] },
    { nom: 'heregex sur plusieurs lignes qui porte une apostrophe', fichier: 'a4.mjs', src: S(['<script>', '  re = ///', '    ^[\'"]', '    \\w+', '  ///', '  # commentaire', '  $n = 1', '  $ok = re.test("\'abc")', '</script>']), commentaires: 1, avec: ['$n', '$ok'] },
    { nom: 'regex en tête de ligne', fichier: 'a5.mjs', src: S(['<script>', '  $s = "l\'a"', '  $x = 1', '  /\'/.test($s)', '  # commentaire', '  $n = 1', '</script>']), textes: ['l\'a', '\'', ' commentaire'], avec: ['$n', '$s', '$x'] },
    { nom: 'apostrophe dans un bloc ### et une bannière', fichier: 'a6.mjs', src: S(['<script>', '  ### l\'ancien code', '  $vieux = 1', '  ###', '  #### l\'en-tête ####', '  $n = 1', '</script>']), commentaires: 2, avec: ['$n'], sans: ['$vieux'] },
    { nom: 'apostrophe dans un commentaire //', fichier: 'a7.mjs', src: S(['<script>', '  $n = 1 // l\'appel', '  $t = \'fin\'', '</script>']), textes: [' l\'appel', 'fin'] },
    { nom: 'gestionnaires en ligne : regex en appel implicite puis autre gestionnaire', fichier: 'a8.mjs', src: S(['<script>', '  $v = "l\'a"', '  $n = 1', '</script>', '<button @click={ $v = $v.replace /\'/g, \'\' }>a</button>', '<button @click={ for x in [1, 2] then $n += x }>c</button>', '<button @click={ $v = \'fin\' }>d</button>']), textes: ['l\'a', '\'', '', 'fin'], avec: ['$n', '$v'] },
    { nom: 'module .civet : regex en appel implicite puis commentaire #', fichier: 'outil.civet.mjs', src: S(['export nettoie := (s) -> s.replace /\'/g, \'-\'', '# commentaire', 'export texte := \'fin\'']), textes: ['\'', '-', ' commentaire', 'fin'] },
    { nom: '#### referme un bloc ###', fichier: 'b1.mjs', src: S(['<script>', '  ###', '  $cache = 1', '  ####', '  $n = 1', '</script>']), commentaires: 2, avec: ['$n'], sans: ['$cache'] },
    { nom: 'bannière en fin de ligne après du code, ##### seul', fichier: 'b2.mjs', src: S(['<script>', '  $n = 1 ####', '  #####', '  $t = \'fin\' ##### fin', '</script>']), commentaires: 3, avec: ['$n', '$t'] },
    { nom: '### en fin de script', fichier: 'b3.mjs', src: S(['<script>', '  $n = 1', '  $t = \'fin\'', '  ###', '</script>']), avec: ['$n', '$t'] },
    { nom: '#### note #### en ligne : tout le reste de la ligne est un commentaire', fichier: 'b4.mjs', src: S(['<script>', '  $a = 1 #### note #### + 1', '  $t = \'fin\'', '</script>']), commentaires: 1, avec: ['$a', '$t'] },
    { nom: 'coffee : #### referme un bloc ###', fichier: 'b5.mjs', src: S(['<script lang="coffee">', '###', '$cache = 1', '####', '$n = 1', '@plus = -> $n += 1', '</script>']), commentaires: 2, avec: ['$n'], sans: ['$cache'] },
    { nom: 'module .civet : #### referme un bloc ###', fichier: 'fab.civet.mjs', src: S(['###', 'export fab := -> 1', '####', 'export fab := -> \'FAB\'']), chaines: ['FAB'], commentaires: 2 },
    { nom: 'µ$x = en tête de la suite d\'une chaîne', fichier: 'c1.mjs', src: S(['<script>', '  $doc = \'exemple :', 'µ$x = 5', 'fin\'', '</script>']), textes: ['exemple :\nµ$x = 5\nfin'], avec: ['$doc'], sans: ['µ$x'] },
    { nom: 'coffee : $n dans le texte d\'une chaîne sur deux lignes', fichier: 'c2.mjs', src: S(['<script lang="coffee">', '$n = 1', '$p = \'prix $n', 'suite\'', '</script>']), textes: ['prix $n\nsuite'], avec: ['$n', '$p'] },
    { nom: 'interpolation #{ } ouverte sur une ligne, refermée sur la suivante', fichier: 'c3.mjs', src: S(['<script>', '  $n = 1', '  $g = "a #{', '    $n', '  } b"', '</script>']), avec: ['$g', '$n'] },
    { nom: 'µ$$X écrit dans la suite d\'une chaîne', fichier: 'c4.mjs', src: S(['<script>', '  $doc = \'exemple :', 'lire µ$$Boite.a', 'fin\'', '</script>']), textes: ['exemple :\nlire µ$$Boite.a\nfin'], sans: ['µ$$Boite'] },
    { nom: 'export µ$$X = dans la suite d\'une chaîne d\'un module', fichier: 'c5.civet.mjs', src: S(['export texte := \'exemple :', 'export µ$$Boite = 1', 'fin\'']), textes: ['exemple :\nexport µ$$Boite = 1\nfin'], sans: ['µ$$Boite'] },
    { nom: '*.server.mjs : #### referme un bloc ###, regex en appel implicite', fichier: 'calc.server.mjs', src: S(['###', 'export un := -> 0', '####', 'export un := -> 1', 'export nettoie := -> "l\'a".replace /\'/g, \'-\'', '# commentaire', 'export texte := -> \'fin\'']), chaines: ['l\'a', '-', 'fin'], commentaires: 3 },
    { nom: 'µ$n = 0 #### fin : la bannière est un commentaire', fichier: 'e3.mjs', src: S(['<script>', 'µ$n = 0 #### fin', '</script>']), commentaires: 1, avec: ['µ$n'] },
    { nom: 'bannières, chaînes sur plusieurs lignes et interpolation dans un même composant', fichier: 'essai.mjs', src: S(['<script>', '  ####', '  $n = 1', '  @plus = -> $n += 1', '  ####', '  $h = \'<p>', '# TEXTE_A </p>\'', '  $g = "<b>#{$n}', '# TEXTE_B #{$n}</b>"', '  $p = \'prix $n', 'suite TEXTE_C\'', '  #### fin ####', '  $z = 2', '</script>', '<p>{$n} {$h} {$g} {$p} {$z}</p>', '<button @click={@plus}>+</button>']), commentaires: 3, avec: ['$g', '$h', '$n', '$p', '$z'] },
  ]

  // `####` qui referme un bloc `###` : Civet y lit la fin du bloc, puis un commentaire de ligne vide (deux commentaires)
  for (const c of CAS) {
    it(c.nom, () => {
      const f = readFile(c.src, { file: c.fichier, ...c.options })
      sansFaute(f)
      if (c.textes) assert.deepEqual(textes(f).filter((t) => t !== '' || c.textes.includes('')), c.textes)
      if (c.chaines) assert.deepEqual(textes(f, 'string'), c.chaines)
      if (c.commentaires !== undefined) assert.equal(textes(f, 'comment').length, c.commentaires, 'commentaires : ' + JSON.stringify(textes(f, 'comment')))
      for (const nom of c.avec ?? []) assert.ok(noms(f).includes(nom), nom + ' lu comme du code')
      for (const nom of c.sans ?? []) assert.ok(!noms(f).includes(nom), nom + ' jamais lu comme du code')
      if (/TEXTE_/.test(c.src)) {
        assert.ok(textes(f, 'string').some((t) => t.includes('# TEXTE_A')), 'TEXTE_A reste dans sa chaîne')
        assert.ok(textes(f, 'template').some((t) => t.includes('# TEXTE_B')), 'TEXTE_B reste dans sa chaîne interpolée')
        assert.ok(textes(f, 'string').some((t) => t === 'prix $n\nsuite TEXTE_C'), 'prix $n reste du texte')
      }
    })
  }
})
