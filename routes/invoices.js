const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Récupérer toutes les factures
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search = '', status = '', client_id = '', date_from = '', date_to = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(i.invoice_number LIKE ? OR c.company_name LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('i.status = ?');
      queryParams.push(status);
    }

    if (client_id) {
      whereConditions.push('i.client_id = ?');
      queryParams.push(client_id);
    }

    if (date_from) {
      whereConditions.push('i.issue_date >= ?');
      queryParams.push(date_from);
    }

    if (date_to) {
      whereConditions.push('i.issue_date <= ?');
      queryParams.push(date_to);
    }

    const whereClause = whereConditions.join(' AND ');

    const invoices = await query(`
      SELECT 
        i.id, i.invoice_number, i.issue_date, i.due_date, i.subtotal, 
        i.tax_rate, i.tax_amount, i.total_amount, i.status, i.payment_method, 
        i.payment_date, i.notes, i.created_at, i.updated_at,
        c.id as client_id, c.company_name as client_name, c.contact_person as client_contact,
        c.email as client_email, c.phone as client_phone, c.address as client_address,
        p.id as project_id, p.name as project_name,
        s.id as subscription_id, s.plan_name as subscription_plan,
        u.first_name as created_by_first_name, u.last_name as created_by_last_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN projects p ON i.project_id = p.id
      LEFT JOIN subscriptions s ON i.subscription_id = s.id
      LEFT JOIN users u ON i.created_by = u.id
      WHERE ${whereClause}
      ORDER BY i.created_at DESC
    `, queryParams);

    res.json(invoices);
  } catch (error) {
    console.error('Erreur lors de la récupération des factures:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des factures' });
  }
});

// Récupérer une facture par ID avec ses lignes
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Récupérer la facture
    const invoices = await query(`
      SELECT 
        i.*,
        c.id as client_id, c.company_name as client_name, c.contact_person as client_contact,
        c.email as client_email, c.phone as client_phone, c.address as client_address,
        c.city as client_city, c.country as client_country, c.tax_number as client_tax_number,
        p.id as project_id, p.name as project_name,
        s.id as subscription_id, s.plan_name as subscription_plan,
        u.first_name as created_by_first_name, u.last_name as created_by_last_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN projects p ON i.project_id = p.id
      LEFT JOIN subscriptions s ON i.subscription_id = s.id
      LEFT JOIN users u ON i.created_by = u.id
      WHERE i.id = ?
    `, [id]);

    if (invoices.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const invoice = invoices[0];

    // Récupérer les lignes de facture
    const items = await query(`
      SELECT id, description, quantity, unit_price, total_price
      FROM invoice_items
      WHERE invoice_id = ?
      ORDER BY id
    `, [id]);

    // Récupérer les paiements
    const payments = await query(`
      SELECT id, amount, payment_date, payment_method, reference_number, notes
      FROM payments
      WHERE invoice_id = ?
      ORDER BY payment_date DESC
    `, [id]);

    res.json({
      ...invoice,
      items,
      payments
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de la facture:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de la facture' });
  }
});

