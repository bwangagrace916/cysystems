const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Récupérer tous les clients
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search = '', status = '', country = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(c.company_name LIKE ? OR c.contact_person LIKE ? OR c.email LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('c.status = ?');
      queryParams.push(status);
    }

    if (country) {
      whereConditions.push('c.country = ?');
      queryParams.push(country);
    }

    const whereClause = whereConditions.join(' AND ');

    const clients = await query(`
      SELECT 
        c.id, c.company_name, c.contact_person, c.email, c.phone, 
        c.address, c.city, c.country, c.tax_number, c.website, c.notes,
        c.status, c.created_at, c.updated_at,
        COUNT(DISTINCT p.id) as project_count,
        COUNT(DISTINCT s.id) as subscription_count
      FROM clients c
      LEFT JOIN projects p ON c.id = p.client_id
      LEFT JOIN subscriptions s ON c.id = s.client_id
      WHERE ${whereClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, queryParams);

    res.json(clients);
  } catch (error) {
    console.error('Erreur lors de la récupération des clients:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des clients' });
  }
});

// Récupérer un client par ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const clients = await query(`
      SELECT 
        c.*,
        COUNT(DISTINCT p.id) as project_count,
        COUNT(DISTINCT s.id) as subscription_count,
        COUNT(DISTINCT i.id) as invoice_count
      FROM clients c
      LEFT JOIN projects p ON c.id = p.client_id
      LEFT JOIN subscriptions s ON c.id = s.client_id
      LEFT JOIN invoices i ON c.id = i.client_id
      WHERE c.id = ?
      GROUP BY c.id
    `, [id]);

    if (clients.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    const client = clients[0];

    // Récupérer les projets du client
    const projects = await query(`
      SELECT 
        p.id, p.name, p.status, p.priority, p.progress, p.budget, p.start_date, p.end_date,
        u.first_name as manager_first_name,
        u.last_name as manager_last_name
      FROM projects p
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE p.client_id = ?
      ORDER BY p.created_at DESC
    `, [id]);

    // Récupérer les abonnements du client
    const subscriptions = await query(`
      SELECT 
        s.id, s.plan_name, s.price, s.billing_cycle, s.status, s.start_date, s.end_date
      FROM subscriptions s
      WHERE s.client_id = ?
      ORDER BY s.created_at DESC
    `, [id]);

    // Récupérer les factures du client
    const invoices = await query(`
      SELECT 
        i.id, i.invoice_number, i.issue_date, i.due_date, i.total_amount, i.status
      FROM invoices i
      WHERE i.client_id = ?
      ORDER BY i.created_at DESC
      LIMIT 10
    `, [id]);

    res.json({
      ...client,
      projects,
      subscriptions,
      invoices
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du client:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du client' });
  }
});

// Créer un nouveau client
router.post('/', authenticateToken, authorize('admin', 'manager'), [
  body('company_name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('contact_person').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      company_name, contact_person, email, phone, address, 
      city, country, tax_number, website, notes 
    } = req.body;

    // Vérifier si le client existe déjà
    const existingClients = await query('SELECT id FROM clients WHERE email = ?', [email]);
    if (existingClients.length > 0) {
      return res.status(400).json({ error: 'Un client avec cet email existe déjà' });
    }

    const result = await query(
      'INSERT INTO clients (company_name, contact_person, email, phone, address, city, country, tax_number, website, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [company_name, contact_person, email, phone, address, city, country, tax_number, website, notes]
    );

    res.status(201).json({
      message: 'Client créé avec succès',
      clientId: result.insertId
    });
  } catch (error) {
    console.error('Erreur lors de la création du client:', error);
    res.status(500).json({ error: 'Erreur lors de la création du client' });
  }
});

// Mettre à jour un client
router.put('/:id', authenticateToken, [
  body('company_name').optional().notEmpty().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('contact_person').optional().notEmpty().trim(),
  body('status').optional().isIn(['active', 'inactive', 'suspended'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { 
      company_name, contact_person, email, phone, address, 
      city, country, tax_number, website, notes, status 
    } = req.body;

    // Vérifier que le client existe
    const existingClients = await query('SELECT id FROM clients WHERE id = ?', [id]);
    if (existingClients.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    // Vérifier l'unicité de l'email si modifié
    if (email) {
      const emailCheck = await query('SELECT id FROM clients WHERE email = ? AND id != ?', [email, id]);
      if (emailCheck.length > 0) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé' });
      }
    }

    const updateFields = [];
    const updateValues = [];

    if (company_name) {
      updateFields.push('company_name = ?');
      updateValues.push(company_name);
    }
    if (contact_person) {
      updateFields.push('contact_person = ?');
      updateValues.push(contact_person);
    }
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (phone) {
      updateFields.push('phone = ?');
      updateValues.push(phone);
    }
    if (address) {
      updateFields.push('address = ?');
      updateValues.push(address);
    }
    if (city) {
      updateFields.push('city = ?');
      updateValues.push(city);
    }
    if (country) {
      updateFields.push('country = ?');
      updateValues.push(country);
    }
    if (tax_number) {
      updateFields.push('tax_number = ?');
      updateValues.push(tax_number);
    }
    if (website) {
      updateFields.push('website = ?');
      updateValues.push(website);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      updateValues.push(notes);
    }
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updateValues.push(id);

    await query(
      `UPDATE clients SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.json({ message: 'Client mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du client:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du client' });
  }
});

