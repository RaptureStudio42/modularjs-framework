<script module>
  # les repères `@@` (script `# @@`, gabarit `<!-- @@ -->`, style `// @@`) cernent ce qui ne sert qu'à la barre d'outils (`toolbar`) : la construction
  # les ôte quand aucune balise de l'application n'écrit `toolbar`, en développement comme en production, au serveur comme au navigateur ; la copie dans
  # un projet garde tout (les repères y sont des commentaires), ils ne partent jamais dans le code envoyé. `toolbar` : le morceau propre à la barre ;
  # `!toolbar` : l'autre forme d'une ligne qui existe avec et sans barre, écrite en commentaire ; `dev toolbar` : l'avertissement du développement,
  # gardé quand aucune page n'écrit `toolbar`
  # les formes et leur famille : les graphiques à axes (courbe, aire, points, barres, barres empilées, histogramme) partagent le cadre, les
  # graduations, le curseur, la bulle et le tableau des valeurs ; l'anneau, la carte d'intensité, le radar et le calendrier ont chacun leur
  # dessin, à côté de celui des axes
  SHAPES = { line: 'axes', area: 'axes', dots: 'axes', bar: 'axes', stack: 'axes', histogram: 'axes', pie: 'pie', heatmap: 'heat', radar: 'radar', calendar: 'calendar' }

  # les statistiques tracées sur chaque série visible, calculées sur ce qui est affiché ; chacune a son style de trait (`.stat-<nom>`)
  STATS = {
    mean:   { label: 'chartMean' }
    median: { label: 'chartMedian' }
    q1:     { label: 'chartQ1' }
    q3:     { label: 'chartQ3' }
    trend:  { label: 'chartTrend' }
  }

  # l'en-tête de la première colonne du tableau des valeurs, selon l'axe x (une période quand les lignes sont regroupées)
  HEADS = {
    date:     { label: 'chartDate' }
    datetime: { label: 'chartTime' }
    number:   { label: 'chartNumber' }
    category: { label: 'chartCategory' }
    period:   { label: 'chartPeriod' }
  }

  AXES = ['date', 'datetime', 'number', 'category']

  # les formes qui tracent des statistiques, celles qui tracent aussi la tendance (dites dans l'erreur) : rien sur des barres empilées, un
  # anneau, une carte, un radar ou un calendrier, pas de tendance sur un histogramme ; un calendrier se compte par jour, par semaine ou par
  # mois, sur des dates
  STATS_SHAPES = ['line', 'area', 'dots', 'bar', 'histogram']
  TREND_SHAPES = ['line', 'area', 'dots', 'bar']
  CAL_STEPS    = ['auto', 'day', 'week', 'month']
  CAL_AXES     = ['date', 'datetime']

  # @@ toolbar
  # la barre d'outils (`toolbar`), dans l'ordre où elle les pose : la légende des séries, le menu des formes, les statistiques, le pas de temps
  TOOLKIT = ['legend', 'shapes', 'stats', 'step']

  # les formes du menu, dans l'ordre du module : leur nom et le dessin de leur icône, un tracé de 16 × 16 (aucune police d'icônes)
  FORMS = {
    line:      { label: 'chartLine',      d: 'M1.5 12L5.5 7.5L9 10L14.5 3.5' }
    area:      { label: 'chartArea',      d: 'M1.5 14V11L5.5 6.5L9 9L14.5 3.5V14Z' }
    dots:      { label: 'chartDots',      d: 'M3 12h.01M6.5 7h.01M10 9.5h.01M13 4h.01' }
    bar:       { label: 'chartBar',       d: 'M3 14V8M8 14V3M13 14V10' }
    stack:     { label: 'chartStack',     d: 'M3 14V10M3 8.5V6M8 14V8M8 6.5V3M13 14V11M13 9.5V7' }
    histogram: { label: 'chartHistogram', d: 'M2.5 14V9M6 14V4.5M9.5 14V6.5M13 14V11' }
    pie:       { label: 'chartPie',       d: 'M8 2.5A5.5 5.5 0 1 1 2.5 8M2.5 6.5A5.5 5.5 0 0 1 6.5 2.5' }
    heatmap:   { label: 'chartHeatmap',   d: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z' }
    radar:     { label: 'chartRadar',     d: 'M8 1.5L14.5 6.2L12 13.8H4L1.5 6.2ZM8 5.5L10.6 7.4L9.6 10.4H6.4L5.4 7.4Z' }
    calendar:  { label: 'chartCalendar',  d: 'M2 3.5h12V14H2zM2 6.5h12M5 1.5v3M11 1.5v3' }
  }

  # les pas du temps, dans l'ordre de la couche de calcul (`C.STEPS`) : leur nom
  PACES = {
    auto:  { label: 'chartAuto' }
    day:   { label: 'chartDay' }
    week:  { label: 'chartWeek' }
    month: { label: 'chartMonth' }
    year:  { label: 'chartYear' }
  }
  # @@

  # les six teintes du thème (variables `$$chart-1` à `$$chart-6`), aussi par leur nom : `color: 'green'` vaut `color: 3`
  HUES = { blue: 1, orange: 2, green: 3, pink: 4, violet: 5, gold: 6 }

  # une couleur de l'auteur part telle quelle (`#c0392b`, `rgb(…)`, `var(--ma-teinte)`, `oklch(from var(--marque) calc(l * 0.8) c h)`…) tant
  # qu'elle ne peut rien écrire d'autre qu'une valeur : ni « ; », ni « : », ni guillemet, ni accolade, ni « < » ou « > », ni « \ », ni « /* », ni url(…)
  SAFE_COLOR = /^(?![\s\S]*(?:url\s*\(|\/\*))[^;:\x22\x27\x60\{\}<>\\]+$/i

  # au-delà de 40 lignes, les courbes et les aires perdent leurs points ; la forme « points » les garde
  DOTS_MAX = 40

  # l'écart entre le curseur et la bulle, entre le menu des formes et le bord de l'écran, en px
  GAP = 10

  # un radar lisible : 24 axes au plus, ceux des 24 dernières lignes ; jusqu'à 8 axes, chaque branche porte son nom, au-delà les quatre pôles
  # seulement (cf. `polesOf`)
  RADAR_MAX   = 24
  RADAR_NAMES = 8

  # le calendrier, par pas, en unités du dessin : la case (`w` × `h`), l'écart d'une colonne à la suivante (`pitch`), la gouttière des jours
  # (`left`) ; l'en-tête des mois prend 16 unités
  CAL = {
    day:   { w: 12, h: 12, pitch: 15, left: 30 }
    week:  { w: 12, h: 36, pitch: 15, left: 0 }
    month: { w: 29.5, h: 36, pitch: 32.5, left: 0 }
  }

  DAY = /^\d{4}-\d{2}-\d{2}$/

  C       = µ._mjs_chart
  faulted = new Set()
  shares  = {}

  # les zones IANA déjà vérifiées (cf. `zoneOf`)
  zonesSeen = {}

  tr   = (key, lang)-> µ._mjs_label('core', key) ?? ''
  # la langue de l'écran, celle des libellés du cœur (la langue choisie par la page, sinon celle du document) : nombres, dates et périodes s'y écrivent
  langOf = (l)-> (if typeof µ._mjs_labelLang is 'function' then µ._mjs_labelLang() else l) or l or undefined
  has  = (table, k)-> Object.prototype.hasOwnProperty.call(table, k)
  flag = (v)-> v? and v isnt false and String(v).toLowerCase() isnt 'false'
  pct  = (f)-> Math.round(f * 1e6) / 1e4
  px   = (v)-> Math.round(v * 100) / 100

  # une faute ne se dit qu'une fois par page : vrai la première fois que `id` se présente
  unsaid = (id)-> not faulted.has(id) and faulted.add(id)

  # les fautes de l'auteur venues d'une variable (écrites en dur, elles arrêtent la construction) : une erreur, une fois, puis la valeur par
  # défaut, pour que la page reste lisible. Un mot inconnu de `shape`, `stats`, `step`, `axis`, `toolbar` ou `shapes` (une faute de frappe,
  # un mot qui n'est pas anglais) est ignoré. Ces contrôles visent les valeurs du programmeur : ce qu'entraîne un choix fait dans la barre
  # d'outils se tait (`quiet`, cf. `ours`)
  misfit = (prop, word, list)->
    µ.error(µ._mjs_msg('coreChartWord', { word: word, prop: prop, list: list.join(' ') }, '<@@chart> : « {word} » n\'est pas une valeur connue de {prop}, elle est ignorée — valeurs connues : {list}.')) if unsaid(prop + '|' + word)

  # un radar de moins de 3 lignes (il en faut une par axe) devient une courbe : des lignes venues d'une variable sont une donnée, pas une faute
  # (écrites en dur, elles arrêtent la construction) — un avertissement du développement
  radarFit = (form, base, quiet)->
    return form unless form is 'radar' and base.length > 0 and base.length < 3
    µ.warn(µ._mjs_msg('coreChartRadar', { n: base.length }, '<@@chart> : un radar demande au moins 3 lignes, une par axe ; il en reçoit {n}, une courbe le remplace.')) if not quiet and unsaid('radar|' + base.length)
    'line'

  # les statistiques que la forme trace (cf. `STATS_SHAPES`, `TREND_SHAPES`) ; les autres sont une faute du programmeur, dite une fois et
  # ignorée
  statsFit = (marks, form, quiet)->
    wrong = marks.filter((m)-> not STATS_SHAPES.includes(form) or (m is 'trend' and not TREND_SHAPES.includes(form)))
    return marks unless wrong.length
    µ.error(µ._mjs_msg('coreChartNoStats', { shape: form, word: wrong.join(' '), list: STATS_SHAPES.join(' '), trend: TREND_SHAPES.join(' ') }, '<@@chart> : la forme {shape} ne trace pas stats « {word} », il est ignoré — formes qui tracent des statistiques : {list} ; trend : {trend}.')) if not quiet and unsaid('stats|' + form + '|' + wrong.join(' '))
    marks.filter((m)-> not wrong.includes(m))

  # un calendrier se compte par jour, par semaine ou par mois, sur des dates : un pas d'un an revient au pas automatique, un autre axe à
  # celui que font deviner les abscisses (`fallback`)
  calendarFit = (prop, word, list, fallback, quiet)->
    return word if list.includes(word)
    µ.error(µ._mjs_msg('coreChartMix', { prop: prop, word: word, shape: 'calendar', list: list.join(' ') }, '<@@chart> : {prop} « {word} » ne va pas avec la forme {shape}, il est ignoré — valeurs possibles : {list}.')) if not quiet and unsaid(prop + '|calendar|' + word)
    fallback

  # vrai quand la prop vaut ce que la barre d'outils y a écrit (`picks`) : un choix de l'utilisateur, pas une valeur du programmeur
  ours = (picks, k, v)-> has(picks, k) and (picks[k] is v or (Array.isArray(v) and Array.isArray(picks[k]) and JSON.stringify(v) is JSON.stringify(picks[k]))) # @@ toolbar
  # ours = -> false # @@ !toolbar

  # @@ toolbar
  # une liste écrite par la barre garde la forme de celle qu'elle remplace : un texte reste un texte (« mean trend »), sinon un tableau
  sameAs = (old, list)-> if typeof old is 'string' then list.join(' ') else list
  # @@

  # une liste écrite en texte (« mean trend ») ou en tableau (['mean', 'trend'])
  wordsOf = (v)->
    return v.filter((w)-> w? and w isnt '').map(String) if Array.isArray(v)
    if typeof v is 'string' then v.split(/[\s,]+/).filter(Boolean) else []

  # un mot écrit se lit sans ses espaces (`shape=" pie "`), comme à la construction
  bare = (v)-> if v? then String(v).trim() else ''

  # le fuseau des heures (`timezone`) : vide, l'heure telle qu'elle est écrite, son fuseau ignoré ; `local`, l'heure de l'écran du visiteur ;
  # sinon une zone IANA qu'Intl connaît (`Europe/Paris`, `UTC`), gardée une fois vérifiée (`zonesSeen`). Une zone inconnue est une faute (cf.
  # `misfit`) : l'heure reste celle qui est écrite
  zoneOf = (v)->
    w = bare(v)
    return w if w is '' or w is 'local' or zonesSeen[w]
    try
      new Intl.DateTimeFormat('en', { timeZone: w })
      zonesSeen[w] = true
      return w
    catch e
      µ.error(µ._mjs_msg('coreChartZone', { zone: w }, '<@@chart> : « {zone} » n\'est pas un fuseau connu, il est ignoré — écrivez local ou le nom d\'une zone IANA (Europe/Paris, UTC…) ; sans fuseau, les heures s\'affichent telles qu\'elles sont écrites.')) if unsaid('zone|' + w)
    ''

  # la précision (`decimals`) : un entier de 0 à 10, le nombre de chiffres après la virgule de chaque mesure écrite ; sans valeur, l'écriture
  # automatique. Une autre valeur est une faute (cf. `misfit`) : l'écriture reste automatique
  placesOf = (v)->
    w = bare(v)
    return null if w is ''
    n = if typeof v is 'number' then v else (if /^\d+$/.test(w) then Number(w) else NaN)
    return n if Number.isInteger(n) and n >= 0 and n <= 10
    µ.error(µ._mjs_msg('coreChartDecimals', { value: w }, '<@@chart> : decimals « {value} » est ignoré — écrivez un nombre entier de 0 à 10 ; sans decimals, les nombres gardent leur écriture automatique.')) if unsaid('decimals|' + w)
    null

  shapeOf = (v)->
    w = bare(v)
    return 'line' if w is ''
    return w if has(SHAPES, w)
    misfit('shape', w, Object.keys(SHAPES))
    'line'

  statsOf = (v)->
    out = []
    for w in wordsOf(v)
      if has(STATS, w)
        out.push(w) unless out.includes(w)
      else
        misfit('stats', w, Object.keys(STATS))
    out

  stepOf = (v)->
    w = bare(v)
    return 'auto' if w is ''
    return w if C.STEPS.includes(w)
    misfit('step', w, C.STEPS)
    'auto'

  # @@ toolbar
  # les outils de la barre (`toolbar="legend shapes stats step"`) ; un mot inconnu est une faute (cf. `misfit`)
  toolsOf = (v)->
    out = {}
    for w in wordsOf(v)
      if TOOLKIT.includes(w) then out[w] = true else misfit('toolbar', w, TOOLKIT)
    out

  # les formes que le menu propose (`shapes="line bar pie"`) ; un mot inconnu est une faute ; sans mot connu, toutes les formes
  shapesOf = (v)->
    out = []
    for w in wordsOf(v)
      if has(SHAPES, w) then out.push(w) else misfit('shapes', w, Object.keys(SHAPES))
    out
  # @@

  # le type de l'axe x : celui qu'écrit l'auteur, sinon deviné sur les abscisses (des jours AAAA-MM-JJ, des instants — ISO 8601, Time#to_s de
  # Ruby ou RFC 2822, lus par la couche de calcul pareil dans tous les moteurs —, des nombres, sinon des libellés)
  axisOf = (v, rows)->
    w = bare(v)
    if w isnt ''
      return w if AXES.includes(w)
      misfit('axis', w, AXES)
    xs = rows.map((r)-> r.x).filter((x)-> x? and x isnt '')
    return 'category' unless xs.length
    return 'date' if xs.every((x)-> DAY.test(String(x)))
    return 'datetime' if xs.every((x)-> C.parseX('datetime', x) isnt null)
    return 'number' if xs.every((x)-> C.parseX('number', x) isnt null)
    'category'

  # une ligne de données : ses mesures rangées dans `readings` (comme les envoie un serveur) ou écrites à plat, à côté de `x` et `id` (le
  # module en fait alors une ligne à lui, `made`)
  rowsOf = (list)->
    return [] unless Array.isArray(list)
    list.filter((r)-> r? and typeof r is 'object').map((r)-> if r.readings? and typeof r.readings is 'object' then r else { id: r.id, x: r.x, readings: r, made: true })

  # la teinte d'une série : un numéro (un entier de 1 ou plus ; au-delà de 6, on reprend au début) ou un nom de teinte du thème, sinon une couleur CSS ; sans couleur, les
  # séries prennent les teintes dans l'ordre, comme une couleur refusée (une faute, cf. `misfit`). `hue` : le numéro de la teinte, 0 pour une
  # couleur de l'auteur (rangée dans `custom`). Une couleur que le navigateur ne sait pas lire (`'bleu'`) est refusée de même : elle ne
  # colorerait rien
  toneOf = (color, i, key)->
    c = if color? then String(color).trim() else ''
    c = String((i % 6) + 1) if c is ''
    c = String(HUES[c.toLowerCase()]) if has(HUES, c.toLowerCase())
    return { hue: ((Number(c) - 1) % 6) + 1, custom: null } if /^\d+$/.test(c) and Number(c) > 0
    return { hue: 0, custom: c } if readable(c)
    µ.error(µ._mjs_msg('coreChartColor', { color: c, key: key, hue: (i % 6) + 1, list: Object.keys(HUES).join(' ') }, '<@@chart> : la couleur « {color} » de la série « {key} » est refusée, la série prend la teinte {hue} — écrivez un nom de teinte ({list}), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \\ », « /* » ni url(…).')) if unsaid('color|' + key + '|' + c)
    { hue: (i % 6) + 1, custom: null }

  # une couleur sûre (cf. `SAFE_COLOR`) que le navigateur sait lire (`CSS.supports`) ; sans lui (rendu serveur), le filtre seul. Un nombre,
  # en toute écriture (0, 1.5, -2, 1e-7), ou un mot qui commence par un chiffre (0x10, 12px) n'est jamais une couleur : rien ne commence
  # par un chiffre, « . », « + » ou un « - » sans lettre derrière (`-webkit-link` reste au navigateur) ; même règle à la construction
  # (`unknownColor`, src/bundler/core-chart.ts), refusé au serveur comme au navigateur
  readable = (c)-> SAFE_COLOR.test(c) and not /^[\d.+]|^-(?![a-z])/i.test(c) and (typeof CSS is 'undefined' or typeof CSS.supports isnt 'function' or CSS.supports('color', c))

  seriesOf = (list)->
    return [] unless Array.isArray(list)
    list.filter((s)-> s? and s.key? and s.key isnt '').map (s, i)->
      tone = toneOf(s.color, i, String(s.key))
      { key: String(s.key), name: (if s.name? and s.name isnt '' then String(s.name) else String(s.key)), unit: (if s.unit? then String(s.unit) else ''), kind: (if s.kind is 'text' then 'text' else 'number'), hue: tone.hue, custom: tone.custom }

  tonesOf = (list)->
    out = {}
    for s in list
      out[s.key] = s
    out

  boundsOf = (v)->
    return {} unless Array.isArray(v)
    { min: C.number(v[0]), max: C.number(v[1]) }

  # les lignes d'un axe d'instants, chaque heure ramenée à celle qu'elle affiche (cf. `dataOf`) : une ligne du module change sur place, une
  # ligne de l'auteur est recopiée, jamais touchée ; la couche de calcul garde les heures déjà ramenées, le survol ne les refait pas
  wallRows = (base, zone)->
    base.forEach (r, i)->
      if r.made then r.x = C.wallTime(r.x, zone) else base[i] = { id: r.id, x: C.wallTime(r.x, zone), readings: r.readings, count: r.count }
    base

  # une abscisse écrite pour l'écran : la période d'une ligne regroupée, sinon l'abscisse dans la langue de l'écran ; `short` pour l'axe ; une
  # heure déjà ramenée à celle qu'elle affiche se lit en UTC (`group.utc`, cf. `dataOf`)
  xText = (group, period, row, short, lang)->
    if group.grouped then C.formatPeriod(period, row.x, lang, short) else C.formatX(group.kind, row.x, lang, short, group.utc)

  # une mesure écrite pour l'écran, avec son unité ; `places` : son nombre de chiffres après la virgule (`decimals`), sinon l'écriture automatique
  valueText = (v, unit, lang, places)->
    return '—' unless v?
    C.formatNumber(v, lang, undefined, places) + (if unit then ' ' + unit else '')

  # une part du total écrite pour l'écran (48 %), dans la langue de l'écran
  shareText = (share, lang)->
    shares[lang or ''] = new Intl.NumberFormat(lang or undefined, { style: 'percent', maximumFractionDigits: 1 }) unless shares[lang or '']
    shares[lang or ''].format(share)

  # l'unité commune des séries visibles, vide quand elles diffèrent : celle du total des barres empilées
  unitOf = (lines)-> if lines.length and lines.every((l)-> l.unit is lines[0].unit) then lines[0].unit else ''

  # les unités des séries de nombres visibles qui ont une valeur (« — » pour une série sans unité) : plusieurs sur une même échelle (barres
  # empilées, carte par série, radar), c'est une limite des données, pas une faute — un avertissement du développement
  unitsOf = (rows, list, masked)->
    out = []
    for s in list
      u = s.unit or '—'
      out.push(u) if s.kind isnt 'text' and not masked.includes(s.key) and not out.includes(u) and rows.some((r)-> C.reading(r, s.key) isnt null)
    out

  wordOf = (row, key)->
    w = row.readings?.[key]
    if w? and w isnt '' then String(w) else '—'

  linesOf = (model, tones)->
    model.lines.map((l)-> Object.assign({}, l, { hue: tones[l.key].hue, custom: tones[l.key].custom }))

  ticksOf = (model, lang, places)->
    s = model.scale
    return [] unless s
    s.ticks.map((t)-> { v: t, y: pct(1 - C.ratio(t, s.min, s.max)), text: C.axisNumber(t, lang, places) })

  # la gouttière des graduations, en px : la plus longue graduation, mesurée dans leur police une fois le tracé mesuré (`width`), estimée
  # avant comme au serveur (6,5 px par signe), plus l'écart au tracé (8 px) et 4 px d'air ; au-dessus de 48 px seulement, sinon rien
  # (la feuille garde 48 px, aucun style n'est écrit dans la page servie)
  gutterOf = (ticks, width, measure)->
    w = Math.ceil(ticks.reduce(((m, t)-> Math.max(m, (if width > 0 then measure(t.text) else String(t.text).length * 6.5))), 0)) + 12
    if w > 48 then w else null

  # les étiquettes de l'axe x : entières, sans chevauchement à la largeur mesurée du tracé ; la première part du bord gauche, la dernière finit au bord droit
  labelsOf = (fractions, texts, width, measure)->
    return [] unless texts.length
    last  = texts.length - 1
    picks = C.labelPicks(fractions, texts, (if width > 0 then { width: width, measure: measure } else {}))
    picks.map((i)-> { i: i, x: pct(fractions[i]), text: texts[i], anchor: (if last is 0 then 'middle' else if i is 0 then 'start' else if i is last then 'end' else 'middle') })

  dotsOf = (lines, form, count)->
    return [] unless form is 'dots' or ((form is 'line' or form is 'area') and count <= DOTS_MAX)
    out = []
    for l in lines
      for p in l.points
        out.push({ id: l.key + '|' + p.i, hue: l.hue, custom: l.custom, x: pct(p.x), y: pct(p.y) }) if p
    out

  barsOf = (model, tones)->
    model.bars.map((b)-> { id: b.key + '|' + b.i, i: b.i, hue: tones[b.key].hue, custom: tones[b.key].custom, x: px(b.left * C.WIDE), y: px(b.top * C.HIGH), w: px(b.width * C.WIDE), h: px(b.height * C.HIGH) })

  # `plain` : les traits prennent la couleur du texte (sur les barres d'un histogramme, la teinte de sa série ne se verrait pas)
  statLinesOf = (lines, marks, plain)->
    out = []
    for l in lines
      for name in marks
        out.push({ id: l.key + '|' + name, name: name, hue: (if plain then 0 else l.hue), custom: (if plain then null else l.custom), d: l.marks[name].d }) if name isnt 'trend' and l.marks[name]
    out

  trendsOf = (lines)->
    lines.filter((l)-> l.trend).map((l)-> { key: l.key, hue: l.hue, custom: l.custom, d: l.trend.d, x: pct(l.trend.to.x), y: pct(l.trend.to.y) })

  legendOf = (marks, lang)->
    marks.map((name)-> { name: name, text: (if name is 'trend' then tr('chartTrend', lang) + ' (' + tr('chartNext', lang) + ')' else tr(STATS[name].label, lang)) })

  # la bulle d'une colonne : son abscisse (la semaine, la moyenne de combien de lignes après un regroupement), une ligne par série visible, les
  # séries de mots comprises tant que rien n'est regroupé (un mot ne se moyenne pas), et les points de la colonne à allumer
  tipOf = (at, data, unit, lang)->
    return sliceTip(at, data, lang) if data.form is 'pie'
    return binTip(at, data, lang) if data.form is 'histogram'
    return heatTip(at, data, lang) if data.family is 'heat'
    return radarTip(at, data, lang) if data.family is 'radar'
    return calendarTip(at, data, lang) if data.family is 'calendar'
    row = data.rows[at]
    return null unless at >= 0 and row
    group = data.group
    title = xText(group, data.period, row, false, lang)
    if group.grouped and data.period is 'week'
      title = tr('chartWeekOf', lang).replace('{date}', title)
    else if unit
      title += ' ' + unit
    words  = if group.grouped then [] else data.list.filter((s)-> s.kind is 'text' and not data.masked.includes(s.key))
    values = data.lines.map((l)-> { key: l.key, hue: l.hue, custom: l.custom, name: l.name, word: false, text: valueText(l.points[at]?.value, l.unit, lang, data.places) })
    values.push({ key: '#total', hue: 0, custom: null, name: tr('chartTotal', lang), word: false, total: true, text: valueText(data.model.totals[at], unitOf(data.lines), lang, data.places) }) if data.form is 'stack'
    {
      at: data.model.fractions[at]
      x: pct(data.model.fractions[at])
      title: title
      grouped: (if row.count > 1 then tr('chartGrouped', lang).replace('{n}', C.formatNumber(row.count, lang)) else '')
      rows: values.concat(words.map((s)-> { key: s.key, hue: s.hue, custom: s.custom, name: s.name, word: true, text: wordOf(row, s.key) }))
      marks: (if data.model.slots then [] else data.lines.filter((l)-> l.points[at]).map((l)-> { key: l.key, hue: l.hue, custom: l.custom, x: pct(l.points[at].x), y: pct(l.points[at].y) }))
    }

  columnsOf = (list, masked, grouped)->
    list.filter((s)-> not masked.includes(s.key) and not (grouped and s.kind is 'text')).map((s)-> { key: s.key, kind: s.kind, unit: s.unit, title: (if s.unit then s.name + ' (' + s.unit + ')' else s.name) })

  cellsOf = (rows, columns, group, period, lang, places)->
    rows.map (r, i)->
      { k: i, x: xText(group, period, r, false, lang), values: columns.map((c)-> { key: c.key, text: (if c.kind is 'text' then wordOf(r, c.key) else valueText(C.reading(r, c.key), c.unit, lang, places)) }) }

  # le tableau des valeurs affichées, lu par les lecteurs d'écran : une colonne par série visible (et le total des barres empilées), une ligne
  # par abscisse ; une ligne par classe pour un histogramme, par part pour un anneau, par case à relevés pour une carte jour × heure ou un
  # calendrier
  tableOf = (data, lang)->
    return pieTable(data, lang) if data.form is 'pie'
    return binTable(data, lang) if data.form is 'histogram'
    return heatTable(data, lang) if data.family is 'heat' and data.model.time
    return calendarTable(data, lang) if data.family is 'calendar'
    columns = columnsOf(data.list, data.masked, data.group.grouped)
    cells   = cellsOf(data.rows, columns, data.group, data.period, lang, data.places)
    if data.form is 'stack'
      unit    = unitOf(data.lines)
      columns = columns.concat([{ key: '#total', title: tr('chartTotal', lang) + (if unit then ' (' + unit + ')' else '') }])
      cells.forEach((c, i)-> c.values.push({ key: '#total', text: valueText(data.model.totals[i], unit, lang, data.places) }))
    { head: tr(HEADS[(if data.group.grouped then 'period' else data.group.kind)].label, lang), columns: columns, cells: cells }

  # des barres empilées : une case par ligne (ou par période), les séries visibles posées l'une sur l'autre, l'échelle sur le plus haut total ;
  # `lines` garde la valeur de chaque série par colonne pour la bulle (une valeur nulle ou négative s'y lit, elle n'empile rien)
  stackOf = (table, kind, masked, bounds, places)->
    model = C.stackModel(table, { kind: kind, hidden: masked, bounds: boundsOf(bounds), places: places })
    shown = table.series.filter((s)-> s.kind isnt 'text' and not masked.includes(s.key))
    Object.assign(model, { slots: true, own: false, bars: model.segments, lines: shown.map((s)-> { key: s.key, name: s.name, unit: s.unit, points: s.values.map((v, i)-> (if v is null then null else { i: i, value: v })) }) })

  # l'histogramme de la première série de nombres visible (la page en montre une autre en masquant les précédentes, `hidden`) : ses classes aux
  # bornes rondes (3 à 12), une barre par classe non vide, l'axe y en effectifs entiers ; les statistiques cochées deviennent des traits
  # verticaux, à leur place sur l'étendue des classes. Toutes les mesures égales : une seule classe, au milieu ; `places` : des classes d'au
  # moins 10^-N (cf. `decimals`)
  binsOf = (table, masked, marks, places)->
    s       = table.series.find((c)-> c.kind isnt 'text' and not masked.includes(c.key))
    values  = if s then s.values.filter((v)-> v isnt null) else []
    bins    = C.histogramBins(values, undefined, places)
    scale   = C.niceScale(0, bins.reduce(((m, b)-> Math.max(m, b.count)), 1), 4, true)
    scale.ticks = scale.ticks.filter((t)-> t is Math.round(t))
    slot    = 1 / Math.max(bins.length, 1)
    low     = if bins.length then bins[0].from else 0
    span    = if bins.length then bins[bins.length - 1].to - low else 0
    at      = (v)-> if span > 0 then Math.min(1, Math.max(0, (v - low) / span)) else 0.5
    figures = C.stats(values)
    stats   = {}
    for name in marks
      stats[name] = { value: figures[name], d: 'M ' + px(at(figures[name]) * C.WIDE) + ' 0 L ' + px(at(figures[name]) * C.WIDE) + ' ' + C.HIGH } if figures[name]?
    edges = if span > 0 then [low].concat(bins.map((b)-> b.to)) else bins.map((b)-> b.from)
    {
      slots: true
      own: false
      scale: scale
      bins: bins
      fractions: bins.map((b, i)-> (i + 0.5) * slot)
      edges: edges.map((v, k)-> { at: (if span > 0 then k * slot else 0.5), v: v })
      lines: (if s then [{ key: s.key, name: s.name, unit: s.unit, points: bins.map((b, i)-> { i: i, value: b.count }), marks: stats }] else [])
      bars: bins.map((b, i)-> { i: i, key: s.key, count: b.count, left: i * slot + slot * 0.06, width: slot * 0.88, top: 1 - C.ratio(b.count, scale.min, scale.max), height: C.ratio(b.count, scale.min, scale.max) }).filter((b)-> b.count > 0)
    }

  # la classe d'un histogramme écrite pour l'écran : « de 60 à 62,5 kg », sa seule valeur quand toutes les mesures sont égales ; au pas de la
  # classe, deux bornes voisines ne s'écrivent jamais pareil (« de 1,001 à 1,002 »)
  rangeText = (bin, unit, lang, places)->
    return valueText(bin.from, unit, lang, places) if bin.from is bin.to
    step = bin.to - bin.from
    tr('chartRange', lang).replace('{from}', C.formatNumber(bin.from, lang, step, places)).replace('{to}', C.formatNumber(bin.to, lang, step, places) + (if unit then ' ' + unit else ''))

  # la bulle d'une classe : ses bornes et le nombre de valeurs qu'elle compte
  binTip = (at, data, lang)->
    bin  = data.model.bins[at]
    line = data.lines[0]
    return null unless at >= 0 and bin and line
    { at: data.model.fractions[at], x: pct(data.model.fractions[at]), title: rangeText(bin, line.unit, lang, data.places), grouped: '', rows: [{ key: line.key, hue: line.hue, custom: line.custom, name: tr('chartCount', lang), word: false, text: C.formatNumber(bin.count, lang) }], marks: [] }

  binTable = (data, lang)->
    unit = data.lines[0]?.unit ?? ''
    { head: tr('chartBin', lang), columns: [{ key: 'count', title: tr('chartCount', lang) }], cells: data.model.bins.map((b, k)-> { k: k, x: rangeText(b, unit, lang, data.places), values: [{ key: 'count', text: C.formatNumber(b.count, lang) }] }) }

  # l'anneau répartit un tout, selon la règle de `pieWay` : une part par série, son TOTAL sur les lignes données (la somme, comme les barres
  # empilées, pas la dernière valeur), ou une part par libellé (les valeurs de la série additionnées par libellé). Seules les valeurs
  # positives comptent ; sept parts au plus, de la plus grande à la plus petite, les suivantes réunies en « autres ». `none` : l'anneau ne
  # convient pas à ces données ; `drop` : ce qui n'a pas de total positif, et donc pas de part — les séries d'une part par série, ou les
  # libellés d'une part par libellé (nommés comme leurs parts, cf. `lostOf`)
  pieOf = (rows, list, kind, masked, tones)->
    filled = valuedOf(rows, list, masked)
    way    = pieWay(filled, kind)
    named  = way is 'label'
    first  = filled[0]
    none   = not way
    points = if named then (if first then C.pointsOf(rows, first.key, false) else []) else (if none then [] else filled.map((s)-> { x: s.key, y: C.stats(rows.map((r)-> C.reading(r, s.key))).sum }))
    parts  = C.pieParts(points, 7)
    slices = parts.slices.map (p, k)->
      tone = if named or p.others then { hue: (if p.others then 0 else (k % 6) + 1), custom: null } else tones[p.key]
      { i: k, key: p.key, label: (if named or p.others then p.label else tones[p.key].name), others: p.others is true, pale: named and k >= 6 and not p.others, value: p.value, share: p.share, from: p.from, to: p.to, hue: tone.hue, custom: tone.custom }
    { own: false, slots: false, scale: null, fractions: [], lines: [], bars: [], by: (if named then 'label' else 'series'), name: (if first then first.name else ''), unit: (if first then first.unit else ''), total: parts.total, slices: slices, none: none, drop: (if way is 'series' then points.filter((p)-> not (p.y > 0)).map((p)-> p.x) else if named then lostOf(points) else []) }

  # les libellés d'un anneau par libellé dont le total n'est pas positif : les valeurs additionnées par libellé, un libellé vide nommé « — »,
  # comme le fait `C.pieParts` pour les parts
  lostOf = (points)->
    sums = new Map()
    for p in points
      name = if p.x? and p.x isnt '' then String(p.x) else '—'
      sums.set(name, (sums.get(name) ?? 0) + p.y)
    Array.from(sums.keys()).filter((k)-> not (sums.get(k) > 0))

  # les séries de nombres visibles qui ont une valeur
  valuedOf = (rows, list, masked)-> list.filter((s)-> s.kind isnt 'text' and not masked.includes(s.key) and rows.some((r)-> C.reading(r, s.key) isnt null))

  # la règle de l'anneau, sur les séries visibles qui ont une valeur (`filled`) : une part par série dès deux séries de même unité, quel que
  # soit l'axe ; une part par libellé pour une seule série sur un axe de libellés (sans série, rien à répartir : un anneau vide) ; sinon (une
  # série sur un axe de dates ou de nombres, des unités différentes) null : l'anneau n'a pas de sens, une note le dit, aucune série ne se
  # perd en silence. Le menu des formes le grise selon la même règle
  pieWay = (filled, kind)->
    return 'series' if filled.length > 1 and filled.every((s)-> s.unit is filled[0].unit)
    if filled.length is 0 or (filled.length is 1 and kind is 'category') then 'label' else null

  sliceName = (slice, lang)-> if slice.others then tr('chartOthers', lang) else slice.label

  # la part survolée ou au focus, pour le centre de l'anneau : son nom, sa valeur, sa part du total
  sliceTip = (at, data, lang)->
    slice = data.model.slices[at]
    return null unless at >= 0 and slice
    amount = valueText(slice.value, data.model.unit, lang, data.places)
    share  = shareText(slice.share, lang)
    { title: sliceName(slice, lang), amount: amount, share: share, rows: [{ key: slice.key, name: amount, text: share }] }

  pieTable = (data, lang)->
    m     = data.model
    title = (if m.by is 'label' then m.name else tr('chartTotal', lang)) + (if m.unit then ' (' + m.unit + ')' else '')
    {
      head: (if m.by is 'label' then tr('chartCategory', lang) else tr('chartSeries', lang))
      columns: [{ key: 'value', title: title }, { key: 'share', title: tr('chartShare', lang) }]
      cells: m.slices.map((s)-> { k: s.i, x: sliceName(s, lang), values: [{ key: 'value', text: valueText(s.value, m.unit, lang, data.places) }, { key: 'share', text: shareText(s.share, lang) }] })
    }

  # ce que dessine un anneau : un secteur par part (rayons 47 et 30 dans un cadre de 100), son nom, sa valeur et sa part ; le total
  ringOf = (data, lang)->
    m = data.model
    { keys: [], total: valueText(m.total, m.unit, lang, data.places), slices: m.slices.map((s)-> { i: s.i, key: s.key, hue: s.hue, custom: s.custom, pale: s.pale, others: s.others, d: C.arcPath(50, 50, 47, 30, s.from, s.to), label: sliceName(s, lang), amount: valueText(s.value, m.unit, lang, data.places), share: shareText(s.share, lang) }) }

  # une case lue dans la bulle : la valeur de la série (sa teinte), puis le nombre de relevés ; sans relevé, « aucune valeur »
  measureRows = (s, tones, v, n, lang, places)->
    return [{ key: '#none', hue: 0, custom: null, name: tr('chartEmpty', lang), text: '' }] unless n > 0
    (if s then [{ key: s.key, hue: tones[s.key].hue, custom: tones[s.key].custom, name: s.name, text: valueText(v, s.unit, lang, places) }] else []).concat([{ key: '#count', hue: 0, custom: null, name: tr('chartCount', lang), text: C.formatNumber(n, lang) }])

  # le tableau d'une carte jour × heure ou d'un calendrier : une ligne par case à relevés (`x` son nom, `v` sa valeur, `n` leur nombre)
  measureTable = (head, s, list, lang, places)->
    columns = (if s then [{ key: s.key, title: (if s.unit then s.name + ' (' + s.unit + ')' else s.name) }] else []).concat([{ key: '#count', title: tr('chartCount', lang) }])
    { head: head, columns: columns, cells: list.map((c)-> { k: c.k, x: c.x, values: (if s then [{ key: s.key, text: valueText(c.v, s.unit, lang, places) }] else []).concat([{ key: '#count', text: C.formatNumber(c.n, lang) }]) }) }

  clip = (text)-> if text.length > 18 then text.slice(0, 17) + '…' else text

  # la carte d'intensité : sur un axe d'instants (date et heure), une grille de 7 jours (lundi en tête) sur 24 heures, à l'heure affichée
  # (cf. `timezone` ; `utc` : déjà ramenée à elle), chaque case la moyenne de la première série de nombres visible, ou le nombre de relevés quand aucune série de nombres n'est
  # visible ; sur un autre axe, une ligne par série de nombres visible et une colonne par ligne de données. Cinq niveaux sur une échelle
  # commune (`bounds` comprises), le niveau 0 pour une case sans valeur ; `ids` : la ligne qu'une case porte seule (@pick)
  heatOf = (rows, list, kind, masked, tones, bounds, utc)->
    shown = list.filter((s)-> s.kind isnt 'text' and not masked.includes(s.key))
    if kind is 'datetime'
      s      = shown[0] ?? null
      points = if s then C.pointsOf(rows, s.key, false) else rows.map((r)-> { x: r.x, y: 1, row: r })
      counts = C.weekHours(points, 'count', utc)
      heat   = C.heatModel((if s then C.weekHours(points, 'mean', utc) else counts.map((r)-> r.map((n)-> n or null))), { bounds: boundsOf(bounds) })
      owner  = []
      for p in points
        t = C.parseX('datetime', p.x)
        d = new Date(t ?? 0)
        owner[(((if utc then d.getUTCDay() else d.getDay()) + 6) % 7) * 24 + (if utc then d.getUTCHours() else d.getHours())] = p.row.id if t isnt null
      return { own: false, lines: [], time: true, rows: 7, cols: 24, cells: heat.cells, counts: counts, series: s, tone: (if s then tones[s.key] else { hue: 1, custom: null }), ids: heat.cells.map((c, i)-> if counts[c.row][c.col] is 1 then owner[i] ?? null else null), count: 168, empty: heat.peak is null, across: 1, down: 24 }
    heat = C.heatModel(C.fromRows(rows, shown).series.map((s)-> s.values), { bounds: boundsOf(bounds) })
    { own: false, lines: [], time: false, rows: shown.length, cols: rows.length, cells: heat.cells, series: shown, xs: rows, ids: heat.cells.map((c)-> if c.value is null then null else rows[c.col].id ?? null), count: heat.cells.length, empty: heat.peak is null, across: 1, down: rows.length }

  # ce que dessine une carte : une case par heure et par jour (ou par série et par ligne), son niveau et sa teinte ; les noms des lignes ; la
  # légende d'intensité dans la teinte de la série (neutre quand plusieurs séries se partagent la grille)
  heatDraw = (data, lang)->
    m     = data.model
    tone  = if m.time then m.tone else if m.series.length is 1 then data.tones[m.series[0].key] else { hue: 0, custom: null }
    names = if m.time then [0, 1, 2, 3, 4, 5, 6].map((d)-> C.formatWeekday(d, lang, 'short')) else m.series.map((s)-> s.name)
    # une case sans valeur garde l'allure de `$$chart-empty` : la couleur de l'auteur, écrite en style sur la case, l'emporterait sur `.level-0`
    cells = m.cells.map (c, i)->
      t = if m.time then m.tone else data.tones[m.series[c.row].key]
      { i: i, x: c.col + 0.05, y: c.row + 0.07, level: c.level, hue: t.hue, custom: (if c.level then t.custom else null) }
    { keys: [], view: '0 0 ' + m.cols + ' ' + m.rows, high: m.rows * 26, names: names.map((text, k)-> { k: k, text: text }), cells: cells, ramp: { hue: tone.hue, custom: tone.custom, levels: [1, 2, 3, 4, 5] } }

  # les étiquettes sous la carte : les heures de trois en trois, centrées sur leur colonne ; sinon les abscisses des lignes
  heatLabels = (data, width, measure, lang)->
    m = data.model
    return labelsOf(m.xs.map((r, c)-> (c + 0.5) / m.cols), m.xs.map((r)-> xText(data.group, data.period, r, true, lang)), width, measure) unless m.time
    hours = [0, 3, 6, 9, 12, 15, 18, 21]
    labelsOf(hours.map((h)-> (h + 0.5) / 24), hours.map((h)-> C.formatHour(h, lang)), width, measure).map((l)-> Object.assign(l, { anchor: 'middle' }))

  hourTitle = (c, lang)-> C.formatWeekday(c.row, lang, 'long') + ' ' + C.formatHour(c.col, lang)

  # la bulle d'une case : le jour et l'heure (sa valeur, le nombre de relevés), ou le libellé de la ligne (la valeur de sa série)
  heatTip = (at, data, lang)->
    m = data.model
    c = m.cells[at]
    return null unless at >= 0 and c
    return { title: hourTitle(c, lang), rows: measureRows(m.series, data.tones, c.value, m.counts[c.row][c.col], lang, data.places) } if m.time
    { title: xText(data.group, data.period, m.xs[c.col], false, lang), rows: measureRows(m.series[c.row], data.tones, c.value, (if c.value is null then 0 else 1), lang, data.places).filter((r)-> r.key isnt '#count') }

  heatTable = (data, lang)->
    m = data.model
    measureTable(tr('chartDayHour', lang), m.series, m.cells.filter((c)-> m.counts[c.row][c.col] > 0).map((c)-> { k: c.row * 24 + c.col, x: hourTitle(c, lang), v: c.value, n: m.counts[c.row][c.col] }), lang, data.places)

  # le radar : un axe par ligne (son abscisse) — les 24 dernières au plus —, un polygone par série de nombres visible, une échelle commune
  # de 0 à la plus grande valeur, ou `bounds` (de 0 à 100 pour des parts) ; une valeur absente revient au centre
  radarOf = (table, rows, masked, bounds)->
    radar = C.radarModel(table, { hidden: masked, bounds: boundsOf(bounds) })
    { own: false, lines: [], radar: radar, xs: rows, ids: rows.map((r)-> r.id ?? null), count: rows.length, empty: radar.shapes.every((s)-> s.vertices.every((v)-> v.value is null)), across: 1, down: 0 }

  # les branches dont le nom s'écrit : toutes jusqu'à 8 axes ; au-delà, celles du haut, de droite, du bas et de gauche (0°, 90°, 180°, 270°),
  # les plus proches quand le nombre d'axes ne se divise pas par 4 (à égalité, celle qui suit), la gauche en miroir de la droite
  polesOf = (n)->
    return Array.from({ length: n }, (v, i)-> i) if n <= RADAR_NAMES
    right = Math.round(n / 4)
    [0, right, Math.round(n / 2), n - right]

  # ce que dessine un radar : la toile (un anneau par graduation, un rayon par axe), un polygone et ses sommets par série, un secteur
  # transparent par axe qui reçoit le pointeur, dans un cadre de 100 ; les noms des branches (cf. `polesOf`, abrégés au-delà de 18 signes),
  # posés au bout de leur axe dans la taille des autres textes, et ceux des côtés (`sides`, ni en haut ni en bas) une seconde fois, cachés,
  # de part et d'autre de la toile : ils lui réservent leur place à toute largeur
  radarDraw = (data, lang)->
    r        = data.model.radar
    n        = r.axes.length
    vertices = []
    for s in r.shapes
      for v in s.vertices
        vertices.push({ id: s.key + '|' + v.i, i: v.i, hue: data.tones[s.key].hue, custom: data.tones[s.key].custom, x: px(v.x), y: px(v.y) }) if v.value isnt null
    poles = polesOf(n).map((i)-> { i: i, x: px(r.axes[i].label.x), y: px(r.axes[i].label.y), anchor: r.axes[i].label.anchor, text: clip(xText(data.group, data.period, data.model.xs[i], true, lang)) })
    {
      keys: []
      mesh: r.rings
      axes: r.axes.map((a)-> { i: a.i, x: px(a.x), y: px(a.y), wedge: C.arcPath(50, 50, 50, 0, (a.i - 0.5) / n, (a.i + 0.5) / n) })
      poles: poles
      sides: poles.filter((p)-> p.anchor isnt 'middle')
      shapes: r.shapes.map((s)-> { key: s.key, hue: data.tones[s.key].hue, custom: data.tones[s.key].custom, points: s.points })
      vertices: vertices
    }

  # la bulle d'un axe : son nom, la valeur de chaque série
  radarTip = (at, data, lang)->
    row = data.model.xs[at]
    return null unless at >= 0 and row
    { title: xText(data.group, data.period, row, false, lang), rows: data.model.radar.shapes.map((s)-> { key: s.key, hue: data.tones[s.key].hue, custom: data.tones[s.key].custom, name: data.tones[s.key].name, text: valueText(s.vertices[at].value, data.tones[s.key].unit, lang, data.places) }) }

  # le calendrier : la première série de nombres visible (sinon le nombre de relevés), par jour (une colonne par semaine, une ligne par jour
  # du lundi au dimanche, 26 semaines), par semaine (26) ou par mois (12), jusqu'à la période du dernier relevé ; cinq niveaux (une humeur
  # avec `bounds` de 1 à 5 : son arrondi), le niveau 0 pour une case sans relevé ; les jours qui suivent le dernier relevé ne se dessinent pas ;
  # `utc` : des heures déjà ramenées à celle qu'elles affichent (cf. `timezone`)
  calendarOf = (rows, list, kind, masked, period, bounds, utc)->
    s      = list.find((c)-> c.kind isnt 'text' and not masked.includes(c.key)) ?? null
    step   = if period is 'week' or period is 'month' then period else 'day'
    points = if s then C.pointsOf(rows, s.key, false) else rows.map((r)-> { x: r.x, y: null, row: r })
    cal    = C.calendarModel(points, { kind: kind, step: step, measure: (if s then 'mean' else 'count'), bounds: boundsOf(bounds), utc: utc })
    owner  = {}
    points.forEach((p)-> owner[C.periodStart(kind, p.x, step, utc)] = p.row.id)
    cells  = cal.cells.filter((c)-> not c.future)
    { own: false, lines: [], cal: cal, cells: cells, series: s, step: step, ids: cells.map((c)-> if c.count is 1 then owner[c.from] ?? null else null), count: cells.length, empty: cells.every((c)-> c.value is null), across: (if step is 'day' then 7 else 1), down: (if step is 'day' then 1 else 0) }

  # ce que dessine un calendrier, en unités du dessin (1,2 px à l'écran large, moins sur un écran étroit : il se resserre) : les cases (une
  # case sans valeur sans la couleur de l'auteur, cf. `heatDraw`) ; les mois en tête, au-dessus de la colonne où chacun commence (par mois : au-dessus de sa case) ; lundi, mercredi et vendredi à gauche des jours
  calendarDraw = (data, lang)->
    m     = data.model
    g     = CAL[m.step]
    tone  = if m.series then data.tones[m.series.key] else { hue: 1, custom: null }
    rows  = if m.step is 'day' then 7 else 1
    wide  = px(g.left + Math.ceil(m.cal.cells.length / rows) * g.pitch - 3)
    high  = 16 + rows * (g.h + 3) - 3
    heads = if m.step is 'month' then m.cal.cells.map((c)-> { col: c.col, x: px(g.left + c.col * g.pitch + g.w / 2), anchor: 'middle', month: c.from }) else m.cal.months.map((h)-> { col: h.col, x: g.left + h.col * g.pitch, anchor: 'start', month: h.month })
    {
      keys: []
      view: '0 0 ' + wide + ' ' + high
      wide: Math.round(wide * 1.2)
      high: Math.round(high * 1.2)
      w: g.w
      h: g.h
      tone: tone
      heads: heads.map((h)-> Object.assign(h, { text: C.formatDay(h.month, lang, { month: 'short' }) }))
      days: (if m.step is 'day' then [0, 2, 4].map((d)-> { row: d, x: g.left - 4, y: 16 + d * 15 + 6, text: C.formatWeekday(d, lang, 'short') }) else [])
      cells: m.cells.map((c, i)-> { i: i, x: px(g.left + c.col * g.pitch), y: 16 + c.row * (g.h + 3), level: c.level, custom: (if c.level then tone.custom else null) })
      ramp: { hue: tone.hue, custom: tone.custom, levels: [1, 2, 3, 4, 5] }
    }

  # une période du calendrier écrite pour l'écran : le jour en toutes lettres, la semaine de son lundi, le mois
  periodTitle = (c, step, lang)->
    return C.formatDay(c.from, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) if step is 'day'
    return C.formatPeriod('month', c.from, lang, false) if step is 'month'
    tr('chartWeekOf', lang).replace('{date}', C.formatX('date', c.from, lang, false))

  calendarTip = (at, data, lang)->
    c = data.model.cells[at]
    return null unless at >= 0 and c
    { title: periodTitle(c, data.model.step, lang), rows: measureRows(data.model.series, data.tones, c.value, c.count, lang, data.places) }

  calendarTable = (data, lang)->
    m = data.model
    measureTable(tr((if m.step is 'day' then 'chartDate' else 'chartPeriod'), lang), m.series, m.cells.filter((c)-> c.count > 0).map((c)-> { k: c.from, x: periodTitle(c, m.step, lang), v: c.value, n: c.count }), lang, data.places)

  # les données telles qu'affichées, depuis les props : lignes regroupées par période (`step`, sur un axe du temps), séries masquées ôtées, puis le
  # modèle de la couche de calcul ; tracés, statistiques, bulle et tableau se calculent sur elles. L'histogramme et l'anneau lisent les lignes
  # telles quelles (`step` ne regroupe que les formes qui suivent les lignes ; le calendrier s'en sert pour ses cases) et se parcourent au
  # clavier même sans `pickable` (`reads`) ; l'histogramme et l'anneau ne choisissent pas de ligne, une carte, un radar ou un calendrier
  # choisissent celle qu'une case porte seule (`model.ids`) ; seules les formes qui suivent les lignes et l'histogramme (sans tendance) ont des
  # statistiques. `count` : les colonnes, les parts ou les cases que parcourt le clavier ; `across` et `down` : le pas des flèches gauche et
  # droite, haut et bas (0 : sans effet). Ce qu'entraîne un choix fait dans la barre (`picks`) ne se dit jamais en console : une forme, des
  # statistiques, un pas ou des séries masquées que l'utilisateur a choisis. Sur un axe d'instants, hors `local`, chaque heure est ramenée
  # d'abord à celle qu'elle affiche (`zone` : telle qu'écrite, ou dans une zone IANA), puis lue en UTC (`utc`) : la même au serveur et au
  # navigateur ; `places` : le nombre de chiffres après la virgule de chaque mesure écrite (`decimals`)
  dataOf = (rows, series, shape, stats, step, hidden, axis, bounds, toolbar, shapes, timezone, decimals, picks)->
    list   = seriesOf(series)
    base   = rowsOf(rows)
    own    = ours(picks, 'shape', shape)
    form   = radarFit(shapeOf(shape), base, own)
    family = SHAPES[form]
    asked  = statsOf(stats)
    marks  = statsFit(asked, form, own or ours(picks, 'stats', stats))
    period = stepOf(step)
    masked = wordsOf(hidden)
    kind   = axisOf(axis, base)
    period = calendarFit('step', period, CAL_STEPS, 'auto', own or ours(picks, 'step', step)) if form is 'calendar'
    kind   = calendarFit('axis', kind, CAL_AXES, axisOf(null, base), own) if form is 'calendar' and AXES.includes(bare(axis))
    zone   = zoneOf(timezone)
    places = placesOf(decimals)
    utc    = kind is 'datetime' and zone isnt 'local'
    base   = wallRows(base, zone) if utc
    tones  = tonesOf(list)
    reads  = form is 'histogram' or family isnt 'axes'
    group  = Object.assign((if reads then { rows: (if family is 'radar' then base.slice(-RADAR_MAX) else base), kind: kind, grouped: false } else C.groupRows(base, list, kind, period, utc)), { utc: utc })
    units  = if form is 'stack' or family is 'radar' or (family is 'heat' and kind isnt 'datetime') then unitsOf(group.rows, list, masked) else []
    µ.warn(µ._mjs_msg('coreChartUnits', { shape: form, units: units.join(' ') }, '<@@chart> : les séries de la forme {shape} n\'ont pas la même unité ({units}) et partagent pourtant une même échelle.')) if units.length > 1 and not (own or ours(picks, 'hidden', hidden)) and unsaid('units|' + form + '|' + units.join(' '))
    µ.warn(µ._mjs_msg('coreChartRadarCut', { max: RADAR_MAX, n: base.length }, '<@@chart> : un radar montre {max} axes au plus, les {n} lignes reçues sont réduites aux {max} dernières.')) if family is 'radar' and base.length > RADAR_MAX and not own and unsaid('cut')
    table  = C.fromRows(group.rows, list)
    model  = if form is 'pie' then pieOf(base, list, kind, masked, tones) else if form is 'histogram' then binsOf(table, masked, marks, places) else if form is 'stack' then stackOf(table, group.kind, masked, bounds, places) else if family is 'heat' then heatOf(base, list, kind, masked, tones, bounds, utc) else if family is 'radar' then radarOf(table, group.rows, masked, bounds) else if family is 'calendar' then calendarOf(base, list, kind, masked, period, bounds, utc) else C.plotModel(table, { kind: group.kind, shape: form, trend: marks.includes('trend'), bounds: boundsOf(bounds), hidden: masked, places: places })
    # une série (ou un libellé, dans un anneau par libellé) sans total positif n'a pas de part dans l'anneau : une limite des données, un
    # avertissement du développement
    for key in (if form is 'pie' and not (own or ours(picks, 'hidden', hidden)) then model.drop else [])
      if model.by is 'label'
        µ.warn(µ._mjs_msg('coreChartPieLabelDrop', { label: key }, '<@@chart> : le libellé « {label} » n\'a pas de total positif, l\'anneau ne lui donne aucune part.')) if unsaid('pie-label|' + key)
      else
        µ.warn(µ._mjs_msg('coreChartPieDrop', { key: key }, '<@@chart> : la série « {key} » n\'a pas de total positif, l\'anneau ne lui donne aucune part.')) if unsaid('pie|' + key)
    lines  = linesOf(model, tones)
    empty  = model.empty ?? (if form is 'pie' then model.slices.length is 0 else lines.every((l)-> l.points.every((p)-> p is null)))
    bar    = barOf(toolbar, shapes, list, base, kind, masked, form, reads, asked, period) # @@ toolbar
    # bar    = null # @@ !toolbar
    Object.assign({ list: list, tones: tones, form: form, family: family, marks: marks, period: period, masked: masked, places: places, group: group, rows: group.rows, model: model, lines: lines, empty: empty, reads: reads, count: model.count ?? (if form is 'pie' then model.slices.length else model.fractions.length), across: model.across ?? 1, down: model.down ?? 0 }, bar)

  # @@ toolbar
  # le menu des formes, dans l'ordre du module : une forme impossible avec ces données est grisée, selon les règles du module — un radar
  # sous 3 lignes (cf. `radarFit`), un calendrier sans axe de dates (cf. `calendarFit`), un anneau qui n'a pas de sens (cf. `pieWay`, sur
  # les séries visibles)
  formsOf = (menu, base, list, kind, masked)->
    way = pieWay(valuedOf(base, list, masked), kind)
    Object.keys(SHAPES).filter((f)-> not menu.length or menu.includes(f)).map((f)-> { name: f, d: FORMS[f].d, off: (f is 'radar' and base.length > 0 and base.length < 3) or (f is 'calendar' and not CAL_AXES.includes(kind)) or (f is 'pie' and not way) })

  # la barre d'outils de ces données : les outils montrés (`tools`, `bar` : au moins un), la légende (une pastille par série de nombres,
  # pressée quand la série est visible), le menu des formes, les cases des statistiques (cochées selon `stats`, grisées quand la forme
  # n'en trace pas, la tendance sur un histogramme), les pas de temps (sur un axe du temps seulement, grisés quand la forme ne suit pas les
  # lignes ; le calendrier sans « année »)
  barOf = (toolbar, shapes, list, base, kind, masked, form, reads, asked, period)->
    tools = toolsOf(toolbar)
    menu  = shapesOf(shapes)
    timed = CAL_AXES.includes(kind)
    {
      tools: tools
      bar: tools.legend or tools.shapes or tools.stats or (tools.step and timed)
      asked: asked
      timed: timed
      legend: (if tools.legend then list.filter((s)-> s.kind isnt 'text').map((s)-> { key: s.key, name: s.name, hue: s.hue, custom: s.custom, on: not masked.includes(s.key) }) else [])
      forms: (if tools.shapes then formsOf(menu, base, list, kind, masked) else [])
      checks: (if tools.stats then Object.keys(STATS).map((n)-> { name: n, on: asked.includes(n), off: not STATS_SHAPES.includes(form) or (n is 'trend' and not TREND_SHAPES.includes(form)) }) else [])
      paces: (if tools.step and timed then (if form is 'calendar' then CAL_STEPS else C.STEPS).map((p)-> { name: p, on: p is period, off: reads and form isnt 'calendar' }) else [])
    }
  # @@

  # ce que dessine un graphique à axes : les tracés des séries qui ont une valeur, graduations, points, barres, traits des statistiques, tendances, légende des traits
  drawOf = (data, lang)->
    return ringOf(data, lang) if data.family is 'pie'
    return heatDraw(data, lang) if data.family is 'heat'
    return radarDraw(data, lang) if data.family is 'radar'
    return calendarDraw(data, lang) if data.family is 'calendar'
    ticks = ticksOf(data.model, lang, (if data.form is 'histogram' then null else data.places))
    {
      paths: data.lines.filter((l)-> l.points.some((p)-> p isnt null))
      ticks: ticks
      yLabels: (if data.empty then [] else ticks)
      dots: dotsOf(data.lines, data.form, data.rows.length)
      dotSize: (if data.form is 'dots' then 4.5 else 3)
      bars: barsOf(data.model, data.tones)
      stats: statLinesOf(data.lines, data.marks, data.form is 'histogram')
      trends: trendsOf(data.lines)
      keys: legendOf(data.marks, lang)
    }

  # les étiquettes de l'axe x : les abscisses des lignes, les bornes des classes d'un histogramme, les heures ou les libellés sous une carte
  xLabelsOf = (data, width, measure, lang)->
    return heatLabels(data, width, measure, lang) if data.family is 'heat' and not data.empty
    return [] if data.empty or data.family isnt 'axes'
    return labelsOf(data.model.edges.map((e)-> e.at), data.model.edges.map((e)-> C.axisNumber(e.v, lang, data.places)), width, measure) if data.form is 'histogram'
    labelsOf(data.model.fractions, data.rows.map((r)-> xText(data.group, data.period, r, true, lang)), width, measure)

  # @@ toolbar
  # les noms d'une table (`label` : la clé du libellé), dans la langue de l'écran
  namesOf = (table, lang)->
    out = {}
    for k in Object.keys(table)
      out[k] = tr(table[k].label, lang)
    out
  # @@

  # textes par défaut : ceux de l'auteur passent avant, sinon la langue de la page choisit ; ceux de la barre d'outils ; la langue elle-même
  textsOf = (label, empty, lang)->
    texts = { label: label ?? tr('chartLabel', lang), empty: empty ?? tr('chartEmpty', lang), hint: tr('chartHint', lang), browse: tr('chartBrowse', lang), own: tr('chartOwnScale', lang), total: tr('chartTotal', lang), none: tr('chartPieNone', lang), choose: tr('chartChoose', lang), less: tr('chartLess', lang), more: tr('chartMore', lang), lang: lang }
    Object.assign(texts, { tools: tr('chartTools', lang), legend: tr('chartLegend', lang), shape: tr('chartShape', lang), shapeOf: tr('chartShapeOf', lang), stats: tr('chartStats', lang), step: tr('chartStep', lang), forms: namesOf(FORMS, lang), marks: namesOf(STATS, lang), paces: namesOf(PACES, lang) }) # @@ toolbar
    texts

  # ce que lit un lecteur d'écran quand le clavier parcourt le graphique : le titre de la bulle, puis chaque ligne
  saidOf = (keyed, tip)-> if keyed and tip then [tip.title].concat(tip.rows.map((r)-> r.name + ' ' + r.text)).join(', ') else ''
</script>

<script>
  $rows       = []
  $series     = []
  $shape      = 'line'
  $stats      = ''
  $step       = 'auto'
  $hidden     = []
  $bounds     = null
  $axis       = null
  $axisUnit   = ''
  $pickable   = false
  $label      = null
  $emptyLabel = null
  $toolbar    = ''
  $shapes     = '' # @@ toolbar
  $timezone   = null
  $decimals   = null

  # `input` : la largeur mesurée du tracé et le mode clavier, une seule variable d'état réécrite au redimensionnement et au passage du clavier
  # à la souris, jamais au survol (cf. `setInput`)
  $hover = -1
  $input = { width: 0, keyed: false }
  $spot  = { x: 0, side: 'right', ready: false }
  $menu  = null # @@ toolbar

  chartRef = null
  plotRef  = null
  svgRef   = null
  hitRef   = null
  tipRef   = null
  watch    = null
  ctx      = null
  seen     = 0
  pickRef  = null # @@ toolbar
  btnRef   = null # @@ toolbar
  menuRef  = null # @@ toolbar
  picks    = {}
  held     = 0 # @@ toolbar

  # les dérivés suivent la langue de la page (lire µlang les rend réactifs à la bascule) ; la barre d'outils se calcule avec les données
  # (`picks` : ce qu'elle a écrit), le tableau des valeurs et les textes avec le dessin ; le gabarit lit les étiquettes de l'axe x et le
  # texte dit au clavier (cf. `xLabelsOf`, `saidOf`)
  $data = dataOf($rows, $series, $shape, $stats, $step, $hidden, $axis, $bounds, $toolbar, $shapes, $timezone, $decimals, picks) # @@ toolbar
  # $data = dataOf($rows, $series, $shape, $stats, $step, $hidden, $axis, $bounds, '', '', $timezone, $decimals, picks) # @@ !toolbar
  $draw = Object.assign(drawOf($data, langOf(µlang)), { table: tableOf($data, langOf(µlang)), texts: textsOf($label, $emptyLabel, langOf(µlang)) })
  $tip  = tipOf($hover, $data, $axisUnit, langOf(µlang))

  # @@ dev toolbar
  # aucune page n'écrit `toolbar` : la construction a ôté la barre, un graphique qui le reçoit d'un script ne l'a pas. Écrit en commentaire, réveillé
  # seulement quand la barre est ôtée : une copie du module posée dans un projet garde sa barre, et ne le dit jamais
  # @@ !toolbar
  # µeffect ->
  #   µ.warn(µ._mjs_msg('dev.chartToolbarScript', {}, '<@@chart> : un graphique reçoit « toolbar » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — la barre d\'outils n\'est pas envoyée, ni en développement ni en production. Écrivez « toolbar » sur le graphique dans votre page plutôt que de le poser par un script.')) if bare($toolbar) isnt '' and unsaid('toolbar-script')
  # @@
  # @@

  setInput = (width, keyed)->
    $input = { width: width, keyed: keyed } unless width is $input.width and keyed is $input.keyed

  # la largeur d'une étiquette, mesurée dans la police des graduations ; sans mesure possible (rendu serveur), 6,5 px par caractère
  measure = (text)-> if ctx then ctx.measureText(text).width else String(text).length * 6.5

  # la largeur du tracé, relue à chaque changement de taille : les étiquettes de l'axe x se choisissent sur elle
  remeasure = ->
    return unless plotRef
    w = Math.round(plotRef.getBoundingClientRect().width)
    return unless w > 0
    unless ctx
      try
        cs  = getComputedStyle(svgRef ?? plotRef)
        ctx = document.createElement('canvas').getContext('2d')
        ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily if ctx
      catch e
        ctx = null
    setInput(w, $input.keyed)

  # le zoom CSS autour d'un élément, le menu ou la bulle (sur la page, sur un conteneur) : le navigateur multiplie par lui sa place et sa
  # hauteur. Lu sur l'élément, sa largeur à l'écran sur sa largeur CSS (`currentCSSZoom` manque à Safari) ; 1 sans zoom CSS, comme sous le
  # zoom du navigateur
  zoomOf = (el)-> el.getBoundingClientRect().width / parseFloat(getComputedStyle(el).width) or 1

  # la bulle se place à droite du curseur, à gauche quand la place manque, sinon au mieux : jamais coupée par le cadre du graphique ni par
  # l'écran ; sur une carte, un calendrier ou un radar, à côté de la case (ou de l'axe) survolée, dans le cadre du graphique. Tout se mesure
  # à l'écran (largeur de la bulle comprise : `offsetWidth` est en pixels CSS, multipliée par le zoom CSS de la bulle, cf. `zoomOf`) ; la
  # place écrite (`left`) est en pixels CSS : divisée par ce zoom, que le navigateur lui rend
  place = ->
    axes = $data.family is 'axes'
    ref  = if axes then plotRef else chartRef
    return unless $tip and tipRef and ref
    k     = zoomOf(tipRef)
    plot  = ref.getBoundingClientRect()
    frame = (chartRef ?? ref).getBoundingClientRect()
    w     = tipRef.offsetWidth * k
    cell  = if axes then null else chartRef.querySelector('[data-i="' + $hover + '"]')
    box   = cell?.getBoundingClientRect()
    x     = if box then box.left + box.width / 2 - plot.left else $tip.at * plot.width
    half  = if box and $data.family isnt 'radar' then box.width / 2 else 0
    low   = Math.max(frame.left, 0) - plot.left
    high  = Math.min(frame.right, document.documentElement.clientWidth) - plot.left
    if x + half + GAP + w <= high
      $spot = { x: Math.round((x + half + GAP) / k), side: 'right', ready: true }
    else if x - half - GAP - w >= low
      $spot = { x: Math.round((x - half - GAP - w) / k), side: 'left', ready: true }
    else
      $spot = { x: Math.round(Math.max(low, Math.min(high - w, x - w / 2)) / k), side: 'over', ready: true }

  hide = -> $spot = { x: 0, side: 'right', ready: false }

  # la bulle mesurée une fois écrite (son texte change sa largeur), puis montrée
  µeffect ->
    if $tip then queueMicrotask(-> if tipRef then place() else requestAnimationFrame(place)) else hide()

  nearest = (e)->
    return -1 unless hitRef
    box = hitRef.getBoundingClientRect()
    return -1 if box.width is 0
    C.nearestIndex($data.model.fractions, Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)))

  onMove = (e)->
    return if $data.empty
    setInput($input.width, false)
    i = nearest(e)
    $hover = i unless i is $hover

  # au doigt, un appui ouvre la bulle ; l'appui suivant, ailleurs dans la page, la ferme (cf. `away`)
  onDown = (e)->
    seen = e.timeStamp
    onMove(e)

  onOut = (e)-> $hover = -1 if e.pointerType is 'mouse' and $hover >= 0 and not $input.keyed

  # un appui ailleurs ferme aussi le menu des formes : un appui sur son bouton ou dans le menu y laisse sa marque (`held`), l'ombre fermée du
  # graphique cache sa cible à la fenêtre
  hold = (e)-> held = e.timeStamp # @@ toolbar

  away = (e)->
    shut(false) if $menu and e.timeStamp isnt held # @@ toolbar
    $hover = -1 unless e.timeStamp is seen or $hover < 0

  # la ligne choisie : celle de la colonne ; sur une carte, un calendrier ou un radar, celle que la case (ou l'axe) porte seule
  pick = (i)->
    id = if $data.model.ids then $data.model.ids[i] else if $data.reads then null else $data.rows[i]?.id
    µemit('pick', { id: id }) if id?

  # un clic ouvre aussi la bulle (un appui que le navigateur ne rend qu'en clic, sans événement de pointeur) et choisit la ligne quand le graphique se choisit
  onClick = (e)->
    return if $data.empty
    seen = e.timeStamp
    i = nearest(e)
    $hover = i unless i is $hover
    pick(i) if flag($pickable)

  # au clavier, quand le graphique se choisit (l'histogramme, l'anneau, la carte, le radar et le calendrier toujours) : flèches, Début et Fin
  # parcourent les colonnes, les parts ou les cases (en haut et en bas, d'une ligne à l'autre d'une grille), Entrée choisit, Échap ferme la
  # bulle
  onKey = (e)->
    return unless (flag($pickable) or $data.reads) and not $data.empty
    last = $data.count - 1
    k    = e.key
    move = if k is 'ArrowRight' then $data.across else if k is 'ArrowLeft' then -$data.across else if k is 'ArrowDown' then $data.down else if k is 'ArrowUp' then -$data.down else 0
    if move
      e.preventDefault()
      $hover = if $hover < 0 then (if move < 0 then last else 0) else Math.min(last, Math.max(0, $hover + move))
    else if k is 'Home'
      e.preventDefault()
      $hover = 0
    else if k is 'End'
      e.preventDefault()
      $hover = last
    else if k is 'Escape'
      $hover = -1
    else if (k is 'Enter' or k is ' ') and $hover >= 0 and flag($pickable) and (not $data.reads or $data.model.ids)
      e.preventDefault()
      pick($hover)
    else
      return
    setInput($input.width, true)

  onBlur = ->
    setInput($input.width, false)
    $hover = -1

  # l'anneau et sa légende (événements reçus par le dessin et par la liste) : la part sous le pointeur s'allume et prend le centre ; au doigt,
  # un appui la montre, l'appui suivant ailleurs rend le total (cf. `away`). De même les cases d'une carte ou d'un calendrier et les secteurs
  # d'un radar, qu'un clic choisit quand le graphique se choisit
  over = (e)->
    node = e.target.closest('[data-i]')
    return -1 unless node
    setInput($input.width, false)
    i = Number(node.getAttribute('data-i'))
    $hover = i unless i is $hover
    i

  press = (e)->
    seen = e.timeStamp
    i    = over(e)
    pick(i) if e.type is 'click' and i >= 0 and flag($pickable)

  # @@ toolbar
  # la barre d'outils écrit les props elles-mêmes, comme une liste écrit sa valeur : liées par !{…}, le parent suit ; `picks` retient ce
  # qu'elle a écrit, prop par prop (cf. `ours`). La légende : un clic cache ou montre la série, la dernière série visible reste
  swap = (key)->
    masked = $data.masked
    shown  = $data.list.filter((s)-> s.kind isnt 'text' and not masked.includes(s.key))
    return if shown.length is 1 and shown[0].key is key
    v = sameAs($hidden, (if masked.includes(key) then masked.filter((k)-> k isnt key) else masked.concat([key])))
    picks.hidden = v
    $hidden = v

  # une statistique cochée ou décochée ; la liste garde l'ordre du module
  toggleStat = (name)->
    asked = $data.asked
    v     = sameAs($stats, Object.keys(STATS).filter((k)-> if k is name then not asked.includes(k) else asked.includes(k)))
    picks.stats = v
    $stats = v

  pace = (p)->
    return if p is $step
    picks.step = p
    $step = p

  # une forme du menu : grisée, elle ne se choisit pas ; sinon le menu se ferme et le focus revient au bouton
  choose = (f, e)->
    hold(e)
    return if f.off
    shut(true)
    return if f.name is $shape
    picks.shape = f.name
    $shape = f.name

  # le menu des formes s'ouvre sous son bouton, au-dessus quand la place manque en bas, décalé pour ne jamais sortir de l'écran. Dans la
  # couche du dessus (`popover`) quand le navigateur la connaît : un ancêtre qui coupe (`overflow: hidden`) ne le rogne plus ; posé alors sur
  # l'écran (`top`), il suit son bouton quand la page défile (cf. `unseat`). Une fois mesuré, la forme choisie (flèche du haut : la
  # dernière) prend le focus. La place du bouton se lit sur son conteneur (`.picker`, à sa taille) : le bouton appuyé rétrécit le temps
  # de l'appui (`scale(.96)`), un menu ouvert à la souris se calait sur ce bouton rétréci
  openMenu = (last)->
    $menu = { x: 0, y: 0, up: false, max: null, top: false, ready: false }
    queueMicrotask(-> if menuRef then seat(last) else requestAnimationFrame(-> seat(last)))

  seat = (last)->
    return unless $menu and menuRef and pickRef
    top = typeof menuRef.showPopover is 'function'
    try
      menuRef.showPopover() if top and not menuRef.matches(':popover-open')
    catch e
      top = false
    k     = zoomOf(menuRef)
    box   = pickRef.getBoundingClientRect()
    below = window.innerHeight - box.bottom - GAP
    above = box.top - GAP
    up    = menuRef.scrollHeight * k > below and above > below
    $menu = Object.assign(menuAt(box, up, top), { up: up, max: Math.max(96, Math.floor((if up then above else below) / k)), top: top, ready: true })
    if top
      window.addEventListener('scroll', unseat, true)
      window.addEventListener('resize', unseat)
    items = Array.from(menuRef.querySelectorAll('[role="menuitemradio"]'))
    (if last then items[items.length - 1] else items.find((n)-> n.getAttribute('aria-checked') is 'true') ?? items[0])?.focus()

  # la place du menu, décalé pour ne pas sortir de l'écran : sous son bouton ou au-dessus (`up`) ; posé sur l'écran (`top`), dans les
  # coordonnées de la fenêtre. Mesurée à l'écran, puis divisée par le zoom du menu (cf. `zoomOf`)
  menuAt = (box, up, top)->
    k = zoomOf(menuRef)
    x = Math.max(GAP - box.left, Math.min(0, document.documentElement.clientWidth - GAP - menuRef.offsetWidth * k - box.left))
    { x: Math.round((if top then box.left + x else x) / k), y: (if top then Math.round((if up then document.documentElement.clientHeight - box.top else box.bottom) / k + 4) else 0) }

  # posé sur l'écran, le menu suit son bouton quand la page ou un ancêtre défile, et quand la fenêtre change de taille ; il se ferme quand
  # le bouton sort de l'écran, et le focus revient au bouton
  unseat = ->
    return unless $menu?.top and menuRef and pickRef
    box = pickRef.getBoundingClientRect()
    return shut(true) if box.bottom < 0 or box.top > window.innerHeight
    $menu = Object.assign({}, $menu, menuAt(box, $menu.up, true))

  shut = (back)->
    return unless $menu
    $menu = null
    window.removeEventListener('scroll', unseat, true)
    window.removeEventListener('resize', unseat)
    btnRef?.focus({ preventScroll: true }) if back

  toggleMenu = (e)->
    hold(e)
    if $menu then shut(false) else openMenu(false)

  # le bouton du menu : Entrée et Espace l'ouvrent (un clic), les flèches aussi
  pickKey = (e)->
    return unless e.key is 'ArrowDown' or e.key is 'ArrowUp'
    e.preventDefault()
    openMenu(e.key is 'ArrowUp')

  # dans le menu : flèches (en boucle), Début et Fin ; Échap ferme et rend le focus au bouton, la tabulation ferme et repart du bouton
  menuKey = (e)->
    items = Array.from(menuRef.querySelectorAll('[role="menuitemradio"]'))
    here  = items.indexOf(e.target.closest('[role="menuitemradio"]'))
    k     = e.key
    return shut(true) if k is 'Tab'
    if k is 'Escape'
      e.preventDefault()
      return shut(true)
    to = if k is 'ArrowDown' then (here + 1) % items.length else if k is 'ArrowUp' then (here - 1 + items.length) % items.length else if k is 'Home' then 0 else if k is 'End' then items.length - 1 else -1
    return if to < 0
    e.preventDefault()
    items[to].focus()
  # @@

  # la largeur suit le graphique et son tracé ; une autre forme (des axes à une carte) change l'élément du tracé, suivi alors à son tour
  follow = ->
    return unless watch
    watch.disconnect()
    watch.observe(chartRef) if chartRef
    watch.observe(plotRef) if plotRef
    remeasure()

  µeffect ->
    requestAnimationFrame(follow) if $data.family

  µmount ->
    remeasure()
    return unless typeof ResizeObserver is 'function'
    watch = new ResizeObserver(-> remeasure())
    follow()

  # retiré menu ouvert, le graphique ne laisse aucun écouteur sur la fenêtre
  µdestroy ->
    watch?.disconnect()
    watch = null
    shut(false) # @@ toolbar
