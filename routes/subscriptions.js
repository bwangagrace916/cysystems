const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Types d'abonnements prédéfinis
const SUBSCRIPTION_TYPES = {
  STARLINK: {
    name: 'Starlink',
    description: 'Service internet par satellite Starlink',
    defaultPrice: 99.00,
    billingCycle: 'monthly'
  },
  TALKIE_WALKIE: {
    name: 'Talkie-Walkie Motorola',
    description: 'Service de communication par talkie-walkie Motorola',
    defaultPrice: 45.00,
    billingCycle: 'monthly'
  },
  DOMAIN: {
    name: 'Nom de Domaine',
    description: 'Enregistrement et gestion de nom de domaine',
    defaultPrice: 15.00,
    billingCycle: 'yearly'
  },
  HOSTING: {
    name: 'Hébergement Web',
    description: 'Service d\'hébergement de sites web',
    defaultPrice: 25.00,
    billingCycle: 'monthly'
  }
};

// GET all subscriptions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search = '', status = '', client_id = '', type = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(s.plan_name LIKE ? OR c.company_name LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('s.status = ?');
      queryParams.push(status);
    }

    if (client_id) {
      whereConditions.push('s.client_id = ?');
      queryParams.push(client_id);
    }

    if (type) {
      whereConditions.push('s.plan_name LIKE ?');
      queryParams.push(`%${type}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    const subscriptions = await query(`
      SELECT
        s.id, s.plan_name, s.description, s.price, s.billing_cycle,
        s.start_date, s.end_date, s.status, s.auto_renew,
        s.created_at, s.updated_at,
        c.id as client_id, c.company_name as client_name,
        c.contact_person as client_contact, c.email as client_email,
        c.phone as client_phone
      FROM subscriptions s
      JOIN clients c ON s.client_id = c.id
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
    `, queryParams);

    res.json(subscriptions);
  } catch (error) {
    console.error('Erreur lors de la récupération des abonnements:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des abonnements' });
  }
});

// GET subscription by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const subscriptions = await query(`
      SELECT
        s.*,
        c.id as client_id, c.company_name as client_name,
        c.contact_person as client_contact, c.email as client_email,
        c.phone as client_phone, c.address as client_address,
        c.city as client_city, c.country as client_country
      FROM subscriptions s
      JOIN clients c ON s.client_id = c.id
      WHERE s.id = ?
    `, [id]);

    if (subscriptions.length === 0) {
      return res.status(404).json({ error: 'Abonnement non trouvé' });
    }

    const subscription = subscriptions[0];

    // Récupérer les factures liées à cet abonnement
    const invoices = await query(`
      SELECT id, invoice_number, issue_date, due_date, total_amount, status
      FROM invoices
      WHERE subscription_id = ?
      ORDER BY issue_date DESC
      LIMIT 10
    `, [id]);

    res.json({
      ...subscription,
      invoices
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'abonnement:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de l\'abonnement' });
  }
});

// POST create new subscription
router.post('/', authenticateToken, authorize('admin', 'manager'), [
  body('client_id').isInt().withMessage('L\'ID du client est requis'),
  body('plan_name').notEmpty().trim().withMessage('Le nom du plan est requis'),
  body('price').isFloat({ min: 0 }).withMessage('Le prix doit être positif'),
  body('billing_cycle').isIn(['monthly', 'quarterly', 'yearly']).withMessage('Cycle de facturation invalide'),
  body('start_date').isISO8601().withMessage('La date de début est requise')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      client_id, plan_name, description, price, billing_cycle,
      start_date, end_date, auto_renew = true
    } = req.body;

    // Vérifier que le client existe
    const clients = await query('SELECT id FROM clients WHERE id = ?', [client_id]);
    if (clients.length === 0) {
      return res.status(400).json({ error: 'Client non trouvé' });
    }

    // Calculer la date de fin si non fournie
    let calculatedEndDate = end_date;
    if (!calculatedEndDate) {
      const start = new Date(start_date);
      if (billing_cycle === 'monthly') {
        start.setMonth(start.getMonth() + 1);
      } else if (billing_cycle === 'quarterly') {
        start.setMonth(start.getMonth() + 3);
      } else if (billing_cycle === 'yearly') {
        start.setFullYear(start.getFullYear() + 1);
      }
      calculatedEndDate = start.toISOString().split('T')[0];
    }

    const result = await query(
      `INSERT INTO subscriptions (client_id, plan_name, description, price, billing_cycle, start_date, end_date, auto_renew)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_id, plan_name, description || null, price, billing_cycle, start_date, calculatedEndDate, auto_renew]
    );

    res.status(201).json({
      message: 'Abonnement créé avec succès',
      subscriptionId: result.insertId
    });
  } catch (error) {
    console.error('Erreur lors de la création de l\'abonnement:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'abonnement' });
  }
});