// Créer une nouvelle facture
router.post('/', authenticateToken, authorize('admin', 'manager'), [
  body('client_id').isInt().withMessage('L\'ID du client est requis'),
  body('invoice_number').notEmpty().trim().withMessage('Le numéro de facture est requis'),
  body('issue_date').isISO8601().withMessage('La date d\'émission est requise'),
  body('due_date').isISO8601().withMessage('La date d\'échéance est requise'),
  body('subtotal').isDecimal().withMessage('Le sous-total est requis'),
  body('tax_rate').isDecimal().withMessage('Le taux de taxe est requis'),
  body('items').isArray().withMessage('Les articles sont requis')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      client_id, project_id, subscription_id, invoice_number, issue_date, due_date,
      subtotal, tax_rate, tax_amount, total_amount, status, payment_method, 
      payment_date, notes, items
    } = req.body;

    // Vérifier que le client existe
    const clients = await query('SELECT id FROM clients WHERE id = ?', [client_id]);
    if (clients.length === 0) {
      return res.status(400).json({ error: 'Client non trouvé' });
    }

    // Vérifier l'unicité du numéro de facture
    const existingInvoices = await query('SELECT id FROM invoices WHERE invoice_number = ?', [invoice_number]);
    if (existingInvoices.length > 0) {
      return res.status(400).json({ error: 'Ce numéro de facture existe déjà' });
    }

    // Calculer les montants si non fournis
    const calculatedTaxAmount = tax_amount || (subtotal * tax_rate / 100);
    const calculatedTotalAmount = total_amount || (subtotal + calculatedTaxAmount);

    // Créer la facture
    const result = await query(
      'INSERT INTO invoices (client_id, project_id, subscription_id, invoice_number, issue_date, due_date, subtotal, tax_rate, tax_amount, total_amount, status, payment_method, payment_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [client_id, project_id || null, subscription_id || null, invoice_number, issue_date, due_date, subtotal, tax_rate, calculatedTaxAmount, calculatedTotalAmount, status || 'draft', payment_method || null, payment_date || null, notes || null, req.user.id]
    );

    const invoiceId = result.insertId;

    // Créer les lignes de facture
    if (items && items.length > 0) {
      for (const item of items) {
        await query(
          'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)',
          [invoiceId, item.description, item.quantity, item.unit_price, item.total_price]
        );
      }
    }

    res.status(201).json({
      message: 'Facture créée avec succès',
      invoiceId: invoiceId
    });
  } catch (error) {
    console.error('Erreur lors de la création de la facture:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la facture' });
  }
});

