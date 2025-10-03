# 🏢 CY Systems Backend API

Backend API pour le système de gestion d'entreprise CY Systems. Une API REST complète construite avec Node.js et Express pour la gestion des employés, projets, clients, équipements, factures et abonnements.

## 📋 Table des matières

- [Fonctionnalités](#-fonctionnalités)
- [Technologies utilisées](#-technologies-utilisées)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [API Endpoints](#-api-endpoints)
- [Sécurité](#-sécurité)
- [Développement](#-développement)
- [Structure du projet](#-structure-du-projet)
- [Contribuer](#-contribuer)

## 🚀 Fonctionnalités

- **Authentification sécurisée** avec JWT
- **Gestion des utilisateurs** et rôles
- **Gestion des employés** avec informations détaillées
- **Gestion des projets** et tâches
- **Gestion des clients** et relations
- **Gestion des équipements** et inventaire
- **Système de facturation** complet
- **Gestion des abonnements**
- **Upload de fichiers** sécurisé
- **Rate limiting** et protection CORS
- **Validation des données** avec express-validator
- **Logs et gestion d'erreurs** avancés

## 🛠 Technologies utilisées

- **Node.js** - Runtime JavaScript
- **Express.js** - Framework web
- **MySQL2** - Base de données relationnelle
- **JWT** - Authentification par tokens
- **bcryptjs** - Hachage des mots de passe
- **Multer** - Upload de fichiers
- **Helmet** - Sécurité HTTP
- **CORS** - Gestion des requêtes cross-origin
- **Express Rate Limit** - Limitation du taux de requêtes
- **Express Validator** - Validation des données
- **Jest** - Tests unitaires

## 📦 Installation

1. **Cloner le repository**
```bash
git clone https://github.com/bwangagrace916/cysystems.git
cd cysystems/backend
```

2. **Installer les dépendances**
```bash
npm install
```

3. **Configurer les variables d'environnement**
```bash
cp env.example .env
```

4. **Configurer la base de données**
   - Créer une base de données MySQL nommée `cy_systems_enterprise`
   - Mettre à jour les informations de connexion dans `.env`

5. **Démarrer le serveur**
```bash
# Mode développement
npm run dev

# Mode production
npm start
```

## ⚙️ Configuration

### Variables d'environnement

Créez un fichier `.env` basé sur `env.example` :

```env
# Configuration de la base de données
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=votre_mot_de_passe
DB_NAME=cy_systems_enterprise

# Configuration du serveur
PORT=5001
NODE_ENV=development

# Configuration JWT
JWT_SECRET=votre_secret_jwt_super_securise
JWT_EXPIRE=7d

# Configuration CORS
CORS_ORIGIN=http://localhost:3000

# Configuration de l'upload
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=5242880
```

## 🔗 API Endpoints

### Authentification
- `POST /api/auth/register` - Inscription d'un utilisateur
- `POST /api/auth/login` - Connexion
- `POST /api/auth/logout` - Déconnexion
- `GET /api/auth/profile` - Profil utilisateur

### Utilisateurs
- `GET /api/users` - Liste des utilisateurs
- `GET /api/users/:id` - Détails d'un utilisateur
- `PUT /api/users/:id` - Mise à jour d'un utilisateur
- `DELETE /api/users/:id` - Suppression d'un utilisateur

### Employés
- `GET /api/employees` - Liste des employés
- `POST /api/employees` - Créer un employé
- `GET /api/employees/:id` - Détails d'un employé
- `PUT /api/employees/:id` - Mise à jour d'un employé
- `DELETE /api/employees/:id` - Suppression d'un employé

### Projets
- `GET /api/projects` - Liste des projets
- `POST /api/projects` - Créer un projet
- `GET /api/projects/:id` - Détails d'un projet
- `PUT /api/projects/:id` - Mise à jour d'un projet
- `DELETE /api/projects/:id` - Suppression d'un projet

### Clients
- `GET /api/clients` - Liste des clients
- `POST /api/clients` - Créer un client
- `GET /api/clients/:id` - Détails d'un client
- `PUT /api/clients/:id` - Mise à jour d'un client
- `DELETE /api/clients/:id` - Suppression d'un client

### Équipements
- `GET /api/equipment` - Liste des équipements
- `POST /api/equipment` - Ajouter un équipement
- `GET /api/equipment/:id` - Détails d'un équipement
- `PUT /api/equipment/:id` - Mise à jour d'un équipement
- `DELETE /api/equipment/:id` - Suppression d'un équipement

### Factures
- `GET /api/invoices` - Liste des factures
- `POST /api/invoices` - Créer une facture
- `GET /api/invoices/:id` - Détails d'une facture
- `PUT /api/invoices/:id` - Mise à jour d'une facture
- `DELETE /api/invoices/:id` - Suppression d'une facture

### Abonnements
- `GET /api/subscriptions` - Liste des abonnements
- `POST /api/subscriptions` - Créer un abonnement
- `GET /api/subscriptions/:id` - Détails d'un abonnement
- `PUT /api/subscriptions/:id` - Mise à jour d'un abonnement
- `DELETE /api/subscriptions/:id` - Suppression d'un abonnement

### Test
- `GET /api/test` - Test de l'API

## 🔒 Sécurité

- **Helmet.js** pour les en-têtes de sécurité HTTP
- **Rate limiting** (100 requêtes/15min par IP)
- **CORS** configuré pour les domaines autorisés
- **JWT** pour l'authentification sécurisée
- **bcryptjs** pour le hachage des mots de passe
- **Validation** des données d'entrée
- **Upload sécurisé** des fichiers

## 🛠 Développement

### Scripts disponibles

```bash
# Démarrer en mode développement avec nodemon
npm run dev

# Démarrer en mode production
npm start

# Lancer les tests
npm test
```

### Structure du projet

```
backend/
├── config/
│   └── database.js          # Configuration de la base de données
├── middleware/
│   └── auth.js              # Middleware d'authentification
├── routes/
│   ├── auth.js              # Routes d'authentification
│   ├── users.js             # Routes des utilisateurs
│   ├── employees.js         # Routes des employés
│   ├── projects.js          # Routes des projets
│   ├── clients.js           # Routes des clients
│   ├── equipment.js         # Routes des équipements
│   ├── invoices.js          # Routes des factures
│   └── subscriptions.js     # Routes des abonnements
├── uploads/                 # Dossier des fichiers uploadés
├── server.js                # Point d'entrée de l'application
├── package.json             # Dépendances et scripts
├── env.example              # Exemple de configuration
└── README.md                # Documentation
```

## 📝 Exemple d'utilisation

### Test de l'API

```bash
curl http://localhost:5001/api/test
```

Réponse :
```json
{
  "message": "CY Systems API fonctionne correctement!",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0"
}
```

### Authentification

```bash
# Inscription
curl -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'

# Connexion
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'
```

## 🤝 Contribuer

1. Fork le projet
2. Créer une branche pour votre fonctionnalité (`git checkout -b feature/AmazingFeature`)
3. Commiter vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Pousser vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## 👥 Auteur

**CY Systems** - *Développement* - [GitHub](https://github.com/bwangagrace916)

## 📞 Support

Pour toute question ou problème, veuillez ouvrir une issue sur GitHub.

---

⭐ N'hésitez pas à donner une étoile si ce projet vous a aidé !