// Suspendre un client
router.post('/:id/suspend', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que le client existe
    const clients = await query('SELECT id, status FROM clients WHERE id = ?', [id]);
    if (clients.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    if (clients[0].status === 'suspended') {
      return res.status(400).json({ error: 'Le client est déjà suspendu' });
    }

    await query('UPDATE clients SET status = "suspended" WHERE id = ?', [id]);

    res.json({ message: 'Client suspendu avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suspension du client:', error);
    res.status(500).json({ error: 'Erreur lors de la suspension du client' });
  }
});

// Réactiver un client
router.post('/:id/reactivate', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que le client existe
    const clients = await query('SELECT id, status FROM clients WHERE id = ?', [id]);
    if (clients.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    if (clients[0].status !== 'suspended') {
      return res.status(400).json({ error: 'Le client n\'est pas suspendu' });
    }

    await query('UPDATE clients SET status = "active" WHERE id = ?', [id]);

    res.json({ message: 'Client réactivé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la réactivation du client:', error);
    res.status(500).json({ error: 'Erreur lors de la réactivation du client' });
  }
});

// Supprimer un client
router.delete('/:id', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que le client existe
    const existingClients = await query('SELECT id FROM clients WHERE id = ?', [id]);
    if (existingClients.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    // Vérifier s'il y a des projets, abonnements ou factures associés
    const projects = await query('SELECT COUNT(*) as count FROM projects WHERE client_id = ?', [id]);
    const subscriptions = await query('SELECT COUNT(*) as count FROM subscriptions WHERE client_id = ?', [id]);
    const invoices = await query('SELECT COUNT(*) as count FROM invoices WHERE client_id = ?', [id]);

    if (projects[0].count > 0 || subscriptions[0].count > 0 || invoices[0].count > 0) {
      return res.status(400).json({ 
        error: 'Impossible de supprimer le client car il a des projets, abonnements ou factures associés' 
      });
    }

    await query('DELETE FROM clients WHERE id = ?', [id]);

    res.json({ message: 'Client supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression du client:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du client' });
  }
});

// Obtenir les statistiques des clients
router.get('/stats/overview', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) as total_clients,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_clients,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive_clients,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended_clients
      FROM clients
    `);

    const countryStats = await query(`
      SELECT country, COUNT(*) as count 
      FROM clients 
      WHERE country IS NOT NULL 
      GROUP BY country 
      ORDER BY count DESC
      LIMIT 10
    `);

    const monthlyStats = await query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as count
      FROM clients 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY month DESC
    `);

    res.json({
      overview: stats[0],
      countries: countryStats,
      monthly: monthlyStats
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

module.exports = router;