// Mettre à jour une facture
router.put('/:id', authenticateToken, [
  body('invoice_number').optional().notEmpty().trim(),
  body('issue_date').optional().isISO8601(),
  body('due_date').optional().isISO8601(),
  body('subtotal').optional().isDecimal(),
  body('tax_rate').optional().isDecimal(),
  body('status').optional().isIn(['draft', 'sent', 'paid', 'overdue', 'cancelled'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { 
      invoice_number, issue_date, due_date, subtotal, tax_rate, tax_amount, 
      total_amount, status, payment_method, payment_date, notes, items
    } = req.body;

    // Vérifier que la facture existe
    const existingInvoices = await query('SELECT id FROM invoices WHERE id = ?', [id]);
    if (existingInvoices.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    // Vérifier l'unicité du numéro de facture si modifié
    if (invoice_number) {
      const duplicateInvoices = await query('SELECT id FROM invoices WHERE invoice_number = ? AND id != ?', [invoice_number, id]);
      if (duplicateInvoices.length > 0) {
        return res.status(400).json({ error: 'Ce numéro de facture existe déjà' });
      }
    }

    const updateFields = [];
    const updateValues = [];

    if (invoice_number) {
      updateFields.push('invoice_number = ?');
      updateValues.push(invoice_number);
    }
    if (issue_date) {
      updateFields.push('issue_date = ?');
      updateValues.push(issue_date);
    }
    if (due_date) {
      updateFields.push('due_date = ?');
      updateValues.push(due_date);
    }
    if (subtotal) {
      updateFields.push('subtotal = ?');
      updateValues.push(subtotal);
    }
    if (tax_rate) {
      updateFields.push('tax_rate = ?');
      updateValues.push(tax_rate);
    }
    if (tax_amount) {
      updateFields.push('tax_amount = ?');
      updateValues.push(tax_amount);
    }
    if (total_amount) {
      updateFields.push('total_amount = ?');
      updateValues.push(total_amount);
    }
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    if (payment_method) {
      updateFields.push('payment_method = ?');
      updateValues.push(payment_method);
    }
    if (payment_date) {
      updateFields.push('payment_date = ?');
      updateValues.push(payment_date);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      updateValues.push(notes);
    }

    if (updateFields.length > 0) {
      updateValues.push(id);
      await query(
        `UPDATE invoices SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    // Mettre à jour les lignes de facture si fournies
    if (items) {
      // Supprimer les anciennes lignes
      await query('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
      
      // Créer les nouvelles lignes
      for (const item of items) {
        await query(
          'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)',
          [id, item.description, item.quantity, item.unit_price, item.total_price]
        );
      }
    }

    res.json({ message: 'Facture mise à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la facture:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la facture' });
  }
});

// Marquer une facture comme envoyée
router.post('/:id/send', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    const invoices = await query('SELECT id, status FROM invoices WHERE id = ?', [id]);
    if (invoices.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    if (invoices[0].status === 'sent') {
      return res.status(400).json({ error: 'La facture a déjà été envoyée' });
    }

    await query('UPDATE invoices SET status = "sent" WHERE id = ?', [id]);

    res.json({ message: 'Facture marquée comme envoyée' });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la facture:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi de la facture' });
  }
});

// Marquer une facture comme payée
router.post('/:id/mark-paid', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_method, payment_date, reference_number, notes } = req.body;

    const invoices = await query('SELECT id, status FROM invoices WHERE id = ?', [id]);
    if (invoices.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    if (invoices[0].status === 'paid') {
      return res.status(400).json({ error: 'La facture est déjà marquée comme payée' });
    }

    await query(
      'UPDATE invoices SET status = "paid", payment_method = ?, payment_date = ? WHERE id = ?',
      [payment_method || null, payment_date || new Date().toISOString().split('T')[0], id]
    );

    res.json({ message: 'Facture marquée comme payée' });
  } catch (error) {
    console.error('Erreur lors du marquage de la facture comme payée:', error);
    res.status(500).json({ error: 'Erreur lors du marquage de la facture comme payée' });
  }
});

// Supprimer une facture
router.delete('/:id', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    const invoices = await query('SELECT id FROM invoices WHERE id = ?', [id]);
    if (invoices.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    // Supprimer les lignes de facture et les paiements
    await query('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
    await query('DELETE FROM payments WHERE invoice_id = ?', [id]);
    await query('DELETE FROM invoices WHERE id = ?', [id]);

    res.json({ message: 'Facture supprimée avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression de la facture:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de la facture' });
  }
});

// Obtenir les statistiques des factures
router.get('/stats/overview', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_invoices,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_invoices,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_invoices,
        SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue_invoices,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_invoices,
        SUM(total_amount) as total_amount,
        SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as paid_amount,
        SUM(CASE WHEN status = 'sent' THEN total_amount ELSE 0 END) as pending_amount
      FROM invoices
    `);

    const monthlyStats = await query(`
      SELECT 
        DATE_FORMAT(issue_date, '%Y-%m') as month,
        COUNT(*) as count,
        SUM(total_amount) as amount
      FROM invoices 
      WHERE issue_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(issue_date, '%Y-%m')
      ORDER BY month DESC
    `);

    const clientStats = await query(`
      SELECT 
        c.company_name,
        COUNT(i.id) as invoice_count,
        SUM(i.total_amount) as total_amount
      FROM clients c
      LEFT JOIN invoices i ON c.id = i.client_id
      GROUP BY c.id, c.company_name
      HAVING invoice_count > 0
      ORDER BY total_amount DESC
      LIMIT 10
    `);

    res.json({
      overview: stats[0],
      monthly: monthlyStats,
      topClients: clientStats
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

// Générer un numéro de facture automatique
router.get('/generate-number', authenticateToken, async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}`;
    
    const lastInvoice = await query(
      'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1',
      [`${prefix}%`]
    );

    let nextNumber = 1;
    if (lastInvoice.length > 0) {
      const lastNumber = parseInt(lastInvoice[0].invoice_number.split('-')[2]) || 0;
      nextNumber = lastNumber + 1;
    }

    const invoiceNumber = `${prefix}-${nextNumber.toString().padStart(4, '0')}`;
    
    res.json({ invoice_number: invoiceNumber });
  } catch (error) {
    console.error('Erreur lors de la génération du numéro de facture:', error);
    res.status(500).json({ error: 'Erreur lors de la génération du numéro de facture' });
  }
});

module.exports = router;