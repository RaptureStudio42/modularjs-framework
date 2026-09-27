// config eslint flat (ESLint 10 / flat config) — base typescript-eslint RECOMMANDÉE,
// SANS règles stylistiques (le style est régi par une convention à part, pas
// par ESLint) — portée src/ (hors runtime) + tests/. src/runtime (code COMPILÉ
// CoffeeScript/Civet, déjà exclu du typecheck par tsconfig.json, jamais du TS écrit à la main)
// a sa PROPRE config plus bas : la recommandée complète s'y casserait les dents (typage TS
// absent par construction), mais rien n'empêche une poignée de règles « bug certain »
// (variable non déclarée, cas de switch qui retombe, comparaison toujours vraie…)

import tseslint from 'typescript-eslint'

// globales navigateur de src/runtime (ecmaVersion 'latest', sourceType 'script' — sortie de
// build, pas des modules ES)
const RUNTIME_GLOBALS = Object.fromEntries(['µ', 'window', 'document', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'FileReader', 'AbortController', 'AbortSignal', 'DOMParser', 'XMLSerializer', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'InputEvent', 'HTMLElement', 'HTMLInputElement', 'HTMLTemplateElement', 'HTMLFormElement', 'HTMLAnchorElement', 'SVGElement', 'Element', 'Node', 'Text', 'Comment', 'DocumentFragment', 'ShadowRoot', 'customElements', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'CSSStyleSheet', 'getComputedStyle', 'performance', 'localStorage', 'sessionStorage', 'location', 'history', 'WebSocket', 'TextEncoder', 'TextDecoder', 'crypto', 'structuredClone', 'atob', 'btoa', 'URL', 'URLSearchParams', 'NodeFilter', 'Range', 'Selection', 'CSS', 'matchMedia', 'Image', 'Audio', 'AudioContext', 'alert', 'confirm', 'prompt', 'self', 'globalThis', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'getSelection', 'BroadcastChannel', 'Worker', 'ImageData', 'OffscreenCanvas', 'DOMRect', 'DOMMatrix', 'Animation', 'KeyframeEffect', 'ErrorEvent', 'PromiseRejectionEvent', 'EventTarget', 'CSSRule', 'Document', 'Window', 'MediaQueryList', 'PageTransitionEvent', 'PopStateEvent', 'HashChangeEvent', 'SubmitEvent', 'DataTransfer', 'ClipboardEvent', 'Notification', 'caches', 'indexedDB', 'visualViewport', 'addEventListener', 'removeEventListener', 'webkitAudioContext'].map(n => [n, 'readonly']))

// globales de concaténation : le build assemble tous les fichiers du runtime en UN script, les
// fonctions déclarées dans l'un sont donc visibles des autres (le module qui les définit est
// toujours livré avec ceux qui les appellent : µsocket avec jeu/salon/chat/comptes, schéma avec ajax)
const RUNTIME_SHARED = Object.fromEntries(['hasProp', 'MjsSocket', '_mjs_safeKey', 'mjschemaEncode', 'mjschemaDecode', 'mjschemaHashRegistre', 'mjschemaChargerDefinitions'].map(n => [n, 'readonly']))

export default tseslint.config(
  {
    // `**/*.mjs` — ce sont des COMPOSANTS ModularJS (balises, `@directives`, SASS), pas du
    // JavaScript : le parseur d'ESLint ne peut que s'y casser les dents (« Unexpected token < »)
    ignores: ['dist/**', 'node_modules/**', 'tests/snapshots/**', 'public/**', 'app/**', 'bench/**', '**/*.mjs']
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    // src/runtime a sa propre config, plus bas — jamais la recommandée complète (typage TS
    // absent par construction, sourceType script, globales navigateur)
    ignores: ['src/runtime/**'],
    extends: [tseslint.configs.recommended],
    linterOptions: {
      // commentaires eslint-disable hérités d'une config antérieure (no-console,
      // no-implied-eval, no-new-func — jamais activés ici) : ne pas les signaler
      reportUnusedDisableDirectives: 'off'
    },
    rules: {
      // typage intentionnellement LÂCHE (tsconfig strict:false, noImplicitAny:false) —
      // compilateur/AST/µschema manipulent des formes non typées par conception, pas
      // par oubli ; ~3750 sites, contredirait un choix de design assumé du projet
      '@typescript-eslint/no-explicit-any': 'off',
      // même rationale que no-explicit-any : `Function` en type large sert dans les
      // mocks de tests (callbacks d'événements non typés à dessein)
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // idiome répété du projet `cond && call()` pour l'invocation conditionnelle de
      // handlers optionnels (mocks WS/DOM) — pas un oubli, allowShortCircuit couvre
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // ~100 sites hérités (imports/vars morts épars) non traités ici —
      // abaissé en avertissement (pas éteint) + convention `_préfixe` déjà ignorée
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['tests/contract-types.test.ts'],
    rules: {
      // fonctions `_typeChecks*` jamais exécutées : expressions volontairement « mortes »
      // pour forcer tsc à TYPE-CHECKER le contrat (cf. en-tête du fichier) — pas des oublis
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  },
  {
    // src/runtime (~24 700 lignes livrées au navigateur) : jamais vérifié par le typecheck
    // (exclu de tsconfig.json) ni par eslint jusqu'ici — cette config minimale « bug certain »
    // ne coûte rien et protège des régressions de base (variable non déclarée, cas de switch qui
    // retombe, comparaison toujours vraie…), sans prétendre remplacer un vrai typage
    files: ['src/runtime/**/*.ts'],
    // globals.d.ts : déclarations de types pour l'éditeur, aucun code exécuté
    ignores: ['src/runtime/**/*.d.ts'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'script', globals: { ...RUNTIME_GLOBALS, ...RUNTIME_SHARED } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-dupe-keys': 'error', 'no-duplicate-case': 'error', 'no-unreachable': 'error', 'no-self-assign': 'error', 'no-self-compare': 'error',
      'no-cond-assign': ['error', 'except-parens'], 'no-fallthrough': 'error', 'no-sparse-arrays': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
      'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error', 'no-dupe-else-if': 'error', 'no-loss-of-precision': 'error', 'getter-return': 'error',
      'no-setter-return': 'error', 'no-async-promise-executor': 'error', 'no-compare-neg-zero': 'error', 'no-empty-character-class': 'error',
      'no-invalid-regexp': 'error', 'no-const-assign': 'error', 'no-func-assign': 'error', 'no-dupe-class-members': 'error', 'no-constant-binary-expression': 'error',
      'no-unmodified-loop-condition': 'error', 'no-unused-private-class-members': 'error', 'no-useless-backreference': 'error', 'no-control-regex': 'off',
      'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }], 'no-shadow-restricted-names': 'error', 'no-redeclare': ['error', { builtinGlobals: false }]
    }
  }
)
