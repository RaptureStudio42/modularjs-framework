<script>
KIND_LABELS := { module: ⟪theme.kind-module⟫, theme: ⟪theme.kind-theme⟫, framework: ⟪theme.kind-framework⟫, stylesheet: ⟪theme.kind-stylesheet⟫ }
ORDRE_KIND  := { theme: 0, module: 1, stylesheet: 2, framework: 3 }

formatKind = (k) -> KIND_LABELS[k] ?? k

COLOR_RE := new RegExp('^#|^rgb\\(|^hsl\\(|^oklch\\(|^color\\(', 'i')

looksLikeColor = (v) -> COLOR_RE.test(v)

MOTIFS := {
  introuvable:        ⟪theme.motif-introuvable⟫
  ambigu:             ⟪theme.motif-ambigu⟫
  inchange:           ⟪theme.motif-inchange⟫
  'hors-projet':      ⟪theme.motif-hors-projet⟫
  'racine-inconnue':  ⟪theme.motif-racine-inconnue⟫
  'valeur-refusee':   ⟪theme.motif-valeur-refusee⟫
  'nom-refuse':       ⟪theme.motif-nom-refuse⟫
  'fichier-manquant': ⟪theme.motif-fichier-manquant⟫
}

LANGUE := ⟪#langue⟫

COMPTES := {
  source: [⟪theme.compte-source-1⟫, ⟪theme.compte-source-n⟫]
  variable: [⟪theme.compte-variable-1⟫, ⟪theme.compte-variable-n⟫]
  declaration: [⟪theme.compte-declaration-1⟫, ⟪theme.compte-declaration-n⟫]
  defaut: [⟪theme.compte-defaut-1⟫, ⟪theme.compte-defaut-n⟫]
  posee: [⟪theme.compte-posee-1⟫, ⟪theme.compte-posee-n⟫]
  lue: [⟪theme.compte-lue-1⟫, ⟪theme.compte-lue-n⟫]
  direct: [⟪theme.compte-direct-1⟫, ⟪theme.compte-direct-n⟫]
  retablir: [⟪theme.compte-retablir-1⟫, ⟪theme.compte-retablir-n⟫]
  lecteur: [⟪theme.compte-lecteur-1⟫, ⟪theme.compte-lecteur-n⟫]
}

pluriel = (n) -> LANGUE == 'en' ? n != 1 : n > 1

compte = (n, cle) -> COMPTES[cle][pluriel(n) ? 1 : 0].replace('{n}', String(n))

$vars     = []
$query    = ''
$kind     = 'all'
$expanded = {}
$live     = false
$clients  = 0
$edits    = {}
$write    = false
$etats    = {}
$ouverts  = {}

