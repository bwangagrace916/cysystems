const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Récupérer tous les employés
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search = '', role = '', department = '', status = '' } = req.query;

    let whereConditions = ['role != "client"'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR position LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (role) {
      whereConditions.push('role = ?');
      queryParams.push(role);
    }

    if (department) {
      whereConditions.push('department = ?');
      queryParams.push(department);
    }

    if (status) {
      if (status === 'active') {
        whereConditions.push('is_active = TRUE');
      } else if (status === 'inactive') {
        whereConditions.push('is_active = FALSE');
      }
    }

    const whereClause = whereConditions.join(' AND ');

    const employees = await query(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.role, u.department, u.position,
        u.phone, u.address, u.hire_date, u.salary, u.is_active, u.avatar,
        u.created_at, u.updated_at,
        COUNT(DISTINCT p.id) as project_count,
        COUNT(DISTINCT pt.id) as task_count
      FROM users u
      LEFT JOIN projects p ON u.id = p.manager_id
      LEFT JOIN project_tasks pt ON u.id = pt.assigned_to
      WHERE ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `, queryParams);

    res.json(employees);
  } catch (error) {
    console.error('Erreur lors de la récupération des employés:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des employés' });
  }
});

// Récupérer un employé par ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const employees = await query(`
      SELECT 
        u.*,
        COUNT(DISTINCT p.id) as project_count,
        COUNT(DISTINCT pt.id) as task_count
      FROM users u
      LEFT JOIN projects p ON u.id = p.manager_id
      LEFT JOIN project_tasks pt ON u.id = pt.assigned_to
      WHERE u.id = ? AND u.role != 'client'
      GROUP BY u.id
    `, [id]);

    if (employees.length === 0) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }

    const employee = employees[0];

    // Récupérer les projets gérés par l'employé
    const managedProjects = await query(`
      SELECT 
        p.id, p.name, p.status, p.priority, p.progress, p.budget, p.start_date, p.end_date,
        c.company_name as client_name
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.manager_id = ?
      ORDER BY p.created_at DESC
    `, [id]);

    // Récupérer les tâches assignées à l'employé
    const assignedTasks = await query(`
      SELECT 
        pt.id, pt.title, pt.status, pt.priority, pt.due_date, pt.estimated_hours, pt.actual_hours,
        p.name as project_name
      FROM project_tasks pt
      LEFT JOIN projects p ON pt.project_id = p.id
      WHERE pt.assigned_to = ?
      ORDER BY pt.created_at DESC
    `, [id]);

    // Récupérer les entrées de temps de l'employé
    const timeEntries = await query(`
      SELECT 
        te.date, te.hours_worked, te.description,
        p.name as project_name,
        pt.title as task_title
      FROM time_entries te
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN project_tasks pt ON te.task_id = pt.id
      WHERE te.user_id = ?
      ORDER BY te.date DESC
      LIMIT 10
    `, [id]);

    res.json({
      ...employee,
      managedProjects,
      assignedTasks,
      timeEntries
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'employé:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de l\'employé' });
  }
});

// Créer un nouvel employé
router.post('/', authenticateToken, authorize('admin', 'manager'), [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('first_name').notEmpty().trim(),
  body('last_name').notEmpty().trim(),
  body('role').isIn(['admin', 'manager', 'employee']),
  body('department').notEmpty().trim(),
  body('position').notEmpty().trim(),
  body('hire_date').isISO8601(),
  body('salary').isDecimal()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      email, password, first_name, last_name, role, department, position,
      phone, address, hire_date, salary, is_active = true
    } = req.body;

    // Vérifier si l'employé existe déjà
    const existingUsers = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Un employé avec cet email existe déjà' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await query(
      'INSERT INTO users (email, password, first_name, last_name, role, department, position, phone, address, hire_date, salary, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, first_name, last_name, role, department, position, phone, address, hire_date, salary, is_active]
    );

    res.status(201).json({
      message: 'Employé créé avec succès',
      employeeId: result.insertId
    });
  } catch (error) {
    console.error('Erreur lors de la création de l\'employé:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'employé' });
  }
});

// Mettre à jour un employé
router.put('/:id', authenticateToken, [
  body('email').optional().isEmail().normalizeEmail(),
  body('first_name').optional().notEmpty().trim(),
  body('last_name').optional().notEmpty().trim(),
  body('role').optional().isIn(['admin', 'manager', 'employee']),
  body('department').optional().notEmpty().trim(),
  body('position').optional().notEmpty().trim(),
  body('hire_date').optional().isISO8601(),
  body('salary').optional().isDecimal(),
  body('is_active').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { 
      email, password, first_name, last_name, role, department, position,
      phone, address, hire_date, salary, is_active
    } = req.body;

    // Vérifier que l'employé existe
    const existingUsers = await query('SELECT id FROM users WHERE id = ? AND role != "client"', [id]);
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }

    // Vérifier l'unicité de l'email si modifié
    if (email) {
      const emailCheck = await query('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
      if (emailCheck.length > 0) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé' });
      }
    }

    const updateFields = [];
    const updateValues = [];

    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push('password = ?');
      updateValues.push(hashedPassword);
    }
    if (first_name) {
      updateFields.push('first_name = ?');
      updateValues.push(first_name);
    }
    if (last_name) {
      updateFields.push('last_name = ?');
      updateValues.push(last_name);
    }
    if (role) {
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
    if (hire_date) {
      updateFields.push('hire_date = ?');
      updateValues.push(hire_date);
    }
    if (salary) {
      updateFields.push('salary = ?');
      updateValues.push(salary);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      updateValues.push(is_active);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updateValues.push(id);

    await query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.json({ message: 'Employé mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'employé:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'employé' });
  }
});

// Désactiver un employé
router.post('/:id/deactivate', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que l'employé existe
    const users = await query('SELECT id, is_active FROM users WHERE id = ? AND role != "client"', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }

    if (!users[0].is_active) {
      return res.status(400).json({ error: 'L\'employé est déjà désactivé' });
    }

    await query('UPDATE users SET is_active = FALSE WHERE id = ?', [id]);

    res.json({ message: 'Employé désactivé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la désactivation de l\'employé:', error);
    res.status(500).json({ error: 'Erreur lors de la désactivation de l\'employé' });
  }
});

// Réactiver un employé
router.post('/:id/activate', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que l'employé existe
    const users = await query('SELECT id, is_active FROM users WHERE id = ? AND role != "client"', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }

    if (users[0].is_active) {
      return res.status(400).json({ error: 'L\'employé est déjà actif' });
    }

    await query('UPDATE users SET is_active = TRUE WHERE id = ?', [id]);

    res.json({ message: 'Employé réactivé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la réactivation de l\'employé:', error);
    res.status(500).json({ error: 'Erreur lors de la réactivation de l\'employé' });
  }
});

// Supprimer un employé (seulement si pas de projets associés)
router.delete('/:id', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que l'employé existe
    const existingUsers = await query('SELECT id FROM users WHERE id = ? AND role != "client"', [id]);
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }

    // Vérifier s'il y a des projets associés
    const projects = await query('SELECT COUNT(*) as count FROM projects WHERE manager_id = ?', [id]);
    const tasks = await query('SELECT COUNT(*) as count FROM project_tasks WHERE assigned_to = ?', [id]);
    const timeEntries = await query('SELECT COUNT(*) as count FROM time_entries WHERE user_id = ?', [id]);

    if (projects[0].count > 0 || tasks[0].count > 0 || timeEntries[0].count > 0) {
      return res.status(400).json({ 
        error: 'Impossible de supprimer l\'employé car il a des projets, tâches ou entrées de temps associés' 
      });
    }

    await query('DELETE FROM users WHERE id = ?', [id]);

    res.json({ message: 'Employé supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'employé:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'employé' });
  }
});

// Obtenir les statistiques des employés
router.get('/stats/overview', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) as total_employees,
        SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_employees,
        SUM(CASE WHEN is_active = FALSE THEN 1 ELSE 0 END) as inactive_employees,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
        SUM(CASE WHEN role = 'manager' THEN 1 ELSE 0 END) as managers,
        SUM(CASE WHEN role = 'employee' THEN 1 ELSE 0 END) as employees,
        AVG(salary) as avg_salary
      FROM users
      WHERE role != 'client'
    `);

    const departmentStats = await query(`
      SELECT department, COUNT(*) as count 
      FROM users 
      WHERE role != 'client' AND department IS NOT NULL
      GROUP BY department 
      ORDER BY count DESC
    `);

    const monthlyHires = await query(`
      SELECT 
        DATE_FORMAT(hire_date, '%Y-%m') as month,
        COUNT(*) as count
      FROM users 
      WHERE role != 'client' AND hire_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(hire_date, '%Y-%m')
      ORDER BY month DESC
    `);

    res.json({
      overview: stats[0],
      departments: departmentStats,
      monthlyHires: monthlyHires
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

module.exports = router;