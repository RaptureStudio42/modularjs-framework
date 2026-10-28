// runtime-labels — libellés par défaut (fr/en) des petits bouts d'UI émis DIRECTEMENT par le
// runtime navigateur (pas par le catalogue messages/, réservé au Node CLI/bundler/serveur — cf.
// src/messages/index.ts). Racine `src/` (à côté de sigils.ts) : importé côté BUNDLER/Node
// (bundler/index.ts) pour être sérialisé dans le manifest — jamais embarqué tel quel dans le
// bundle navigateur.
//
// Groupe `core` : libellés par défaut des modules cœur (<@@nom>), lus par chaque module au rendu
// (`µ._mjs_label('core', clé)`) ; un libellé donné par l'auteur sur la balise passe avant. Le manifeste n'en
// pose que les clés des modules que le build emporte (CORE_LABEL_MODULES, plus bas).
//
// Groupe `fx` : libellés par défaut des effets qui écrivent un texte (*guard, *offline, *loader, *spoiler, *flipcard),
// lus par l'aide commune `µ._mjs_fxLabel(clé)` (mjs_fx_toollabel.ts). Même découpe que `core` : le manifeste n'en pose
// que les clés des effets que le build emporte (FX_LABEL_EFFECTS, plus bas).
//
// Structure NAMESPACÉE (`modal: {...}`) délibérément, même si un seul groupe existe aujourd'hui —
// laisse la place à d'autres chaînes runtime qui migreraient un jour hors du texte en dur, sans
// re-designer la forme du manifest.
//
// Le manifest (writeManifest, bundler/index.ts) sérialise ICI TOUTES les
// langues (posé INCONDITIONNELLEMENT, contrairement à `µ._i18nData` qui ne s'émet que si
// `sourceDir/i18n/` existe : les libellés de modale doivent être dans TOUS les builds) : plus une
// seule langue figée au build. Le choix de la langue AFFICHÉE se fait au runtime, via
// `µ._mjs_label(group, key)`/`µ._mjs_labelLang()` (mjs_init.ts) — consommateurs mjs_modal.ts (groupes
// modal/toast), mjs_router.ts (groupe router) et mjs_ujs.ts (groupe ujs, panneau 404 + échec
// d'envoi), mjs_fx_guard.ts, mjs_fx_offline.ts, mjs_fx_loader.ts, mjs_fx_spoiler.ts et mjs_fx_flipcard.ts (groupe fx,
// par l'aide commune mjs_fx_toollabel.ts).
//
// SURCHARGE PROJET : cette table n'est que le DERNIER recours. `µ._mjs_label`
// consulte D'ABORD le dictionnaire i18n du projet (`µ._mjs_i18nLookup`, mjs_i18n.ts) sur une clé racine
// réservée `mjs.<groupe>.<clé>` (ex. `mjs.toast.success`, `mjs.modal.cancel`) — utile pour une
// langue absente d'ici (allemand, espagnol…) ou pour changer un seul mot sans toucher ce fichier.
// Cf. docs/29-i18n.md « Libellés du framework ».
//
// Groupe `err` : les messages que le framework écrit dans la console du navigateur (avertissements,
// erreurs levées), lus par `µ._mjs_msg(clé, variables, secours)` (mjs_init.ts) — `{nom}` = variable,
// préfixe [ModularJS] posé par l'assistant. Rangés par fichier d'origine. Groupe `dev` : même
// mécanique pour les fichiers qui ne partent que dans un build de développement (mjs_hotcss,
// mjs_devpanel, mjs_devinspect) ; `runtimeLabelsFor(true)` le retire du manifeste d'un build prod,
// avec `err`, qui part alors dans un fichier par langue (`runtimeMessagesFor`).
export const RUNTIME_LABELS = {
  fr: {
    modal:  { ok: 'OK', cancel: 'Annuler', deny: 'Non' },
    router: { notFound: 'Page introuvable', noRoute: 'Aucune route ne correspond à cette adresse.', declared: 'Routes déclarées' },
    toast:  { success: 'Succès', error: 'Erreur', warning: 'Attention', info: 'Info' },
    ujs:    { sendFailed: 'Échec de l\'envoi — le serveur n\'a pas répondu.' },
    core:   { carouselPrev: 'Précédent', carouselNext: 'Suivant', codeCopy: 'Copier le code', codeCopied: 'Copié !', selectPlaceholder: 'Choisir…', selectSearch: 'Rechercher…', selectEmpty: 'Aucun résultat', selectOther: 'Autre…', selectOtherPlaceholder: 'Précisez', selectOtherHint: 'Entrée pour valider · Échap pour revenir', selectOtherOk: 'Valider', selectOtherSep: '\u00a0: ', numberLabel: 'Nombre', numberLess: 'Moins', numberMore: 'Plus', numberBigLess: 'Diminuer de {n}', numberBigMore: 'Augmenter de {n}', gaugeLabel: 'Nombre', knobLabel: 'Valeur', progressLabel: 'Progression', colorLabel: 'Couleur', menuLabel: 'Menu', clockHours: 'Heures', clockMinutes: 'Minutes', clockSeconds: 'Secondes', editorLabel: 'Éditeur de texte', editorPlaceholder: 'Écrivez ici…', toolbarLabel: 'Mise en forme', toolH2: 'Titre', toolH3: 'Sous-titre', toolQuote: 'Citation', toolBold: 'Gras', toolItalic: 'Italique', toolUnderline: 'Souligné', toolStrike: 'Barré', toolUl: 'Liste à puces', toolOl: 'Liste numérotée', toolCheck: 'Liste à cocher', toolLink: 'Lien', toolUndo: 'Annuler', toolRedo: 'Rétablir', toolClear: 'Effacer la mise en forme', toolColor: 'Couleur du texte', toolbarShift: 'Maj', linkLabel: 'Adresse du lien', linkApply: 'Appliquer', linkRemove: 'Retirer le lien', linkCancel: 'Annuler', linkDone: 'Lien enregistré', colorsLabel: 'Couleur du texte', colorNone: 'Aucune couleur', colorGray: 'Gris', colorBrown: 'Marron', colorOrange: 'Orange', colorYellow: 'Jaune', colorGreen: 'Vert', colorBlue: 'Bleu', colorPurple: 'Violet', colorPink: 'Rose', colorRed: 'Rouge', boxChecked: 'Case cochée', boxUnchecked: 'Case non cochée', checked: 'Case cochée', unchecked: 'Case décochée', chartLabel: 'Graphique', chartEmpty: 'Aucune valeur', chartHint: 'Flèches pour parcourir les points, Entrée pour choisir', chartGrouped: 'Moyenne de {n} valeurs', chartWeekOf: 'Semaine du {date}', chartOwnScale: 'Une échelle par série\u00a0: leurs unités diffèrent', chartMean: 'Moyenne', chartMedian: 'Médiane', chartQ1: 'Premier quartile', chartQ3: 'Troisième quartile', chartTrend: 'Tendance', chartNext: 'le cercle\u00a0: le point suivant estimé', chartDate: 'Date', chartTime: 'Date et heure', chartNumber: 'Valeur', chartCategory: 'Libellé', chartPeriod: 'Période', chartTotal: 'Total', chartOthers: 'Autres', chartRange: 'De {from} à {to}', chartCount: 'Valeurs', chartBin: 'Classe', chartSeries: 'Série', chartShare: 'Part', chartPieNone: 'L\'anneau ne convient pas à ces données\u00a0: il compare plusieurs séries de même unité, ou des libellés', chartBrowse: 'Flèches pour parcourir les valeurs', chartChoose: 'Flèches pour parcourir les valeurs, Entrée pour choisir', chartLess: 'Moins', chartMore: 'Plus', chartDayHour: 'Jour et heure', chartTools: 'Outils du graphique', chartLegend: 'Séries affichées', chartShape: 'Forme', chartShapeOf: 'Forme\u00a0: {shape}', chartLine: 'Courbe', chartArea: 'Aire', chartDots: 'Points', chartBar: 'Barres', chartStack: 'Barres empilées', chartHistogram: 'Histogramme', chartPie: 'Anneau', chartHeatmap: 'Carte d\'intensité', chartRadar: 'Radar', chartCalendar: 'Calendrier', chartStats: 'Statistiques', chartStep: 'Pas de temps', chartAuto: 'Automatique', chartDay: 'Jour', chartWeek: 'Semaine', chartMonth: 'Mois', chartYear: 'Année' },
    fx:     { range: 'de {a} à {b}', atLeast: 'au moins {a}', atMost: 'au plus {b}', chars: 'de {a} à {b} caractères', charsMin: 'au moins {a} caractères', charsMax: 'au plus {b} caractères', or: 'ou', except: 'sauf', invalid: 'valeur refusée', offline: 'Hors ligne', loading: 'Chargement', pending1: '1 changement partira au retour du réseau', pendingN: '{n} changements partiront au retour du réseau', spoiler: 'Texte masqué, activer pour l\'afficher', flip: 'Retourner la carte' },
    err: {
      // mjs_vt_presets.ts
      vtMalformed: '@viewTransition : valeur malformée \'{name}\' — repli sur \'{namePart}\'.',
      vtDirName: '@viewTransition : la direction ne s\'écrit plus dans le nom (\'{namePart}\') — repli sur \'{base}\', posez \'dir\'/\'direction\' en option.',
      vtOptMalformed: '@viewTransition : option malformée \'{pair}\' dans \'{name}\' — ignorée.',
      vtUnknownKey: '@viewTransition : clé inconnue \'{rawKey}\' dans \'{name}\' — ignorée (clés valides : {keys}).',
      vtDupKey: '@viewTransition : clé \'{key}\' en double dans \'{name}\' (\'{key}\'/\'{short}\' désignent la même option) — 2e occurrence ignorée.',
      vtBadDir: '@viewTransition : direction invalide \'{val}\' dans \'{name}\' — ignorée.',
      vtBadDur: '@viewTransition : duration invalide \'{val}\' dans \'{name}\' — un nombre nu en millisecondes (comme setTimeout), ex. dur: 600 — ignorée.',
      vtBadPrio: '@viewTransition : priority invalide \'{val}\' dans \'{name}\' — ignorée.',
      vtUnknownPreset: '@viewTransition : préréglage inconnu \'{name}\' — valeurs valides : {presets}, {curtains} (pour orienter une base directionnelle : l\'option { dir: left }, le suffixe \':left\' a été retiré en v6).',
      vtLevitation: 'couche de lévitation VT abandonnée : {msg}',
      vtLevitationIn: 'couche de lévitation VT (arrivée) abandonnée : {msg}',
      vtSwapThrew: '@viewTransition : la permutation sous rideau a levé —',
      // mjs_modal.ts
      modalRead: 'la lecture de `{where}` a échoué : {reason}.',
      modalWantsText: '`{key}` attend du texte, reçu {type}.',
      modalNotText: '`{key}` n\'a pas pu être converti en texte : {reason}.',
      modalMapKeys: '`{key}` ressemble à une Map mais son `keys()` n\'est pas parcourable : {reason}.',
      modalNotIterable: '`{key}` n\'a pas pu être parcouru : {reason}.',
      modalGetFailed: '`{key}.get()` a échoué : {reason}.',
      modalOptsObject: 'les options doivent être un objet, reçu {type}.',
      modalWantsFn: '`{key}` doit être une fonction, reçu {type}.',
      modalIconString: '`icon` doit être une chaîne, reçu {type}.',
      modalInputString: '`input` doit être une chaîne, reçu {type}.',
      modalInputOptions: '`inputOptions` doit être un objet ou une Map, reçu {type}.',
      modalTimer: '`timer` doit être un nombre de millisecondes, reçu {got}.',
      modalCustomClass: '`customClass` doit être un objet, reçu {type}.',
      modalSoundType: '`sound` doit être un booléen ou une chaîne, reçu {type}.',
      modalNoBody: '`document.body` est absent — une modale ne peut pas être affichée à ce moment du chargement.',
      modalUnknownIcon: 'µ.modal.fire — icône inconnue « {v} », ignorée (attendu : {list}).',
      modalUnknownInput: 'µ.modal.fire — type d\'input inconnu « {v} », repli sur « text » (attendu : {list}).',
      modalSoundPath: 'µ.sound — chemin « {path} » non résoluble, aucun son : {reason}.',
      modalSoundUnknown: 'µ.sound — type inconnu « {type} », aucun son (attendu : {list}).',
      modalNotifyPos: 'µ.config.notifyPosition : valeur invalide (« {v} ») — repli \'top-right\'.',
      modalNotifyFlow: 'µ.config.notifyFlow : valeur invalide (« {v} ») — repli \'auto\'.',
      modalPreConfirm: 'µ.modal : preConfirm en échec —',
      modalValidator: 'µ.modal : inputValidator en échec —',
      // mjs_element.ts
      elProto: 'état : changement de prototype refusé',
      elCycle: 'Cycle réactif détecté sur \'{k}\' — retourne undefined',
      elTeardown: '@attach/@this teardown en erreur :',
      elOrphanInherited: 'Orphelin CSS hérité : La feuille \'{sheetName}\' est absente du registre.',
      elOrphanLocal: 'Orphelin CSS local : La feuille \'{sheetName}\' est introuvable.',
      elHydrate: 'hydratation demandée par la page mais absente du cœur : mode ssr:markers/positional/diff dans render, ou runtime: [\'hydrate\'].',
      elHydrateMismatch: '<{tag}> : les repères écrits par le serveur ne correspondent pas à ceux du navigateur — ce composant est reconstruit, sans le gain de la reprise. Cause probable : le serveur et le navigateur ont été construits différemment (autre « env », autres pages) ; construisez-les à l\'identique.',
      elLoop: 'Boucle réactive détectée sur <{tag}> : plus de 10 000 rendus dans la même rafale de microtasks. Un effet mute probablement sa propre dépendance ($x = $x + … dans un µeffect ?). Effets suspendus pour garder la page vivante.',
      elStructLoop: '<{tag}> : boucle de mutations structurelles détectée (20 passes) — re-render abandonné. Une var pilotant un {for}/{if} est probablement re-mutée par le rendu lui-même.',
      // mjs_store_globals.ts
      storeGWatch: 'µ._mjs_storeWatch : callback en erreur.',
      storeGProtoKey: 'µ.store : clé « {k} » refusée — elle appartient au prototype JavaScript, choisissez un autre nom.',
      storeGCycle: 'µ.store : cycle de computed détecté sur « {key} » — undefined retourné.',
      storeGKey: 'µ.store : clé refusée (« {key} ») — mutation ignorée.',
      storeGTheme: 'µtheme : « {value} » n\'est pas un thème déclaré — ignorée. Thèmes connus : {themes}.',
      storeGResKey: 'µ.res : clé refusée (« {k} ») — mutation ignorée.',
      storeGResTag: 'µres : balise __mjs_res illisible au boot, ignorée.',
      // mjs_runes.ts
      runesKey: 'µ.state : clé refusée (« {key} ») — mutation ignorée.',
      runesCycle: 'µ.state : cycle de computed détecté sur « {key} » — undefined retourné.',
      // mjs_every.ts
      everyInit: 'µevery doit être appelé à l\'initialisation.',
      everySyntax: 'µevery s\'écrit « µevery 2500, -> » : un délai en millisecondes, puis la fonction à répéter.',
      everyHash: 'µevery : le 2e argument est un hash d\'options (« µevery 3000, pause: true, -> ») — reçu :',
      everyOptType: 'µevery : option « {opt} » attendue de type {type}, reçu : ',
      everyIgnored: '— option ignorée.',
      everyUnknownOpt: 'µevery : option inconnue « {opt} ». Options reconnues : {list}.',
      everyTimes: 'µevery : option « times » attendue ≥ 0, reçu :',
      everyError: 'µevery :',
      everyWhileAsync: 'µevery : l\'option « while » doit rendre un booléen SYNCHRONE — une fonction async rend une promesse, toujours vraie, et la répétition ne s\'arrêterait jamais. Arrêt.',
      // mjs_dynamic.ts
      dynAccept: '<@element>/<@module> : accept attend une liste de noms (tableau ou chaîne séparée par des espaces)',
      dynRefused: '<@element>/<@module> : balise « {norm} » refusée — un élément dynamique ne peut pas devenir {norm} ; pour l\'autoriser explicitement : accept="{norm}".',
      dynNotListed: '<@element>/<@module> : balise « {norm} » refusée — hors de la liste accept="{list}" ; quand accept est présent, seuls les noms qu\'il liste sont créés.',
      dynInstance: '<@module> : impossible d\'instancier le composant. Passez le NOM de tag (chaîne kebab du custom element) plutôt que la classe.',
      // mjs_i18n.ts
      i18nMissing: 'i18n : clé « {key} » absente en « {lang} », repli sur « {def} »',
      i18nNoData: 'i18n : µ._i18nData jamais reçu, composants i18n en placeholder',
      i18nLoadSection: 'i18n : échec de chargement de « {section} » ({lang}) — {reason}',
      i18nLoadLang: 'i18n : échec de chargement de la langue « {lang} » ({url}) — {reason}',
      i18nHook: 'i18n : crochet de bascule en erreur :',
      i18nSecours: 'i18n : textes toujours absents après {ms} ms — le module paraît avec ⟦clé⟧ à la place de chaque texte absent, les textes les remplaceront à leur arrivée',
      // mjs_fx.ts
      fxLoad: 'effet « {name} » : son fichier ne s\'est pas chargé —',
      fxApply: 'effet « {name} » : sa pose a échoué —',
      fxRemove: 'retrait d\'effet en erreur :',
      // mjs_store.ts
      storeKey: 'µ.Store : clé refusée (« {prop} ») — mutation ignorée.',
      storeProto: 'store : changement de prototype refusé',
      // mjs_if.ts
      ifReintro: 'Échec re-intro:',
      ifDestroy: 'destruction de branche {if} en erreur :',
      ifDestroyNested: 'destruction de branche {if}/{key} imbriquée en erreur :',
      // mjs_fx_blend.ts
      blendCsp: '*blend : la politique de sécurité de la page refuse les images data: — le calque garde des coins carrés et un dégradé prend sa première couleur. Ajoutez data: à img-src pour les retrouver.',
      blendImage: '*blend : l\'image {src} n\'a pas pu être chargée, le calque reste vide.',
      blendNoSrc: '*blend : l\'image donnée n\'a pas d\'adresse, l\'effet n\'est pas posé.',
      // mjs_fx_fluid.ts
      fluidNoGl: '*fluid : ce navigateur ne sait pas faire tourner le fluide (WebGL avec textures demi-flottantes requis), l\'effet n\'est pas posé.',
      fluidTextComponent: '*fluid : sur un composant, `where: text` ne s\'applique pas (son texte est dans son intérieur, pas dans la balise) — le fluide est posé en `box` et le texte reste tel quel.',
      fluidColor: '*fluid : la couleur « {color} » ne se résout pas (variable absente ou valeur qui n\'est pas une couleur), elle est ignorée.',
      fluidNoContext: '*fluid : le navigateur ne donne plus de contexte WebGL à cette balise (il en limite le nombre par page, une quinzaine) — elle reste sans effet et réessaiera à son prochain survol ou quand elle reviendra à l\'écran.',
      blendFilter: '*blend : cette balise a déjà un `filter` en CSS, que l\'effet remplace — posez *blend sur une balise qui l\'englobe pour garder les deux.',
      // mjs_destroy_hooks.ts
      destroyAttach: 'nettoyage (@attach/@this=!) en erreur :',
      destroyRef: 'nettoyage (ref) en erreur :',
      destroyOut: 'transition de sortie en erreur :',
      // mjs_ujs.ts
      ujsConfirmNoModal: 'µ.config.confirm = true mais µ.modal est absent (module \'modal\' non inclus dans `runtime`) — repli sur window.confirm.',
      ujsConfirmValue: 'µ.config.confirm attend désormais true/false (l\'ancien \'sweetalert2\'/objet n\'existe plus) — repli sur window.confirm.',
      // mjs_lifecycle.ts
      lifeOnDestroy: '_mjs_onDestroy : callback en erreur :',
      lifeHook: 'hook destroy en erreur :',
      lifeRun: 'hook µ{name} en erreur :',
      // mjs_layout_variant.ts
      layoutUnknown: '<{tag}> : variant de style \'{name}\' inconnu (connus : {known}).',
      layoutFile: '<{tag}> : fichier du variant \'{name}\' introuvable ({url}) — noms connus : {known}.',
      layoutNone: 'aucune',
      // mjs_interpolate.ts
      interpInvalidator: 'µ.interpolate : invalidator en erreur, détaché.',
      interpNonFinite: 'µ.interpolate : valeur non-finie ignorée ({value})',
      // mjs_init.ts
      initReadOnly: '<{tag}> : propriété « {prop} » en lecture seule, valeur ignorée.',
      initPath: 'chemin d\'état refusé (segment « {seg} ») — mutation ignorée.',
      // mjs_for.ts
      forDupKeys: '{for} : clés dupliquées détectées — seules les 1ères occurrences sont rendues. Vérifiez l\'unicité de la clé `by`. (cacheId: {id})',
      // mjs_failed.ts
      failedLimit: '<@failed> : limite de réessai atteinte ({limit}) — abandon.',
      failedFallback: 'fallback @failed en erreur :',
      // mjs_await.ts
      awaitUnhandled: '{await} rejeté dans <{tag}> sans branche {error} pour l\'afficher — le bloc reste vide. Ajoutez {error err}…{end} pour montrer l\'erreur.',
      // mjs_fx_follow.ts
      followNoSock: '*follow n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne suit — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec followPackage côté serveur ; une connexion posée plus tard dans la variable le relance',
      // mjs_fx_cursors.ts
      cursorsNoSock: '*cursors n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec cursorsPackage côté serveur ; une connexion posée plus tard dans la variable le relance',
      // mjs_fx_heatmap.ts
      heatmapNoSock: '*heatmap n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec heatmapPackage côté serveur ; une connexion posée plus tard dans la variable le relance',
      // mjs_fx_react.ts
      reactNoSock: '*react n\'a pas de connexion MJS WS : la variable de sa scène (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec reactionsPackage côté serveur ; une connexion posée plus tard dans la variable la relance',
      // mjs_fx_follow.ts
      followNoCore: '*follow : le module socket manque au cœur (réglage runtime)',
      // mjs_fx_cursors.ts
      cursorsNoCore: '*cursors : le module socket manque au cœur (réglage runtime)',
      // mjs_fx_heatmap.ts
      heatmapNoCore: '*heatmap : le module socket manque au cœur (réglage runtime)',
      // mjs_fx_react.ts
      reactNoCore: '*react : le module socket manque au cœur (réglage runtime)',
      // mjs_fx_heatmap.ts
      heatmapServerHint: ' — pour l\'adresse d\'un serveur, écrivez server: \'{on}\'',
      heatmapEvent: '*heatmap : « {name} » n\'est pas un nom d\'événement valide (en minuscules : click, mousemove, dblclick…){hint}',
      // mjs_ticker.ts
      tickerTask: 'Ticker : tâche en erreur, éjectée.',
      // mjs_socket.ts
      socketPackage: '{effet} : le serveur MJS WS ne connaît pas « {type} » — il lui manque le paquet {paquet} : ajoutez app.use({invoke}) côté serveur ; en attendant, rien ne part',
      // mjs_rare_runes.ts
      runesInspectInit: 'µ.inspect doit être appelé à l\'initialisation.',
      // mjs_lazy_css.ts
      lazyCss: 'Feuille partagée \'{name}\' introuvable ({url}) — le composant s\'affichera sans elle.',
      // mjs_key.ts
      keyDestroy: 'destruction de l\'ancienne clé {key} en erreur :',
      // mjs_html.ts
      htmlDestroy: 'destruction de contenu {@html} en erreur :',
      // mjs_fx_transition.ts
      hoverIgnored: '*{name} : au survol (on: hover), les réglages suivants ne servent à rien : {list}. Retirez-les.',
      hoverOfAlone: '*{name} : le réglage of ne sert qu\'avec on: hover — il est ignoré ici. Retirez-le, ou ajoutez on: hover.',
      transitionNone: '*{name} : aucune transition de ce nom — µanim.create \'{name}\' n\'a pas été appelé.',
      hoverOf: '*{name} : aucun ancêtre de la balise ne vérifie « {of} » (réglage of) : son parent direct commande le survol. Vérifiez ce sélecteur.',
      // mjs_fx_path.ts
      pathStays: '*path : {why} — la balise ne bouge pas{tag}',
      pathMissing: 'le tracé « {from} » n\'existe pas dans votre composant (il faut un <path> SVG)',
      pathUnreadable: 'le tracé « {d} » est illisible',
      // mjs_fx_travel.ts
      travelNone: '*travel : la destination « {to} » est introuvable, cette étape est sautée — vérifiez le sélecteur, il est cherché dans votre composant puis dans la page',
      // mjs_fx_liquid.ts
      liquidFilter: '*liquid : la balise porte déjà un autre effet à filtre (*filter ou *chromatic) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.',
      // mjs_fx_pile.ts
      pileOverflow: '*pile : <{tag}> a un « overflow » (hidden, auto…) mais ne défile pas : les panneaux ne peuvent plus se coller (position: sticky). Retirez-le, ou remplacez-le par « overflow: clip ».',
      liquidCap: '*liquid : plus de {max} images se déforment en même temps par carreaux (le navigateur limite les contextes WebGL) : les suivantes prennent la déformation lisse. Posez radius : seule l\'image sous la souris se déforme alors.',
      liquidTag: '*liquid : cette balise n\'est pas une <img>, elle prend donc la déformation lisse ; posez *liquid sur une <img> pour avoir les carreaux.',
      liquidCors: '*liquid : cette image vient d\'un autre site et le navigateur ne la laisse pas lire sans crossorigin, elle prend donc la déformation lisse ; ajoutez crossorigin="anonymous" à la balise <img> (le site de l\'image doit l\'autoriser).',
      liquidGl: '*liquid : ce navigateur ne propose pas WebGL, les images prennent donc la déformation lisse ; activez l\'accélération matérielle du navigateur.',
      // mjs_fx_chromatic.ts
      chromaticFilter: '*chromatic : la balise porte déjà un autre effet à filtre (*filter ou *liquid) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.',
      // mjs_fx_gradient.ts
      gradientImage: '*gradient : l\'image {url} est introuvable, le dégradé la remplace',
      spotlightWhere: '*spotlight : « {word} » est lu comme une couleur, non comme un mode — écrivez *spotlight(where: {word}).',
      // mjs_fx_flipcard.ts
      flipcard: '*flipcard : la balise doit porter deux enfants — le premier est le recto, le second le verso. Ajoutez-lui le verso.',
      // mjs_fx_physics.ts
      physicsHeight: '*physics : la balise n\'a pas de hauteur — rien ne peut tomber. Donnez-lui une hauteur (height ou min-height).',
      // mjs_fx_focus.ts
      focusHost: '*focus : le composant <{tag}> n\'a aucun enfant glissé — ses enfants vivent dans son gabarit, où *focus ne les atteint pas. Posez *focus dans le gabarit du composant, sur le parent de ses enfants.',
      // mjs_effect.ts
      effectInit: 'µ.effect doit être appelé à l\'initialisation.',
      // mjs_dom.ts
      domDefined: '{tag} déjà défini par un autre bundle : cette définition est ignorée',
      // mjs_fx_reflect.ts
      reflectBlur: '*reflect : sur un composant (<{tag}>), blur et water ne sont pas possibles dans votre navigateur — le reflet reste simple',
      reflectNone: '*reflect : votre navigateur n\'a ni reflet natif ni -moz-element, et un composant (<{tag}>) ne se copie pas — aucun reflet',
      reflectBlurInside: '*reflect : <{tag}> contient un composant (<{inner}>), qu\'une copie ferait naître une seconde fois : blur et water ne sont pas possibles dans votre navigateur — le reflet reste simple',
      // mjs_fx_behind.ts
      behindImage: '*behind : l\'image {url} est introuvable — le sujet détouré n\'apparaît pas',
      behindEdge: '*behind : edge = {edge} n\'est ni zoom, ni blur, ni une couleur que votre navigateur connaît — le zoom est pris. Vérifiez comment vous l\'avez écrit.',
      // mjs_fx_backlight.ts
      backlightNone: '*backlight : la balise <{tag}> n\'a ni image ni image de fond — le halo n\'a rien à copier',
      // mjs_fx_scratch.ts
      scratchBadMany: 'ces couleurs ne sont pas lisibles',
      scratchBadOne: 'cette couleur n\'est pas lisible',
      scratchIgnMany: 'elles sont ignorées',
      scratchIgnOne: 'elle est ignorée',
      scratchIgnNone: 'la couche prend la couleur de color',
      scratchColors: '*scratch : {what} ({list}), {fate} — donnez une couleur CSS valide dans colors.',
      scratchImage: '*scratch : l\'image {url} n\'a pas pu être chargée, la couche de couleur la remplace.',
      // mjs_fx_scrub.ts
      scrubTag: '*scrub : sans frames ni images, la balise doit être une <video> (c\'est une <{tag}>) — l\'effet n\'est pas posé. Pour une suite d\'images, écrivez frames et count sur un <canvas> ou une <img>.',
      scrubSeqTag: '*scrub : une suite d\'images (frames, images) se pose sur un <canvas> ou une <img>, pas sur une <{tag}> — l\'effet n\'est pas posé.',
      scrubCount: '*scrub : frames demande count, le nombre d\'images de la suite — l\'effet n\'est pas posé. Écrivez par exemple *scrub(frames: \'img/seq-###.webp\', count: 120).',
      scrubHash: '*scrub : frames doit contenir ### à la place du numéro de l\'image (img/seq-###.webp) — l\'effet n\'est pas posé.',
      scrubContext: '*scrub : ce <canvas> porte déjà un autre contexte que 2d — l\'effet n\'est pas posé.',
      // mjs_ujs.ts
      ujsSubmitFailed: 'Submit en échec (statut {status}) — aucune page de repli HTML complète dans la réponse.',
      ujsSubmitNotHtml: 'Réponse du submit non reconnue comme une page HTML complète (attendu : une chaîne contenant "<html") — aucun contenu mis à jour. Pour gérer vous-même une réponse non-HTML, posez @noUJS sur le <form>.',
      ujsSubmitNoBody: 'Réponse HTML du submit reçue, mais aucun <body> exploitable (page courante ou réponse serveur) — aucun contenu mis à jour.',
      ujsMethodDialog: '_method=dialog n\'a pas de sens : dialog est un attribut method/formmethod, pas un verbe HTTP',
      ujsVerbUnknown: 'mjs-method="{verb}" : verbe HTTP non reconnu (get/delete/post/put/patch attendus) — navigation normale.',
      ujsConfirmRetryFailed: '@confirm : relance de requestSubmit() nu a ÉGALEMENT échoué, formulaire non soumis — {e}',
      ujsConfirmRetry: '@confirm : requestSubmit({tag}) a échoué après acceptation, repli sur requestSubmit() nu — {reqErr}',
      ujsNoAjax: 'navigation ujs : module runtime \'ajax\' absent (µ._mjs_ajaxRequest introuvable).',
      ujsHardNavOutside: 'navigation abandonnée, url hors origine et protocole non http/https : {dest}',
      ujsCallbackMissing: '@callback="{nom}" : aucune méthode « {nom} » trouvée sur {tag} ni ses ancêtres — rappel ignoré.',
      ujsFlashNoModal: 'flash/error à afficher mais µ.modal est absent (module \'modal\' non inclus dans `runtime`) — repli console/alert.',
      ujsFlashUnknown: 'mjs-flash="{attr}" : valeur non reconnue (popup/console/silent attendus) — politique globale utilisée.',
      ujsTargetMissingReceived: 'cible de navigation \'{target}\' introuvable dans la page reçue — contenu de <body> remplacé (des deux côtés).',
      ujsReplaceNoTarget: 'method \'replace\' sans target : <body> n\'est jamais remplacé — contenu remplacé à la place.',
      ujsPermanentDupId: '[mjs-permanent] id \'{id}\' porté par PLUSIEURS éléments — un seul peut traverser la navigation, les autres partent avec la page quittée. Un id doit être unique dans le document.',
      ujsPermanentNoId: '[mjs-permanent] sans id ignoré — un appariement entre deux navigations exige un id stable sur cet élément.',
      ujsScriptSwapped: '<script> détecté dans le contenu échangé : le navigateur ne ré-exécute JAMAIS un <script> injecté (règle du DOM) — ce code ne tournera pas. Déplacez-le dans un composant MJS (µmount), ou posez @noUJS sur les liens qui mènent à cette page. Script : {sig}',
      ujsMethodNoUjs: '@method="{method}" ignoré — @noUJS rend la navigation native, et le navigateur ne sait faire qu\'un GET sur un lien. Retirez l\'un des deux.',
      ujsMethodNative: '@method="{method}" : lien non suivi — vers une autre origine, avec une touche Ctrl, Maj, Alt ou Cmd, au clic du milieu, avec `target` ou `download`, le navigateur le suivrait lui-même, en GET, sans le verbe. Seul un clic simple sur un lien de la même origine, sans `target` ni `download`, envoie la requête.',
      ujsUnknownCache: 'cache \'{raw}\' inconnu dans la fiche de navigation — \'cache-first\' appliqué.',
      ujsUnknownMethod: 'method \'{raw}\' inconnu dans la fiche de navigation — \'update\' appliqué.',
      ujsTargetMissing: 'cible de navigation \'{target}\' introuvable dans la page — contenu de <body> remplacé.',
      ujsHardNavProtocol: 'navigation dure refusée, protocole non http/https : {destination}',
      // mjs_schema.ts
      schemaDefsInvalid: 'définitions µ:schema invalides, registre local INCHANGÉ',
      schemaDecodeFailed: 'décodage en échec (trame corrompue ?)',
      schemaUnknownIdReceived: 'id de schéma inconnu ({id}) reçu — registre local désynchronisé (en attente d\'un µ:schema ?)',
      schemaEncodeFailed: 'encodage en échec, envoi en JSON',
      schemaDecodeUnknownId: 'decode() : id de schéma inconnu ({id}) — registre local incomplet ou désynchronisé',
      schemaDecodeEmpty: 'decode() : trame vide, octet id de schéma attendu',
      schemaEncodeUnknown: 'encode() : schéma inconnu \'{nom}\' — déclarez-le d\'abord (µ.schema)',
      schemaDecodeOutOfFrame: 'decode() : lecture hors de la trame (offset {offset}, {taille} octets, trame de {frame})',
      schemaListTooLong: 'list({of}) : {count} éléments, max 65535 (compteur u16)',
      schemaStringTooLong: 'chaîne trop longue pour {t} ({bytes} octets UTF-8, max {max})',
      schemaOutOfRange: 'schéma \'{nomSchema}\', champ \'{nomChamp}\' : {valeur} est hors de la plage de {t} ({min} à {max}) — la valeur arriverait repliée. Choisissez un type plus large, ou bornez la valeur avant l\'envoi.',
      schemaRegistryFull: 'registre plein — 256 schémas déjà déclarés (id u8 épuisé), impossible d\'ajouter \'{nom}\'',
      schemaRedeclared: 'schéma \'{nom}\' déjà déclaré avec une forme différente — garde AJOUT-SEUL : un schéma existant est IMMUABLE, déclarez un NOM neuf pour faire évoluer le protocole.',
      schemaFieldName: 'schéma \'{nom}\' : nom de champ invalide \'{field}\' — ne survit pas à un objet ordinaire ({}[nom] = valeur), ex. \'__proto__\'',
      schemaFieldInvalid: 'schéma \'{nomSchema}\', champ \'{nomChamp}\' : type de champ invalide (ni chaîne scalaire, ni list(), ni bits())',
      schemaBitsDup: 'schéma \'{nomSchema}\', champ \'{nomChamp}\' : bits() — noms en double',
      schemaBitsMax: 'schéma \'{nomSchema}\', champ \'{nomChamp}\' : bits() accepte au plus 8 booléens (reçu {count})',
      schemaBitsEmpty: 'schéma \'{nomSchema}\', champ \'{nomChamp}\' : bits() attend un tableau de noms non vide',
      schemaListType: 'schéma \'{nomSchema}\', champ \'{nomChamp}\' : list() attend un type scalaire ({scalars}) — sous-schémas/list imbriquée non supportés, reçu \'{of}\'',
      schemaUnknownType: 'schéma \'{nomSchema}\', champ \'{nomChamp}\' : type inconnu \'{type}\' — types valides : {scalars}, list(type), bits([noms])',
      // mjs_socket.ts
      sockLiveEffect: 'effet en direct',
      sockQueueFull: 'file hors-ligne pleine (maxQueue={maxQ}) — message le plus ancien perdu',
      sockQueueDenied: 'file hors ligne vidée ({n} en attente) : le serveur a refusé l\'identité pour laquelle ces messages ont été écrits, ils ne partent sous aucune autre — renvoyez-les une fois reconnecté si besoin',
      sockSendDropped: 'envoi ignoré : connexion abandonnée (close() volontaire, essais épuisés ou reconnect.enabled:false) — appelez connect() pour reprendre : {url}',
      sockOptionInvalid: 'option {name} ignorée : valeur invalide {value}',
      sockBadUrl: 'URL invalide, connexion abandonnée : {url}',
      sockDuplicateAuth: '{url} : une connexion à cette adresse existe déjà avec un autre auth — elle vous revient telle quelle, sous sa première identité ; fermez-la (destroy()) avant d\'en ouvrir une autre sous une autre identité',
      sockHandleGone: '{fn}() sur une poignée du salon « {room} » déjà partie (leave()) : rien n\'est inscrit ni envoyé — pour reprendre ce salon, prenez une poignée neuve avec sock.room()',
      sockBinaryNoSchema: 'trame binaire reçue et ignorée : sans le module \'schema\', le cœur ne sait pas la lire (un serveur MJS-WS encode en binaire les messages dont il déclare le schéma, app.schema) — ajoutez "schema" à la liste "runtime" de mjs.config.json, ou écrivez "runtime": "all"',
      // mjs_ajax.ts
      ajaxBinVersionDiff: 'version de schéma différente (client {hashLocal}, serveur {version}) — rafraîchissement en arrière-plan',
      ajaxBinTooShort: 'réponse trop courte pour porter une version de schéma (8 octets attendus, {size} reçus)',
      ajaxBinRefreshFailed: 'rafraîchissement du schéma en échec ({url}) : HTTP {status}',
      ajaxBinUnknownSchema: 'schéma inconnu \'{schema}\' — schémas déclarés dans ce registre : {names}',
      ajaxBinNoRegistry: 'aucun registre disponible — déclarez au moins un schéma via µ.schema(...) avant d\'appeler µ.ajax.binary(url, { schema: \'{schema}\' }), ou passez options.codec.',
      ajaxBinNoSchemaModule: 'option \'schema\' utilisée sans le module runtime \'schema\' chargé — µschema-HTTP a besoin de son codec (µ.schema/µ.list/µ.bits, cf. docs/23-mjs-ws.md §3.2). Ajoutez \'schema\' à la sélection runtime (mjs.config.json), ou passez un registre tout fait via options.codec.',
      ajaxCrossOrigin: 'requête {method} vers une autre origine ({url}) : le jeton CSRF de la page n\'est PAS envoyé — il n\'a de sens que pour l\'origine qui l\'a émis.',
      // mjs_easing.ts
      txCssThrew: 'cfg.css() a levé (transition {direction} #{txId}) — transition close proprement :',
      txSetupThrew: 'setup() a levé (transition {direction} #{txId}) — transition close proprement :',
      txCssSharedThrew: 'cfg.css() a levé (transition partagée {direction} #{txId}) — transition close proprement :',
      txTickThrew: 'cfg.tick() a levé (transition {direction} #{txId}) — transition close proprement :',
      txEasingUnknown: 'easing inconnu « {e} » — repli cubicOut (attendu : linear, ease, ease-in, ease-out, ease-in-out, cubic-bezier(x1,y1,x2,y2), ou une fonction)',
      txBezierRange: 'cubic-bezier({x1}, {y1}, {x2}, {y2}) : x1/x2 hors de [0, 1] — repli cubicOut',
      // mjs_spring.ts
      springShapeMismatch: 'la cible n\'a pas la même forme que la valeur courante (clés ou longueur différentes) — chaque axe est traité indépendamment : absent de la cible => figé à sa valeur courante, absent de current => apparaît sans animer.',
      springContainerKind: 'la cible change de nature de conteneur (objet <-> tableau) — le ressort redémarre à zéro sur la nouvelle forme.',
      springShapeToObject: 'la cible change de forme (nombre → objet/tableau) — le ressort redémarre à zéro sur la nouvelle forme.',
      springShapeToNumber: 'la cible change de forme (objet/tableau → nombre) — le ressort redémarre à zéro sur la nouvelle forme.',
      springNestedShape: 'une valeur imbriquée change de forme (objet/tableau/nombre) — cette branche saute directement à la nouvelle valeur.',
      // mjs_router.ts
      routerHistoryRefused: '(r)emplacement d\'historique refusé pour \'{dest}\' :',
      routerSlashRefused: 'canonicalisation du slash refusée pour \'{hash}\' :',
      routerCatchAllLast: '<{tag}> : route \'{path}\' invalide — le \'*\' catch-all doit être en DERNIÈRE position (segment \'{seg}\' et la suite ne seraient jamais atteints).',
      // mjs_autoloader.ts
      autoloaderNotRegistered: '❌ Import de \'{fileName}\' réussi mais <{tag}> n\'a jamais été enregistré (customElements.define manquant dans le module ?).',
      autoloaderRejected: '❌ Rejet : Composant \'{fileName}\' absent du manifeste de distribution.',
      autoloaderStale: 'bundle périmé : \'{fileName}\' introuvable — rechargement de la page (une seule fois par build).',
      // mjs_lockstep.ts
      lockstepApplyThrew: 'apply() a levé une erreur au tick {tick} : l\'ordre n\'est appliqué qu\'en partie et l\'état local de la partie n\'est plus sûr — corrigez apply(), qui doit appliquer chaque ordre sans lever d\'erreur',
      lockstepJournalTruncated: 'journal tronqué au resync (tick {tick} reçu, tick {expected} attendu) — resync déterministe impossible, état local potentiellement faux',
      lockstepResyncLimit: 'apply() a levé une erreur au tick {tick} alors que {max} reprises de l\'état en {s} s ont déjà été demandées : l\'état local de la partie reste faux jusqu\'à la prochaine reprise, dans {wait} s au plus — la partie le signale (événement \'divergence\', raison \'apply-threw\') ; corrigez apply(), qui doit appliquer chaque ordre sans lever d\'erreur',
      lockstepReplayThrew: 'apply() a levé une erreur au tick {tick} pendant le rejeu de la reprise : la reprise ne rend pas l\'état local de la partie sûr, il diffère de celui des autres joueurs si apply() ne lève pas chez eux — la partie le signale (événement \'divergence\', raison \'apply-threw\') ; corrigez apply(), qui doit appliquer chaque ordre sans lever d\'erreur',
      lockstepNotLockstep: 'partie \'{game}\' n\'est pas en mode lockstep côté serveur (def.mode) — µ.lockstep restera inerte',
      lockstepSnapshotTooBig: 'instantané de {size} octets au tick {tick}, au-delà des {max} octets permis par le serveur (limits.maxPayload, lockstepJournal.maxBytes) — non proposé, le journal de la partie n\'est pas coupé',
      // mjs_page_cache.ts
      lruEvictError: 'onEvict en erreur :',
      // mjs_optimistic.ts
      optimisticBadStore: 'store invalide (objet attendu, ex. µ.state({...}))',
      // mjs_smooth.ts
      smoothNonFinite: 'échantillon non fini (Infinity/NaN) ignoré pour \'{id}\'',
      // animations/crossfade.ts
      crossfadeFallbackFailed: 'fonction de repli en échec — transition close proprement :',
      // animations/create.ts
      animCreateOverride: '\'{name}\' remplace une animation déjà enregistrée sous ce nom (built-in du framework, ou un autre µanim.create appelé avant) — la précédente est perdue.',
      // animations/typewriter.ts
      typewriterOneText: '*typewriter exige un unique nœud texte',
      // animations/pixelate.ts
      pixelateFilter: '*pixelate : la balise porte déjà un autre effet à filtre (*filter, *chromatic ou *liquid) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.',
      // mjs_ajax.ts
      ajaxBinNoneDeclared: '(aucun)',
      // mjs_ujs.ts
      ujsNoPage: 'Aucune page ne correspond à \'{matchPath}\'.',
      // mjs_router.ts
      routerNoRouteLog: 'Aucune route pour \'{matchPath}\'.',
      routerNoRoute: 'Aucune route ne correspond à \'{matchPath}\'. Routes déclarées : {routes} — déclarez une route de repli (\'/*\') pour servir votre propre page 404.',
      routerViewCrash: 'CRASH : <@view {targetId}> introuvable dans le DOM !',
      routerNoneDeclared: '(aucune)',
      routerLogRegister: 'Enregistrement de : <{tag}>',
      routerLogInit: 'Init <{tag}> avec le Hash Path : \'{matchPath}\'',
      routerLogNavigate: 'Navigation locale vers : \'{matchPath}\'',
      routerLogCurtain: 'Permutation de vues sous RIDEAU ({value}, priorité {priority})',
      routerLogViewTransition: 'Permutation de vues sous View Transition ({value}, priorité {priority})',
      routerLogNative: 'natif',
      routerLogNoRoutes: 'Aucun objet @routes trouvé dans <{tag}>',
      routerLogAnalyze: 'Analyse des @routes pour <{tag}>...',
      routerLogMatch: 'Match ! [{routePath}] -> Module [{module}] injecté dans <@view {targetId}>',
      routerLogNothingToInject: 'Aucun composant à injecter pour le path \'{matchPath}\'.',
      routerLogViewCleared: 'Aucune route pour <@view {targetId}> — vue vidée.',
      routerLogCacheHit: 'Restauration depuis le cache : <{tag}>',
      routerLogCreate: 'Création DOM : <{tag}>',
      // mjs_element.ts
      elementClosedShadow: '<{tag}> : un Shadow DOM \'closed\' préexiste (SSR avec shadowMode:\'closed\' ?) — MJS ne peut pas l\'adopter ni le reconstruire (contenu inaccessible en mode closed). Utilisez shadowMode:\'open\' (défaut) dans les options de rendu SSR.',
      // mjs_rare_runes.ts
      importEmptyPath: 'µimport : chemin vide — asset non résolu au build',
      // mjs_i18n.ts
      i18nHttp: 'i18n : HTTP {status} sur {path}',
      // src/core-modules/field.mjs
      coreFieldNoName: 'aucun « name » : ni sur <@@field>, ni sur le champ enveloppé.',
      // src/core-modules/color.mjs
      coreColorNoValue: 'l\'attribut « value » est requis.',
      // src/core-modules/toolbar.mjs
      coreToolbarUnknown: '<@@toolbar> : l\'outil « {n} » n\'existe pas, il est ignoré — outils connus : {list}.',
      coreEditorColorUnknown: '<@@editor> : la couleur « {n} » n\'existe pas, elle est ignorée — couleurs connues : {list}.',
      // src/core-modules/chart.mjs
      coreChartWord: '<@@chart> : « {word} » n\'est pas une valeur connue de {prop}, elle est ignorée — valeurs connues : {list}.',
      coreChartColor: '<@@chart> : la couleur « {color} » de la série « {key} » est refusée, la série prend la teinte {hue} — écrivez un nom de teinte ({list}), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \\ », « /* » ni url(…).',
      coreChartNoStats: '<@@chart> : la forme {shape} ne trace pas stats « {word} », il est ignoré — formes qui tracent des statistiques : {list} ; trend : {trend}.',
      coreChartMix: '<@@chart> : {prop} « {word} » ne va pas avec la forme {shape}, il est ignoré — valeurs possibles : {list}.',
      coreChartRadar: '<@@chart> : un radar demande au moins 3 lignes, une par axe ; il en reçoit {n}, une courbe le remplace.',
      coreChartRadarCut: '<@@chart> : un radar montre {max} axes au plus, les {n} lignes reçues sont réduites aux {max} dernières.',
      coreChartUnits: '<@@chart> : les séries de la forme {shape} n\'ont pas la même unité ({units}) et partagent pourtant une même échelle.',
      coreChartZone: '<@@chart> : « {zone} » n\'est pas un fuseau connu, il est ignoré — écrivez local ou le nom d\'une zone IANA (Europe/Paris, UTC…) ; sans fuseau, les heures s\'affichent telles qu\'elles sont écrites.',
      coreChartDecimals: '<@@chart> : decimals « {value} » est ignoré — écrivez un nombre entier de 0 à 10 ; sans decimals, les nombres gardent leur écriture automatique.',
      coreChartPieDrop: '<@@chart> : la série « {key} » n\'a pas de total positif, l\'anneau ne lui donne aucune part.',
      coreChartPieLabelDrop: '<@@chart> : le libellé « {label} » n\'a pas de total positif, l\'anneau ne lui donne aucune part.',
      coreChartSide: '<@@chart> : axis « {word} » de la série « {key} » n\'est pas une valeur connue, la série reste sur l\'axe de gauche — valeurs connues : {list}.',
      coreChartSideShape: '<@@chart> : la forme {shape} n\'a qu\'une échelle, axis « right » est ignoré pour {keys} — formes à deux échelles : {list}.',
      coreChartDay: '<@@chart> : « {x} » n\'est pas une date qui existe, sa ligne ne se range dans aucune période et quitte le graphique — écrivez un jour possible (AAAA-MM-JJ) ou un instant qui se lit.',
      // src/core-modules/gauge.mjs
      coreGaugeStep: '<@@gauge> : le pas « {n} » n\'est pas un nombre positif, la jauge avance de 1. Écrivez un pas plus grand que 0.',
      // src/core-modules/number.mjs
      coreNumberDecimals: '<@@number> : decimals « {value} » est ignoré — écrivez un nombre entier de 0 à 100 ; sans decimals, la valeur s\'écrit telle quelle.',
      // src/core-modules/number.mjs, knob.mjs, gauge.mjs
      coreRangeInverted: '<@@{tag}> : min « {min} » est plus grand que max « {max} », la valeur reste bloquée sur une borne. Écrivez un min plus petit que max.',
      // mjs_types.ts
      typesAllowed: ' — permis : {d}',
      typesRefuses: '{p} refuse {v}{d}{at}',
      typesBrought: '{p} : {v} ramené à {to}{d}{at}',
      typesAnimated: '{p} reçoit une valeur animée : ses bornes se règlent en la créant (µspring(valeur, raideur, amortissement, min, max), µinterpolate(valeur, durée, min, max)) — retirez {p} du <vars>{at}',
      // mjs_fx.ts
      fxBrought: '*{name} : {k} = {vu} ramené à {to} — permis : {reg}{at}',
      fxRefused: '*{name} : {k} = {vu} refusé, valeur par défaut — permis : {reg}{at}',
      fxEveryRefused: 'la variable de thème $$mjs-fx-every vaut {vu}, une valeur refusée : chaque effet garde sa cadence par défaut — permis : une durée (300ms, 1.5s, 0){at}',
      // mjs_fx_sprite.ts
      spriteImage: '*sprite : l\'image {url} est introuvable — la planche n\'est pas animée',
      spriteFps: '*sprite : fps et speed sont écrits tous les deux — fps l\'emporte',
      spriteRow: '*sprite : row sans rows — row est ignoré',
      spritePoses: '*sprite : poses : « {valeur} » n\'est pas un numéro de case — écarté',
      // mjs_adopt_sheet.ts
      adoptSheetNoShadow: 'µ.adoptSheet : la feuille n\'est pas collée dans <{tag}>, car cette balise n\'a pas d\'ombre (composant réglé en mjs-light, ou balise qui n\'est pas un composant ModularJS). Écrivez ce style dans le <style> du composant, ou dans une feuille de la page : sans ombre, les feuilles de la page s\'appliquent déjà à la balise.',
      // mjs_clone.ts
      cloneNotComponent: 'µclone : {tag} n\'est pas un composant MJS, ou sa définition n\'est pas encore chargée — aucun état à copier. Pour copier une balise ordinaire, écrivez el.cloneNode(true).',
      cloneOption: 'µclone : option « {opt} » inconnue — la seule option est mirror : µclone el, mirror: true rend un miroir vivant, qui partage l\'état de l\'original.',
    },
    dev: {
      // mjs_debug.ts
      propOneWay: '<{tag}> écrit sa prop « {prop} » : cette valeur vient du parent ; liez-la par !{…} ou envoyez un événement. Le parent garde sa propre valeur, il ne voit pas ce changement.',
      attachNotFn: '<{tag}> : l\'@attach de <{node}> (ligne {line}) a rendu une valeur de type {type}, pas une fonction : elle est ignorée. Rendez une fonction de nettoyage, appelée quand la balise disparaît, ou rien.',
      // mjs_hotcss.ts
      hotcssLight: '_hotCss : replaceSync a échoué pour la feuille légère <{tag}> :',
      hotcssTag: '_hotCss : replaceSync a échoué pour <{tag}> :',
      hotcssShared: '_hotCss : replaceSync a échoué pour la feuille partagée « {name} » :',
      hotcssRoot: '_hotCss : replaceSync a échoué pour mjs_root :',
      // mjs_devinspect.ts
      inspectArmed: 'inspecteur d\'objets armé — µconsole(valeur), ou depuis le panneau (Ctrl+Shift+Espace)',
      // mjs_devpanel.ts
      panelArmed: 'panneau d\'inspection armé — Ctrl+Shift+Espace, ou µconsole',
      majEffect: 'effet',
      majColor: 'couleur',
      majDuration: 'durée',
      anchorDetach: 'détacher',
      anchorBottom: 'ancrer en bas',
      btnTarget: 'cibler',
      tipTarget: 'cliquer ensuite un élément de la page',
      btnFlash: 'clignoter au rendu',
      tipFlash: 'chaque composant qui se re-rend s\'éclaire',
      btnUpdates: 'mises à jour',
      tipUpdates: 'chaque morceau que MJS réécrit s\'éclaire',
      btnRefresh: 'rafraîchir',
      btnClose: 'fermer',
      rowEffects: 'effets (*)',
      tabState: 'État',
      tabDerived: 'Dérivés',
      tabBindings: 'Liaisons',
      tabContext: 'Contexte',
      tabProps: 'Attributs et props',
      tabStyle: 'Style et thème',
      tabEffects: 'Effets',
      empty: '(vide)',
      themeNone: 'aucune variable de thème détectée',
      themeActive: 'Thème actif',
      themeKnown: 'connus :',
      themeVars: 'Variables de thème en vigueur',
      cssActive: 'CSS actif (feuilles adoptées)',
      cssNone: 'aucun CSS propre détecté',
      propsDeclared: 'Props / variables déclarées',
      noneF: 'aucune',
      attrsReal: 'Attributs réels de l\'élément',
      noneM: 'aucun',
      closeInspector: 'fermer l\'inspecteur d\'objet',
      noStore: 'aucun store',
      noEffectPage: 'aucun effet dans la page',
      pickComponent: 'Choisissez un composant à gauche.<br>Survolez une ligne pour le situer dans la page.',
      derivedTitle: 'Dérivés et leurs dépendances',
      noDerived: 'aucun dérivé',
      bindingsTitle: 'Ce que chaque variable met à jour',
      noBinding: 'aucune liaison',
      ctxSet: 'Posés ici',
      ctxReceived: 'Reçus d\'un ancêtre',
      noCtxSet: 'aucun contexte posé par ce composant',
      noCtxReceived: 'aucun contexte reçu',
      noEffectComp: 'aucun effet posé par ce composant',
      noStateVar: 'aucune variable d\'état',
      fxDuration: 'durée',
      fxCurve: 'courbe',
      fxMain: 'principal',
      fxCopy: 'copier l\'écriture',
      fxRevert: 'rétablir',
      fxCopied: 'copié ✓',
      fxSelected: 'sélectionné : Ctrl+C',
      mountedOne: '{n} composant monté',
      mountedMany: '{n} composants montés',
      keysOne: '{n} clé',
      keysMany: '{n} clés',
      fxSetOne: '{n} posé',
      fxSetMany: '{n} posés',
      renderOne: '{n} rendu',
      renderMany: '{n} rendus',
      bindingOne: '{n} liaison',
      bindingMany: '{n} liaisons',
      panelOpen: 'panneau d\'inspection ouvert — Échap pour le fermer',
      panelClosed: 'panneau d\'inspection fermé',
      // mjs_devinspect.ts
      inspNode: 'nœud',
      inspObject: 'Objet',
      inspNoValue: 'aucune valeur',
      inspMore: 'et {n} de plus (affichage plafonné à {max})',
      inspAccessor: 'accesseur',
      inspFailed: 'échec :',
      inspCircular: 'référence circulaire',
      // mjs_fx_marquee.ts
      marqueeKids: '*marquee{where} : cette balise fait défiler des balises que le compilateur n\'a pas vues dans le gabarit (un script les a ajoutées, le plus souvent). En production, le défilé des balises n\'est envoyé que si une pose de l\'application le demande : celle-ci ne le demande pas, ces balises ne défileront pas à moins qu\'une autre pose ne le fasse envoyer. Écrivez *marquee(unit: child) pour le demander.',
      // mjs_fx_filter.ts
      filterSpotParent: '*filter : pas de zone nette (spot) sur cette balise — son parent {parent} rogne ou défile sans être positionné, et le positionner déplacerait ce qu\'il contient (une balise posée en absolu, ou des décalages top, left… écrits sur lui). Mettez la balise dans un bloc en position: relative, à l\'intérieur de ce parent',
      // mjs_fx_transition.ts
      crossfadeGroup: '*crossfade : le groupe « {group} » garde les réglages de sa première pose ; une pose suivante écrit d\'autres valeurs pour {keys}, qui ne comptent pas. Donnez les mêmes réglages à toutes les poses du groupe, ou placez celle-ci dans un autre groupe (group).',
      // mjs_fx_hologram.ts
      hologramImages: '*hologram : image, mask et back ne servent qu\'aux styles de carte ; avec le style « {style} », ils sont ignorés et aucune image n\'est chargée',
      // mjs_fx_autosize.ts
      autosizeField: '*autosize : sur un <{tag}>, l\'effet ne fait rien — il fait glisser la taille d\'une boîte quand son contenu change (une balise ajoutée, un bloc qui s\'ouvre, une image qui arrive), et ce qu\'on tape dans un champ n\'en change pas le contenu. Posez *autosize sur la boîte dont le contenu change, par exemple celle qui entoure le champ et ses messages.',
      // select.mjs
      selectOtherScript: '<@@select> : une liste reçoit « other » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — la réponse libre « Autre » n\'est pas envoyée, ni en développement ni en production. Écrivez « other » sur la liste dans votre page plutôt que de le poser par un script.',
      // editor.mjs
      editorAnswerScript: '<@@editor> : un éditeur reçoit « answer » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — le mode « répondre » n\'est pas envoyé, ni en développement ni en production. Écrivez « answer » sur l\'éditeur dans votre page plutôt que de le poser par un script.',
      // toolbar.mjs
      toolbarToolScript: '<@@toolbar> : une barre reçoit l\'outil « {n} » d\'un script, mais aucune page de l\'application n\'écrit cet outil — il n\'est pas envoyé, ni en développement ni en production. Écrivez « {n} » dans la liste d\'outils d\'une barre de votre page (l\'attribut toolbar d\'un éditeur, ou tools d\'une barre) plutôt que de le poser par un script.',
      // chart.mjs
      chartToolbarScript: '<@@chart> : un graphique reçoit « toolbar » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — la barre d\'outils n\'est pas envoyée, ni en développement ni en production. Écrivez « toolbar » sur le graphique dans votre page plutôt que de le poser par un script.',
    },
  },
  en: {
    modal:  { ok: 'OK', cancel: 'Cancel', deny: 'No' },
    router: { notFound: 'Page not found', noRoute: 'No route matches this address.', declared: 'Declared routes' },
    toast:  { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' },
    ujs:    { sendFailed: 'Sending failed — the server did not respond.' },
    core:   { carouselPrev: 'Previous', carouselNext: 'Next', codeCopy: 'Copy code', codeCopied: 'Copied!', selectPlaceholder: 'Choose…', selectSearch: 'Search…', selectEmpty: 'No results', selectOther: 'Other…', selectOtherPlaceholder: 'Please specify', selectOtherHint: 'Enter to confirm · Esc to go back', selectOtherOk: 'Confirm', selectOtherSep: ': ', numberLabel: 'Number', numberLess: 'Less', numberMore: 'More', numberBigLess: 'Decrease by {n}', numberBigMore: 'Increase by {n}', gaugeLabel: 'Number', knobLabel: 'Value', progressLabel: 'Progress', colorLabel: 'Color', menuLabel: 'Menu', clockHours: 'Hours', clockMinutes: 'Minutes', clockSeconds: 'Seconds', editorLabel: 'Text editor', editorPlaceholder: 'Write here…', toolbarLabel: 'Formatting', toolH2: 'Heading', toolH3: 'Subheading', toolQuote: 'Quote', toolBold: 'Bold', toolItalic: 'Italic', toolUnderline: 'Underline', toolStrike: 'Strikethrough', toolUl: 'Bulleted list', toolOl: 'Numbered list', toolCheck: 'Checklist', toolLink: 'Link', toolUndo: 'Undo', toolRedo: 'Redo', toolClear: 'Clear formatting', toolColor: 'Text color', toolbarShift: 'Shift', linkLabel: 'Link address', linkApply: 'Apply', linkRemove: 'Remove link', linkCancel: 'Cancel', linkDone: 'Link saved', colorsLabel: 'Text color', colorNone: 'No color', colorGray: 'Gray', colorBrown: 'Brown', colorOrange: 'Orange', colorYellow: 'Yellow', colorGreen: 'Green', colorBlue: 'Blue', colorPurple: 'Purple', colorPink: 'Pink', colorRed: 'Red', boxChecked: 'Checked box', boxUnchecked: 'Unchecked box', checked: 'Box checked', unchecked: 'Box unchecked', chartLabel: 'Chart', chartEmpty: 'No values', chartHint: 'Arrow keys to browse the points, Enter to choose', chartGrouped: 'Average of {n} values', chartWeekOf: 'Week of {date}', chartOwnScale: 'One scale per series: their units differ', chartMean: 'Mean', chartMedian: 'Median', chartQ1: 'First quartile', chartQ3: 'Third quartile', chartTrend: 'Trend', chartNext: 'the circle: the next estimated point', chartDate: 'Date', chartTime: 'Date and time', chartNumber: 'Value', chartCategory: 'Label', chartPeriod: 'Period', chartTotal: 'Total', chartOthers: 'Others', chartRange: '{from} to {to}', chartCount: 'Values', chartBin: 'Range', chartSeries: 'Series', chartShare: 'Share', chartPieNone: 'A ring does not suit this data: it compares several series with the same unit, or labels', chartBrowse: 'Arrow keys to browse the values', chartChoose: 'Arrow keys to browse the values, Enter to choose', chartLess: 'Less', chartMore: 'More', chartDayHour: 'Day and time', chartTools: 'Chart tools', chartLegend: 'Shown series', chartShape: 'Shape', chartShapeOf: 'Shape: {shape}', chartLine: 'Line', chartArea: 'Area', chartDots: 'Dots', chartBar: 'Bars', chartStack: 'Stacked bars', chartHistogram: 'Histogram', chartPie: 'Ring', chartHeatmap: 'Heat map', chartRadar: 'Radar', chartCalendar: 'Calendar', chartStats: 'Statistics', chartStep: 'Time step', chartAuto: 'Automatic', chartDay: 'Day', chartWeek: 'Week', chartMonth: 'Month', chartYear: 'Year' },
    fx:     { range: 'from {a} to {b}', atLeast: 'at least {a}', atMost: 'at most {b}', chars: '{a} to {b} characters', charsMin: 'at least {a} characters', charsMax: 'at most {b} characters', or: 'or', except: 'except', invalid: 'value refused', offline: 'Offline', loading: 'Loading', pending1: '1 change will be sent when the network is back', pendingN: '{n} changes will be sent when the network is back', spoiler: 'Hidden text, activate to show it', flip: 'Flip the card' },
    err: {
      // mjs_vt_presets.ts
      vtMalformed: '@viewTransition: malformed value \'{name}\' — falling back to \'{namePart}\'.',
      vtDirName: '@viewTransition: the direction is no longer written in the name (\'{namePart}\') — falling back to \'{base}\', set \'dir\'/\'direction\' as an option.',
      vtOptMalformed: '@viewTransition: malformed option \'{pair}\' in \'{name}\' — ignored.',
      vtUnknownKey: '@viewTransition: unknown key \'{rawKey}\' in \'{name}\' — ignored (valid keys: {keys}).',
      vtDupKey: '@viewTransition: key \'{key}\' repeated in \'{name}\' (\'{key}\'/\'{short}\' name the same option) — 2nd occurrence ignored.',
      vtBadDir: '@viewTransition: invalid direction \'{val}\' in \'{name}\' — ignored.',
      vtBadDur: '@viewTransition: invalid duration \'{val}\' in \'{name}\' — a bare number of milliseconds (like setTimeout), e.g. dur: 600 — ignored.',
      vtBadPrio: '@viewTransition: invalid priority \'{val}\' in \'{name}\' — ignored.',
      vtUnknownPreset: '@viewTransition: unknown preset \'{name}\' — valid values: {presets}, {curtains} (to orient a directional base: use the option { dir: left }, the \':left\' suffix was removed in v6).',
      vtLevitation: 'VT levitation layer abandoned: {msg}',
      vtLevitationIn: 'VT levitation layer (arrival) abandoned: {msg}',
      vtSwapThrew: '@viewTransition: the swap under the curtain threw —',
      // mjs_modal.ts
      modalRead: 'reading `{where}` failed: {reason}.',
      modalWantsText: '`{key}` expects text, received {type}.',
      modalNotText: '`{key}` could not be converted to text: {reason}.',
      modalMapKeys: '`{key}` looks like a Map but its `keys()` cannot be iterated: {reason}.',
      modalNotIterable: '`{key}` could not be iterated: {reason}.',
      modalGetFailed: '`{key}.get()` failed: {reason}.',
      modalOptsObject: 'the options must be an object, received {type}.',
      modalWantsFn: '`{key}` must be a function, received {type}.',
      modalIconString: '`icon` must be a string, received {type}.',
      modalInputString: '`input` must be a string, received {type}.',
      modalInputOptions: '`inputOptions` must be an object or a Map, received {type}.',
      modalTimer: '`timer` must be a number of milliseconds, received {got}.',
      modalCustomClass: '`customClass` must be an object, received {type}.',
      modalSoundType: '`sound` must be a boolean or a string, received {type}.',
      modalNoBody: '`document.body` is missing — a modal cannot be shown at this point of the page load.',
      modalUnknownIcon: 'µ.modal.fire — unknown icon "{v}", ignored (expected: {list}).',
      modalUnknownInput: 'µ.modal.fire — unknown input type "{v}", falling back to "text" (expected: {list}).',
      modalSoundPath: 'µ.sound — path "{path}" cannot be resolved, no sound: {reason}.',
      modalSoundUnknown: 'µ.sound — unknown type "{type}", no sound (expected: {list}).',
      modalNotifyPos: 'µ.config.notifyPosition: invalid value ("{v}") — falling back to \'top-right\'.',
      modalNotifyFlow: 'µ.config.notifyFlow: invalid value ("{v}") — falling back to \'auto\'.',
      modalPreConfirm: 'µ.modal: preConfirm failed —',
      modalValidator: 'µ.modal: inputValidator failed —',
      // mjs_element.ts
      elProto: 'state: prototype change refused',
      elCycle: 'Reactive cycle detected on \'{k}\' — returning undefined',
      elTeardown: '@attach/@this teardown failed:',
      elOrphanInherited: 'Inherited CSS orphan: the sheet \'{sheetName}\' is missing from the registry.',
      elOrphanLocal: 'Local CSS orphan: the sheet \'{sheetName}\' was not found.',
      elHydrate: 'hydration requested by the page but missing from the core: use ssr:markers/positional/diff mode in render, or runtime: [\'hydrate\'].',
      elHydrateMismatch: '<{tag}>: the markers written by the server do not match the ones the browser expects — this component is rebuilt, without the benefit of hydration. Likely cause: the server and the browser were built differently (another "env", other pages); build them identically.',
      elLoop: 'Reactive loop detected on <{tag}>: more than 10,000 renders in the same burst of microtasks. An effect probably mutates its own dependency ($x = $x + … inside a µeffect?). Effects paused to keep the page alive.',
      elStructLoop: '<{tag}>: structural mutation loop detected (20 passes) — re-render abandoned. A var driving a {for}/{if} is probably mutated again by the render itself.',
      // mjs_store_globals.ts
      storeGWatch: 'µ._mjs_storeWatch: callback failed.',
      storeGProtoKey: 'µ.store: key "{k}" refused — it belongs to the JavaScript prototype, choose another name.',
      storeGCycle: 'µ.store: computed cycle detected on "{key}" — returning undefined.',
      storeGKey: 'µ.store: key refused ("{key}") — mutation ignored.',
      storeGTheme: 'µtheme: "{value}" is not a declared theme — ignored. Known themes: {themes}.',
      storeGResKey: 'µ.res: key refused ("{k}") — mutation ignored.',
      storeGResTag: 'µres: __mjs_res tag unreadable at boot, ignored.',
      // mjs_runes.ts
      runesKey: 'µ.state: key refused ("{key}") — mutation ignored.',
      runesCycle: 'µ.state: computed cycle detected on "{key}" — returning undefined.',
      // mjs_every.ts
      everyInit: 'µevery must be called at initialization.',
      everySyntax: 'µevery is written "µevery 2500, ->": a delay in milliseconds, then the function to repeat.',
      everyHash: 'µevery: the 2nd argument is an options hash ("µevery 3000, pause: true, ->") — received:',
      everyOptType: 'µevery: option "{opt}" expected of type {type}, received: ',
      everyIgnored: '— option ignored.',
      everyUnknownOpt: 'µevery: unknown option "{opt}". Known options: {list}.',
      everyTimes: 'µevery: option "times" expected ≥ 0, received:',
      everyError: 'µevery:',
      everyWhileAsync: 'µevery: the "while" option must return a SYNCHRONOUS boolean — an async function returns a promise, always truthy, and the repetition would never stop. Stopped.',
      // mjs_dynamic.ts
      dynAccept: '<@element>/<@module>: accept expects a list of names (array or space-separated string)',
      dynRefused: '<@element>/<@module>: tag "{norm}" refused — a dynamic element cannot become {norm}; to allow it explicitly: accept="{norm}".',
      dynNotListed: '<@element>/<@module>: tag "{norm}" refused — not in the list accept="{list}"; when accept is present, only the names it lists are created.',
      dynInstance: '<@module>: cannot instantiate the component. Pass the tag NAME (kebab string of the custom element) rather than the class.',
      // mjs_i18n.ts
      i18nMissing: 'i18n: key "{key}" missing in "{lang}", falling back to "{def}"',
      i18nNoData: 'i18n: µ._i18nData never received, i18n components shown as placeholders',
      i18nLoadSection: 'i18n: failed to load "{section}" ({lang}) — {reason}',
      i18nLoadLang: 'i18n: failed to load the language "{lang}" ({url}) — {reason}',
      i18nHook: 'i18n: language switch hook failed:',
      i18nSecours: 'i18n: texts still missing after {ms} ms — the module appears with ⟦key⟧ in place of each missing text, the texts will replace them on arrival',
      // mjs_fx.ts
      fxLoad: 'effect "{name}": its file failed to load —',
      fxApply: 'effect "{name}": applying it failed —',
      fxRemove: 'effect removal failed:',
      // mjs_store.ts
      storeKey: 'µ.Store: key refused ("{prop}") — mutation ignored.',
      storeProto: 'store: prototype change refused',
      // mjs_if.ts
      ifReintro: 'Re-intro failed:',
      ifDestroy: '{if} branch destruction failed:',
      ifDestroyNested: 'nested {if}/{key} branch destruction failed:',
      // mjs_fx_blend.ts
      blendCsp: '*blend: the page\'s security policy refuses data: images — the layer keeps square corners and a gradient takes its first color. Add data: to img-src to get them back.',
      blendImage: '*blend: the image {src} could not be loaded, the layer stays empty.',
      blendNoSrc: '*blend: the given image has no address, the effect is not applied.',
      // mjs_fx_fluid.ts
      fluidNoGl: '*fluid: this browser cannot run the fluid (WebGL with half-float textures required), the effect is not applied.',
      fluidTextComponent: '*fluid: on a component, `where: text` does not apply (its text lives inside it, not in its tag) — the fluid is applied as `box` and the text is left as it is.',
      fluidColor: '*fluid: the color "{color}" cannot be resolved (missing variable or a value that is not a color), it is ignored.',
      fluidNoContext: '*fluid: the browser has no WebGL context left for this tag (it limits them per page, around sixteen) — it stays without effect and will try again on its next hover or when it comes back on screen.',
      blendFilter: '*blend: this tag already has a CSS `filter`, which the effect replaces — put *blend on a tag that wraps it to keep both.',
      // mjs_destroy_hooks.ts
      destroyAttach: 'cleanup (@attach/@this=!) failed:',
      destroyRef: 'cleanup (ref) failed:',
      destroyOut: 'exit transition failed:',
      // mjs_ujs.ts
      ujsConfirmNoModal: 'µ.config.confirm = true but µ.modal is missing (the \'modal\' module is not included in `runtime`) — falling back to window.confirm.',
      ujsConfirmValue: 'µ.config.confirm now expects true/false (the former \'sweetalert2\'/object no longer exists) — falling back to window.confirm.',
      // mjs_lifecycle.ts
      lifeOnDestroy: '_mjs_onDestroy: callback failed:',
      lifeHook: 'destroy hook failed:',
      lifeRun: 'µ{name} hook failed:',
      // mjs_layout_variant.ts
      layoutUnknown: '<{tag}>: style variant \'{name}\' unknown (known: {known}).',
      layoutFile: '<{tag}>: variant file \'{name}\' not found ({url}) — known names: {known}.',
      layoutNone: 'none',
      // mjs_interpolate.ts
      interpInvalidator: 'µ.interpolate: invalidator failed, detached.',
      interpNonFinite: 'µ.interpolate: non-finite value ignored ({value})',
      // mjs_init.ts
      initReadOnly: '<{tag}>: property "{prop}" is read-only, value ignored.',
      initPath: 'state path refused (segment "{seg}") — mutation ignored.',
      // mjs_for.ts
      forDupKeys: '{for}: duplicate keys detected — only the first occurrences are rendered. Check that the `by` key is unique. (cacheId: {id})',
      // mjs_failed.ts
      failedLimit: '<@failed>: retry limit reached ({limit}) — giving up.',
      failedFallback: '@failed fallback failed:',
      // mjs_await.ts
      awaitUnhandled: '{await} rejected in <{tag}> with no {error} branch to display it — the block stays empty. Add {error err}…{end} to show the error.',
      // mjs_fx_follow.ts
      followNoSock: '*follow has no MJS WS connection: its variable (sock; @sock by default) is empty, nothing follows — open it (@sock = µsocket \'wss://…\', or a store: sock: $$sock), with followPackage on the server side; a connection set later in the variable restarts it',
      // mjs_fx_cursors.ts
      cursorsNoSock: '*cursors has no MJS WS connection: its variable (sock; @sock by default) is empty, nothing is sent — open it (@sock = µsocket \'wss://…\', or a store: sock: $$sock), with cursorsPackage on the server side; a connection set later in the variable restarts it',
      // mjs_fx_heatmap.ts
      heatmapNoSock: '*heatmap has no MJS WS connection: its variable (sock; @sock by default) is empty, nothing is sent — open it (@sock = µsocket \'wss://…\', or a store: sock: $$sock), with heatmapPackage on the server side; a connection set later in the variable restarts it',
      // mjs_fx_react.ts
      reactNoSock: '*react has no MJS WS connection: its scene variable (sock; @sock by default) is empty, nothing is sent — open it (@sock = µsocket \'wss://…\', or a store: sock: $$sock), with reactionsPackage on the server side; a connection set later in the variable restarts it',
      // mjs_fx_follow.ts
      followNoCore: '*follow: the socket module is missing from the core (runtime setting)',
      // mjs_fx_cursors.ts
      cursorsNoCore: '*cursors: the socket module is missing from the core (runtime setting)',
      // mjs_fx_heatmap.ts
      heatmapNoCore: '*heatmap: the socket module is missing from the core (runtime setting)',
      // mjs_fx_react.ts
      reactNoCore: '*react: the socket module is missing from the core (runtime setting)',
      // mjs_fx_heatmap.ts
      heatmapServerHint: ' — for a server address, write server: \'{on}\'',
      heatmapEvent: '*heatmap: "{name}" is not a valid event name (lowercase: click, mousemove, dblclick…){hint}',
      // mjs_ticker.ts
      tickerTask: 'Ticker: task failed, ejected.',
      // mjs_socket.ts
      socketPackage: '{effet}: the MJS WS server does not know "{type}" — it lacks the {paquet} package: add app.use({invoke}) on the server side; until then, nothing is sent',
      // mjs_rare_runes.ts
      runesInspectInit: 'µ.inspect must be called at initialization.',
      // mjs_lazy_css.ts
      lazyCss: 'Shared sheet \'{name}\' not found ({url}) — the component will render without it.',
      // mjs_key.ts
      keyDestroy: 'destruction of the old {key} key failed:',
      // mjs_html.ts
      htmlDestroy: 'destruction of {@html} content failed:',
      // mjs_fx_transition.ts
      hoverIgnored: '*{name}: with on: hover, these settings do nothing: {list}. Remove them.',
      hoverOfAlone: '*{name}: the of setting only works with on: hover — it is ignored here. Remove it, or add on: hover.',
      transitionNone: '*{name}: no transition with this name — µanim.create \'{name}\' was not called.',
      hoverOf: '*{name}: no ancestor of the tag matches "{of}" (the of setting): its direct parent drives the hover. Check this selector.',
      // mjs_fx_path.ts
      pathStays: '*path: {why} — the tag does not move{tag}',
      pathMissing: 'the path "{from}" does not exist in your component (an SVG <path> is needed)',
      pathUnreadable: 'the path "{d}" is unreadable',
      // mjs_fx_travel.ts
      travelNone: '*travel: the destination "{to}" was not found, this step is skipped — check the selector, it is looked up in your component, then in the page',
      // mjs_fx_liquid.ts
      liquidFilter: '*liquid: the tag already carries another filter effect (*filter or *chromatic): both fight over the CSS filter property. Put one of them on a wrapping tag.',
      // mjs_fx_pile.ts
      pileOverflow: '*pile: <{tag}> has an "overflow" (hidden, auto…) but does not scroll: the panels can no longer stick (position: sticky). Remove it, or replace it with "overflow: clip".',
      liquidCap: '*liquid: more than {max} images deform at the same time by tiles (the browser limits WebGL contexts): the next ones take the smooth deformation. Set radius: only the image under the mouse deforms then.',
      liquidTag: '*liquid: this tag is not an <img>, so it takes the smooth deformation; put *liquid on an <img> to get the tiles.',
      liquidCors: '*liquid: this image comes from another site and the browser will not let it be read without crossorigin, so it takes the smooth deformation; add crossorigin="anonymous" to the <img> tag (the image\'s site must allow it).',
      liquidGl: '*liquid: this browser does not offer WebGL, so images take the smooth deformation; enable the browser\'s hardware acceleration.',
      // mjs_fx_chromatic.ts
      chromaticFilter: '*chromatic: the tag already carries another filter effect (*filter or *liquid): both fight over the CSS filter property. Put one of them on a wrapping tag.',
      // mjs_fx_gradient.ts
      gradientImage: '*gradient: the image {url} was not found, the gradient replaces it',
      spotlightWhere: '*spotlight: "{word}" is read as a colour, not as a mode — write *spotlight(where: {word}).',
      // mjs_fx_flipcard.ts
      flipcard: '*flipcard: the tag must carry two children — the first is the front, the second the back. Add the back to it.',
      // mjs_fx_physics.ts
      physicsHeight: '*physics: the tag has no height — nothing can fall. Give it a height (height or min-height).',
      // mjs_fx_focus.ts
      focusHost: '*focus: the component <{tag}> has no slotted children — its children live in its own template, where *focus cannot reach them. Put *focus in the component\'s template, on the parent of its children.',
      // mjs_effect.ts
      effectInit: 'µ.effect must be called at initialization.',
      // mjs_dom.ts
      domDefined: '{tag} already defined by another bundle: this definition is ignored',
      // mjs_fx_reflect.ts
      reflectBlur: '*reflect: on a component (<{tag}>), blur and water are not possible in your browser — the reflection stays simple',
      reflectNone: '*reflect: your browser has neither a native reflection nor -moz-element, and a component (<{tag}>) cannot be copied — no reflection',
      reflectBlurInside: '*reflect: <{tag}> contains a component (<{inner}>), which a copy would create a second time: blur and water are not possible in your browser — the reflection stays simple',
      // mjs_fx_behind.ts
      behindImage: '*behind: the image {url} was not found — the cut-out subject does not appear',
      behindEdge: '*behind: edge = {edge} is neither zoom nor blur nor a color your browser knows — the zoom is used. Check how you wrote it.',
      // mjs_fx_backlight.ts
      backlightNone: '*backlight: the tag <{tag}> has neither an image nor a background image — the backlight has nothing to copy',
      // mjs_fx_scratch.ts
      scratchBadMany: 'these colors are not readable',
      scratchBadOne: 'this color is not readable',
      scratchIgnMany: 'they are ignored',
      scratchIgnOne: 'it is ignored',
      scratchIgnNone: 'the layer takes the color from color',
      scratchColors: '*scratch: {what} ({list}), {fate} — give a valid CSS color in colors.',
      scratchImage: '*scratch: the image {url} could not be loaded, the color layer replaces it.',
      // mjs_fx_scrub.ts
      scrubTag: '*scrub: without frames or images, the tag must be a <video> (this is a <{tag}>) — the effect is not applied. For an image sequence, write frames and count on a <canvas> or an <img>.',
      scrubSeqTag: '*scrub: an image sequence (frames, images) goes on a <canvas> or an <img>, not on a <{tag}> — the effect is not applied.',
      scrubCount: '*scrub: frames needs count, the number of images in the sequence — the effect is not applied. For example write *scrub(frames: \'img/seq-###.webp\', count: 120).',
      scrubHash: '*scrub: frames must contain ### in place of the image number (img/seq-###.webp) — the effect is not applied.',
      scrubContext: '*scrub: this <canvas> already carries a context other than 2d — the effect is not applied.',
      // mjs_ujs.ts
      ujsSubmitFailed: 'Submit failed (status {status}) — no complete fallback HTML page in the response.',
      ujsSubmitNotHtml: 'Submit response not recognized as a complete HTML page (expected: a string containing "<html") — no content updated. To handle a non-HTML response yourself, set @noUJS on the <form>.',
      ujsSubmitNoBody: 'HTML response to the submit received, but no usable <body> (current page or server response) — no content updated.',
      ujsMethodDialog: '_method=dialog makes no sense: dialog is a method/formmethod attribute, not an HTTP verb',
      ujsVerbUnknown: 'mjs-method="{verb}": unrecognized HTTP verb (get/delete/post/put/patch expected) — normal navigation.',
      ujsConfirmRetryFailed: '@confirm: retry with a bare requestSubmit() ALSO failed, form not submitted — {e}',
      ujsConfirmRetry: '@confirm: requestSubmit({tag}) failed after acceptance, falling back to a bare requestSubmit() — {reqErr}',
      ujsNoAjax: 'ujs navigation: runtime module \'ajax\' missing (µ._mjs_ajaxRequest not found).',
      ujsHardNavOutside: 'navigation abandoned, url outside the origin and protocol not http/https: {dest}',
      ujsCallbackMissing: '@callback="{nom}": no method \'{nom}\' found on {tag} or its ancestors — callback ignored.',
      ujsFlashNoModal: 'flash/error to display but µ.modal is missing (module \'modal\' not included in `runtime`) — falling back to console/alert.',
      ujsFlashUnknown: 'mjs-flash="{attr}": unrecognized value (popup/console/silent expected) — global policy used.',
      ujsTargetMissingReceived: 'navigation target \'{target}\' not found in the received page — <body> content replaced (on both sides).',
      ujsReplaceNoTarget: 'method \'replace\' without target: <body> is never replaced — content replaced instead.',
      ujsPermanentDupId: '[mjs-permanent] id \'{id}\' carried by SEVERAL elements — only one can cross the navigation, the others leave with the page you left. An id must be unique in the document.',
      ujsPermanentNoId: '[mjs-permanent] without an id ignored — pairing between two navigations requires a stable id on this element.',
      ujsScriptSwapped: '<script> detected in the swapped content: the browser NEVER re-executes an injected <script> (DOM rule) — this code will not run. Move it into an MJS component (µmount), or set @noUJS on the links that lead to this page. Script: {sig}',
      ujsMethodNoUjs: '@method="{method}" ignored — @noUJS makes navigation native, and the browser can only do a GET on a link. Remove one of the two.',
      ujsMethodNative: '@method="{method}": link not followed — to another origin, with a Ctrl, Shift, Alt or Cmd key, on a middle click, with `target` or `download`, the browser would follow it itself, as a GET, without the verb. Only a plain click on a same-origin link, without `target` or `download`, sends the request.',
      ujsUnknownCache: 'cache \'{raw}\' unknown in the navigation card — \'cache-first\' applied.',
      ujsUnknownMethod: 'method \'{raw}\' unknown in the navigation card — \'update\' applied.',
      ujsTargetMissing: 'navigation target \'{target}\' not found in the page — <body> content replaced.',
      ujsHardNavProtocol: 'hard navigation refused, protocol is not http/https: {destination}',
      // mjs_schema.ts
      schemaDefsInvalid: 'invalid µ:schema definitions, local registry UNCHANGED',
      schemaDecodeFailed: 'decoding failed (corrupted frame?)',
      schemaUnknownIdReceived: 'unknown schema id ({id}) received — local registry out of sync (waiting for a µ:schema?)',
      schemaEncodeFailed: 'encoding failed, sending as JSON',
      schemaDecodeUnknownId: 'decode(): unknown schema id ({id}) — local registry incomplete or out of sync',
      schemaDecodeEmpty: 'decode(): empty frame, schema id byte expected',
      schemaEncodeUnknown: 'encode(): unknown schema \'{nom}\' — declare it first (µ.schema)',
      schemaDecodeOutOfFrame: 'decode(): read outside the frame (offset {offset}, {taille} bytes, frame of {frame})',
      schemaListTooLong: 'list({of}): {count} elements, max 65535 (u16 counter)',
      schemaStringTooLong: 'string too long for {t} ({bytes} UTF-8 bytes, max {max})',
      schemaOutOfRange: 'schema \'{nomSchema}\', field \'{nomChamp}\': {valeur} is out of range for {t} ({min} to {max}) — the value would arrive wrapped. Choose a wider type, or clamp the value before sending.',
      schemaRegistryFull: 'registry full — 256 schemas already declared (u8 id exhausted), cannot add \'{nom}\'',
      schemaRedeclared: 'schema \'{nom}\' already declared with a different shape — APPEND-ONLY guard: an existing schema is IMMUTABLE, declare a NEW NAME to evolve the protocol.',
      schemaFieldName: 'schema \'{nom}\': invalid field name \'{field}\' — does not survive a plain object ({}[name] = value), e.g. \'__proto__\'',
      schemaFieldInvalid: 'schema \'{nomSchema}\', field \'{nomChamp}\': invalid field type (neither a scalar string, nor list(), nor bits())',
      schemaBitsDup: 'schema \'{nomSchema}\', field \'{nomChamp}\': bits() — duplicate names',
      schemaBitsMax: 'schema \'{nomSchema}\', field \'{nomChamp}\': bits() accepts at most 8 booleans (received {count})',
      schemaBitsEmpty: 'schema \'{nomSchema}\', field \'{nomChamp}\': bits() expects a non-empty array of names',
      schemaListType: 'schema \'{nomSchema}\', field \'{nomChamp}\': list() expects a scalar type ({scalars}) — sub-schemas/nested list not supported, received \'{of}\'',
      schemaUnknownType: 'schema \'{nomSchema}\', field \'{nomChamp}\': unknown type \'{type}\' — valid types: {scalars}, list(type), bits([names])',
      // mjs_socket.ts
      sockLiveEffect: 'live effect',
      sockQueueFull: 'offline queue full (maxQueue={maxQ}) — oldest message lost',
      sockQueueDenied: 'offline queue emptied ({n} waiting): the server refused the identity these messages were written for, they are not sent under any other — send them again once reconnected if needed',
      sockSendDropped: 'send ignored: connection abandoned (voluntary close(), attempts exhausted or reconnect.enabled:false) — call connect() to resume: {url}',
      sockOptionInvalid: 'option {name} ignored: invalid value {value}',
      sockBadUrl: 'invalid URL, connection abandoned: {url}',
      sockDuplicateAuth: '{url}: a connection to this address already exists with a different auth — it is returned to you as is, under its first identity; close it (destroy()) before opening another one under another identity',
      sockHandleGone: '{fn}() on a handle of room "{room}" that has already left (leave()): nothing is registered or sent — to use this room again, take a new handle with sock.room()',
      sockBinaryNoSchema: 'binary frame received and ignored: without the \'schema\' module, the core cannot read it (an MJS-WS server encodes in binary the messages whose schema it declares, app.schema) — add "schema" to the "runtime" list in mjs.config.json, or write "runtime": "all"',
      // mjs_ajax.ts
      ajaxBinVersionDiff: 'schema version differs (client {hashLocal}, server {version}) — refreshing in the background',
      ajaxBinTooShort: 'response too short to carry a schema version (8 bytes expected, {size} received)',
      ajaxBinRefreshFailed: 'schema refresh failed ({url}): HTTP {status}',
      ajaxBinUnknownSchema: 'unknown schema \'{schema}\' — schemas declared in this registry: {names}',
      ajaxBinNoRegistry: 'no registry available — declare at least one schema via µ.schema(...) before calling µ.ajax.binary(url, { schema: \'{schema}\' }), or pass options.codec.',
      ajaxBinNoSchemaModule: 'option \'schema\' used without the \'schema\' runtime module loaded — µschema-HTTP needs its codec (µ.schema/µ.list/µ.bits, see docs/23-mjs-ws.md §3.2). Add \'schema\' to the runtime selection (mjs.config.json), or pass a ready-made registry via options.codec.',
      ajaxCrossOrigin: '{method} request to another origin ({url}): the page\'s CSRF token is NOT sent — it only makes sense for the origin that issued it.',
      // mjs_easing.ts
      txCssThrew: 'cfg.css() threw (transition {direction} #{txId}) — transition closed cleanly:',
      txSetupThrew: 'setup() threw (transition {direction} #{txId}) — transition closed cleanly:',
      txCssSharedThrew: 'cfg.css() threw (shared transition {direction} #{txId}) — transition closed cleanly:',
      txTickThrew: 'cfg.tick() threw (transition {direction} #{txId}) — transition closed cleanly:',
      txEasingUnknown: 'unknown easing \'{e}\' — falling back to cubicOut (expected: linear, ease, ease-in, ease-out, ease-in-out, cubic-bezier(x1,y1,x2,y2), or a function)',
      txBezierRange: 'cubic-bezier({x1}, {y1}, {x2}, {y2}): x1/x2 outside [0, 1] — falling back to cubicOut',
      // mjs_spring.ts
      springShapeMismatch: 'the target does not have the same shape as the current value (different keys or length) — each axis is handled independently: absent from the target => frozen at its current value, absent from current => appears without animating.',
      springContainerKind: 'the target changes container kind (object <-> array) — the spring restarts from zero on the new shape.',
      springShapeToObject: 'the target changes shape (number → object/array) — the spring restarts from zero on the new shape.',
      springShapeToNumber: 'the target changes shape (object/array → number) — the spring restarts from zero on the new shape.',
      springNestedShape: 'a nested value changes shape (object/array/number) — this branch jumps straight to the new value.',
      // mjs_router.ts
      routerHistoryRefused: 'history (re)placement refused for \'{dest}\':',
      routerSlashRefused: 'slash canonicalization refused for \'{hash}\':',
      routerCatchAllLast: '<{tag}>: invalid route \'{path}\' — the \'*\' catch-all must be in LAST position (segment \'{seg}\' and what follows would never be reached).',
      // mjs_autoloader.ts
      autoloaderNotRegistered: '❌ Import of \'{fileName}\' succeeded but <{tag}> was never registered (customElements.define missing in the module?).',
      autoloaderRejected: '❌ Rejected: Component \'{fileName}\' absent from the distribution manifest.',
      autoloaderStale: 'stale bundle: \'{fileName}\' not found — reloading the page (only once per build).',
      // mjs_lockstep.ts
      lockstepApplyThrew: 'apply() threw an error at tick {tick}: the order is only partly applied and the local state of the game can no longer be trusted — fix apply(), which must apply every order without throwing',
      lockstepJournalTruncated: 'journal truncated at resync (tick {tick} received, tick {expected} expected) — deterministic resync impossible, local state potentially wrong',
      lockstepResyncLimit: 'apply() threw an error at tick {tick} after {max} resyncs of the state were already requested within {s} s: the local state of the game stays wrong until the next resync, in {wait} s at most — the game reports it (\'divergence\' event, reason \'apply-threw\'); fix apply(), which must apply every order without throwing',
      lockstepReplayThrew: 'apply() threw an error at tick {tick} while replaying the resync: the resync does not make the local state of the game trustworthy, it differs from the other players\' state if apply() does not throw for them — the game reports it (\'divergence\' event, reason \'apply-threw\'); fix apply(), which must apply every order without throwing',
      lockstepNotLockstep: 'game \'{game}\' is not in lockstep mode on the server side (def.mode) — µ.lockstep will stay inert',
      lockstepSnapshotTooBig: 'snapshot of {size} bytes at tick {tick}, above the {max} bytes allowed by the server (limits.maxPayload, lockstepJournal.maxBytes) — not proposed, the game journal is not cut',
      // mjs_page_cache.ts
      lruEvictError: 'onEvict failed:',
      // mjs_optimistic.ts
      optimisticBadStore: 'invalid store (object expected, e.g. µ.state({...}))',
      // mjs_smooth.ts
      smoothNonFinite: 'non-finite sample (Infinity/NaN) ignored for \'{id}\'',
      // animations/crossfade.ts
      crossfadeFallbackFailed: 'fallback function failed — transition closed cleanly:',
      // animations/create.ts
      animCreateOverride: '\'{name}\' replaces an animation already registered under this name (framework built-in, or another µanim.create called before) — the previous one is lost.',
      // animations/typewriter.ts
      typewriterOneText: '*typewriter requires a single text node',
      // animations/pixelate.ts
      pixelateFilter: '*pixelate: the tag already carries another filter effect (*filter, *chromatic or *liquid): both fight over the CSS filter property. Put one of them on a wrapping tag.',
      // mjs_ajax.ts
      ajaxBinNoneDeclared: '(none)',
      // mjs_ujs.ts
      ujsNoPage: 'No page matches \'{matchPath}\'.',
      // mjs_router.ts
      routerNoRouteLog: 'No route for \'{matchPath}\'.',
      routerNoRoute: 'No route matches \'{matchPath}\'. Declared routes: {routes} — declare a fallback route (\'/*\') to serve your own 404 page.',
      routerViewCrash: 'CRASH: <@view {targetId}> not found in the DOM!',
      routerNoneDeclared: '(none)',
      routerLogRegister: 'Registering: <{tag}>',
      routerLogInit: 'Init <{tag}> with the Hash Path: \'{matchPath}\'',
      routerLogNavigate: 'Local navigation to: \'{matchPath}\'',
      routerLogCurtain: 'View swap under CURTAIN ({value}, priority {priority})',
      routerLogViewTransition: 'View swap under View Transition ({value}, priority {priority})',
      routerLogNative: 'native',
      routerLogNoRoutes: 'No @routes object found in <{tag}>',
      routerLogAnalyze: 'Analyzing @routes for <{tag}>...',
      routerLogMatch: 'Match! [{routePath}] -> Module [{module}] injected into <@view {targetId}>',
      routerLogNothingToInject: 'No component to inject for path \'{matchPath}\'.',
      routerLogViewCleared: 'No route for <@view {targetId}> — view cleared.',
      routerLogCacheHit: 'Restored from cache: <{tag}>',
      routerLogCreate: 'DOM creation: <{tag}>',
      // mjs_element.ts
      elementClosedShadow: '<{tag}>: a \'closed\' Shadow DOM already exists (SSR with shadowMode:\'closed\'?) — MJS can neither adopt nor rebuild it (content inaccessible in closed mode). Use shadowMode:\'open\' (default) in the SSR render options.',
      // mjs_rare_runes.ts
      importEmptyPath: 'µimport: empty path — asset not resolved at build time',
      // mjs_i18n.ts
      i18nHttp: 'i18n: HTTP {status} on {path}',
      // src/core-modules/field.mjs
      coreFieldNoName: 'no \'name\': neither on <@@field>, nor on the wrapped field.',
      // src/core-modules/color.mjs
      coreColorNoValue: 'the \'value\' attribute is required.',
      // src/core-modules/toolbar.mjs
      coreToolbarUnknown: '<@@toolbar>: the tool "{n}" does not exist, it is ignored — known tools: {list}.',
      coreEditorColorUnknown: '<@@editor>: the color "{n}" does not exist, it is ignored — known colors: {list}.',
      // src/core-modules/chart.mjs
      coreChartWord: '<@@chart>: "{word}" is not a known value of {prop}, it is ignored — known values: {list}.',
      coreChartColor: '<@@chart>: the color "{color}" of the series "{key}" is refused, the series takes hue {hue} — write a theme hue name ({list}), an integer of 1 or more (past 6, the hues start over) or a CSS color the browser can read, without ";", ":", quote, brace, "<", ">", "\\", "/*" or url(…).',
      coreChartNoStats: '<@@chart>: the {shape} shape does not draw stats "{word}", it is ignored — shapes that draw statistics: {list}; trend: {trend}.',
      coreChartMix: '<@@chart>: {prop} "{word}" does not go with the {shape} shape, it is ignored — possible values: {list}.',
      coreChartRadar: '<@@chart>: a radar needs at least 3 rows, one per axis; it receives {n}, a line chart replaces it.',
      coreChartRadarCut: '<@@chart>: a radar shows {max} axes at most, the {n} rows received are cut to the last {max}.',
      coreChartUnits: '<@@chart>: the series of the {shape} shape do not have the same unit ({units}) yet they share one scale.',
      coreChartZone: '<@@chart>: "{zone}" is not a known time zone, it is ignored — write local or the name of an IANA zone (Europe/Paris, UTC…); without a time zone, hours are shown as they are written.',
      coreChartDecimals: '<@@chart>: decimals "{value}" is ignored — write a whole number from 0 to 10; without decimals, numbers keep their automatic writing.',
      coreChartPieDrop: '<@@chart>: the series "{key}" has no positive total, the ring gives it no share.',
      coreChartPieLabelDrop: '<@@chart>: the label "{label}" has no positive total, the ring gives it no share.',
      coreChartSide: '<@@chart>: axis "{word}" of the series "{key}" is not a known value, the series stays on the left axis — known values: {list}.',
      coreChartSideShape: '<@@chart>: the {shape} shape has a single scale, axis "right" is ignored for {keys} — shapes with two scales: {list}.',
      coreChartDay: '<@@chart>: "{x}" is not a date that exists, its row fits in no period and leaves the chart — write a possible day (YYYY-MM-DD) or a readable instant.',
      // src/core-modules/gauge.mjs
      coreGaugeStep: '<@@gauge>: the step "{n}" is not a positive number, the gauge moves by 1. Write a step greater than 0.',
      // src/core-modules/number.mjs
      coreNumberDecimals: '<@@number>: decimals "{value}" is ignored — write a whole number from 0 to 100; without decimals, the value is written as is.',
      // src/core-modules/number.mjs, knob.mjs, gauge.mjs
      coreRangeInverted: '<@@{tag}>: min "{min}" is greater than max "{max}", the value stays stuck on a bound. Write a min smaller than max.',
      // mjs_types.ts
      typesAllowed: ' — allowed: {d}',
      typesRefuses: '{p} refuses {v}{d}{at}',
      typesBrought: '{p}: {v} brought back to {to}{d}{at}',
      typesAnimated: '{p} receives an animated value: its bounds are set when creating it (µspring(value, stiffness, damping, min, max), µinterpolate(value, duration, min, max)) — remove {p} from the <vars>{at}',
      // mjs_fx.ts
      fxBrought: '*{name} : {k} = {vu} brought back to {to} — allowed: {reg}{at}',
      fxRefused: '*{name} : {k} = {vu} refused, default value — allowed: {reg}{at}',
      fxEveryRefused: 'the theme variable $$mjs-fx-every is {vu}, a refused value: each effect keeps its default cadence — allowed: a duration (300ms, 1.5s, 0){at}',
      // mjs_fx_sprite.ts
      spriteImage: '*sprite: the image {url} was not found — the sheet is not animated',
      spriteFps: '*sprite: fps and speed are both written — fps wins',
      spriteRow: '*sprite: row without rows — row is ignored',
      spritePoses: '*sprite: poses: "{valeur}" is not a cell number — dropped',
      // mjs_adopt_sheet.ts
      adoptSheetNoShadow: 'µ.adoptSheet: the sheet is not attached to <{tag}>, because this tag has no shadow (a component set to mjs-light, or a tag that is not a ModularJS component). Write this style in the <style> of the component, or in a stylesheet of the page: without a shadow, the page\'s stylesheets already apply to the tag.',
      // mjs_clone.ts
      cloneNotComponent: 'µclone: {tag} is not an MJS component, or its definition has not loaded yet — there is no state to copy. To copy a plain element, write el.cloneNode(true).',
      cloneOption: 'µclone: unknown option "{opt}" — the only option is mirror: µclone el, mirror: true returns a live mirror, which shares the state of the original.',
    },
    dev: {
      // mjs_debug.ts
      propOneWay: '<{tag}> writes its prop "{prop}": this value comes from the parent; bind it with !{…} or send an event. The parent keeps its own value, it does not see this change.',
      attachNotFn: '<{tag}>: the @attach on <{node}> (line {line}) returned a value of type {type}, not a function: it is ignored. Return a cleanup function, called when the element goes away, or nothing.',
      // mjs_hotcss.ts
      hotcssLight: '_hotCss: replaceSync failed for the light sheet <{tag}>:',
      hotcssTag: '_hotCss: replaceSync failed for <{tag}>:',
      hotcssShared: '_hotCss: replaceSync failed for the shared sheet "{name}":',
      hotcssRoot: '_hotCss: replaceSync failed for mjs_root:',
      // mjs_devinspect.ts
      inspectArmed: 'object inspector armed — µconsole(value), or from the panel (Ctrl+Shift+Space)',
      // mjs_devpanel.ts
      panelArmed: 'inspection panel armed — Ctrl+Shift+Space, or µconsole',
      majEffect: 'effect',
      majColor: 'color',
      majDuration: 'duration',
      anchorDetach: 'detach',
      anchorBottom: 'anchor to bottom',
      btnTarget: 'target',
      tipTarget: 'then click an element of the page',
      btnFlash: 'blink on render',
      tipFlash: 'every component that re-renders lights up',
      btnUpdates: 'updates',
      tipUpdates: 'every piece that MJS rewrites lights up',
      btnRefresh: 'refresh',
      btnClose: 'close',
      rowEffects: 'effects (*)',
      tabState: 'State',
      tabDerived: 'Derived',
      tabBindings: 'Bindings',
      tabContext: 'Context',
      tabProps: 'Attributes and props',
      tabStyle: 'Style and theme',
      tabEffects: 'Effects',
      empty: '(empty)',
      themeNone: 'no theme variable detected',
      themeActive: 'Active theme',
      themeKnown: 'known:',
      themeVars: 'Theme variables in effect',
      cssActive: 'Active CSS (adopted sheets)',
      cssNone: 'no own CSS detected',
      propsDeclared: 'Declared props / variables',
      noneF: 'none',
      attrsReal: 'Actual attributes of the element',
      noneM: 'none',
      closeInspector: 'close the object inspector',
      noStore: 'no store',
      noEffectPage: 'no effect in the page',
      pickComponent: 'Pick a component on the left.<br>Hover a row to locate it in the page.',
      derivedTitle: 'Derived values and their dependencies',
      noDerived: 'no derived value',
      bindingsTitle: 'What each variable updates',
      noBinding: 'no binding',
      ctxSet: 'Set here',
      ctxReceived: 'Received from an ancestor',
      noCtxSet: 'no context set by this component',
      noCtxReceived: 'no context received',
      noEffectComp: 'no effect set by this component',
      noStateVar: 'no state variable',
      fxDuration: 'duration',
      fxCurve: 'curve',
      fxMain: 'main',
      fxCopy: 'copy the syntax',
      fxRevert: 'revert',
      fxCopied: 'copied ✓',
      fxSelected: 'selected: Ctrl+C',
      mountedOne: '{n} component mounted',
      mountedMany: '{n} components mounted',
      keysOne: '{n} key',
      keysMany: '{n} keys',
      fxSetOne: '{n} applied',
      fxSetMany: '{n} applied',
      renderOne: '{n} render',
      renderMany: '{n} renders',
      bindingOne: '{n} binding',
      bindingMany: '{n} bindings',
      panelOpen: 'inspection panel open — Esc to close it',
      panelClosed: 'inspection panel closed',
      // mjs_devinspect.ts
      inspNode: 'node',
      inspObject: 'Object',
      inspNoValue: 'no value',
      inspMore: 'and {n} more (display capped at {max})',
      inspAccessor: 'accessor',
      inspFailed: 'failure:',
      inspCircular: 'circular reference',
      // mjs_fx_marquee.ts
      marqueeKids: '*marquee{where}: this tag scrolls child tags that the compiler did not see in the template (most often a script added them). In production the tags scroll is only sent when a placement in the application asks for it: this one does not, so these tags will not scroll unless another placement gets it sent. Write *marquee(unit: child) to ask for it.',
      // mjs_fx_filter.ts
      filterSpotParent: '*filter: no sharp zone (spot) on this tag — its parent {parent} clips or scrolls without being positioned, and positioning it would move what it holds (a tag positioned absolutely, or top, left… offsets written on it). Put the tag inside a position: relative block, within that parent',
      // mjs_fx_transition.ts
      crossfadeGroup: '*crossfade: the group "{group}" keeps the settings of its first placement; a later placement writes other values for {keys}, which do not count. Give the same settings to every placement of the group, or put this one in another group (group).',
      // mjs_fx_hologram.ts
      hologramImages: '*hologram: image, mask and back only apply to card styles; with the style "{style}", they are ignored and no image is loaded',
      // mjs_fx_autosize.ts
      autosizeField: '*autosize: on a <{tag}>, the effect does nothing — it smoothly resizes a box when its content changes (a tag added, a block that opens, an image that arrives), and typing in a field does not change its content. Place *autosize on the box whose content changes, for example the one around the field and its messages.',
      // select.mjs
      selectOtherScript: '<@@select>: a list gets "other" from a script, but no page of the application writes that attribute — the free "Other" answer is not shipped, neither in development nor in production. Write "other" on the list in your page instead of setting it from a script.',
      // editor.mjs
      editorAnswerScript: '<@@editor>: an editor gets "answer" from a script, but no page of the application writes that attribute — the "answer" mode is not shipped, neither in development nor in production. Write "answer" on the editor in your page instead of setting it from a script.',
      // toolbar.mjs
      toolbarToolScript: '<@@toolbar>: a toolbar gets the tool "{n}" from a script, but no page of the application writes that tool — it is not shipped, neither in development nor in production. Write "{n}" in the tool list of a toolbar in your page (the toolbar attribute of an editor, or tools of a toolbar) instead of setting it from a script.',
      // chart.mjs
      chartToolbarScript: '<@@chart>: a chart gets "toolbar" from a script, but no page of the application writes that attribute — the toolbar is not shipped, neither in development nor in production. Write "toolbar" on the chart in your page instead of setting it from a script.',
    },
  },
}

// les groupes que seul un fichier précis du runtime (ou un module cœur) lit : le manifeste ne pose
// un groupe que si son lecteur part dans le build (cf. Bundler.runtimeLabelGroups)
export const OPTIONAL_LABEL_GROUPS = ['modal', 'router', 'toast', 'ujs', 'core', 'fx']

// groupe `core` : à quel module cœur (src/core-modules/<nom>.mjs) appartient chaque clé. Le manifeste ne pose que les
// clés des modules que le build emporte (cf. coreLabelKeys) : une page qui n'emploie que <@@select> ne paie pas les
// textes de l'éditeur, de la barre ni du carrousel. Un module sans libellé par défaut (field, checkbox, sortable…) n'a
// pas de ligne. Les clés de l'éditeur et de la barre n'ont pas toutes le préfixe de leur module (link*, box*, checked
// et unchecked sont à l'éditeur ; tool* à la barre) : d'où une table, pas un préfixe. Une clé appartient à UN module,
// qui la lit lui-même (deux tests le gardent, sur le texte des modules). Le module qui en pose un autre dans son
// gabarit (<@@editor> pose <@@toolbar>) l'emporte avec lui : le build le sait déjà, resolveTagShortcuts() compile
// chaque module référencé jusqu'au point fixe, la table n'a donc pas à le redire
export const CORE_LABEL_MODULES: Record<string, string[]> = {
  carousel: ['carouselPrev', 'carouselNext'],
  code:     ['codeCopy', 'codeCopied'],
  select:   ['selectPlaceholder', 'selectSearch', 'selectEmpty', 'selectOther', 'selectOtherPlaceholder', 'selectOtherHint', 'selectOtherOk', 'selectOtherSep'],
  number:   ['numberLabel', 'numberLess', 'numberMore', 'numberBigLess', 'numberBigMore'],
  gauge:    ['gaugeLabel'],
  knob:     ['knobLabel'],
  progress: ['progressLabel'],
  color:    ['colorLabel'],
  menu:     ['menuLabel'],
  clock:    ['clockHours', 'clockMinutes', 'clockSeconds'],
  editor:   ['editorLabel', 'editorPlaceholder', 'linkLabel', 'linkApply', 'linkRemove', 'linkCancel', 'linkDone', 'boxChecked', 'boxUnchecked', 'checked', 'unchecked', 'colorsLabel', 'colorNone', 'colorGray', 'colorBrown', 'colorOrange', 'colorYellow', 'colorGreen', 'colorBlue', 'colorPurple', 'colorPink', 'colorRed'],
  toolbar:  ['toolbarLabel', 'toolH2', 'toolH3', 'toolQuote', 'toolBold', 'toolItalic', 'toolUnderline', 'toolStrike', 'toolUl', 'toolOl', 'toolCheck', 'toolLink', 'toolUndo', 'toolRedo', 'toolClear', 'toolColor', 'toolbarShift'],
  chart:    ['chartLabel', 'chartEmpty', 'chartHint', 'chartGrouped', 'chartWeekOf', 'chartOwnScale', 'chartMean', 'chartMedian', 'chartQ1', 'chartQ3', 'chartTrend', 'chartNext', 'chartDate', 'chartTime', 'chartNumber', 'chartCategory', 'chartPeriod', 'chartTotal', 'chartOthers', 'chartRange', 'chartCount', 'chartBin', 'chartSeries', 'chartShare', 'chartPieNone', 'chartBrowse', 'chartChoose', 'chartLess', 'chartMore', 'chartDayHour', 'chartTools', 'chartLegend', 'chartShape', 'chartShapeOf', 'chartLine', 'chartArea', 'chartDots', 'chartBar', 'chartStack', 'chartHistogram', 'chartPie', 'chartHeatmap', 'chartRadar', 'chartCalendar', 'chartStats', 'chartStep', 'chartAuto', 'chartDay', 'chartWeek', 'chartMonth', 'chartYear']
}

// les clés d'une PARTIE d'un module que la construction ôte quand aucune page ne la demande (cf. STRICT_ATTRS, bundler/core-sections.ts), nommée
// `<module>.<attribut>` : `chart.toolbar`, la barre d'outils de <@@chart> (ses textes, les noms des formes de son menu, ceux des pas de temps) ;
// `editor.colors`, la couleur du texte (les noms des couleurs de l'éditeur) ; ou `<module>.tool-<outil>`, un outil de la barre de l'éditeur riche
// (cf. TOOL_PREFIX) : `toolbar.tool-color`, le texte du bouton `color`, qui ne part que si une barre de l'appli peut le montrer (Bundler.coreToolShown,
// qui répond non quand aucun éditeur n'a de palette : une <@@toolbar> seule ne le montre jamais). Ses clés restent rangées sous leur module dans
// CORE_LABEL_MODULES (le module les lit) ; le manifeste ne les pose pas quand la partie est ôtée (cf. coreLabelKeys)
export const CORE_LABEL_PARTS: Record<string, string[]> = {
  'editor.colors':      ['colorsLabel', 'colorNone', 'colorGray', 'colorBrown', 'colorOrange', 'colorYellow', 'colorGreen', 'colorBlue', 'colorPurple', 'colorPink', 'colorRed'],
  'toolbar.tool-color': ['toolColor'],
  'chart.toolbar':      ['chartTools', 'chartLegend', 'chartShape', 'chartShapeOf', 'chartStats', 'chartStep', 'chartLine', 'chartArea', 'chartDots', 'chartBar', 'chartStack', 'chartHistogram', 'chartPie', 'chartHeatmap', 'chartRadar', 'chartCalendar', 'chartAuto', 'chartDay', 'chartWeek', 'chartMonth', 'chartYear']
}

// les clés du groupe `core` des modules donnés, moins celles des parties ôtées (`dropped`, cf. CORE_LABEL_PARTS) ; un nom sans ligne dans la table
// (module sans libellé, nom inconnu, `constructor`…) n'en apporte aucune, une partie inconnue n'en ôte aucune
export function coreLabelKeys(modules: Iterable<string>, dropped: Iterable<string> = []): Set<string> {
  const keys = new Set<string>()
  for (const name of modules) if (Object.hasOwn(CORE_LABEL_MODULES, name)) for (const key of CORE_LABEL_MODULES[name]) keys.add(key)
  for (const part of dropped) if (Object.hasOwn(CORE_LABEL_PARTS, part)) for (const key of CORE_LABEL_PARTS[part]) keys.delete(key)
  return keys
}

// groupe `fx` : à quel effet (src/runtime/mjs_fx_<nom>.ts) appartient chaque clé. Le manifeste ne pose que les clés des effets
// que le build emporte (cf. fxLabelKeys) : une page qui n'a que *flipcard ne paie pas les textes de *guard, de *offline ni de
// *loader. Une clé appartient à UN effet, qui la lit lui-même par µ._mjs_fxLabel (un test le garde, sur le texte des effets)
export const FX_LABEL_EFFECTS: Record<string, string[]> = {
  guard:    ['range', 'atLeast', 'atMost', 'chars', 'charsMin', 'charsMax', 'or', 'except', 'invalid'],
  offline:  ['offline', 'pending1', 'pendingN'],
  loader:   ['loading'],
  spoiler:  ['spoiler'],
  flipcard: ['flip']
}

// les clés du groupe `fx` des effets donnés (nom du fichier sans `mjs_fx_` ni `.ts`) ; un nom sans ligne dans la table
// (effet sans libellé, outil, `constructor`…) n'en apporte aucune
export function fxLabelKeys(effects: Iterable<string>): Set<string> {
  const keys = new Set<string>()
  for (const name of effects) if (Object.hasOwn(FX_LABEL_EFFECTS, name)) for (const key of FX_LABEL_EFFECTS[name]) keys.add(key)
  return keys
}

// la table que le manifeste d'un build embarque : en production, sans le groupe `dev` (les fichiers
// qui le lisent ne partent pas) ni le groupe `err` (un fichier par langue, cf. runtimeMessagesFor,
// chargé au premier message de la console). `groups` = les groupes optionnels dont un lecteur part
// dans le build ; absent (faits inconnus), tous sont gardés. `coreModules` = les modules cœur que le build
// emporte : le groupe `core` se réduit à leurs clés, dans l'ordre de la table, et ne part pas quand il n'en
// reste aucune ; absent (faits inconnus), le groupe est gardé entier. `fxEffects` = les fichiers d'effet que le build
// emporte (noms sans `mjs_fx_`) : même découpe du groupe `fx` (cf. fxLabelKeys). `coreDropped` = les parties des modules cœur que le
// build a ôtées (cf. CORE_LABEL_PARTS) : leurs clés ne partent pas. Sans `groups`, ni `coreModules`, ni `coreDropped`, ni `fxEffects` ne jouent
export function runtimeLabelsFor(prod: boolean, groups?: ReadonlySet<string>, coreModules?: ReadonlySet<string>, fxEffects?: ReadonlySet<string>, coreDropped?: ReadonlySet<string>) {
  const garde = (t: any) => {
    if (!groups) return t
    const reste: any = {}
    for (const k of Object.keys(t)) {
      if (OPTIONAL_LABEL_GROUPS.includes(k) && !groups.has(k)) continue
      const keys = k === 'core' && coreModules ? coreLabelKeys(coreModules, coreDropped) : k === 'fx' && fxEffects ? fxLabelKeys(fxEffects) : undefined
      if (keys) {
        const part = Object.fromEntries(Object.entries(t[k]).filter(([key]) => keys.has(key)))
        if (Object.keys(part).length > 0) reste[k] = part
      }
      else reste[k] = t[k]
    }
    return reste
  }
  if (!prod) return { fr: garde(RUNTIME_LABELS.fr), en: garde(RUNTIME_LABELS.en) }
  const sansMessages = (t: any) => { const { dev: _dev, err: _err, ...reste } = t; return garde(reste) }
  return { fr: sansMessages(RUNTIME_LABELS.fr), en: sansMessages(RUNTIME_LABELS.en) }
}

// les langues de la table, et le groupe `err` de l'une d'elles : le contenu du fichier de messages
// que le build de production écrit pour cette langue
export const RUNTIME_LANGS = Object.keys(RUNTIME_LABELS)

export function runtimeMessagesFor(lang: string): Record<string, string> {
  return (RUNTIME_LABELS as Record<string, any>)[lang].err
}
