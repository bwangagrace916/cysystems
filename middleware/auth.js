const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// Middleware d'authentification
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token d\'accès requis' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérifier que l'utilisateur existe toujours
    const users = await query('SELECT id, email, role, is_active FROM users WHERE id = ?', [decoded.userId]);
    
    if (users.length === 0 || !users[0].is_active) {
      return res.status(401).json({ error: 'Utilisateur invalide ou inactif' });
    }

    req.user = users[0];
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token invalide' });
  }
};

// Middleware de vérification des rôles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }

    next();
  };
};

// Middleware pour vérifier si l'utilisateur peut accéder à une ressource
const checkResourceAccess = (resourceType) => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params.id;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Les admins peuvent accéder à tout
      if (userRole === 'admin') {
        return next();
      }

      let hasAccess = false;

      switch (resourceType) {
        case 'project':
          const projects = await query(
            'SELECT id FROM projects WHERE id = ? AND (manager_id = ? OR id IN (SELECT project_id FROM project_tasks WHERE assigned_to = ?))',
            [resourceId, userId, userId]
          );
          hasAccess = projects.length > 0;
          break;

        case 'client':
          const clients = await query(
            'SELECT id FROM clients WHERE id = ?',
            [resourceId]
          );
          hasAccess = clients.length > 0;
          break;

        case 'invoice':
          const invoices = await query(
            'SELECT id FROM invoices WHERE id = ? AND created_by = ?',
            [resourceId, userId]
          );
          hasAccess = invoices.length > 0;
          break;

        default:
          hasAccess = true;
      }

      if (!hasAccess) {
        return res.status(403).json({ error: 'Accès non autorisé à cette ressource' });
      }

      next();
    } catch (error) {
      console.error('Erreur de vérification d\'accès:', error);
      res.status(500).json({ error: 'Erreur de vérification des permissions' });
    }
  };
};

module.exports = {
  authenticateToken,
  authorize,
  checkResourceAccess
};
