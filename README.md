# 🚀 BackHub

**L'outil de gestion complet pour RevolutionDayZ**

BackHub est une application desktop développée avec Electron, conçue spécialement pour la communauté du serveur RevolutionDayZ. Cette application permet aux clans de gérer leur économie en jeu, notamment pour les activités de marché noir (Black market) et de trafic de drogue (Drug dealer).

---

## 📋 Table des matières

- [À propos](#-à-propos)
- [Fonctionnalités](#-fonctionnalités)
- [Installation](#-installation)
- [Utilisation](#-utilisation)
- [Développement](#-développement)
- [Structure du projet](#-structure-du-projet)
- [Technologies utilisées](#-technologies-utilisées)
- [Sécurité](#-sécurité)
- [Contribution](#-contribution)
- [Support](#-support)
- [Licence](#-licence)

---

## 🎯 À propos

BackHub est un projet **indépendant** développé bénévolement par **Kaen** pour la communauté RevolutionDayZ. Cette application n'est **en aucun cas** créée, développée, maintenue ou hébergée par les administrateurs du serveur RevolutionDayZ.

### Objectif

Faciliter la gestion économique des clans sur RevolutionDayZ en fournissant des outils pratiques pour :
- Calculer les marges bénéficiaires
- Gérer les prix d'achat personnalisés
- Suivre les transactions
- Optimiser les profits

---

## ✨ Fonctionnalités

### 💰 Gestion économique
- **Calcul automatique des marges bénéficiaires** pour toutes les transactions
- **Gestion des prix d'achat personnalisés** pour chaque utilisateur
- Visualisation des prix de revente en temps réel
- Support pour les calculs de **drogues** et **items**
- Historique complet des transactions
- Système d'alertes de marge configurable
- Calculs en temps réel avec mise à jour automatique

### 🗳️ Système de votes
- Suivi du **cooldown de vote** sur Top-Serveurs
- Affichage du **nombre de votes du mois** en temps réel
- Suivi du **classement du serveur** sur Top-Serveurs
- Notifications overlay pour les votes disponibles
- Compte à rebours visuel du cooldown
- Synchronisation automatique des statistiques de vote

### 🔔 Notifications
- **Notifications overlay** en plein écran (style Discord)
- Notifications pour les votes disponibles
- Notifications pour les retours de feedback
- Notifications système natives Windows
- Interface non-intrusive et élégante

### 📊 Synchronisation et sauvegarde
- **Synchronisation automatique** avec l'API BackHub
- Système de **sauvegarde et restauration** des données
- Gestion des prix personnalisés par utilisateur
- **Cache intelligent** pour améliorer les performances
- Stockage local sécurisé

### 🗺️ Carte interactive
- Intégration de cartes interactives avec Leaflet
- Visualisation des zones importantes du serveur
- Support pour les marqueurs personnalisés
- Carte de Chernarus intégrée

### 👥 Gestion des utilisateurs
- **Système d'authentification sécurisé**
- Gestion des **membres de clan**
- Profils utilisateurs personnalisés
- Session persistante avec option "Se souvenir de moi"

### 🔄 Mise à jour automatique
- Vérification automatique des mises à jour au démarrage
- Vérification périodique toutes les 4 heures
- Téléchargement et installation automatiques
- Notifications pour les nouvelles versions

### 🎨 Interface moderne
- Design sombre élégant
- Interface sans bordure (frameless) personnalisée
- Contrôles de fenêtre personnalisés
- Animations et transitions fluides
- Responsive et optimisé

---

## 📦 Installation

### Prérequis
- **Windows 10/11** (64-bit)
- Connexion Internet pour la synchronisation

### Installation pour les utilisateurs

1. **Télécharger l'installateur**
   - Allez sur la [page des releases GitHub](https://github.com/KaenTV/BackHub/releases)
   - Téléchargez `BackHub-Setup.exe` de la dernière version

2. **Exécuter l'installateur**
   - Double-cliquez sur `BackHub-Setup.exe`
   - Suivez les instructions de l'assistant d'installation
   - Choisissez le répertoire d'installation (optionnel)

3. **Lancer l'application**
   - L'application se lancera automatiquement après l'installation
   - Un raccourci sera créé sur le bureau et dans le menu Démarrer

4. **Première connexion**
   - Créez un compte ou connectez-vous avec vos identifiants
   - Configurez vos préférences

---

## 💻 Utilisation

### Première utilisation

1. **Créer un compte**
   - Cliquez sur l'onglet "Inscription"
   - Remplissez le formulaire avec votre nom d'utilisateur et mot de passe
   - Cliquez sur "S'inscrire"

2. **Se connecter**
   - Entrez vos identifiants
   - Cochez "Garder la session active" si vous souhaitez rester connecté
   - Cliquez sur "Se connecter"

3. **Configurer vos prix**
   - Accédez à la section de gestion des prix
   - Définissez vos prix d'achat personnalisés
   - Les calculs de marge se feront automatiquement

### Fonctionnalités principales

- **Calcul de marges** : Sélectionnez un item ou une drogue pour voir automatiquement les marges bénéficiaires
- **Gestion des votes** : Suivez votre cooldown de vote et vos statistiques sur Top-Serveurs
- **Notifications** : Recevez des alertes pour les votes disponibles et les retours de feedback
- **Synchronisation** : Vos données sont automatiquement synchronisées avec le serveur

## 🔐 Sécurité

### Mesures de sécurité implémentées

- ✅ **Sandbox activé** pour une sécurité renforcée
- ✅ **Context isolation** pour protéger les données sensibles
- ✅ **DevTools désactivés** en production
- ✅ **Menu contextuel désactivé** (clic droit)
- ✅ **Raccourcis clavier bloqués** (F12, Ctrl+Shift+I, etc.)
- ✅ Validation stricte des URLs et domaines autorisés
- ✅ Gestion sécurisée des tokens d'authentification
- ✅ Protection contre les injections XSS
- ✅ WebSecurity activé par défaut
- ✅ Communications HTTPS uniquement

### Protection des données

- Toutes les communications avec le serveur sont sécurisées (HTTPS)
- Les mots de passe sont hashés et jamais stockés en clair
- Isolation du contexte pour protéger les données sensibles
- Validation stricte de toutes les entrées utilisateur

---

## 🤝 Contribution

BackHub est un projet communautaire en constante évolution. Nous recherchons activement des contributeurs pour :

### Développement
- Frontend & Backend
- Architecture & APIs
- Applications Desktop

### Design
- Interface utilisateur
- Expérience utilisateur
- Identité visuelle

### Tests
- Assurance qualité
- Tests utilisateurs
- Retours & Feedback

### Comment contribuer

1. **Fork** le projet
2. Créez une **branche** pour votre fonctionnalité (`git checkout -b feature/AmazingFeature`)
3. **Commit** vos changements (`git commit -m 'Add some AmazingFeature'`)
4. **Push** vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une **Pull Request**

---

## 📧 Support

### Besoin d'aide ?

- 📧 **Email** : [kaen@backhub.online](mailto:kaen@backhub.online)
- 🐛 **Signaler un bug** : Utilisez la section Feedback dans l'application
- 💡 **Suggestion** : Utilisez la section Feedback dans l'application
- 📖 **Documentation** : Consultez le Wiki intégré dans l'application

### Signaler un problème

Lors du signalement d'un bug, merci d'inclure :
- Version de l'application
- Système d'exploitation
- Étapes pour reproduire le problème
- Captures d'écran (si applicable)
- Messages d'erreur (si applicable)

---

## 📄 Licence

Ce projet est sous licence **MIT**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## 🔗 Liens utiles

- 🌐 **Site web** : [backhub.online](https://backhub.online)
- 📦 **Repository GitHub** : [github.com/KaenTV/BackHub](https://github.com/KaenTV/BackHub)
- 🎮 **Serveur RevolutionDayZ** : [top-serveurs.net](https://www.top-serveurs.net/dayz/revolutiondayz)

---

## 🙏 Remerciements

Un grand merci à :
- Toute la **communauté RevolutionDayZ** pour leur support et leurs retours constructifs
- Les **testeurs bêta** qui ont aidé à améliorer l'application
- La communauté **open source** pour les outils utilisés

---

**Développé avec ❤️ par Kaen pour la communauté RevolutionDayZ**

*Version 1.5.0-BETA*