</script>

<div class="chart" part="chart" @this=!{chartRef} @class{flag($pickable)}="pickable" @class{$data.empty}="void">
  <!-- @@ toolbar -->
  {if $data.bar}
    <div class="tools" part="tools" role="group" aria-label={$draw.texts.tools}>
      {if $data.tools.legend}<div class="kit" role="group" aria-label={$draw.texts.legend}>{for s in $data.legend by key}<button type="button" class="pill series tone-{s.hue}" @class{not s.on}="dim" --mjs-chart-tone={s.custom} aria-pressed={s.on ? 'true' : 'false'} @click={swap(s.key)}><i class="swatch"></i>{s.name}</button>{end}</div>{end}
      {if $data.tools.shapes}
        <div class="kit picker" @this=!{pickRef}>
          <button type="button" class="pill pick" aria-haspopup="menu" aria-expanded={$menu ? 'true' : 'false'} aria-label={$draw.texts.shapeOf.replace('{shape}', $draw.texts.forms[$data.form])} @this=!{btnRef} @pointerdown={hold(e)} @click={toggleMenu(e)} @keydown={pickKey(e)}><svg class="glyph glyph-{$data.form}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d={FORMS[$data.form].d}/></svg>{$draw.texts.forms[$data.form]}<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4"/></svg></button>
          {if $menu}<div class="menu" part="menu" role="menu" popover="manual" aria-label={$draw.texts.shape} @this=!{menuRef} @class{$menu.up}="up" @class{$menu.top}="top" @class{not $menu.ready}="wait" --mjs-chart-menu-x={$menu.x} --mjs-chart-menu-y={$menu.y} --mjs-chart-menu-max={$menu.max} @keydown={menuKey(e)} @pointerdown={hold(e)} @mousedown={e.preventDefault()}>{for f in $data.forms by name}<button type="button" class="item" role="menuitemradio" tabindex="-1" aria-checked={f.name is $data.form ? 'true' : 'false'} aria-disabled={f.off ? 'true' : null} @click={choose(f, e)}><svg class="glyph glyph-{f.name}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d={f.d}/></svg>{$draw.texts.forms[f.name]}</button>{end}</div>{end}
        </div>
      {end}
      {if $data.tools.stats}<div class="kit" role="group" aria-label={$draw.texts.stats}>{for m in $data.checks by name}<label class="pill" @class{m.on}="on" @class{m.off}="off"><input type="checkbox" class="box" checked={m.on} disabled={m.off} @change={toggleStat(m.name)}><svg class="sample" viewBox="0 0 26 8" aria-hidden="true" focusable="false"><path class="stat stat-{m.name}" d="M 1 4 L 18 4"/>{if m.name is 'trend'}<circle class="ghost" cx="22" cy="4" r="3"/>{end}</svg>{$draw.texts.marks[m.name]}</label>{end}</div>{end}
      {if $data.paces.length}<div class="kit" role="radiogroup" aria-label={$draw.texts.step}>{for p in $data.paces by name}<label class="pill" @class{p.on}="on" @class{p.off}="off"><input type="radio" class="box" name="step" value={p.name} checked={p.on} disabled={p.off} @change={pace(p.name)}>{$draw.texts.paces[p.name]}</label>{end}</div>{end}
    </div>
  {end}
  <!-- @@ -->
  {if $data.family is 'axes'}
    <div class="frame" part="frame" --mjs-chart-gutter={gutterOf($draw.yLabels, $input.width, measure)}>
      <div class="plot" part="plot" @this=!{plotRef}>
        <svg class="svg" aria-hidden="true" focusable="false" @this=!{svgRef}>
          <svg class="draw" viewBox="0 0 1000 300" preserveAspectRatio="none" width="100%" height="100%">
            {for t in $draw.ticks by v}<line class="grid" x1="0" x2="1000" y1={t.y * 3} y2={t.y * 3}/>{end}
            {if $data.form is 'area'}{for l in $draw.paths by key}<path class="area tone-{l.hue}" --mjs-chart-tone={l.custom} d={l.area}/>{end}{end}
            {if $data.form is 'line' or $data.form is 'area'}{for l in $draw.paths by key}<path class="line tone-{l.hue}" --mjs-chart-tone={l.custom} d={l.d}/>{end}{end}
            {for b in $draw.bars by id}<rect class="bar tone-{b.hue}" @class{$hover is b.i}="on" --mjs-chart-tone={b.custom} x={b.x} y={b.y} width={b.w} height={b.h}/>{end}
            {for s in $draw.stats by id}<path class="stat stat-{s.name} tone-{s.hue}" --mjs-chart-tone={s.custom} d={s.d}/>{end}
            {for t in $draw.trends by key}<path class="trend stat-trend tone-{t.hue}" --mjs-chart-tone={t.custom} d={t.d}/>{end}
          </svg>
          {for t in $draw.yLabels by v}<text class="ylabel" x="-8" y="{t.y}%">{t.text}</text>{end}
          {for l in xLabelsOf($data, $input.width, measure, $draw.texts.lang) by i}<text class="xlabel" x="{l.x}%" y="100%" dy="1.45em" text-anchor={l.anchor}>{l.text}</text>{end}
          {for d in $draw.dots by id}<circle class="dot tone-{d.hue}" --mjs-chart-tone={d.custom} cx="{d.x}%" cy="{d.y}%" r={$draw.dotSize}/>{end}
          {for t in $draw.trends by key}<circle class="ghost tone-{t.hue}" --mjs-chart-tone={t.custom} cx="{t.x}%" cy="{t.y}%" r="4.5"/>{end}
          {if $tip}
            <line class="cursor" x1="{$tip.x}%" x2="{$tip.x}%" y1="0" y2="100%"/>
            {for m in $tip.marks by key}<circle class="mark tone-{m.hue}" --mjs-chart-tone={m.custom} cx="{m.x}%" cy="{m.y}%" r="4.5"/>{end}
          {end}
        </svg>
        {if $data.empty}<p class="empty" part="empty">{$draw.texts.empty}</p>{end}
        <div class="hit" part="hit" @this=!{hitRef} tabindex={(flag($pickable) or $data.reads) ? 0 : null} role={(flag($pickable) or $data.reads) ? 'group' : null} aria-label={$data.reads ? $draw.texts.browse : (flag($pickable) ? $draw.texts.hint : null)} @pointermove={onMove(e)} @pointerdown={onDown(e)} @pointerout={onOut(e)} @click={onClick(e)} @keydown={onKey(e)} @blur={onBlur()}></div>
        {if $tip}
          <div class="tip" part="tip" aria-hidden="true" data-side={$spot.side} @class{not $spot.ready}="wait" --mjs-chart-tip-x={$spot.x} @this=!{tipRef}>
            <b>{$tip.title}</b>
            {if $tip.grouped}<em class="grouped">{$tip.grouped}</em>{end}
            {for r in $tip.rows by key}<span class="row tone-{r.hue}" @class{r.word}="word" @class{r.total}="total" --mjs-chart-tone={r.custom}><i class="swatch"></i>{r.name} <strong>{r.text}</strong></span>{end}
          </div>
        {end}
      </div>
    </div>
  {elsif $data.family is 'pie'}
    <div class="pie" part="pie">
      <div class="ring" part="ring" tabindex={$data.empty ? null : 0} role={$data.empty ? null : 'group'} aria-label={$data.empty ? null : $draw.texts.browse} @keydown={onKey(e)} @blur={onBlur()}>
        <svg class="disc" viewBox="0 0 100 100" aria-hidden="true" focusable="false" @pointerover={over(e)} @pointerdown={press(e)} @pointerout={onOut(e)} @click={press(e)}>
          <circle class="track" cx="50" cy="50" r="38.5"/>
          {for s in $draw.slices by key}<path class="slice tone-{s.hue}" @class{s.pale}="pale" @class{s.others}="others" @class{$hover is s.i}="on" --mjs-chart-tone={s.custom} data-i={s.i} d={s.d}/>{end}
        </svg>
        {if $data.empty and not $data.model.none}<p class="empty" part="empty">{$draw.texts.empty}</p>{end}
        {if not $data.empty}<p class="center" part="center">{if $tip}<b>{$tip.amount}</b><small>{$tip.share}</small><small class="name">{$tip.title}</small>{else}<b>{$draw.total}</b><small>{$draw.texts.total}</small>{end}</p>{end}
      </div>
      {if $data.model.none}<p class="note" part="note">{$draw.texts.none}</p>{end}
      {if not $data.empty}<ul class="legend" part="legend" @pointerover={over(e)} @pointerdown={press(e)} @pointerout={onOut(e)} @click={press(e)}>{for s in $draw.slices by key}<li class="part tone-{s.hue}" @class{s.pale}="pale" @class{s.others}="others" @class{$hover is s.i}="on" --mjs-chart-tone={s.custom} data-i={s.i}><i class="swatch"></i><span class="name">{s.label}</span> <strong>{s.amount}</strong> <small>{s.share}</small></li>{end}</ul>{end}
    </div>
  {elsif $data.empty}
    <div class="blank" part="blank"><p class="empty" part="empty">{$draw.texts.empty}</p></div>
  {elsif $data.family is 'heat'}
    <div class="heat" part="heat" tabindex="0" role="group" aria-label={flag($pickable) ? $draw.texts.choose : $draw.texts.browse} @keydown={onKey(e)} @blur={onBlur()}>
      <div class="names" aria-hidden="true">{for n in $draw.names by k}<span class="name">{n.text}</span>{end}</div>
      <div class="field" part="plot" @this=!{plotRef}>
        <svg class="cells" viewBox={$draw.view} preserveAspectRatio="none" width="100%" height={$draw.high} aria-hidden="true" focusable="false" @pointerover={over(e)} @pointerdown={press(e)} @pointerout={onOut(e)} @click={press(e)}>{for c in $draw.cells by i}<rect class="cell tone-{c.hue} level-{c.level}" @class{$hover is c.i}="on" --mjs-chart-tone={c.custom} data-i={c.i} x={c.x} y={c.y} width="0.9" height="0.86"/>{end}</svg>
        <svg class="svg" aria-hidden="true" focusable="false" @this=!{svgRef}>{for l in xLabelsOf($data, $input.width, measure, $draw.texts.lang) by i}<text class="xlabel" x="{l.x}%" y="100%" dy="1.45em" text-anchor={l.anchor}>{l.text}</text>{end}</svg>
      </div>
    </div>
  {elsif $data.family is 'radar'}
    <div class="radar" part="radar">
      <div class="dial" part="dial" tabindex="0" role="group" aria-label={flag($pickable) ? $draw.texts.choose : $draw.texts.browse} @keydown={onKey(e)} @blur={onBlur()}>
        <div class="side" aria-hidden="true">{for a in $draw.sides by i}<span>{a.text}</span>{end}</div>
        <div class="face">
          <svg class="web" viewBox="0 0 100 100" width="300" height="300" aria-hidden="true" focusable="false" @pointerover={over(e)} @pointerdown={press(e)} @pointerout={onOut(e)} @click={press(e)}>
            {for r in $draw.mesh by value}<polygon class="mesh" points={r.points}/>{end}
            {for a in $draw.axes by i}<line class="spoke" @class{$hover is a.i}="on" x1="50" y1="50" x2={a.x} y2={a.y}/>{end}
            {for s in $draw.shapes by key}<polygon class="shape tone-{s.hue}" --mjs-chart-tone={s.custom} points={s.points}/>{end}
            {for v in $draw.vertices by id}<circle class="vertex tone-{v.hue}" @class{$hover is v.i}="on" --mjs-chart-tone={v.custom} cx={v.x} cy={v.y} r="1.6"/>{end}
            {for a in $draw.axes by i}<path class="wedge" data-i={a.i} d={a.wedge}/>{end}
          </svg>
          <svg class="poles" aria-hidden="true" focusable="false">{for a in $draw.poles by i}<text class="pole" @class{$hover is a.i}="on" x="{a.x}%" y="{a.y}%" text-anchor={a.anchor}>{a.text}</text>{end}</svg>
        </div>
        <div class="side" aria-hidden="true">{for a in $draw.sides by i}<span>{a.text}</span>{end}</div>
      </div>
    </div>
  {elsif $data.family is 'calendar'}
    <div class="calendar" part="calendar" tabindex="0" role="group" aria-label={flag($pickable) ? $draw.texts.choose : $draw.texts.browse} @keydown={onKey(e)} @blur={onBlur()}>
      <svg class="days" viewBox={$draw.view} width={$draw.wide} height={$draw.high} aria-hidden="true" focusable="false" @pointerover={over(e)} @pointerdown={press(e)} @pointerout={onOut(e)} @click={press(e)}>
        {for h in $draw.heads by col}<text class="head" x={h.x} y="11" text-anchor={h.anchor}>{h.text}</text>{end}
        {for d in $draw.days by row}<text class="day" x={d.x} y={d.y}>{d.text}</text>{end}
        {for c in $draw.cells by i}<rect class="cell tone-{$draw.tone.hue} level-{c.level}" @class{$hover is c.i}="on" --mjs-chart-tone={c.custom} data-i={c.i} x={c.x} y={c.y} width={$draw.w} height={$draw.h} rx="2"/>{end}
      </svg>
    </div>
  {end}
  {if $tip and $data.family isnt 'axes' and $data.family isnt 'pie'}
    <div class="tip" part="tip" aria-hidden="true" data-side={$spot.side} @class{not $spot.ready}="wait" --mjs-chart-tip-x={$spot.x} @this=!{tipRef}>
      <b>{$tip.title}</b>
      {for r in $tip.rows by key}<span class="row tone-{r.hue}" @class{r.hue is 0 and not r.custom}="plain" --mjs-chart-tone={r.custom}><i class="swatch"></i>{r.name} <strong>{r.text}</strong></span>{end}
    </div>
  {end}
  {if $draw.ramp and not $data.empty}
    <p class="ramp" part="ramp"><span class="key"><i class="swatch level-0"></i>{$draw.texts.empty}</span><span class="key">{$draw.texts.less} {for n in $draw.ramp.levels}<i class="swatch tone-{$draw.ramp.hue} level-{n}" --mjs-chart-tone={$draw.ramp.custom}></i>{end} {$draw.texts.more}</span></p>
  {end}
  {if $data.model.own and not $data.empty}<p class="note" part="note">{$draw.texts.own}</p>{end}
  {if $draw.keys.length and not $data.empty}
    <p class="keys" part="keys">{for k in $draw.keys by name}<span class="key"><svg class="sample" viewBox="0 0 26 8" aria-hidden="true" focusable="false"><path class="stat stat-{k.name}" d="M 1 4 L 18 4"/>{if k.name is 'trend'}<circle class="ghost" cx="22" cy="4" r="3"/>{end}</svg>{k.text}</span>{end}</p>
  {end}
  <p class="sr" aria-live="polite">{saidOf($input.keyed, $tip)}</p>
  <div class="sr">
    <table>
      <caption>{$draw.texts.label}</caption>
      <thead><tr><th scope="col">{$draw.table.head}</th>{for c in $draw.table.columns by key}<th scope="col">{c.title}</th>{end}</tr></thead>
      <tbody>{for r in $draw.table.cells by k}<tr><th scope="row">{r.x}</th>{for v in r.values by key}<td>{v.text}</td>{end}</tr>{end}</tbody>
    </table>
  </div>
