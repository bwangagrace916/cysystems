const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, authorize, checkResourceAccess } = require('../middleware/auth');

const router = express.Router();

// Récupérer tous les projets
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search = '', status = '', priority = '', client_id = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    // Filtrage par utilisateur si ce n'est pas un admin/manager
    if (req.user.role === 'employee') {
      whereConditions.push('(p.manager_id = ? OR p.id IN (SELECT project_id FROM project_tasks WHERE assigned_to = ?))');
      queryParams.push(req.user.id, req.user.id);
    }

    if (search) {
      whereConditions.push('(p.name LIKE ? OR p.description LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('p.status = ?');
      queryParams.push(status);
    }

    if (priority) {
      whereConditions.push('p.priority = ?');
      queryParams.push(priority);
    }

    if (client_id) {
      whereConditions.push('p.client_id = ?');
      queryParams.push(client_id);
    }

    const whereClause = whereConditions.join(' AND ');

    const projects = await query(`
      SELECT 
        p.id, p.name, p.description, p.start_date, p.end_date, p.budget, 
        p.status, p.priority, p.progress, p.created_at, p.updated_at,
        c.id as client_id, c.company_name as client_name, c.contact_person as client_contact,
        c.email as client_email, c.phone as client_phone, c.address as client_address,
        u.id as manager_id, u.first_name as manager_first_name, u.last_name as manager_last_name,
        u.email as manager_email
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
    `, queryParams);

    res.json(projects);
  } catch (error) {
    console.error('Erreur lors de la récupération des projets:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des projets' });
  }
});

// Récupérer un projet par ID
router.get('/:id', authenticateToken, checkResourceAccess('project'), async (req, res) => {
  try {
    const { id } = req.params;

    const projects = await query(`
      SELECT 
        p.*,
        c.company_name as client_name,
        c.contact_person as client_contact,
        c.email as client_email,
        c.phone as client_phone,
        u.first_name as manager_first_name,
        u.last_name as manager_last_name,
        u.email as manager_email
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE p.id = ?
    `, [id]);

    if (projects.length === 0) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    const project = projects[0];

    // Récupérer les tâches du projet
    const tasks = await query(`
      SELECT 
        pt.*,
        u.first_name as assigned_first_name,
        u.last_name as assigned_last_name
      FROM project_tasks pt
      LEFT JOIN users u ON pt.assigned_to = u.id
      WHERE pt.project_id = ?
      ORDER BY pt.created_at DESC
    `, [id]);

    // Récupérer les temps de travail
    const timeEntries = await query(`
      SELECT 
        te.*,
        u.first_name as user_first_name,
        u.last_name as user_last_name,
        pt.title as task_title
      FROM time_entries te
      LEFT JOIN users u ON te.user_id = u.id
      LEFT JOIN project_tasks pt ON te.task_id = pt.id
      WHERE te.project_id = ?
      ORDER BY te.date DESC
    `, [id]);

    res.json({
      ...project,
      tasks,
      timeEntries
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du projet:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du projet' });
  }
});

// Créer un nouveau projet
router.post('/', authenticateToken, authorize('admin', 'manager'), [
  body('name').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, client_id, manager_id, start_date, end_date, budget, status, priority, progress } = req.body;

    // Vérifier que le client existe si fourni
    if (client_id) {
      const clients = await query('SELECT id FROM clients WHERE id = ?', [client_id]);
      if (clients.length === 0) {
        return res.status(400).json({ error: 'Client non trouvé' });
      }
    }

    // Vérifier que le manager existe si fourni
    if (manager_id) {
      const managers = await query('SELECT id FROM users WHERE id = ? AND role IN ("admin", "manager")', [manager_id]);
      if (managers.length === 0) {
        return res.status(400).json({ error: 'Manager non trouvé' });
      }
    }

    const result = await query(
      'INSERT INTO projects (name, description, client_id, manager_id, start_date, end_date, budget, status, priority, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description, client_id || null, manager_id || null, start_date || null, end_date || null, budget || null, status || 'planning', priority || 'medium', progress || 0]
    );

    res.status(201).json({
      message: 'Projet créé avec succès',
      projectId: result.insertId
    });
  } catch (error) {
    console.error('Erreur lors de la création du projet:', error);
    res.status(500).json({ error: 'Erreur lors de la création du projet' });
  }
});

// Mettre à jour un projet
router.put('/:id', authenticateToken, checkResourceAccess('project'), [
  body('name').optional().notEmpty().trim(),
  body('status').optional().isIn(['planning', 'in_progress', 'on_hold', 'completed', 'cancelled']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('progress').optional().isInt({ min: 0, max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { name, description, status, priority, progress, end_date } = req.body;

    // Vérifier que le projet existe
    const existingProjects = await query('SELECT id FROM projects WHERE id = ?', [id]);
    if (existingProjects.length === 0) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    const updateFields = [];
    const updateValues = [];

    if (name) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      updateValues.push(description);
    }
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    if (priority) {
      updateFields.push('priority = ?');
      updateValues.push(priority);
    }
    if (progress !== undefined) {
      updateFields.push('progress = ?');
      updateValues.push(progress);
    }
    if (end_date) {
      updateFields.push('end_date = ?');
      updateValues.push(end_date);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updateValues.push(id);

    await query(
      `UPDATE projects SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.json({ message: 'Projet mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du projet:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du projet' });
  }
});

// Supprimer un projet
router.delete('/:id', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que le projet existe
    const existingProjects = await query('SELECT id FROM projects WHERE id = ?', [id]);
    if (existingProjects.length === 0) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    await query('DELETE FROM projects WHERE id = ?', [id]);

    res.json({ message: 'Projet supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression du projet:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du projet' });
  }
});

// Créer une tâche pour un projet
router.post('/:id/tasks', authenticateToken, [
  body('title').notEmpty().trim(),
  body('assigned_to').isInt(),
  body('due_date').isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, description, assigned_to, priority, due_date, estimated_hours } = req.body;

    // Vérifier que le projet existe
    const projects = await query('SELECT id FROM projects WHERE id = ?', [id]);
    if (projects.length === 0) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    // Vérifier que l'utilisateur assigné existe
    const users = await query('SELECT id FROM users WHERE id = ?', [assigned_to]);
    if (users.length === 0) {
      return res.status(400).json({ error: 'Utilisateur assigné non trouvé' });
    }

    const result = await query(
      'INSERT INTO project_tasks (project_id, title, description, assigned_to, priority, due_date, estimated_hours) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, title, description, assigned_to, priority || 'medium', due_date, estimated_hours]
    );

    res.status(201).json({
      message: 'Tâche créée avec succès',
      taskId: result.insertId
    });
  } catch (error) {
    console.error('Erreur lors de la création de la tâche:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la tâche' });
  }
});

// Obtenir les statistiques des projets
router.get('/stats/overview', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) as total_projects,
        SUM(CASE WHEN status = 'planning' THEN 1 ELSE 0 END) as planning,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) as on_hold,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        AVG(progress) as avg_progress,
        SUM(budget) as total_budget
      FROM projects
    `);

    const priorityStats = await query(`
      SELECT priority, COUNT(*) as count 
      FROM projects 
      GROUP BY priority 
      ORDER BY count DESC
    `);

    res.json({
      overview: stats[0],
      priorities: priorityStats
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

module.exports = router;
