const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Récupérer tous les utilisateurs (admin/manager seulement)
router.get('/', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { search = '', role = '', department = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (role) {
      whereConditions.push('role = ?');
      queryParams.push(role);
    }

    if (department) {
      whereConditions.push('department = ?');
      queryParams.push(department);
    }

    const whereClause = whereConditions.join(' AND ');

    // Récupérer les utilisateurs
    const users = await query(
      `SELECT id, email, first_name, last_name, role, department, position, phone, 
              hire_date, salary, is_active, created_at 
       FROM users 
       WHERE ${whereClause} 
       ORDER BY created_at DESC`,
      queryParams
    );

    res.json(users);
  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
  }
});

// Récupérer la liste des utilisateurs pour les sélecteurs (managers et employés seulement)
router.get('/select', authenticateToken, async (req, res) => {
  try {
    const users = await query(
      `SELECT id, first_name, last_name, email, role, department, position 
       FROM users 
       WHERE role IN ('admin', 'manager', 'employee') AND is_active = 1
       ORDER BY first_name, last_name`,
      []
    );

    res.json(users);
  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs pour sélection:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
  }
});

// Récupérer un utilisateur par ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier les permissions
    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }

    const users = await query(
      'SELECT id, email, first_name, last_name, role, department, position, phone, address, hire_date, salary, avatar, is_active, created_at FROM users WHERE id = ?',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const user = users[0];
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      department: user.department,
      position: user.position,
      phone: user.phone,
      address: user.address,
      hireDate: user.hire_date,
      salary: user.salary,
      avatar: user.avatar,
      isActive: user.is_active,
      createdAt: user.created_at
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de l\'utilisateur' });
  }
});

// Créer un nouvel utilisateur (admin seulement)
router.post('/', authenticateToken, authorize('admin'), [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').notEmpty().trim(),
  body('lastName').notEmpty().trim(),
  body('role').isIn(['admin', 'manager', 'employee', 'client'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, firstName, lastName, role, department, position, phone, address, salary } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const existingUsers = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Un utilisateur avec cet email existe déjà' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Créer l'utilisateur
    const result = await query(
      'INSERT INTO users (email, password, first_name, last_name, role, department, position, phone, address, salary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, firstName, lastName, role, department, position, phone, address, salary]
    );

    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      userId: result.insertId
    });
  } catch (error) {
    console.error('Erreur lors de la création de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur' });
  }
});

// Mettre à jour un utilisateur
router.put('/:id', authenticateToken, [
  body('firstName').optional().notEmpty().trim(),
  body('lastName').optional().notEmpty().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('role').optional().isIn(['admin', 'manager', 'employee', 'client']),
  body('phone').optional().isMobilePhone(),
  body('salary').optional().isDecimal()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { firstName, lastName, email, role, department, position, phone, address, salary, isActive } = req.body;

    // Vérifier les permissions
    if (req.user.role !== 'admin' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }

    // Vérifier que l'utilisateur existe
    const existingUsers = await query('SELECT id FROM users WHERE id = ?', [id]);
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Vérifier l'unicité de l'email si modifié
    if (email) {
      const emailCheck = await query('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
      if (emailCheck.length > 0) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé' });
      }
    }

    // Construire la requête de mise à jour
    const updateFields = [];
    const updateValues = [];

    if (firstName) {
      updateFields.push('first_name = ?');
      updateValues.push(firstName);
    }
    if (lastName) {
      updateFields.push('last_name = ?');
      updateValues.push(lastName);
    }
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (role && req.user.role === 'admin') {
      updateFields.push('role = ?');
      updateValues.push(role);
    }
    if (department) {
      updateFields.push('department = ?');
      updateValues.push(department);
    }
    if (position) {
      updateFields.push('position = ?');
      updateValues.push(position);
    }
    if (phone) {
      updateFields.push('phone = ?');
      updateValues.push(phone);
    }
    if (address) {
      updateFields.push('address = ?');
      updateValues.push(address);
    }
    if (salary !== undefined && req.user.role === 'admin') {
      updateFields.push('salary = ?');
      updateValues.push(salary);
    }
    if (isActive !== undefined && req.user.role === 'admin') {
      updateFields.push('is_active = ?');
      updateValues.push(isActive);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updateValues.push(id);

    await query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.json({ message: 'Utilisateur mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'utilisateur' });
  }
});

// Supprimer un utilisateur (admin seulement)
router.delete('/:id', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Empêcher la suppression de son propre compte
    if (req.user.id === parseInt(id)) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }

    // Vérifier que l'utilisateur existe
    const existingUsers = await query('SELECT id FROM users WHERE id = ?', [id]);
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Supprimer l'utilisateur
    await query('DELETE FROM users WHERE id = ?', [id]);

    res.json({ message: 'Utilisateur supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur' });
  }
});

// Obtenir les statistiques des utilisateurs (admin/manager seulement)
router.get('/stats/overview', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
        SUM(CASE WHEN role = 'manager' THEN 1 ELSE 0 END) as managers,
        SUM(CASE WHEN role = 'employee' THEN 1 ELSE 0 END) as employees,
        SUM(CASE WHEN role = 'client' THEN 1 ELSE 0 END) as clients
      FROM users
    `);

    const departmentStats = await query(`
      SELECT department, COUNT(*) as count 
      FROM users 
      WHERE department IS NOT NULL 
      GROUP BY department 
      ORDER BY count DESC
    `);

    res.json({
      overview: stats[0],
      departments: departmentStats
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

module.exports = router;