versHex = (v) ->
  s := (v ?? '').trim()
  court := s.match(/^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/)
  return '#' + court[1] + court[1] + court[2] + court[2] + court[3] + court[3] if court
  long := s.match(/^#([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?$/)
  return '#' + long[1].toLowerCase() if long
  canaux := s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  return '' unless canaux
  '#' + [1, 2, 3].map((i) -> Math.min(255, +canaux[i]).toString(16).padStart(2, '0')).join('')

envoyer = (name, value) ->
  fetch('/__mjs/theme/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vars: { [name]: value } }) }).then((r) -> r.json()).then((d) -> $clients = d.clients).catch((err) -> µ.error(err))

cmp = (x, y) -> x < y ? -1 : x > y ? 1 : 0

ecrivable = (d) -> d.kind != 'framework' and not d.read and not d.set

cleSource = (d) -> [d.kind, d.declaredBy, d.file, d.variant ?? '', d.set ? 'posee' : d.read ? 'lue' : ''].join('::')

rangGroupe = (g) -> g.posee ? 2 : g.lue ? 1 : 0

grouper = (vars) ->
  index := new Map()
  vars.forEach (themeVar) ->
    themeVar.declarations.forEach (d, rang) ->
      cle := cleSource(d)
      groupe := index.get(cle) ?? { cle, kind: d.kind, declaredBy: d.declaredBy, file: d.file, variant: d.variant ?? '', lue: !!d.read and not d.set, posee: !!d.set, lignes: [] }
      groupe.lignes.push({ cle: cle + '::' + themeVar.name + '::' + rang, name: themeVar.name, decl: d, readBy: themeVar.readBy, autres: themeVar.declarations.filter((x) -> x != d and not x.read) })
      index.set(cle, groupe)
  [...index.values()].sort((a, b) -> ((ORDRE_KIND[a.kind] ?? 9) - (ORDRE_KIND[b.kind] ?? 9)) or cmp(a.declaredBy, b.declaredBy) or cmp(a.variant, b.variant) or cmp(a.file, b.file) or (rangGroupe(a) - rangGroupe(b)))

retient = (ligne, q) -> not q or ligne.name.toLowerCase().includes(q) or ligne.decl.declaredBy.toLowerCase().includes(q) or ligne.readBy.some((r) -> r.toLowerCase().includes(q))

enregistrer = (ligne) ->
  return unless ecrivable(ligne.decl)
  corps := { name: ligne.name, value: $edits[ligne.name], file: ligne.decl.file, line: ligne.decl.line }
  fetch('/__mjs/theme/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }).then((r) -> r.json()).then((res) -> $etats[ligne.cle] = { ok: res.written, texte: if res.written then ⟪theme.ecrit-dans⟫ + ' ' + res.file + ':' + res.line else (MOTIFS[res.reason] ?? res.reason) }).catch((err) -> µ.error(err))

modifier = (ligne, value) ->
  $edits[ligne.name] = value
  envoyer(ligne.name, value)

valider = (ligne) ->
  enregistrer(ligne) if $write

retablir = (ligne) ->
  delete $edits[ligne.name]
  delete $etats[ligne.cle]
  envoyer(ligne.name, '')

retablirTout = ->
  Object.keys($edits).forEach((name) -> envoyer(name, ''))
  $edits = {}
  $etats = {}

resetFermeture = ->
  return unless $live and Object.keys($edits).length > 0
  vars := {}
  Object.keys($edits).forEach((name) -> vars[name] = '')
  navigator.sendBeacon('/__mjs/theme/edit', new Blob([JSON.stringify({ vars })], { type: 'application/json' }))

refresh = ->
  fetch('/__mjs/theme.json').then((r) -> r.json()).then((data) -> $vars = Object.keys(data ?? {}).sort().map((name) -> ({ name, declarations: data[name].declarations, readBy: data[name].readBy }))).catch((err) -> µ.error(err))

etatDirect = ->
  fetch('/__mjs/theme/edit').then((r) -> r.json()).then((d) -> $live = d.live; $clients = d.clients).catch(-> $live = false)

toggle = (cle) ->
  $expanded[cle] = not $expanded[cle]

toggleKey = (e, cle) ->
  return unless e.key is 'Enter' or e.key is ' '
  e.preventDefault()
  toggle(cle)

basculer = (g) ->
  $ouverts[g.cle] = not g.ouvert

$groupes = grouper($vars)
$filtres = $groupes.filter((g) -> $kind == 'all' or g.kind == $kind).map((g) -> ({ ...g, ouvert: $ouverts[g.cle] ?? (not g.posee or $query.trim() != ''), lignes: g.lignes.filter((l) -> retient(l, $query.trim().toLowerCase())) })).filter((g) -> g.lignes.length > 0)

$countRead   = $vars.filter((themeVar) -> themeVar.readBy.length > 0).length
$countDecl   = $vars.reduce((n, themeVar) -> n + themeVar.declarations.filter((d) -> not d.read and not d.set).length, 0)
$countLues   = $vars.reduce((n, themeVar) -> n + themeVar.declarations.filter((d) -> d.read and not d.set).length, 0)
$countPosees = $vars.filter((themeVar) -> themeVar.declarations.some((d) -> d.set)).length

$nbEdits = Object.keys($edits).length

µmount ->
  refresh()
  etatDirect()
</script>

<@window @pagehide={resetFermeture()}>

<div class="atelier">
  <div class="barre">
    <h1>⟪theme.titre⟫</h1>
    <div class="stats">
      <span class="stat">{compte($groupes.length, 'source')}</span>
      <span class="stat">{compte($vars.length, 'variable')}</span>
      <span class="stat">{compte($countDecl, 'declaration')}</span>
      <span class="stat">{compte($countLues, 'defaut')}</span>
      {if $countPosees > 0}<span class="stat">{compte($countPosees, 'posee')}</span>{end}
      <span class="stat">{compte($countRead, 'lue')}</span>
    </div>
  </div>

  <div class="direct">
    {if $live}
      <span class="temoin"></span>
      <span class="etat">{compte($clients, 'direct')}</span>
      <label class="bascule">
        <input type="checkbox" checked=!{$write}>
        <span>⟪theme.enregistrer⟫</span>
      </label>
      {if $write}
        <span class="precision ecrit">⟪theme.precision-ecrit⟫</span>
      {else}
        <span class="precision">⟪theme.precision-apercu⟫</span>
      {end}
    {else}
      <span class="temoin hors"></span>
      <span class="etat hors">⟪theme.lecture-seule-direct⟫</span>
    {end}
    {if $nbEdits > 0}
      <button class="retablir-tout" @click={retablirTout()}>{compte($nbEdits, 'retablir')}</button>
    {end}
  </div>

  {if $vars.length == 0}
    <p class="vide">⟪theme.vide⟫</p>
  {else}
    <div class="controles">
      <input class="recherche" type="text" aria-label="⟪theme.recherche-label⟫" placeholder="⟪theme.recherche-placeholder⟫" value=!{$query}>
      <div class="filtres">
        <button @class{$kind == 'all'}="actif" @click={$kind = 'all'}>⟪theme.filtre-tous⟫</button>
        <button @class{$kind == 'theme'}="actif" @click={$kind = 'theme'}>⟪theme.filtre-themes⟫</button>
        <button @class{$kind == 'module'}="actif" @click={$kind = 'module'}>⟪theme.filtre-modules⟫</button>
        <button @class{$kind == 'stylesheet'}="actif" @click={$kind = 'stylesheet'}>⟪theme.filtre-feuilles⟫</button>
        <button @class{$kind == 'framework'}="actif" @click={$kind = 'framework'}>⟪theme.filtre-framework⟫</button>
      </div>
    </div>

    {if $filtres.length == 0}
      <p class="vide">⟪theme.aucune⟫</p>
    {else}
      <div class="groupes">
        {for g in $filtres by cle}
          <section class="groupe">
            <header class="tete">
              <span class="badge badge-{g.kind}">{formatKind(g.kind)}</span>
              <span class="source">{g.declaredBy}</span>
              {if g.variant}<span class="variante">⟪theme.variante⟫ {g.variant}</span>{end}
              {if g.lue}<span class="variante">⟪theme.badge-defauts⟫</span>{end}
              {if g.posee}<span class="variante">⟪theme.badge-posees⟫</span>{end}
              <span class="emplacement">{g.file}</span>
              {if not ecrivable(g.lignes[0].decl)}<span class="lecture-seule">⟪theme.badge-lecture-seule⟫</span>{end}
              <span class="compte">{compte(g.lignes.length, 'variable')}</span>
              {if g.posee}<button class="plier" aria-label="⟪theme.plier⟫ {g.declaredBy}" aria-expanded="{g.ouvert}" @click={basculer(g)}>{if g.ouvert}▾{else}▸{end}</button>{end}
            </header>
            {if g.ouvert}
            <div class="liste">
              {for l in g.lignes by cle}
                <div class="variable" role="button" tabindex="0" @click={toggle(l.cle)} @keydown={toggleKey(e, l.cle)}>
                  {const courante = $edits[l.name] ?? l.decl.value}
                  {const hex = $live and not l.decl.set ? versHex(courante) : ''}
                  <div class="ligne">
                    {if hex}
                      <input class="pastille vive" type="color" aria-label="⟪theme.couleur-de⟫ {l.name}" value={hex} @click.stop={} @input.stop={modifier(l, e.target.value)} @change.stop={valider(l)}>
                    {else}
                      {if looksLikeColor(courante)}<span class="pastille" @style.background={courante}></span>{end}
                    {end}
                    <span class="nom">{l.name}</span>
                    <span class="valeur">{courante}</span>
                    {if $edits[l.name]}
                      <span class="valeur source-valeur">⟪theme.source⟫ {l.decl.value}</span>
                      <button class="retablir" aria-label="⟪theme.retablir-nom⟫ {l.name}" @click.stop={retablir(l)}>⟪theme.retablir⟫</button>
                    {end}
                    {if $etats[l.cle]}
                      <span class="ecriture" @class{$etats[l.cle].ok == false}="rate">{$etats[l.cle].texte}</span>
                    {end}
                    <span class="emplacement">{if l.decl.read}⟪theme.par-defaut⟫{elsif l.decl.line > 0}⟪theme.ligne⟫ {l.decl.line}{else}⟪theme.ligne-inconnue⟫{end}</span>
                    {if l.autres.length > 0 and not l.decl.read}
                      <span class="ailleurs">+{l.autres.length} ⟪theme.ailleurs⟫</span>
                    {end}
                    <span class="lecteurs">{compte(l.readBy.length, 'lecteur')}</span>
                  </div>
                  {if $expanded[l.cle]}
                    <div class="detail">
                      {if l.decl.doc}<p class="doc">{l.decl.doc}</p>{end}
                      {if l.decl.set}
                        <p class="doc">{l.decl.declaredBy} ⟪theme.doc-posee⟫</p>
                      {elsif l.decl.read}
                        <p class="doc">{l.decl.declaredBy} ⟪theme.doc-lue⟫</p>
                      {end}
                      {if $write}
                        {if l.decl.set}
                          <p class="cible">⟪theme.cible-posee⟫</p>
                        {elsif l.decl.read}
                          <p class="cible">⟪theme.cible-defaut⟫</p>
                        {elsif ecrivable(l.decl)}
                          <p class="cible">⟪theme.cible-vers⟫ {l.decl.file}{if l.decl.line > 0}:{l.decl.line}{else} — ⟪theme.cible-ligne-cherchee⟫{end}</p>
                        {else}
                          <p class="cible">⟪theme.cible-framework⟫</p>
                        {end}
                      {end}
                      {if l.autres.length > 0}
                        {if l.decl.read}
                          <p class="cascade">⟪theme.cascade-lue⟫</p>
                        {else}
                          <p class="cascade">⟪theme.cascade-ailleurs⟫</p>
                        {end}
                        <div class="declarations">
                          {for d in l.autres}
                            <div class="declaration">
                              <span class="badge badge-{d.kind}">{formatKind(d.kind)}</span>
                              <span class="declarant">{d.declaredBy}</span>
                              {if d.variant}<span class="variante">⟪theme.variante⟫ {d.variant}</span>{end}
                              <span class="valeur">{d.value}</span>
                              <span class="emplacement">{d.file}:{d.line}</span>
                            </div>
                          {end}
                        </div>
                      {end}
                      {if l.readBy.length == 0}
                        <p class="sans-lecteur">⟪theme.sans-lecteur⟫</p>
                      {else}
                        <div class="lecteurs-liste">
                          <span class="titre-lecteurs">⟪theme.lu-par⟫</span>
                          {for r in l.readBy}
                            <span class="lecteur">{r}</span>
                          {end}
                        </div>
                      {end}
                    </div>
                  {end}
                </div>
              {end}
            </div>
            {end}
          </section>
        {end}
      </div>
    {end}
  {end}
</div>

<style>
  .atelier
    display: block
    background: #14171f
    color: #e4e6ec
    font: 14px/1.5 system-ui, sans-serif
    min-height: 100vh
    padding: 1.5rem
    box-sizing: border-box
  .barre
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 1rem
    margin-bottom: 1.25rem
  h1
    font-size: 1.1rem
    margin: 0
    margin-right: auto
    color: #f4f4f5
  .stats
    display: flex
    gap: 1rem
    color: #8a8f9c
    font-size: 0.85rem
  .vide
    color: #8a8f9c
  .controles
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 0.75rem
    margin-bottom: 1.25rem
  .recherche
    flex: 1
    min-width: 240px
    background: #1b1f29
    color: #e4e6ec
    border: 1px solid #363c4c
    border-radius: 6px
    padding: 0.45rem 0.7rem
    font: inherit
    &:focus
      outline: none
      border-color: #3a6df0
  .filtres
    display: flex
    flex-wrap: wrap
    gap: 0.4rem
  button
    background: #232733
    color: #e4e6ec
    border: 1px solid #363c4c
    border-radius: 6px
    padding: 0.4rem 0.8rem
    cursor: pointer
    font: inherit
    &:hover
      background: #2c3140
  button.actif
    background: #3a6df0
    border-color: #3a6df0
    color: #fff
  .groupes
    display: flex
    flex-direction: column
    gap: 0.9rem
  .groupe
    background: #171b24
    border: 1px solid #2a2f3c
    border-radius: 8px
    overflow: hidden
  .tete
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 0.6rem
    padding: 0.55rem 0.8rem
    background: #1f2430
    border-bottom: 1px solid #2a2f3c
  .source
    font-family: ui-monospace, monospace
    font-weight: 600
    color: #f4f4f5
  .compte
    margin-left: auto
    color: #6b7280
    font-size: 0.75rem
    white-space: nowrap
  .plier
    background: none
    border: none
    color: #8a8f9c
    padding: 0 0.3rem
    font-size: 0.9rem
  .lecture-seule
    color: #c07a2a
    font-size: 0.75rem
  .liste
    display: flex
    flex-direction: column
    gap: 0.3rem
    padding: 0.5rem
  .variable
    background: #1b1f29
    border: 1px solid #2a2f3c
    border-radius: 6px
    padding: 0.5rem 0.7rem
    cursor: pointer
    &:hover
      border-color: #3a6df0
  .ligne
    display: flex
    align-items: center
    gap: 0.6rem
  .pastille
    display: inline-block
    width: 12px
    height: 12px
    border-radius: 50%
    border: 1px solid rgba(255, 255, 255, 0.3)
    flex-shrink: 0
  input.pastille.vive
    width: 18px
    height: 18px
    padding: 0
    cursor: pointer
    background: none
    &::-webkit-color-swatch-wrapper
      padding: 0
    &::-webkit-color-swatch
      border: none
      border-radius: 50%
    &::-moz-color-swatch
      border: none
      border-radius: 50%
  .direct
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 0.6rem
    margin-bottom: 1.25rem
    padding: 0.5rem 0.8rem
    background: #1b1f29
    border: 1px solid #2a2f3c
    border-radius: 8px
  .temoin
    width: 8px
    height: 8px
    border-radius: 50%
    background: #3fb950
    flex-shrink: 0
  .temoin.hors
    background: #6b7280
  .etat
    color: #e4e6ec
    font-size: 0.85rem
  .etat.hors
    color: #8a8f9c
  .precision
    color: #6b7280
    font-size: 0.8rem
  .precision.ecrit
    color: #d8b34a
  .bascule
    display: inline-flex
    align-items: center
    gap: 0.35rem
    color: #e4e6ec
    font-size: 0.8rem
    cursor: pointer
    user-select: none
  .bascule input
    accent-color: #3fb950
    cursor: pointer
  .retablir-tout
    margin-left: auto
    font-size: 0.8rem
    padding: 0.3rem 0.6rem
  .retablir
    font-size: 0.7rem
    padding: 0.05rem 0.4rem
    border-radius: 4px
    flex-shrink: 0
  .ecriture
    color: #3fb950
    font-size: 0.75rem
    font-family: ui-monospace, monospace
  .ecriture.rate
    color: #e5714d
  .nom
    font-family: ui-monospace, monospace
    font-weight: 600
  .valeur
    color: #a9afbc
    font-family: ui-monospace, monospace
    font-size: 0.85rem
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
  .source-valeur
    color: #6b7280
    font-size: 0.75rem
  .badge
    font-size: 0.7rem
    text-transform: uppercase
    letter-spacing: 0.04em
    padding: 0.1rem 0.45rem
    border-radius: 4px
    background: #363c4c
    flex-shrink: 0
  .badge-module
    background: #3a6df0
  .badge-theme
    background: #8a5ff0
  .badge-framework
    background: #c07a2a
  .badge-stylesheet
    background: #2a6f5f
  .declarant
    color: #8a8f9c
    font-size: 0.8rem
  .ailleurs
    color: #d8b34a
    font-size: 0.75rem
    white-space: nowrap
  .lecteurs
    margin-left: auto
    color: #6b7280
    font-size: 0.75rem
    white-space: nowrap
  .detail
    margin-top: 0.6rem
    padding-top: 0.6rem
    border-top: 1px solid #2a2f3c
  .cascade
    margin: 0 0 0.5rem
    color: #d8b34a
    font-size: 0.8rem
  .cible
    margin: 0 0 0.5rem
    color: #8a8f9c
    font-size: 0.8rem
    font-family: ui-monospace, monospace
  .declarations
    display: flex
    flex-direction: column
    gap: 0.4rem
  .declaration
    display: flex
    flex-wrap: wrap
    align-items: baseline
    gap: 0.5rem
    padding: 0.4rem 0.5rem
    background: #0d0f14
    border-radius: 6px
  .variante
    color: #6b7280
    font-size: 0.75rem
    font-style: italic
  .emplacement
    color: #6b7280
    font-size: 0.75rem
    font-family: ui-monospace, monospace
  .doc
    margin: 0 0 0.5rem
    color: #8a8f9c
    font-size: 0.8rem
  .sans-lecteur
    margin: 0.5rem 0 0
    color: #6b7280
    font-size: 0.8rem
  .lecteurs-liste
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 0.4rem
    margin-top: 0.5rem
  .titre-lecteurs
    color: #6b7280
    font-size: 0.75rem
  .lecteur
    background: #232733
    border-radius: 4px
    padding: 0.1rem 0.5rem
    font-size: 0.8rem
    font-family: ui-monospace, monospace
</style>
