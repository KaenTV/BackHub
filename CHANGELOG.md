# Changelog

## [1.1.0] - 2025-01-07

### ✨ Nouvelles fonctionnalités

#### Performance & Optimisation
- ✅ **Debounce/Throttle** : `updateTotals()` optimisé avec debounce (150ms)
- ✅ **Mémorisation des calculs** : Cache des calculs de marge pour éviter les recalculs
- ✅ **Lazy loading** : Chargement à la demande des catégories d'items
- ✅ **Performance monitoring** : Détection automatique des opérations lentes (>100ms)

#### Notifications & Alertes
- ✅ **Système de notifications toast** : Notifications élégantes avec animations
- ✅ **Notifications système** : Intégration avec le système d'exploitation
- ✅ **Alertes marge négative** : Alertes automatiques quand la marge devient négative

#### Backup & Synchronisation
- ✅ **Backup automatique** : Sauvegarde automatique toutes les 5 minutes
- ✅ **Export/Import** : Export et import de sauvegardes en JSON
- ✅ **Synchronisation locale** : Synchronisation entre instances locales (sans cloud)

#### UX/UI
- ✅ **Animations fluides** : Transitions entre vues améliorées
- ✅ **Responsive design** : Adaptation aux différentes tailles d'écran
- ✅ **Mode compact** : Mode compact pour petits écrans
- ✅ **Drag & Drop** : Réorganisation des items par drag & drop
- ✅ **Import par drag & drop** : Import de fichiers de sauvegarde par drag & drop
- ✅ **Undo/Redo** : Système complet d'annulation/rétablissement
- ✅ **Tooltips** : Tooltips contextuels pour l'aide
- ✅ **Guide interactif** : Guide au premier lancement

#### Architecture
- ✅ **Modularisation** : Code organisé en modules ES6
  - `utils/` : Utilitaires (debounce, format, logger, performance, memoize)
  - `services/` : Services (notifications, storage, backup, sync, undo-redo, calculations, alerts, lazy-load)
  - `components/` : Composants réutilisables (tooltip, guide, drag-drop)
- ✅ **Gestion d'erreurs** : Logging complet avec rotation et messages utilisateur
- ✅ **SQLite** : Migration vers SQLite avec fallback localStorage
- ✅ **Tray icon** : Icône dans la barre système avec notifications

#### Raccourcis clavier
- ✅ `Ctrl+Z` / `Cmd+Z` : Undo
- ✅ `Ctrl+Shift+Z` / `Cmd+Shift+Z` : Redo
- ✅ `Ctrl+S` / `Cmd+S` : Sauvegarder
- ✅ `Ctrl+F` / `Cmd+F` : Rechercher

### 🔧 Améliorations techniques

- Code modulaire et maintenable
- Meilleure gestion des erreurs
- Performance optimisée
- Compatibilité ascendante maintenue (localStorage + SQLite)

### 📝 Notes

- Les mots de passe sont toujours stockés en clair (à améliorer en production)
- Le guide interactif s'affiche uniquement au premier lancement
- Les sauvegardes automatiques sont créées toutes les 5 minutes
- La synchronisation locale vérifie les changements toutes les 2 secondes

### 🐛 Corrections

- Correction des appels asynchrones pour le stockage
- Amélioration de la gestion des erreurs SQLite
- Fallback automatique vers localStorage si SQLite échoue