</div>
<@window @pointerdown={away(e)} @click={away(e)}>

<style @display="block">
  // les couleurs se règlent par le thème : les six teintes ($$chart-1 à $$chart-6), la grille ($$chart-grid), les axes ($$chart-axis), les
  // textes ($$chart-text), la bulle ($$chart-tip-bg, $$chart-tip-fg, $$chart-tip-border), le trait de chaque statistique ($$chart-stat-mean,
  // $$chart-stat-median, $$chart-stat-q1, $$chart-stat-q3, $$chart-stat-trend), la case vide ($$chart-empty) et la teinte neutre
  // ($$chart-neutral) ; chacune retombe sur la variable générale du thème, ou sur la teinte de la série
  :host
    font: inherit

  .chart
    position: relative
    display: flex
    flex-direction: column
    gap: 8px

  // la gouttière des graduations à gauche (à la mesure de la plus longue, cf. `gutterOf`), la place des étiquettes de l'axe x dessous :
  // réservées dès le premier rendu
  .frame
    padding: 8px 0 24px calc(var(--mjs-chart-gutter, 48) * 1px)

  .plot
    position: relative
    height: var(--mjs-chart-height, 180px)
    border-left: 1px solid var(--mjs-chart-axis, var(--mjs-border, color-mix(in srgb, currentColor 32%, transparent)))
    border-bottom: 1px solid var(--mjs-chart-axis, var(--mjs-border, color-mix(in srgb, currentColor 32%, transparent)))

  .svg
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    overflow: visible
    font-size: 11px
    font-variant-numeric: tabular-nums

  .draw
    overflow: visible

  text
    fill: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))

  .ylabel
    text-anchor: end
    dominant-baseline: middle

  .grid
    stroke: var(--mjs-chart-grid, var(--mjs-border, color-mix(in srgb, currentColor 32%, transparent)))
    stroke-opacity: .5
    stroke-width: 1
    vector-effect: non-scaling-stroke

  .tone-1
    --mjs-chart-tone: var(--mjs-chart-1, #3b82f6)

  .tone-2
    --mjs-chart-tone: var(--mjs-chart-2, #dd6b10)

  .tone-3
    --mjs-chart-tone: var(--mjs-chart-3, #16a34a)

  .tone-4
    --mjs-chart-tone: var(--mjs-chart-4, #db2777)

  .tone-5
    --mjs-chart-tone: var(--mjs-chart-5, #8b5cf6)

  .tone-6
    --mjs-chart-tone: var(--mjs-chart-6, #b7860b)

  // sans teinte (traits d'un histogramme, ligne du total, légende d'une carte à plusieurs séries) : la teinte neutre, la couleur du texte
  .tone-0
    --mjs-chart-tone: var(--mjs-chart-neutral, currentColor)

  // « autres », dans l'anneau : la teinte neutre, éclaircie
  .others
    --mjs-chart-tone: color-mix(in srgb, var(--mjs-chart-neutral, currentColor) 35%, transparent)

  .line
    fill: none
    stroke: var(--mjs-chart-tone)
    stroke-width: 2.2
    stroke-linejoin: round
    stroke-linecap: round
    vector-effect: non-scaling-stroke

  .area
    fill: var(--mjs-chart-tone)
    fill-opacity: .16

  .bar
    fill: var(--mjs-chart-tone)
    fill-opacity: .85

    &.on
      fill-opacity: 1
      stroke: currentColor
      stroke-width: 1.5
      vector-effect: non-scaling-stroke

  .stat, .trend
    fill: none
    stroke-width: 1.5
    stroke-opacity: .8
    vector-effect: non-scaling-stroke

  // une couleur (la teinte de la série sans réglage) et un style de trait par statistique
  .stat-mean
    stroke: var(--mjs-chart-stat-mean, var(--mjs-chart-tone, currentColor))
    stroke-dasharray: none

  .stat-median
    stroke: var(--mjs-chart-stat-median, var(--mjs-chart-tone, currentColor))
    stroke-dasharray: 10 4

  .stat-q1
    stroke: var(--mjs-chart-stat-q1, var(--mjs-chart-tone, currentColor))
    stroke-dasharray: 2 4

  .stat-q3
    stroke: var(--mjs-chart-stat-q3, var(--mjs-chart-tone, currentColor))
    stroke-dasharray: 8 3 2 3

  .stat-trend
    stroke: var(--mjs-chart-stat-trend, var(--mjs-chart-tone, currentColor))
    stroke-width: 2
    stroke-dasharray: 6 6

  .dot
    fill: var(--mjs-chart-tone)

  .ghost
    fill: none
    stroke: var(--mjs-chart-stat-trend, var(--mjs-chart-tone, currentColor))
    stroke-width: 2

  .cursor
    stroke: currentColor
    stroke-opacity: .45
    stroke-width: 1

  .mark
    fill: var(--mjs-chart-tone)
    stroke: var(--mjs-surface, Canvas)
    stroke-width: 2
    transform-box: fill-box
    transform-origin: center
    transition: transform .12s ease

  .hit
    position: absolute
    inset: 0
    z-index: 2
    cursor: crosshair
    touch-action: pan-y
    -webkit-tap-highlight-color: transparent

    &:focus
      outline: none

    &:focus-visible
      outline: 2px solid var(--mjs-accent, #3b82f6)
      outline-offset: 2px

  // un graphique qu'on choisit s'allume au survol, au focus et à l'appui
  .pickable
    .hit
      cursor: pointer

    .cursor
      stroke: var(--mjs-accent, #3b82f6)
      stroke-opacity: .8

    .plot:has(.hit:active) .mark
      transform: scale(1.35)

  .void .hit
    cursor: default

  .tip
    position: absolute
    top: 4px
    left: calc(var(--mjs-chart-tip-x, 0) * 1px)
    z-index: 3
    display: flex
    flex-direction: column
    gap: 3px
    box-sizing: border-box
    width: max-content
    min-width: 130px
    max-width: min(260px, 70vw)
    padding: 8px 10px
    border: 1px solid var(--mjs-chart-tip-border, var(--mjs-border, color-mix(in srgb, currentColor 22%, transparent)))
    border-radius: 8px
    background: var(--mjs-chart-tip-bg, var(--mjs-surface, Canvas))
    color: var(--mjs-chart-tip-fg, var(--mjs-fg, CanvasText))
    box-shadow: 0 8px 24px var(--mjs-shadow, rgba(0, 0, 0, .18))
    font-size: 12px
    line-height: 1.35
    pointer-events: none
    transition: opacity .12s ease

    &.wait
      opacity: 0

    b
      font-weight: 600

    .grouped
      font-size: 11px
      font-style: normal
      opacity: .7

  .row
    display: flex
    align-items: baseline
    gap: 6px

    strong
      margin-left: auto
      padding-left: 10px
      font-weight: 600
      font-variant-numeric: tabular-nums
      white-space: nowrap

    &.word strong
      min-width: 0
      white-space: normal
      overflow-wrap: anywhere
      text-align: right

    &.plain .swatch
      visibility: hidden

    &.total
      margin-top: 2px
      padding-top: 4px
      border-top: 1px solid var(--mjs-chart-tip-border, var(--mjs-border, color-mix(in srgb, currentColor 22%, transparent)))

      .swatch
        visibility: hidden

  .swatch
    display: inline-block
    flex: none
    align-self: center
    width: 10px
    height: 10px
    border-radius: 3px
    background: var(--mjs-chart-tone)

  .empty
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    margin: 0
    color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
    font-size: 13px
    opacity: .75
    pointer-events: none

  .note, .keys
    margin: 0
    color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
    font-size: 11px
    opacity: .85

  .keys
    display: flex
    flex-wrap: wrap
    gap: 4px 14px

  .key
    display: inline-flex
    align-items: center
    gap: 6px

  .sample
    width: 26px
    height: 8px
    overflow: visible

  // @@ toolbar
  // la barre d'outils, au-dessus du cadre : des pastilles, qui passent à la ligne quand la place manque
  .tools
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 6px 14px
    color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
    font-size: 12px

  .kit
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 4px

  // une pastille (série, forme, statistique, pas) s'allume au survol (contour, halo), au focus clavier (contour d'accent) et à l'appui
  // (léger rétrécissement) ; grisée, elle ne réagit plus
  .pill
    position: relative
    display: inline-flex
    align-items: center
    gap: 6px
    box-sizing: border-box
    min-height: 28px
    padding: 3px 10px
    border: 1px solid var(--mjs-chart-grid, var(--mjs-border, color-mix(in srgb, currentColor 32%, transparent)))
    border-radius: 999px
    background: none
    color: inherit
    font: inherit
    line-height: 1.2
    white-space: nowrap
    cursor: pointer
    -webkit-tap-highlight-color: transparent
    transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease, transform .1s ease

    &:not(.off):hover
      border-color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mjs-chart-neutral, currentColor) 14%, transparent)

    &:focus
      outline: none

    &:focus-visible, &:has(.box:focus-visible)
      outline: 2px solid var(--mjs-accent, currentColor)
      outline-offset: 2px

    &:not(.off):active
      transform: scale(.96)

    &.on
      border-color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
      background: color-mix(in srgb, var(--mjs-chart-neutral, currentColor) 12%, transparent)
      color: var(--mjs-chart-tip-fg, var(--mjs-fg, CanvasText))

    &.off
      opacity: .45
      cursor: not-allowed

  // une série visible : sa teinte en contour et en fond léger ; cachée, sa pastille se vide
  .series
    border-color: color-mix(in srgb, var(--mjs-chart-tone) 60%, transparent)
    background: color-mix(in srgb, var(--mjs-chart-tone) 12%, transparent)
    color: var(--mjs-chart-tip-fg, var(--mjs-fg, CanvasText))

    &.dim
      border-color: var(--mjs-chart-grid, var(--mjs-border, color-mix(in srgb, currentColor 32%, transparent)))
      background: none
      color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))

      .swatch
        background: none
        box-shadow: inset 0 0 0 1.5px var(--mjs-chart-tone)

  // la case ou le bouton radio reste lu au clavier et par les lecteurs d'écran, la pastille le montre
  .box
    position: absolute
    width: 1px
    height: 1px
    margin: 0
    opacity: 0
    pointer-events: none

  .picker
    position: relative

  .glyph
    flex: none
    width: 16px
    height: 16px
    fill: none
    stroke: currentColor
    stroke-width: 1.5
    stroke-linecap: round
    stroke-linejoin: round

  .glyph-area
    fill: currentColor
    fill-opacity: .2

  .glyph-dots
    stroke-width: 3

  .glyph-bar, .glyph-stack, .glyph-histogram, .glyph-pie
    stroke-width: 3
    stroke-linecap: butt

  .chevron
    width: 12px
    height: 12px
    margin-right: -3px
    fill: none
    stroke: currentColor
    stroke-width: 1.6
    stroke-linecap: round
    stroke-linejoin: round
    transition: transform .15s ease

  .pick[aria-expanded="true"] .chevron
    transform: rotate(180deg)

  // le menu des formes : sous son bouton (au-dessus quand la place manque), décalé et borné pour rester dans l'écran ; dans la couche du
  // dessus (`.top`), posé sur l'écran, la feuille native de [popover] remise (inset: 0 et margin: auto le tireraient vers le centre)
  .menu
    position: absolute
    top: calc(100% + 4px)
    left: calc(var(--mjs-chart-menu-x, 0) * 1px)
    z-index: 5
    display: flex
    flex-direction: column
    gap: 1px
    box-sizing: border-box
    min-width: 190px
    max-width: calc(100vw - 20px)
    max-height: calc(var(--mjs-chart-menu-max, 320) * 1px)
    overflow-y: auto
    padding: 4px
    border: 1px solid var(--mjs-chart-tip-border, var(--mjs-border, color-mix(in srgb, currentColor 22%, transparent)))
    border-radius: 10px
    background: var(--mjs-chart-tip-bg, var(--mjs-surface, Canvas))
    color: var(--mjs-chart-tip-fg, var(--mjs-fg, CanvasText))
    box-shadow: 0 8px 24px var(--mjs-shadow, color-mix(in srgb, CanvasText 18%, transparent))
    transition: opacity .12s ease

    &.up
      top: auto
      bottom: calc(100% + 4px)

    &.top
      position: fixed
      inset: auto
      top: calc(var(--mjs-chart-menu-y, 0) * 1px)
      left: calc(var(--mjs-chart-menu-x, 0) * 1px)
      margin: 0

      &.up
        top: auto
        bottom: calc(var(--mjs-chart-menu-y, 0) * 1px)

    &.wait
      opacity: 0

  .item
    display: flex
    align-items: center
    gap: 10px
    padding: 7px 10px
    border: 0
    border-radius: 7px
    background: none
    color: inherit
    font: inherit
    font-size: 13px
    text-align: left
    white-space: nowrap
    cursor: pointer
    transition: background-color .12s ease, transform .1s ease

    &[aria-checked="true"]
      background: color-mix(in srgb, var(--mjs-accent, currentColor) 14%, transparent)
      font-weight: 600

    &:hover, &:focus-visible
      background: color-mix(in srgb, var(--mjs-chart-neutral, currentColor) 14%, transparent)

    &:focus
      outline: none

    &:focus-visible
      outline: 2px solid var(--mjs-accent, currentColor)
      outline-offset: -2px

    &:not([aria-disabled="true"]):active
      transform: scale(.98)

    &[aria-disabled="true"]
      opacity: .45
      cursor: not-allowed
  // @@

  // l'anneau à gauche, sa légende à droite, dessous quand la place manque
  .pie
    display: flex
    flex-wrap: wrap
    align-items: center
    justify-content: center
    gap: 12px 20px

  .ring
    position: relative
    flex: none
    width: var(--mjs-chart-height, 180px)
    height: var(--mjs-chart-height, 180px)
    border-radius: 50%
    -webkit-tap-highlight-color: transparent

    &:focus
      outline: none

    &:focus-visible
      outline: 2px solid var(--mjs-accent, #3b82f6)
      outline-offset: 2px

  .disc
    display: block
    width: 100%
    height: 100%
    overflow: visible

  .track
    fill: none
    stroke: color-mix(in srgb, var(--mjs-chart-neutral, currentColor) 10%, transparent)
    stroke-width: 17

  .slice
    fill: var(--mjs-chart-tone)
    fill-rule: evenodd
    stroke: var(--mjs-surface, Canvas)
    stroke-width: 1
    vector-effect: non-scaling-stroke
    cursor: pointer
    transform-origin: 50px 50px
    transition: transform .15s ease

    &.on
      transform: scale(1.04)

    // au-delà de six parts, une teinte revient : plus pâle, elle se distingue de la première
    &.pale
      fill-opacity: .55

  .center
    position: absolute
    inset: 0
    display: flex
    flex-direction: column
    align-items: center
    justify-content: center
    gap: 1px
    margin: 0
    padding: 0 22%
    text-align: center
    pointer-events: none

    b
      font-size: 17px
      font-weight: 600
      font-variant-numeric: tabular-nums

    small
      color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
      font-size: 11px

    .name
      max-width: 100%
      overflow: hidden
      text-overflow: ellipsis
      white-space: nowrap

  .legend
    display: flex
    flex: 1 1 170px
    flex-direction: column
    gap: 2px
    min-width: 0
    max-width: 320px
    margin: 0
    padding: 0
    list-style: none

  .part
    display: flex
    align-items: center
    gap: 8px
    padding: 3px 8px
    border-radius: 6px
    font-size: 12.5px
    transition: background-color .15s ease

    &.on
      background: color-mix(in srgb, var(--mjs-chart-tone) 16%, transparent)

    &.pale .swatch
      opacity: .55

    .name
      flex: 1
      min-width: 0
      overflow: hidden
      text-overflow: ellipsis
      white-space: nowrap

    strong
      font-weight: 600
      font-variant-numeric: tabular-nums
      white-space: nowrap

    small
      min-width: 44px
      color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
      font-size: 11px
      font-variant-numeric: tabular-nums
      text-align: right
      white-space: nowrap

  // une case sans valeur : neutre, tirée de la couleur du texte ; cinq niveaux, la teinte de la série plus ou moins couvrante
  .level-0
    --mjs-chart-tone: var(--mjs-chart-empty, color-mix(in srgb, currentColor 12%, transparent))

  .level-1
    --mjs-chart-alpha: .2

  .level-2
    --mjs-chart-alpha: .4

  .level-3
    --mjs-chart-alpha: .6

  .level-4
    --mjs-chart-alpha: .8

  // une case reçoit le pointeur jusqu'au milieu de l'écart qui la sépare de ses voisines
  .cell
    fill: var(--mjs-chart-tone)
    fill-opacity: var(--mjs-chart-alpha, 1)
    stroke: transparent
    stroke-width: 5px
    vector-effect: non-scaling-stroke
    transition: fill-opacity .2s ease

    &.on
      stroke: currentColor
      stroke-width: 2px

  .pickable .cell, .pickable .wedge
    cursor: pointer

  .blank
    position: relative
    min-height: 120px

  .heat, .dial, .calendar
    border-radius: 6px
    -webkit-tap-highlight-color: transparent

    &:focus
      outline: none

    &:focus-visible
      outline: 2px solid var(--mjs-accent, #3b82f6)
      outline-offset: 2px

  // la carte : les noms des lignes à gauche (abrégés d'un « … » quand la place manque), la grille à droite, les heures ou les libellés dessous
  .heat
    display: grid
    grid-template-columns: fit-content(40%) minmax(0, 1fr)
    column-gap: 8px
    padding: 4px 0 24px

  .names
    display: grid
    grid-auto-rows: 1fr
    min-width: 0
    color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
    font-size: 11px

  .name
    align-self: center
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
    text-align: right

  .field
    position: relative
    min-width: 0

    .svg
      pointer-events: none

  .cells
    display: block
    overflow: visible
    touch-action: pan-y

  // le radar : la toile discrète, un polygone par série et ses sommets ; l'axe survolé s'allume. Les noms des branches gardent la taille des
  // autres textes à toute largeur : de part et d'autre, une colonne (les noms des côtés, cachés) leur réserve la place, la toile se resserre
  // entre les deux
  .radar
    display: flex
    justify-content: center

  .dial
    display: grid
    grid-template-columns: max-content minmax(0, 300px) max-content
    min-width: 0
    max-width: 100%

  .side
    height: 0
    overflow: hidden
    visibility: hidden
    font-size: 11px
    font-weight: 600
    white-space: nowrap

    span
      display: block

  .face
    position: relative
    min-width: 0

  .poles
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    overflow: visible
    pointer-events: none
    font-size: 11px

  // le calendrier se resserre sur un écran étroit, dessin et textes ensemble ; la toile du radar suit sa colonne
  .web, .days
    display: block
    max-width: 100%
    height: auto
    overflow: visible
    touch-action: pan-y

  .web
    width: 100%

  .mesh
    fill: none
    stroke: var(--mjs-chart-grid, var(--mjs-border, color-mix(in srgb, currentColor 32%, transparent)))
    stroke-width: .4

  .spoke
    stroke: var(--mjs-chart-axis, var(--mjs-border, color-mix(in srgb, currentColor 32%, transparent)))
    stroke-width: .3

    &.on
      stroke: currentColor
      stroke-width: .6

  .shape
    fill: var(--mjs-chart-tone)
    fill-opacity: .2
    stroke: var(--mjs-chart-tone)
    stroke-width: 1
    stroke-linejoin: round

  .vertex
    fill: var(--mjs-chart-tone)
    transform-box: fill-box
    transform-origin: center
    transition: transform .12s ease

    &.on
      transform: scale(1.6)

  .pole
    font-weight: 600
    dominant-baseline: middle

    &.on
      fill: currentColor

  .wedge
    fill: transparent

  .calendar
    max-width: 100%

  .days
    font-size: 10px

  .day
    text-anchor: end
    dominant-baseline: middle

  // la légende d'intensité : « aucune valeur », puis « moins », les cinq niveaux, « plus »
  .ramp
    display: flex
    flex-wrap: wrap
    gap: 4px 14px
    margin: 0
    color: var(--mjs-chart-text, var(--mjs-fg-muted, currentColor))
    font-size: 11px

    .key
      gap: 3px

    .swatch
      opacity: var(--mjs-chart-alpha, 1)

  .sr
    position: absolute
    width: 1px
    height: 1px
    margin: -1px
    padding: 0
    border: 0
    overflow: hidden
    clip-path: inset(50%)
    white-space: nowrap

  @media (prefers-reduced-motion: reduce)
    .tip, .mark, .slice, .part, .cell, .vertex
      transition: none

    // @@ toolbar
    .pill, .item, .menu, .chevron
      transition: none

    .pill:not(.off):active, .item:not([aria-disabled="true"]):active
      transform: none
    // @@
</style>