// PUT update subscription
router.put('/:id', authenticateToken, authorize('admin', 'manager'), [
  body('plan_name').optional().notEmpty().trim(),
  body('price').optional().isFloat({ min: 0 }),
  body('billing_cycle').optional().isIn(['monthly', 'quarterly', 'yearly']),
  body('start_date').optional().isISO8601(),
  body('end_date').optional().isISO8601(),
  body('status').optional().isIn(['active', 'suspended', 'cancelled', 'expired']),
  body('auto_renew').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const {
      plan_name, description, price, billing_cycle,
      start_date, end_date, status, auto_renew
    } = req.body;

    // Vérifier que l'abonnement existe
    const existingSubscriptions = await query('SELECT id FROM subscriptions WHERE id = ?', [id]);
    if (existingSubscriptions.length === 0) {
      return res.status(404).json({ error: 'Abonnement non trouvé' });
    }

    const updateFields = [];
    const updateValues = [];

    if (plan_name !== undefined) { updateFields.push('plan_name = ?'); updateValues.push(plan_name); }
    if (description !== undefined) { updateFields.push('description = ?'); updateValues.push(description); }
    if (price !== undefined) { updateFields.push('price = ?'); updateValues.push(price); }
    if (billing_cycle !== undefined) { updateFields.push('billing_cycle = ?'); updateValues.push(billing_cycle); }
    if (start_date !== undefined) { updateFields.push('start_date = ?'); updateValues.push(start_date); }
    if (end_date !== undefined) { updateFields.push('end_date = ?'); updateValues.push(end_date); }
    if (status !== undefined) { updateFields.push('status = ?'); updateValues.push(status); }
    if (auto_renew !== undefined) { updateFields.push('auto_renew = ?'); updateValues.push(auto_renew); }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updateValues.push(id);

    await query(
      `UPDATE subscriptions SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.json({ message: 'Abonnement mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'abonnement:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'abonnement' });
  }
});

// POST suspend subscription
router.post('/:id/suspend', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    const subscriptions = await query('SELECT id, status FROM subscriptions WHERE id = ?', [id]);
    if (subscriptions.length === 0) {
      return res.status(404).json({ error: 'Abonnement non trouvé' });
    }

    if (subscriptions[0].status === 'suspended') {
      return res.status(400).json({ error: 'L\'abonnement est déjà suspendu' });
    }

    await query('UPDATE subscriptions SET status = "suspended" WHERE id = ?', [id]);

    res.json({ message: 'Abonnement suspendu avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suspension de l\'abonnement:', error);
    res.status(500).json({ error: 'Erreur lors de la suspension de l\'abonnement' });
  }
});

// POST reactivate subscription
router.post('/:id/reactivate', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    const subscriptions = await query('SELECT id, status FROM subscriptions WHERE id = ?', [id]);
    if (subscriptions.length === 0) {
      return res.status(404).json({ error: 'Abonnement non trouvé' });
    }

    if (subscriptions[0].status === 'active') {
      return res.status(400).json({ error: 'L\'abonnement est déjà actif' });
    }

    await query('UPDATE subscriptions SET status = "active" WHERE id = ?', [id]);

    res.json({ message: 'Abonnement réactivé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la réactivation de l\'abonnement:', error);
    res.status(500).json({ error: 'Erreur lors de la réactivation de l\'abonnement' });
  }
});

// POST cancel subscription
router.post('/:id/cancel', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    const subscriptions = await query('SELECT id, status FROM subscriptions WHERE id = ?', [id]);
    if (subscriptions.length === 0) {
      return res.status(404).json({ error: 'Abonnement non trouvé' });
    }

    if (subscriptions[0].status === 'cancelled') {
      return res.status(400).json({ error: 'L\'abonnement est déjà annulé' });
    }

    await query('UPDATE subscriptions SET status = "cancelled" WHERE id = ?', [id]);

    res.json({ message: 'Abonnement annulé avec succès' });
  } catch (error) {
    console.error('Erreur lors de l\'annulation de l\'abonnement:', error);
    res.status(500).json({ error: 'Erreur lors de l\'annulation de l\'abonnement' });
  }
});

// DELETE subscription
router.delete('/:id', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const subscriptions = await query('SELECT id FROM subscriptions WHERE id = ?', [id]);
    if (subscriptions.length === 0) {
      return res.status(404).json({ error: 'Abonnement non trouvé' });
    }

    // Vérifier s'il y a des factures liées
    const invoicesCount = await query('SELECT COUNT(*) as count FROM invoices WHERE subscription_id = ?', [id]);
    if (invoicesCount[0].count > 0) {
      return res.status(400).json({ error: 'Impossible de supprimer l\'abonnement car il a des factures associées' });
    }

    await query('DELETE FROM subscriptions WHERE id = ?', [id]);

    res.json({ message: 'Abonnement supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'abonnement:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'abonnement' });
  }
});

// GET subscription statistics
router.get('/stats/overview', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT
        COUNT(*) as total_subscriptions,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_subscriptions,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended_subscriptions,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_subscriptions,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_subscriptions,
        SUM(price) as total_revenue,
        SUM(CASE WHEN status = 'active' THEN price ELSE 0 END) as active_revenue
      FROM subscriptions
    `);

    const typeStats = await query(`
      SELECT
        plan_name,
        COUNT(*) as count,
        SUM(price) as total_revenue,
        AVG(price) as avg_price
      FROM subscriptions
      GROUP BY plan_name
      ORDER BY count DESC
    `);

    const monthlyStats = await query(`
      SELECT
        DATE_FORMAT(start_date, '%Y-%m') as month,
        COUNT(*) as new_subscriptions,
        SUM(price) as revenue
      FROM subscriptions
      WHERE start_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(start_date, '%Y-%m')
      ORDER BY month ASC
    `);

    const clientStats = await query(`
      SELECT
        c.company_name,
        COUNT(s.id) as subscription_count,
        SUM(s.price) as total_spent
      FROM clients c
      LEFT JOIN subscriptions s ON c.id = s.client_id
      GROUP BY c.id, c.company_name
      HAVING subscription_count > 0
      ORDER BY total_spent DESC
      LIMIT 10
    `);

    res.json({
      overview: stats[0],
      byType: typeStats,
      monthly: monthlyStats,
      topClients: clientStats
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques des abonnements:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques des abonnements' });
  }
});

// GET subscription types
router.get('/types/available', authenticateToken, async (req, res) => {
  try {
    res.json(SUBSCRIPTION_TYPES);
  } catch (error) {
    console.error('Erreur lors de la récupération des types d\'abonnements:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des types d\'abonnements' });
  }
});

module.exports = router;
